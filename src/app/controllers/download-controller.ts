import { useAppStore } from "@app/store/use-app-store";
import { appendDownloadHistoryId } from "@lib/db/download-history-db";
import { buildArchiveWorkPlan } from "@lib/archive-organizer/build-archive-work-plan";
import { downloadBlob, downloadTextFile } from "@lib/utils/download-utils";
import { selectSelectedVideoRows } from "@app/store/selectors";
import { createLogger } from "@lib/logging/logger";
import { getDraftGenerationId } from "@lib/normalize/shared";
import { sendBackgroundRequest } from "@lib/background/client";
import type { ResolveDraftReferenceResponse } from "types/background";
import type { ArchiveSupplementalEntry, DownloadProgressState, VideoRow } from "types/domain";

const logger = createLogger("download-controller");
const MAX_PART_FILE_COUNT = 4000;
const MAX_PART_ESTIMATED_BYTES = 1_350_000_000;
const FALLBACK_ROW_ESTIMATED_BYTES = 20_000_000;
const DRAFT_RESOLUTION_SAFE_DELAY_MS = 900;
const DRAFT_RESOLUTION_MAX_RETRIES = 4;

interface ZipWorkerProgressMessage {
  type: "progress";
  payload: DownloadProgressState;
}

interface ZipWorkerCompleteMessage {
  type: "complete";
  payload: {
    archive_name: string;
    blob: Blob;
  };
}

interface ZipWorkerErrorMessage {
  type: "error";
  payload: {
    error: string;
  };
}

/**
 * Builds one or more ZIP parts in page-owned workers, downloads each part, and
 * then appends resolved ids to permanent download history.
 */
export async function downloadSelectedRows(): Promise<void> {
  const state = useAppStore.getState();
  const selectedRows = selectSelectedVideoRows(state);
  const fallbackRows = state.video_rows.filter((row) => row.is_downloadable);
  const targetCandidateRows = selectedRows.length > 0 ? selectedRows : fallbackRows;

  state.setPhase("downloading");
  state.setDownloadProgress({
    active_label: "Preparing download handoff…",
    completed_items: 0,
    running_workers: 0,
    total_items: targetCandidateRows.length,
    total_workers: 0,
    worker_progress: []
  });

  const resolvedTargetRows = await resolveDraftRowsForDownload(targetCandidateRows);
  const targetRows = resolvedTargetRows.filter((row) => row.is_downloadable && row.video_id);

  if (targetRows.length === 0) {
    state.setPhase("ready");
    throw new Error("Select at least one downloadable row before building the ZIP.");
  }
  const rootWorkPlan = buildArchiveWorkPlan(targetRows, state.settings.archive_name_template);
  const zipParts = splitRowsIntoZipParts(rootWorkPlan.rows);
  const totalParts = zipParts.length;
  const carryForwardCompletedItems = useAppStore.getState().download_progress.completed_items;
  logger.info("zip build start", {
    selected_rows: rootWorkPlan.rows.length,
    archive_name: rootWorkPlan.archive_name,
    parts: totalParts
  });

  state.setDownloadProgress({
    active_label: totalParts > 1 ? `Preparing ZIP part 1/${totalParts}…` : "Preparing Archive…",
    completed_items: Math.min(rootWorkPlan.rows.length, Math.max(0, carryForwardCompletedItems)),
    running_workers: 0,
    total_items: rootWorkPlan.rows.length,
    total_workers: 0,
    worker_progress: []
  });

  let completedRowsAcrossParts = 0;
  for (let index = 0; index < zipParts.length; index += 1) {
    const partRows = zipParts[index];
    const partNumber = index + 1;
    const partWorkPlan = buildArchiveWorkPlan(partRows, rootWorkPlan.archive_name);
    if (totalParts > 1) {
      partWorkPlan.supplemental_entries = [
        ...partWorkPlan.supplemental_entries,
        buildSplitArchiveReadmeEntry(rootWorkPlan.archive_name, totalParts)
      ];
    }
    const partArchiveName = buildArchiveFileName(rootWorkPlan.archive_name, partNumber, totalParts);

    logger.info("zip part start", {
      part_number: partNumber,
      total_parts: totalParts,
      selected_rows: partRows.length,
      archive_name: partArchiveName
    });
    const partArchiveBlob = await buildZipPart(partWorkPlan, {
      completedRowsAcrossParts,
      totalRows: rootWorkPlan.rows.length,
      partNumber,
      totalParts
    });
    completedRowsAcrossParts += partRows.length;
    downloadBlob(partArchiveName, partArchiveBlob);
    await waitForNextTick();
  }

  if (totalParts > 1) {
    downloadExtractionHelpersForSplitArchive(rootWorkPlan.archive_name);
  }

  for (const row of rootWorkPlan.rows) {
    if (!row.video_id.startsWith("s_")) {
      continue;
    }
    await appendDownloadHistoryId(row.video_id);
    state.appendDownloadHistoryId(row.video_id);
  }

  state.setPhase("ready");
  state.setDownloadProgress({
    active_label: "Archive Ready",
    completed_items: rootWorkPlan.rows.length,
    running_workers: 0,
    total_items: rootWorkPlan.rows.length,
    worker_progress: []
  });
  logger.info("archive built", {
    rowCount: rootWorkPlan.rows.length,
    parts: totalParts
  });
}

async function buildZipPart(
  partWorkPlan: ReturnType<typeof buildArchiveWorkPlan>,
  options: {
    completedRowsAcrossParts: number;
    totalRows: number;
    partNumber: number;
    totalParts: number;
  }
): Promise<Blob> {
  const state = useAppStore.getState();
  const worker = new Worker(new URL("../../../workers/zip.worker.ts", import.meta.url), { type: "module" });
  const partPrefix = options.totalParts > 1 ? `Part ${options.partNumber}/${options.totalParts} · ` : "";

  return new Promise<Blob>((resolve, reject) => {
    let lastLoggedActiveLabel = "";

    worker.addEventListener("message", (event: MessageEvent<ZipWorkerProgressMessage | ZipWorkerCompleteMessage | ZipWorkerErrorMessage>) => {
      if (event.data.type === "progress") {
        const partProgress = event.data.payload;
        const partCompletedItems = Math.min(partWorkPlan.rows.length, partProgress.completed_items);
        const aggregateCompletedItems = Math.min(options.totalRows, options.completedRowsAcrossParts + partCompletedItems);
        const currentCompletedItems = useAppStore.getState().download_progress.completed_items;
        state.setDownloadProgress({
          ...partProgress,
          active_label: `${partPrefix}${partProgress.active_label || "Building archive"}`.trim(),
          completed_items: Math.max(currentCompletedItems, aggregateCompletedItems),
          total_items: options.totalRows
        });
        const nextActiveLabel = partProgress.active_label.trim();
        if (nextActiveLabel && nextActiveLabel !== lastLoggedActiveLabel) {
          const firstWorker = partProgress.worker_progress[0];
          logger.info("zip progress", {
            active_label: `${partPrefix}${nextActiveLabel}`,
            completed_items: aggregateCompletedItems,
            total_items: options.totalRows,
            worker: firstWorker
              ? {
                  id: firstWorker.worker_id,
                  status: firstWorker.status,
                  active_item_label: firstWorker.active_item_label,
                  last_completed_item_label: firstWorker.last_completed_item_label
                }
              : null
          });
          lastLoggedActiveLabel = nextActiveLabel;
        }
        return;
      }

      if (event.data.type === "complete") {
        logger.info("zip worker complete", {
          archive_name: event.data.payload.archive_name,
          part_number: options.partNumber,
          total_parts: options.totalParts,
          selected_rows: partWorkPlan.rows.length
        });
        resolve(event.data.payload.blob);
        return;
      }

      logger.error("zip worker error", {
        part_number: options.partNumber,
        total_parts: options.totalParts,
        error: event.data.payload.error
      });
      reject(new Error(event.data.payload.error));
    });

    worker.postMessage({
      type: "build-archive",
      payload: partWorkPlan
    });
  }).finally(() => worker.terminate());
}

function splitRowsIntoZipParts(
  rows: ReturnType<typeof buildArchiveWorkPlan>["rows"]
): ReturnType<typeof buildArchiveWorkPlan>["rows"][] {
  if (rows.length === 0) {
    return [];
  }

  const parts: ReturnType<typeof buildArchiveWorkPlan>["rows"][] = [];
  let currentPart: ReturnType<typeof buildArchiveWorkPlan>["rows"] = [];
  let currentPartEstimatedBytes = 0;

  for (const row of rows) {
    const rowEstimatedBytes = Math.max(1, row.estimated_size_bytes ?? FALLBACK_ROW_ESTIMATED_BYTES);
    const wouldExceedFileCount = currentPart.length >= MAX_PART_FILE_COUNT;
    const wouldExceedEstimatedBytes =
      currentPart.length > 0 && currentPartEstimatedBytes + rowEstimatedBytes > MAX_PART_ESTIMATED_BYTES;
    if (wouldExceedFileCount || wouldExceedEstimatedBytes) {
      parts.push(currentPart);
      currentPart = [];
      currentPartEstimatedBytes = 0;
    }

    currentPart.push(row);
    currentPartEstimatedBytes += rowEstimatedBytes;
  }

  if (currentPart.length > 0) {
    parts.push(currentPart);
  }

  return parts;
}

function buildArchiveFileName(baseArchiveName: string, partNumber: number, totalParts: number): string {
  if (totalParts <= 1) {
    return `${baseArchiveName}.zip`;
  }
  const partDigits = Math.max(4, String(totalParts).length);
  const normalizedPartNumber = String(partNumber).padStart(partDigits, "0");
  const normalizedTotalParts = String(totalParts).padStart(partDigits, "0");
  return `${baseArchiveName}.part-${normalizedPartNumber}-of-${normalizedTotalParts}.zip`;
}

function downloadExtractionHelpersForSplitArchive(archiveName: string): void {
  downloadTextFile("extract-all-windows.bat", buildWindowsExtractScript(archiveName));
  downloadTextFile("extract-all-macOS.command", buildMacExtractScript(archiveName));
}

function buildWindowsExtractScript(archiveName: string): string {
  const escapedArchiveName = escapeForBatchSetValue(archiveName);
  return [
    "@echo off",
    "setlocal",
    `set \"ARCHIVE_NAME=${escapedArchiveName}\"`,
    "set \"BASE_DIR=%~dp0\"",
    "set \"DEST=%BASE_DIR%%ARCHIVE_NAME%\"",
    "if not exist \"%DEST%\" mkdir \"%DEST%\"",
    "set \"FOUND_PART=0\"",
    "for %%F in (\"%BASE_DIR%%ARCHIVE_NAME%.part-*.zip\") do (",
    "  set \"FOUND_PART=1\"",
    "  powershell -NoProfile -ExecutionPolicy Bypass -Command \"Expand-Archive -Path \\\"%%~fF\\\" -DestinationPath \\\"%DEST%\\\" -Force\"",
    ")",
    "if \"%FOUND_PART%\"==\"0\" (",
    "  echo No split archives found for %ARCHIVE_NAME% in %BASE_DIR%",
    "  pause",
    "  exit /b 1",
    ")",
    "echo Extraction complete: %DEST%",
    "pause"
  ].join("\r\n");
}

function buildMacExtractScript(archiveName: string): string {
  const escapedArchiveName = escapeForSingleQuotedShell(archiveName);
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "",
    "SCRIPT_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"",
    `ARCHIVE_NAME='${escapedArchiveName}'`,
    "DEST=\"$SCRIPT_DIR/$ARCHIVE_NAME\"",
    "mkdir -p \"$DEST\"",
    "",
    "shopt -s nullglob",
    "parts=(\"$SCRIPT_DIR/$ARCHIVE_NAME\".part-*.zip)",
    "if [ ${#parts[@]} -eq 0 ]; then",
    "  echo \"No split archives found for $ARCHIVE_NAME in $SCRIPT_DIR\"",
    "  exit 1",
    "fi",
    "",
    "for z in \"${parts[@]}\"; do",
    "  unzip -oq \"$z\" -d \"$DEST\"",
    "done",
    "",
    "echo \"Extraction complete: $DEST\""
  ].join("\n");
}

function buildSplitArchiveReadmeEntry(archiveName: string, totalParts: number): ArchiveSupplementalEntry {
  const archiveNameForCommand = escapeForDoubleQuotedShell(archiveName);
  const content = [
    "Save Sora - Split Archive Extraction Guide",
    "=========================================",
    "",
    `Archive name: ${archiveName}`,
    `Parts expected: ${totalParts}`,
    "",
    "Important:",
    "- Keep all .part-*.zip files in the same folder.",
    "- Keep the helper scripts in the same folder as the parts:",
    "  - extract-all-windows.bat",
    "  - extract-all-macOS.command",
    "",
    "Windows (Recommended):",
    "1. Put all split ZIP parts and extract-all-windows.bat in one folder.",
    "2. Double-click extract-all-windows.bat.",
    `3. Files are extracted into a folder named \"${archiveName}\".`,
    "",
    "macOS (Recommended):",
    "1. Put all split ZIP parts and extract-all-macOS.command in one folder.",
    "2. Open Terminal in that folder and run:",
    "   chmod +x ./extract-all-macOS.command",
    "   ./extract-all-macOS.command",
    `3. Files are extracted into a folder named \"${archiveName}\".`,
    "",
    "Manual extraction (PowerShell on Windows):",
    "$archiveName = \"" + archiveNameForCommand + "\"",
    "$dest = Join-Path $PWD $archiveName",
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "Get-ChildItem \"$archiveName.part-*.zip\" | Sort-Object Name | ForEach-Object {",
    "  Expand-Archive -Path $_.FullName -DestinationPath $dest -Force",
    "}",
    "",
    "Manual extraction (macOS Terminal):",
    "ARCHIVE_NAME=\"" + archiveNameForCommand + "\"",
    "mkdir -p \"./$ARCHIVE_NAME\"",
    "for z in \"./$ARCHIVE_NAME\".part-*.zip; do",
    "  unzip -oq \"$z\" -d \"./$ARCHIVE_NAME\"",
    "done",
    "",
    "If extraction fails:",
    "- Verify every split part is present.",
    "- Verify all part filenames are unchanged.",
    "- Re-download missing/corrupt part files."
  ].join("\n");

  return {
    archive_path: `${archiveName}/README-EXTRACTION.txt`,
    content
  };
}

function escapeForBatchSetValue(value: string): string {
  return value
    .replace(/\^/g, "^^")
    .replace(/%/g, "%%");
}

function escapeForSingleQuotedShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeForDoubleQuotedShell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function resolveDraftRowsForDownload(rows: VideoRow[]): Promise<VideoRow[]> {
  const dedupedRows = dedupeRowsByRowId(rows);
  const rowsNeedingResolution = dedupedRows.filter(shouldResolveDraftReferenceForDownload);
  if (rowsNeedingResolution.length === 0) {
    return dedupedRows;
  }

  logger.info("download handoff resolving draft references", {
    total_rows: dedupedRows.length,
    rows_needing_resolution: rowsNeedingResolution.length
  });
  const state = useAppStore.getState();
  const resolvedByRowId = new Map<string, VideoRow>();
  const selectedIdRemap = new Map<string, string>();
  const preflightProgressCap = Math.min(
    rowsNeedingResolution.length,
    Math.max(1, Math.round(dedupedRows.length * 0.1))
  );

  for (let index = 0; index < rowsNeedingResolution.length; index += 1) {
    const row = rowsNeedingResolution[index];
    const progressLabel = `Resolving draft links ${index + 1}/${rowsNeedingResolution.length}…`;
    const preflightCompletedItems = Math.round(((index + 1) / rowsNeedingResolution.length) * preflightProgressCap);
    const currentCompletedItems = useAppStore.getState().download_progress.completed_items;
    state.setDownloadProgress({
      active_label: progressLabel,
      completed_items: Math.max(currentCompletedItems, preflightCompletedItems)
    });

    const resolvedRow = await resolveDraftRowForDownload(row);
    if (resolvedRow) {
      resolvedByRowId.set(row.row_id, resolvedRow);
      if (row.video_id && row.video_id !== resolvedRow.video_id) {
        selectedIdRemap.set(row.video_id, resolvedRow.video_id);
      }
    }

    if (index < rowsNeedingResolution.length - 1) {
      await sleep(DRAFT_RESOLUTION_SAFE_DELAY_MS);
    }
  }

  if (resolvedByRowId.size > 0) {
    const updatedRows = [...resolvedByRowId.values()];
    useAppStore.getState().upsertVideoRows(updatedRows);
  }
  if (selectedIdRemap.size > 0) {
    remapSelectedVideoIds(selectedIdRemap);
  }

  return dedupedRows.map((row) => resolvedByRowId.get(row.row_id) ?? row);
}

async function resolveDraftRowForDownload(row: VideoRow): Promise<VideoRow | null> {
  const rowPayload = parseRowPayload(row);
  const generationId = resolveDraftGenerationId(row, rowPayload);
  if (!generationId) {
    return null;
  }

  for (let attempt = 0; attempt < DRAFT_RESOLUTION_MAX_RETRIES; attempt += 1) {
    try {
      const response = await sendBackgroundRequest<ResolveDraftReferenceResponse>({
        type: "resolve-draft-reference",
        generation_id: generationId,
        detail_url: row.detail_url || undefined,
        row_payload: rowPayload || undefined
      });
      const resolvedVideoId = response.payload.video_id.trim();
      if (!resolvedVideoId) {
        return null;
      }

      const resolvedPlaybackUrl = response.payload.playback_url || row.playback_url;
      const resolvedDownloadUrl = response.payload.download_url || row.download_url || resolvedPlaybackUrl;
      return {
        ...row,
        video_id: resolvedVideoId,
        detail_url: response.payload.share_url || row.detail_url,
        thumbnail_url: response.payload.thumbnail_url || row.thumbnail_url,
        playback_url: resolvedPlaybackUrl,
        download_url: resolvedDownloadUrl,
        estimated_size_bytes:
          typeof response.payload.estimated_size_bytes === "number"
            ? response.payload.estimated_size_bytes
            : row.estimated_size_bytes,
        is_downloadable: Boolean(resolvedDownloadUrl),
        skip_reason: resolvedDownloadUrl ? "" : "missing_download_url"
      };
    } catch (error) {
      const isLastAttempt = attempt >= DRAFT_RESOLUTION_MAX_RETRIES - 1;
      if (!isRetryableDraftResolutionError(error) || isLastAttempt) {
        logger.warn("draft reference resolution failed during download handoff", {
          row_id: row.row_id,
          source: row.source_type,
          generation_id: generationId,
          attempt: attempt + 1,
          error: getUnknownErrorMessage(error)
        });
        return null;
      }
      await sleep(DRAFT_RESOLUTION_SAFE_DELAY_MS * (attempt + 1));
    }
  }

  return null;
}

function shouldResolveDraftReferenceForDownload(row: VideoRow): boolean {
  if (!isDraftSourceType(row.source_type) || !row.is_downloadable) {
    return false;
  }
  return !isResolvedVideoId(row.video_id);
}

function isDraftSourceType(sourceType: string): boolean {
  return sourceType === "drafts" || sourceType === "characterDrafts" || sourceType === "characterAccountDrafts";
}

function isResolvedVideoId(videoId: string): boolean {
  return /^s_[A-Za-z0-9_-]+$/i.test(videoId.trim());
}

function parseRowPayload(row: Pick<VideoRow, "raw_payload_json">): Record<string, unknown> | null {
  if (!row.raw_payload_json?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.raw_payload_json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveDraftGenerationId(row: VideoRow, rowPayload: Record<string, unknown> | null): string {
  const videoId = row.video_id.trim();
  if (/^gen_[A-Za-z0-9_-]+$/i.test(videoId)) {
    return videoId;
  }
  if (rowPayload) {
    const payloadGenerationId = getDraftGenerationId(rowPayload);
    if (payloadGenerationId) {
      return payloadGenerationId;
    }
  }
  const detailUrlMatch = row.detail_url.match(/\/d\/(gen_[A-Za-z0-9_-]+)/i);
  return detailUrlMatch?.[1] ?? "";
}

function dedupeRowsByRowId(rows: VideoRow[]): VideoRow[] {
  const rowMap = new Map<string, VideoRow>();
  for (const row of rows) {
    rowMap.set(row.row_id, row);
  }
  return [...rowMap.values()];
}

function remapSelectedVideoIds(remap: Map<string, string>): void {
  const state = useAppStore.getState();
  const normalizedIds = state.selected_video_ids.map((videoId) => remap.get(videoId) ?? videoId);
  const dedupedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const videoId of normalizedIds) {
    if (!videoId || seenIds.has(videoId)) {
      continue;
    }
    seenIds.add(videoId);
    dedupedIds.push(videoId);
  }
  state.setSelectedVideoIds(dedupedIds);
}

function isRetryableDraftResolutionError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error).toLowerCase();
  return (
    message.includes("status 429") ||
    message.includes("failed to fetch") ||
    message.includes("message channel closed") ||
    message.includes("message port closed") ||
    message.includes("receiving end does not exist") ||
    message.includes("back/forward cache") ||
    message.includes("status 500") ||
    message.includes("status 502") ||
    message.includes("status 503") ||
    message.includes("status 504")
  );
}

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
