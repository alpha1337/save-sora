/// <reference lib="webworker" />
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { ArchiveWorkPlan, DownloadProgressState, DownloadWorkerProgress } from "../src/types/domain";

interface BuildArchiveMessage {
  type: "build-archive";
  payload: ArchiveWorkPlan;
}

const ZIP_FETCH_CONCURRENCY = 1;
const WATERMARK_FETCH_MAX_ATTEMPTS = 6;
const WATERMARK_FETCH_BASE_RETRY_MS = 1200;
const WATERMARK_FETCH_MAX_RETRY_MS = 20000;
const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
let globalRateLimitCooldownUntilMs = 0;
let watermarkRateLimitStreak = 0;

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
      completedItems += 1;
      worker.completed_items += 1;
      worker.active_item_label = "";
      worker.last_completed_item_label = "Complete!";
      publishProgress();
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
  if (!SHARED_VIDEO_ID_PATTERN.test(row.video_id) && row.playback_url) {
    onStatusLabel?.("Using source download URL");
    return fetchDirectVideoBytes(row.playback_url);
  }

  return fetchWatermarkFreeVideoBytes(row.video_id, onStatusLabel);
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
  onStatusLabel?: (statusLabel: string) => void
): Promise<Uint8Array> {
  onStatusLabel?.("Attempting to remove watermark");
  for (let attempt = 0; attempt < WATERMARK_FETCH_MAX_ATTEMPTS; attempt += 1) {
    await waitForGlobalRateLimitCooldown();
    const response = await fetch(`https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}`);
    if (response.ok) {
      watermarkRateLimitStreak = 0;
      onStatusLabel?.("Watermark removed!");
      return new Uint8Array(await response.arrayBuffer());
    }
    const status = response.status;
    if (status === 429 && attempt + 1 < WATERMARK_FETCH_MAX_ATTEMPTS) {
      watermarkRateLimitStreak += 1;
      const retryDelayMs = resolveRetryDelayMs(response, attempt, watermarkRateLimitStreak);
      globalRateLimitCooldownUntilMs = Date.now() + retryDelayMs;
      onStatusLabel?.("Rate-limit exceeded, trying again");
      await sleep(retryDelayMs);
      continue;
    }
    throw new Error(buildWatermarkRemovalErrorMessage(status));
  }
  throw new Error("Watermark removal failed after retries. Please try again.");
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

async function waitForGlobalRateLimitCooldown(): Promise<void> {
  const remainingMs = globalRateLimitCooldownUntilMs - Date.now();
  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
}
