/// <reference lib="webworker" />
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { ArchiveWorkPlan, DownloadProgressState, DownloadWorkerProgress } from "../src/types/domain";

interface BuildArchiveMessage {
  type: "build-archive";
  payload: ArchiveWorkPlan;
}

const ZIP_FETCH_CONCURRENCY = 1;
const WATERMARK_FETCH_MAX_ATTEMPTS = 12;
const WATERMARK_FETCH_BASE_RETRY_MS = 1200;
const WATERMARK_FETCH_MAX_RETRY_MS = 20000;
const WATERMARK_QUEUE_MIN_INTERVAL_MS = 1800;
const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
const MIN_VIDEO_BYTES_FALLBACK_THRESHOLD = 256 * 1024;
const ESTIMATED_SIZE_FALLBACK_RATIO = 0.2;
const WATERMARK_VALIDATION_RETRY_DELAY_MS = 1600;
let globalRateLimitCooldownUntilMs = 0;
let watermarkRateLimitStreak = 0;
let watermarkQueueTail: Promise<void> = Promise.resolve();
let lastWatermarkRequestStartedAtMs = 0;

self.addEventListener("message", (event: MessageEvent<BuildArchiveMessage>) => {
  if (event.data.type !== "build-archive") {
    return;
  }

  void buildArchive(event.data.payload).catch((error) => {
    self.postMessage({
      type: "error",
      payload: { error: error instanceof Error ? error.message : String(error) }
    });
  });
});

async function buildArchive(workPlan: ArchiveWorkPlan): Promise<void> {
  const libraryPathByVideoId = new Map(workPlan.organizer_rows.map((row) => [row.video_id, row.library_path]));
  const chunks: Uint8Array[] = [];
  const totalWorkers = Math.min(ZIP_FETCH_CONCURRENCY, workPlan.rows.length);
  const workerProgress = createWorkerProgress(totalWorkers);
  let completedItems = 0;
  let activeLabel = "Preparing archive";
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      throw error;
    }
    chunks.push(chunk);
    if (final) {
      const archiveBlob = new Blob(chunks as unknown as BlobPart[], { type: "application/zip" });
      self.postMessage({
        type: "complete",
        payload: {
          archive_name: workPlan.archive_name,
          blob: archiveBlob
        }
      });
    }
  });

  const publishProgress = () => {
    const payload: DownloadProgressState = {
      active_label: activeLabel,
      completed_items: completedItems,
      running_workers: workerProgress.filter((worker) => worker.status === "running").length,
      total_items: workPlan.rows.length,
      total_workers: workerProgress.length,
      worker_progress: workerProgress.map((worker) => ({ ...worker }))
    };

    self.postMessage({
      type: "progress",
      payload
    });
  };

  publishProgress();

  await runWithConcurrency(
    workPlan.rows,
    totalWorkers,
    async (row, _index, workerIndex) => {
      const worker = workerProgress[workerIndex];
      const itemTitle = row.title?.trim();
      const itemLabel = itemTitle ? `${itemTitle} · ${row.video_id}` : row.video_id;
      worker.status = "running";
      worker.active_item_label = "Preparing download";
      activeLabel = `Bundling ${itemLabel}`;
      publishProgress();
      try {
        const bytes = await fetchPreferredVideoBytes(row, (statusLabel) => {
          worker.active_item_label = statusLabel;
          activeLabel = `${itemLabel} · ${statusLabel}`;
          publishProgress();
        });
        worker.active_item_label = "Download ready";
        publishProgress();
        const entry = new ZipPassThrough(libraryPathByVideoId.get(row.video_id) ?? `library/${row.video_id}.mp4`);
        zip.add(entry);
        entry.push(bytes, true);
        worker.last_completed_item_label = "Complete!";
      } catch (_error) {
        worker.last_completed_item_label = "Skipped: download unavailable";
      } finally {
        completedItems += 1;
        worker.completed_items += 1;
        worker.active_item_label = "";
        publishProgress();
      }
    },
    (workerIndex) => {
      const worker = workerProgress[workerIndex];
      worker.active_item_label = "";
      worker.status = "completed";
      publishProgress();
    }
  );

  activeLabel = "Finalizing archive";
  publishProgress();

  for (const supplementalEntry of workPlan.supplemental_entries) {
    const entry = new ZipPassThrough(supplementalEntry.archive_path);
    zip.add(entry);
    if (typeof supplementalEntry.content === "string") {
      entry.push(strToU8(supplementalEntry.content), true);
    } else {
      entry.push(new Uint8Array(await supplementalEntry.content.arrayBuffer()), true);
    }
  }

  zip.end();
}

function createWorkerProgress(totalWorkers: number): DownloadWorkerProgress[] {
  return Array.from({ length: totalWorkers }, (_value, index) => ({
    worker_id: `zip-worker-${index + 1}`,
    label: `Worker ${index + 1}`,
    status: "pending",
    completed_items: 0,
    active_item_label: "",
    last_completed_item_label: ""
  }));
}

async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  workerFn: (value: T, index: number, workerIndex: number) => Promise<void>,
  onWorkerComplete: (workerIndex: number) => Promise<void> | void
): Promise<void> {
  let currentIndex = 0;

  async function worker(workerIndex: number) {
    while (currentIndex < values.length) {
      const index = currentIndex;
      const value = values[index];
      currentIndex += 1;
      await workerFn(value, index, workerIndex);
    }

    await onWorkerComplete(workerIndex);
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, (_value, workerIndex) => worker(workerIndex)));
}

async function fetchPreferredVideoBytes(
  row: ArchiveWorkPlan["rows"][number],
  onStatusLabel?: (statusLabel: string) => void
): Promise<Uint8Array> {
  if (SHARED_VIDEO_ID_PATTERN.test(row.video_id)) {
    for (let attempt = 0; attempt < WATERMARK_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const attemptLabel = `${attempt + 1}/${WATERMARK_FETCH_MAX_ATTEMPTS}`;
      try {
        const bytes = await fetchWatermarkFreeVideoBytes(
          row.video_id,
          attempt,
          WATERMARK_FETCH_MAX_ATTEMPTS,
          onStatusLabel
        );
        if (shouldFallbackToSourceDownload(row, bytes)) {
          if (attempt + 1 < WATERMARK_FETCH_MAX_ATTEMPTS) {
            const retryDelayMs = resolveValidationRetryDelayMs(attempt);
            onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: payload too small, retrying in ${formatDurationMs(retryDelayMs)}`);
            await sleep(retryDelayMs);
            continue;
          }
          if (!row.playback_url) {
            throw new Error("Watermark-free payload is unexpectedly small and source URL is unavailable.");
          }
          onStatusLabel?.("Failed to remove watermark, downloading source URL");
          return fetchDirectVideoBytes(row.playback_url);
        }
        return bytes;
      } catch (error) {
        if (attempt + 1 < WATERMARK_FETCH_MAX_ATTEMPTS) {
          const retryDelayMs = resolveValidationRetryDelayMs(attempt);
          onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: retrying in ${formatDurationMs(retryDelayMs)}`);
          await sleep(retryDelayMs);
          continue;
        }
        if (!row.playback_url) {
          throw error;
        }
        onStatusLabel?.("Failed to remove watermark, downloading source URL");
        return fetchDirectVideoBytes(row.playback_url);
      }
    }

    if (row.playback_url) {
      onStatusLabel?.("Failed to remove watermark, downloading source URL");
      return fetchDirectVideoBytes(row.playback_url);
    }
    throw new Error("Failed to remove watermark.");
  }

  if (row.playback_url) {
    onStatusLabel?.("Using source download URL");
    return fetchDirectVideoBytes(row.playback_url);
  }

  throw new Error("Draft is unresolved: missing shared post id (s_*). Re-fetch drafts to resolve before building ZIP.");
}

async function fetchDirectVideoBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Source video download failed (status ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchWatermarkFreeVideoBytes(
  videoId: string,
  attempt: number,
  maxAttempts: number,
  onStatusLabel?: (statusLabel: string) => void
): Promise<Uint8Array> {
  const attemptLabel = `${attempt + 1}/${maxAttempts}`;
  onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: preparing request`);
  const response = await runSerializedWatermarkRequest(() =>
    fetch(`https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}`),
    onStatusLabel,
    attemptLabel
  );
  if (response.ok) {
    onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: validating response`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!isLikelyVideoPayload(bytes, contentType)) {
      throw new Error("Watermark removal returned a non-video payload.");
    }
    watermarkRateLimitStreak = 0;
    onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: watermark removed`);
    return bytes;
  }
  const status = response.status;
  if (status === 429) {
    watermarkRateLimitStreak += 1;
    const retryDelayMs = resolveRetryDelayMs(response, 0, watermarkRateLimitStreak);
    globalRateLimitCooldownUntilMs = Date.now() + retryDelayMs;
    onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: rate-limited, cooling down ${formatDurationMs(retryDelayMs)}`);
  } else {
    watermarkRateLimitStreak = 0;
    onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: request failed (status ${status})`);
  }
  throw new Error(buildWatermarkRemovalErrorMessage(status));
}

function resolveValidationRetryDelayMs(attempt: number): number {
  const dynamicDelayMs = WATERMARK_VALIDATION_RETRY_DELAY_MS * (attempt + 1);
  return Math.min(WATERMARK_FETCH_MAX_RETRY_MS, dynamicDelayMs + jitterMs(400));
}

function shouldFallbackToSourceDownload(
  row: ArchiveWorkPlan["rows"][number],
  bytes: Uint8Array
): boolean {
  if (!row.playback_url) {
    return false;
  }
  if (!Number.isFinite(row.estimated_size_bytes ?? NaN) || (row.estimated_size_bytes ?? 0) <= 0) {
    return bytes.byteLength < MIN_VIDEO_BYTES_FALLBACK_THRESHOLD;
  }
  const estimatedSizeBytes = row.estimated_size_bytes ?? 0;
  const minimumExpectedBytes = Math.max(
    MIN_VIDEO_BYTES_FALLBACK_THRESHOLD,
    Math.floor(estimatedSizeBytes * ESTIMATED_SIZE_FALLBACK_RATIO)
  );
  return bytes.byteLength < minimumExpectedBytes;
}

function isLikelyVideoPayload(bytes: Uint8Array, contentType: string): boolean {
  if (contentType.includes("video/")) {
    return true;
  }
  if (contentType.includes("application/octet-stream") || !contentType) {
    return hasVideoContainerSignature(bytes);
  }
  return hasVideoContainerSignature(bytes);
}

function hasVideoContainerSignature(bytes: Uint8Array): boolean {
  return hasMp4FtypSignature(bytes) || hasWebmSignature(bytes);
}

function hasMp4FtypSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) {
    return false;
  }
  return bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}

function hasWebmSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 4) {
    return false;
  }
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function buildWatermarkRemovalErrorMessage(status: number): string {
  if (status === 429) {
    return "Watermark removal is being rate-limited right now. Please wait a minute and try Build ZIP again.";
  }
  if (status === 400) {
    return "Watermark removal is unavailable for one or more selected videos right now. They may still be processing.";
  }
  if (status === 404) {
    return "A selected video is no longer available for watermark removal.";
  }
  if (status >= 500) {
    return "Watermark removal is temporarily unavailable due to a server issue. Please retry shortly.";
  }
  return `Watermark removal failed (status ${status}).`;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1000;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function resolveRetryDelayMs(response: Response, attempt: number, rateLimitStreak: number): number {
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return clampRetryMs(retryAfterSeconds * 1000 + jitterMs(400));
  }

  const exponentialMultiplier = Math.max(1, Math.min(6, attempt + 1 + rateLimitStreak));
  const backoffMs = WATERMARK_FETCH_BASE_RETRY_MS * exponentialMultiplier;
  return clampRetryMs(backoffMs + jitterMs(500));
}

function clampRetryMs(value: number): number {
  return Math.min(WATERMARK_FETCH_MAX_RETRY_MS, Math.max(800, Math.round(value)));
}

function jitterMs(maxJitterMs: number): number {
  return Math.floor(Math.random() * maxJitterMs);
}

async function waitForGlobalRateLimitCooldown(
  onStatusLabel?: (statusLabel: string) => void,
  attemptLabel?: string
): Promise<void> {
  const remainingMs = globalRateLimitCooldownUntilMs - Date.now();
  if (remainingMs > 0) {
    if (attemptLabel) {
      onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: waiting rate-limit cooldown ${formatDurationMs(remainingMs)}`);
    }
    await sleep(remainingMs);
  }
}

async function runSerializedWatermarkRequest<T>(
  requestFn: () => Promise<T>,
  onStatusLabel?: (statusLabel: string) => void,
  attemptLabel?: string
): Promise<T> {
  const previousTurn = watermarkQueueTail;
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  watermarkQueueTail = previousTurn.then(() => currentTurn);

  if (attemptLabel) {
    onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: waiting queue slot`);
  }
  await previousTurn;
  try {
    await waitForGlobalRateLimitCooldown(onStatusLabel, attemptLabel);
    await waitForWatermarkQueueInterval(onStatusLabel, attemptLabel);
    if (attemptLabel) {
      onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: submitting request`);
    }
    return await requestFn();
  } finally {
    releaseTurn();
  }
}

async function waitForWatermarkQueueInterval(
  onStatusLabel?: (statusLabel: string) => void,
  attemptLabel?: string
): Promise<void> {
  const elapsedMs = Date.now() - lastWatermarkRequestStartedAtMs;
  const remainingMs = WATERMARK_QUEUE_MIN_INTERVAL_MS - elapsedMs;
  if (remainingMs > 0) {
    const pacingDelayMs = remainingMs + jitterMs(180);
    if (attemptLabel) {
      onStatusLabel?.(`Watermark removal attempt ${attemptLabel}: pacing requests ${formatDurationMs(pacingDelayMs)}`);
    }
    await sleep(pacingDelayMs);
  }
  lastWatermarkRequestStartedAtMs = Date.now();
}
