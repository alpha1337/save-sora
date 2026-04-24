import { useAppStore } from "@app/store/use-app-store";
import { appendDownloadHistoryRecord, listDownloadHistoryIds } from "@lib/db/download-history-db";
import { buildArchiveWorkPlan, buildZipWorkerWorkPlan } from "@lib/archive-organizer/build-archive-work-plan";
import { downloadBlob, downloadTextFile } from "@lib/utils/download-utils";
import { selectSelectedVideoRows } from "@app/store/selectors";
import { createLogger } from "@lib/logging/logger";
import { clearDownloadQueue } from "@lib/db/session-db";
import { loadDownloadDirectoryHandle } from "@lib/db/download-directory-db";
import { runDownloadPreflight } from "./download-preflight";
import type { ArchiveSupplementalEntry, ArchiveWorkPlan, DownloadProgressState } from "types/domain";

const logger = createLogger("download-controller");
const MAX_PART_FILE_COUNT = 4000;
const MAX_PART_ESTIMATED_BYTES = 1_350_000_000;
const FALLBACK_ROW_ESTIMATED_BYTES = 20_000_000;

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
 * then hydrates permanent download history so status badges update immediately.
 */
export async function downloadSelectedRows(): Promise<void> {
  const state = useAppStore.getState();
  const selectedRows = selectSelectedVideoRows(state);
  const fallbackRows = state.video_rows.filter((row) => row.is_downloadable);
  const targetCandidateRows = selectedRows.length > 0 ? selectedRows : fallbackRows;

  state.setPhase("downloading");
  state.setDownloadProgress({
    active_label: "Preparing download handoff…",
    active_subtitle: "Building a queue from selected videos.",
    completed_items: 0,
    preflight_completed_items: 0,
    preflight_stage: "building_queue",
    preflight_stage_label: "Building Queue",
    preflight_total_items: targetCandidateRows.length,
    rejection_entries: [],
    running_workers: 0,
    swimlanes: [],
    total_items: targetCandidateRows.length,
    total_workers: 0,
    worker_progress: [],
    zip_part_completed_items: 0,
    zip_part_number: 0,
    zip_part_total_items: 0,
    zip_total_parts: 0,
    zip_completed: false
  });

  const preflightResult = await runDownloadPreflight(targetCandidateRows, {
    onProgress: (progress) => {
      useAppStore.getState().setDownloadProgress(progress);
    },
    retryPreviouslyFailedWatermarkRemovals: state.settings.retry_failed_watermark_removals === true
  });
  if (preflightResult.rows.length > 0) {
    useAppStore.getState().upsertVideoRows(preflightResult.rows);
  }
  if (preflightResult.selected_id_remap.size > 0) {
    remapSelectedVideoIds(preflightResult.selected_id_remap);
  }

  const targetRows = preflightResult.rows.filter((row) => row.is_downloadable && row.video_id);

  if (targetRows.length === 0) {
    state.setPhase("ready");
    throw new Error("Select at least one downloadable row before building the ZIP.");
  }
  const rootWorkPlan = buildArchiveWorkPlan(targetRows, state.settings.archive_name_template, preflightResult.queue);
  const zipParts = splitRowsIntoZipParts(rootWorkPlan.rows);
  const totalParts = zipParts.length;
  const downloadDirectoryHandle = await loadDownloadDirectoryHandle();
  logger.info("zip build start", {
    selected_rows: rootWorkPlan.rows.length,
    archive_name: rootWorkPlan.archive_name,
    parts: totalParts,
    download_directory: downloadDirectoryHandle?.name ?? "browser-downloads"
  });

  const finalZipPartRows = zipParts[zipParts.length - 1] ?? rootWorkPlan.rows;
  state.setDownloadProgress({
    active_label: totalParts > 1 ? `Preparing ZIP part 1/${totalParts}…` : "Preparing Archive…",
    active_subtitle: totalParts > 1 ? `Starting ZIP worker for part 1/${totalParts}.` : "Starting ZIP worker.",
    completed_items: 0,
    preflight_stage: "zipping",
    preflight_stage_label: "ZIP Worker",
    running_workers: 0,
    total_items: rootWorkPlan.rows.length,
    total_workers: 0,
    worker_progress: [],
    zip_part_completed_items: 0,
    zip_part_number: totalParts > 0 ? 1 : 0,
    zip_part_total_items: zipParts[0]?.length ?? 0,
    zip_total_parts: totalParts
  });

  let completedRowsAcrossParts = 0;
  for (let index = 0; index < zipParts.length; index += 1) {
    const partRows = zipParts[index];
    const partNumber = index + 1;
    state.setDownloadProgress({
      active_label: totalParts > 1 ? `Preparing ZIP part ${partNumber}/${totalParts}…` : "Preparing Archive…",
      active_subtitle: totalParts > 1 ? `Starting ZIP worker for part ${partNumber}/${totalParts}.` : "Starting ZIP worker.",
      completed_items: completedRowsAcrossParts,
      preflight_stage: "zipping",
      preflight_stage_label: "ZIP Worker",
      running_workers: 0,
      total_items: rootWorkPlan.rows.length,
      total_workers: 0,
      worker_progress: [],
      zip_part_completed_items: 0,
      zip_part_number: partNumber,
      zip_part_total_items: partRows.length,
      zip_total_parts: totalParts
    });
    const partWorkPlan = buildArchivePartWorkPlan(rootWorkPlan, partRows);
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
    await downloadBlob(partArchiveName, partArchiveBlob, { directoryHandle: downloadDirectoryHandle });
    await waitForNextTick();
  }

  if (totalParts > 1) {
    await downloadExtractionHelpersForSplitArchive(rootWorkPlan.archive_name, downloadDirectoryHandle);
  }

  const downloadedVideoIds = new Set<string>();
  const noWatermarkUrlByVideoId = new Map<string, string>();
  const failedWatermarkRemovalVideoIds = new Set(
    preflightResult.rejections
      .filter((entry) => entry.reason === "access_restricted")
      .map((entry) => entry.id.trim())
      .filter(Boolean)
  );
  for (const row of rootWorkPlan.rows) {
    const normalizedVideoId = row.video_id.trim();
    if (!normalizedVideoId) {
      continue;
    }
    downloadedVideoIds.add(normalizedVideoId);
    if (row.archive_variant === "no-watermark" && row.archive_download_url.trim()) {
      noWatermarkUrlByVideoId.set(normalizedVideoId, row.archive_download_url.trim());
    }
  }

  for (const videoId of downloadedVideoIds) {
    await appendDownloadHistoryRecord(videoId, noWatermarkUrlByVideoId.get(videoId) ?? null, {
      watermarkRemovalFailed: failedWatermarkRemovalVideoIds.has(videoId)
    });
    state.appendDownloadHistoryId(videoId);
  }

  try {
    const hydratedDownloadHistoryIds = await listDownloadHistoryIds();
    const hydratedDownloadHistorySet = new Set(hydratedDownloadHistoryIds);
    const latestState = useAppStore.getState();
    latestState.replaceDownloadHistoryIds(hydratedDownloadHistoryIds);
    latestState.setSelectedVideoIds(
      latestState.selected_video_ids.filter((videoId) => !hydratedDownloadHistorySet.has(videoId))
    );
  } catch (error) {
    logger.warn("download history hydration after archive build failed", {
      error: getUnknownErrorMessage(error)
    });
  }

  state.setDownloadProgress({
    active_label: "Archive Ready",
    active_subtitle: "Downloads are packaged and ready to review.",
    completed_items: rootWorkPlan.rows.length,
    preflight_stage: "completed",
    preflight_stage_label: "Summary",
    running_workers: 0,
    total_items: rootWorkPlan.rows.length,
    worker_progress: [],
    zip_part_completed_items: finalZipPartRows.length,
    zip_part_number: totalParts,
    zip_part_total_items: finalZipPartRows.length,
    zip_total_parts: totalParts,
    zip_completed: true
  });
  logger.info("archive built", {
    rowCount: rootWorkPlan.rows.length,
    parts: totalParts
  });
}

export function closeDownloadSummary(): void {
  useAppStore.getState().setPhase("ready");
}

export async function startOverDownloadSummary(): Promise<void> {
  await clearDownloadQueue();
  useAppStore.getState().clearWorkingSessionState();
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
        const currentProgress = useAppStore.getState().download_progress;
        state.setDownloadProgress({
          ...partProgress,
          active_label: `${partPrefix}${partProgress.active_label || "Building archive"}`.trim(),
          active_subtitle: partProgress.active_subtitle || "Bundling the current video.",
          completed_items: Math.max(currentProgress.completed_items, aggregateCompletedItems),
          preflight_completed_items: currentProgress.preflight_completed_items,
          preflight_stage: "zipping",
          preflight_stage_label: "ZIP Worker",
          preflight_total_items: currentProgress.preflight_total_items,
          rejection_entries: currentProgress.rejection_entries,
          swimlanes: currentProgress.swimlanes,
          total_items: options.totalRows,
          zip_part_completed_items: partCompletedItems,
          zip_part_number: options.partNumber,
          zip_part_total_items: partWorkPlan.rows.length,
          zip_total_parts: options.totalParts
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
      payload: buildZipWorkerWorkPlan(partWorkPlan)
    });
  }).finally(() => worker.terminate());
}

function buildArchivePartWorkPlan(
  rootWorkPlan: ArchiveWorkPlan,
  rows: ArchiveWorkPlan["rows"]
): ArchiveWorkPlan {
  return {
    archive_name: rootWorkPlan.archive_name,
    organizer_rows: [],
    rows,
    supplemental_entries: []
  };
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

async function downloadExtractionHelpersForSplitArchive(
  archiveName: string,
  directoryHandle: FileSystemDirectoryHandle | null
): Promise<void> {
  await downloadTextFile("extract-all-windows.bat", buildWindowsExtractScript(archiveName), "text/plain;charset=utf-8", { directoryHandle });
  await downloadTextFile("extract-all-macOS.command", buildMacExtractScript(archiveName), "text/plain;charset=utf-8", { directoryHandle });
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

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
