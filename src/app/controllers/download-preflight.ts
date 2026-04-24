import { resolveVideoVariantUrls } from "@lib/archive-organizer/build-archive-work-plan";
import { sendBackgroundRequest } from "@lib/background/client";
import { listDownloadHistoryRecords as defaultListDownloadHistoryRecords } from "@lib/db/download-history-db";
import { patchDownloadQueue, replaceDownloadQueue, type DownloadQueuePatch } from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";
import { getDraftGenerationId } from "@lib/normalize/shared";
import { removeWatermark as defaultRemoveWatermark } from "@lib/utils/remove-watermark";
import type { ResolveDraftReferenceResponse } from "types/background";
import type {
  DownloadProgressState,
  DownloadQueueItem,
  DownloadQueueLaneId,
  DownloadQueueRejectionEntry,
  DownloadQueueRejectionReason,
  DownloadQueueSwimlane,
  DownloadQueueSwimlaneItem,
  DownloadPreflightStage,
  DownloadHistoryRecord,
  VideoRow
} from "types/domain";

const logger = createLogger("download-preflight");
const PREFLIGHT_BATCH_SIZE = 24;
const WATERMARK_CONCURRENCY = 2;
const DRAFT_RESOLUTION_SAFE_DELAY_MS = 1200;
const DRAFT_RESOLUTION_MAX_RETRIES = 4;
const WATERMARK_BACKOFF_MS = [600, 1200, 2400] as const;
const GENERATION_ID_PATTERN = /^gen_[A-Za-z0-9_-]+$/i;
const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/i;
const RUN_REJECTED_WATERMARK_IDS = new Set<string>();

interface PreflightQueueEntry {
  current_id: string;
  effective_id: string;
  original_id: string;
  row: VideoRow;
  lane: DownloadQueueLaneId;
  shared_post_id: string;
  title: string;
  watermark: string;
  no_watermark: string | null;
  rejection_reason?: DownloadQueueRejectionReason;
}

export interface DownloadPreflightResult {
  rows: VideoRow[];
  queue: DownloadQueueItem[];
  rejections: DownloadQueueRejectionEntry[];
  selected_id_remap: Map<string, string>;
}

interface DownloadPreflightOptions {
  getJitterMs?: () => number;
  listDownloadHistoryRecords?: () => Promise<DownloadHistoryRecord[]>;
  onProgress?: (progress: Partial<DownloadProgressState>) => void;
  patchQueue?: (patches: DownloadQueuePatch[]) => Promise<DownloadQueueItem[]>;
  removeWatermark?: (videoId: string) => Promise<string | null>;
  replaceQueue?: (items: DownloadQueueItem[]) => Promise<DownloadQueueItem[]>;
  resolveDraftRow?: (row: VideoRow) => Promise<VideoRow | null>;
  sleep?: (durationMs: number) => Promise<void>;
}

export async function runDownloadPreflight(
  rows: VideoRow[],
  options: DownloadPreflightOptions = {}
): Promise<DownloadPreflightResult> {
  const sleep = options.sleep ?? sleepFor;
  const dependencies = {
    getJitterMs: options.getJitterMs ?? (() => Math.floor(Math.random() * 180)),
    listDownloadHistoryRecords: options.listDownloadHistoryRecords ?? defaultListDownloadHistoryRecords,
    patchQueue: options.patchQueue ?? patchDownloadQueue,
    removeWatermark: options.removeWatermark ?? defaultRemoveWatermark,
    replaceQueue: options.replaceQueue ?? replaceDownloadQueue,
    resolveDraftRow: options.resolveDraftRow ?? ((row: VideoRow) => resolveDraftRowForDownload(row, sleep)),
    sleep
  };
  const entries = buildPreflightEntries(rows);
  const historyNoWatermarkById = buildHistoryNoWatermarkMap(await dependencies.listDownloadHistoryRecords());
  for (const entry of entries) {
    applyHistoryNoWatermark(entry, historyNoWatermarkById);
  }
  const rejections: DownloadQueueRejectionEntry[] = [];
  const selectedIdRemap = new Map<string, string>();
  const publish = (
    stage: DownloadPreflightStage,
    stageLabel: string,
    activeLabel: string,
    activeSubtitle: string
  ) => {
    options.onProgress?.(buildPreflightProgress(entries, rejections, stage, stageLabel, activeLabel, activeSubtitle));
  };

  publish("building_queue", "Building Queue", "Building preflight queue", "Preparing selected videos for preflight.");
  await dependencies.replaceQueue(toQueueItems(entries));

  await processDraftEntries(entries, rejections, selectedIdRemap, historyNoWatermarkById, publish, dependencies);
  await processSharedEntries(entries, rejections, publish, dependencies);

  publish("zip_handoff", "Zip Handoff", "Queue ready for ZIP handoff", "Passing resolved sources to the ZIP worker.");
  return {
    rows: entries.map((entry) => entry.row),
    queue: toQueueItems(entries),
    rejections,
    selected_id_remap: selectedIdRemap
  };
}

export function buildInitialDownloadQueue(rows: VideoRow[]): DownloadQueueItem[] {
  return toQueueItems(buildPreflightEntries(rows));
}

function buildPreflightEntries(rows: VideoRow[]): PreflightQueueEntry[] {
  const entries: PreflightQueueEntry[] = [];
  const seenEffectiveIds = new Set<string>();

  for (const row of rows) {
    if (!row.is_downloadable || !row.video_id.trim()) {
      continue;
    }
    const queueUrls = resolveQueueUrls(row);
    if (!queueUrls.watermark) {
      continue;
    }
    const rowPayload = parseRowPayload(row);
    const sharedPostId = resolveSharedPostId(rowPayload);
    const currentId = row.video_id.trim();
    const effectiveId = sharedPostId || currentId;
    if (!effectiveId || seenEffectiveIds.has(effectiveId)) {
      continue;
    }

    seenEffectiveIds.add(effectiveId);
    entries.push({
      current_id: currentId,
      effective_id: effectiveId,
      original_id: currentId,
      row,
      lane: resolveInitialLane(currentId),
      shared_post_id: sharedPostId,
      title: row.title.trim() || currentId,
      watermark: queueUrls.watermark,
      no_watermark: queueUrls.no_watermark
    });
  }

  return entries;
}

async function processDraftEntries(
  entries: PreflightQueueEntry[],
  rejections: DownloadQueueRejectionEntry[],
  selectedIdRemap: Map<string, string>,
  historyNoWatermarkById: Map<string, string>,
  publish: (stage: DownloadPreflightStage, stageLabel: string, activeLabel: string, activeSubtitle: string) => void,
  dependencies: Required<Pick<DownloadPreflightOptions, "patchQueue" | "resolveDraftRow" | "sleep">>
): Promise<void> {
  const draftEntries = entries.filter((entry) => entry.lane === "drafts");
  for (const batch of chunkItems(draftEntries, PREFLIGHT_BATCH_SIZE)) {
    const patches: DownloadQueuePatch[] = [];
    const nonSharedEntries = batch.filter((entry) => !entry.shared_post_id);

    for (const entry of batch) {
      publish("sharing_drafts", "Sharing Drafts", entry.title, "Checking whether this draft is already shared.");
      if (entry.shared_post_id) {
        patches.push(markEntryShared(entry, entry.shared_post_id, selectedIdRemap, historyNoWatermarkById));
        publish("sharing_drafts", "Sharing Drafts", entry.title, "Moving shared video to source resolution.");
        continue;
      }

      const resolvedRow = await dependencies.resolveDraftRow(entry.row);
      if (resolvedRow && isSharedVideoId(resolvedRow.video_id)) {
        patches.push(markEntryShared(entry, resolvedRow.video_id, selectedIdRemap, historyNoWatermarkById, resolvedRow));
        publish("sharing_drafts", "Sharing Drafts", entry.title, "Shared draft and refreshed download URLs.");
      } else {
        const rejectionPatch = markEntryRejected(entry, "could_not_share_video", rejections);
        if (rejectionPatch) {
          patches.push(rejectionPatch);
        }
        publish("sharing_drafts", "Sharing Drafts", entry.title, "Using watermarked fallback because sharing failed.");
      }

      if (!entry.shared_post_id && nonSharedEntries.indexOf(entry) < nonSharedEntries.length - 1) {
        await dependencies.sleep(DRAFT_RESOLUTION_SAFE_DELAY_MS);
      }
    }

    if (patches.length > 0) {
      await dependencies.patchQueue(patches);
    }
  }
}

async function processSharedEntries(
  entries: PreflightQueueEntry[],
  rejections: DownloadQueueRejectionEntry[],
  publish: (stage: DownloadPreflightStage, stageLabel: string, activeLabel: string, activeSubtitle: string) => void,
  dependencies: Required<Pick<DownloadPreflightOptions, "getJitterMs" | "patchQueue" | "removeWatermark" | "sleep">>
): Promise<void> {
  const sharedEntries = entries.filter((entry) => entry.lane === "shared" && isSharedVideoId(entry.current_id));
  for (const batch of chunkItems(sharedEntries, PREFLIGHT_BATCH_SIZE)) {
    const patches: DownloadQueuePatch[] = [];
    await runWithConcurrency(batch, WATERMARK_CONCURRENCY, async (entry) => {
      entry.lane = "processing";
      publish("resolving_sources", "Resolving Sources", entry.title, "Resolving the best available source URL.");

      if (entry.no_watermark) {
        entry.lane = "watermark_removed";
        publish("resolving_sources", "Resolving Sources", entry.title, "Using existing no-watermark source.");
        return;
      }

      const resolvedUrl = await resolveNoWatermarkWithRetry(entry.current_id, dependencies);
      if (resolvedUrl) {
        entry.no_watermark = resolvedUrl;
        entry.row = {
          ...entry.row,
          download_url: resolvedUrl,
          is_downloadable: true,
          skip_reason: ""
        };
        patches.push({
          current_id: entry.current_id,
          no_watermark: resolvedUrl
        });
        entry.lane = "watermark_removed";
        publish("resolving_sources", "Resolving Sources", entry.title, "No-watermark source resolved.");
        return;
      }

      markEntryRejected(entry, "access_restricted", rejections);
      publish("resolving_sources", "Resolving Sources", entry.title, "Using watermarked fallback because access is restricted.");
    });

    if (patches.length > 0) {
      await dependencies.patchQueue(patches);
    }
  }
}

function markEntryShared(
  entry: PreflightQueueEntry,
  sharedVideoId: string,
  selectedIdRemap: Map<string, string>,
  historyNoWatermarkById: Map<string, string>,
  resolvedRow?: VideoRow
): DownloadQueuePatch {
  const previousId = entry.current_id;
  const nextRow = resolvedRow ?? {
    ...entry.row,
    video_id: sharedVideoId,
    detail_url: entry.row.detail_url || `https://sora.chatgpt.com/p/${sharedVideoId}`,
    playback_url: entry.watermark,
    download_url: entry.no_watermark ?? entry.watermark,
    is_downloadable: true,
    skip_reason: ""
  };
  const queueUrls = resolveQueueUrls(nextRow);

  entry.current_id = sharedVideoId;
  entry.effective_id = sharedVideoId;
  entry.lane = "shared";
  entry.row = nextRow;
  entry.watermark = queueUrls.watermark || entry.watermark;
  entry.no_watermark = queueUrls.no_watermark ?? entry.no_watermark;
  applyHistoryNoWatermark(entry, historyNoWatermarkById);
  if (previousId !== sharedVideoId) {
    selectedIdRemap.set(previousId, sharedVideoId);
  }

  return {
    current_id: previousId,
    id: sharedVideoId,
    watermark: entry.watermark,
    no_watermark: entry.no_watermark
  };
}

function markEntryRejected(
  entry: PreflightQueueEntry,
  reason: DownloadQueueRejectionReason,
  rejections: DownloadQueueRejectionEntry[]
): DownloadQueuePatch | null {
  const hadNoWatermark = entry.no_watermark !== null;
  entry.lane = "watermarked";
  entry.no_watermark = null;
  entry.rejection_reason = reason;
  rejections.push({
    id: entry.current_id,
    title: entry.title,
    reason
  });
  return hadNoWatermark
    ? {
        current_id: entry.current_id,
        no_watermark: null
      }
    : null;
}

function buildHistoryNoWatermarkMap(records: DownloadHistoryRecord[]): Map<string, string> {
  const historyNoWatermarkById = new Map<string, string>();
  for (const record of records) {
    const videoId = record.video_id.trim();
    const noWatermarkUrl = record.no_watermark?.trim() ?? "";
    if (videoId && noWatermarkUrl) {
      historyNoWatermarkById.set(videoId, noWatermarkUrl);
    }
  }
  return historyNoWatermarkById;
}

function applyHistoryNoWatermark(
  entry: PreflightQueueEntry,
  historyNoWatermarkById: Map<string, string>
): boolean {
  const historyUrl = pickFirstTrimmed([
    historyNoWatermarkById.get(entry.current_id),
    historyNoWatermarkById.get(entry.effective_id),
    historyNoWatermarkById.get(entry.shared_post_id),
    historyNoWatermarkById.get(entry.original_id)
  ]);
  if (!historyUrl) {
    return false;
  }

  entry.no_watermark = historyUrl;
  entry.row = {
    ...entry.row,
    download_url: historyUrl,
    is_downloadable: true,
    skip_reason: ""
  };
  return true;
}

function buildPreflightProgress(
  entries: PreflightQueueEntry[],
  rejections: DownloadQueueRejectionEntry[],
  stage: DownloadPreflightStage,
  stageLabel: string,
  activeLabel: string,
  activeSubtitle: string
): Partial<DownloadProgressState> {
  return {
    active_label: activeLabel,
    active_subtitle: activeSubtitle,
    preflight_completed_items: entries.filter((entry) => isZipHandoffLane(entry.lane)).length,
    preflight_stage: stage,
    preflight_stage_label: stageLabel,
    preflight_total_items: entries.length,
    rejection_entries: [...rejections],
    swimlanes: buildSwimlanes(entries),
    total_items: entries.length,
    zip_completed: false
  };
}

function buildSwimlanes(entries: PreflightQueueEntry[]): DownloadQueueSwimlane[] {
  return LANE_DEFINITIONS.map((lane) => ({
    ...lane,
    items: entries
      .filter((entry) => entry.lane === lane.id)
      .map((entry): DownloadQueueSwimlaneItem => ({
        id: entry.current_id,
        title: entry.title,
        reason: entry.rejection_reason
      }))
  }));
}

const LANE_DEFINITIONS: Array<{ id: DownloadQueueLaneId; label: string }> = [
  { id: "drafts", label: "Drafts" },
  { id: "shared", label: "Shared" },
  { id: "processing", label: "Processing" },
  { id: "watermarked", label: "Watermarked" },
  { id: "watermark_removed", label: "Watermark Removed" }
];

function toQueueItems(entries: PreflightQueueEntry[]): DownloadQueueItem[] {
  return entries.map((entry) => ({
    id: entry.current_id,
    watermark: entry.watermark,
    no_watermark: entry.no_watermark
  }));
}

function resolveInitialLane(videoId: string): DownloadQueueLaneId {
  if (GENERATION_ID_PATTERN.test(videoId)) {
    return "drafts";
  }
  if (isSharedVideoId(videoId)) {
    return "shared";
  }
  return "watermarked";
}

function resolveQueueUrls(row: VideoRow): { watermark: string; no_watermark: string | null } {
  const variantUrls = resolveVideoVariantUrls(row);
  const watermark = pickFirstTrimmed([
    variantUrls.watermark,
    row.playback_url,
    row.download_url,
    variantUrls.noWatermark
  ]);
  const noWatermark = pickFirstTrimmed([variantUrls.noWatermark]);
  return {
    watermark,
    no_watermark: noWatermark && noWatermark !== watermark ? noWatermark : null
  };
}

async function resolveNoWatermarkWithRetry(
  videoId: string,
  dependencies: Required<Pick<DownloadPreflightOptions, "getJitterMs" | "removeWatermark" | "sleep">>
): Promise<string | null> {
  if (RUN_REJECTED_WATERMARK_IDS.has(videoId)) {
    return null;
  }

  for (let attempt = 0; attempt <= WATERMARK_BACKOFF_MS.length; attempt += 1) {
    try {
      const resolvedUrl = normalizeOptionalUrl(await dependencies.removeWatermark(videoId));
      if (resolvedUrl) {
        return resolvedUrl;
      }
      RUN_REJECTED_WATERMARK_IDS.add(videoId);
      return null;
    } catch (error) {
      const isLastAttempt = attempt >= WATERMARK_BACKOFF_MS.length;
      if (isLastAttempt) {
        RUN_REJECTED_WATERMARK_IDS.add(videoId);
        logger.warn("watermark removal failed", {
          video_id: videoId,
          error: getUnknownErrorMessage(error)
        });
        return null;
      }
      await dependencies.sleep(WATERMARK_BACKOFF_MS[attempt] + dependencies.getJitterMs());
    }
  }

  return null;
}

async function resolveDraftRowForDownload(
  row: VideoRow,
  sleep: (durationMs: number) => Promise<void>
): Promise<VideoRow | null> {
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
        logger.warn("draft reference resolution failed during preflight", {
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

function resolveDraftGenerationId(row: VideoRow, rowPayload: Record<string, unknown> | null): string {
  const videoId = row.video_id.trim();
  if (GENERATION_ID_PATTERN.test(videoId)) {
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

function resolveSharedPostId(rowPayload: Record<string, unknown> | null): string {
  if (!rowPayload) {
    return "";
  }
  const draftRecord = asRecord(rowPayload.draft);
  return pickFirstSharedVideoId([
    getPostObjectSharedId(asRecord(rowPayload.post)),
    getPostObjectSharedId(asRecord(draftRecord.post)),
    rowPayload.resolved_video_id,
    rowPayload.resolvedVideoId,
    draftRecord.resolved_video_id,
    draftRecord.resolvedVideoId,
    extractSharedIdFromUrl(rowPayload.resolved_share_url),
    extractSharedIdFromUrl(rowPayload.resolvedShareUrl),
    extractSharedIdFromUrl(draftRecord.resolved_share_url),
    extractSharedIdFromUrl(draftRecord.resolvedShareUrl)
  ]);
}

function getPostObjectSharedId(postRecord: Record<string, unknown>): string {
  if (Object.keys(postRecord).length === 0) {
    return "";
  }
  const nestedPost = asRecord(postRecord.post);
  return pickFirstSharedVideoId([
    nestedPost.id,
    nestedPost.post_id,
    nestedPost.postId,
    postRecord.id,
    postRecord.post_id,
    postRecord.postId,
    postRecord.shared_post_id,
    postRecord.sharedPostId
  ]);
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

function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  workerFn: (value: T) => Promise<void>
): Promise<void> {
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < values.length) {
      const value = values[currentIndex];
      currentIndex += 1;
      await workerFn(value);
    }
  }

  return Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  ).then(() => undefined);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isZipHandoffLane(lane: DownloadQueueLaneId): boolean {
  return lane === "watermarked" || lane === "watermark_removed";
}

function pickFirstTrimmed(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeOptionalUrl(value: string | null): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickFirstSharedVideoId(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && isSharedVideoId(value.trim())) {
      return value.trim();
    }
  }
  return "";
}

function extractSharedIdFromUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const match = value.match(/\/p\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isSharedVideoId(value: string): boolean {
  return SHARED_VIDEO_ID_PATTERN.test(value.trim());
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

async function sleepFor(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
