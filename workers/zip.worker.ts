/// <reference lib="webworker" />
import { Zip, ZipPassThrough } from "fflate";
import type { DownloadProgressState, DownloadWorkerProgress, ZipWorkerRow, ZipWorkerWorkPlan } from "../src/types/domain";

interface BuildArchiveMessage {
  type: "build-archive";
  payload: ZipWorkerWorkPlan;
}

interface DownloadResult {
  bytes: Uint8Array;
  extension: string;
}

const ZIP_FETCH_CONCURRENCY = 1;
const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
const FALLBACK_VIDEO_EXTENSION = "mp4";
const ALLOWED_VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "ogv",
  "mkv",
  "avi",
  "mpeg",
  "mpg",
  "ts"
]);

function logZipStep(step: string, context: Record<string, unknown> = {}): void {
  try {
    console.log("[save-sora:zip-worker]", step, context);
  } catch (_error) {
    // no-op
  }
}

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

async function buildArchive(workPlan: ZipWorkerWorkPlan): Promise<void> {
  if (workPlan.rows.length === 0) {
    throw new Error("No downloadable rows selected for ZIP.");
  }

  logZipStep("build-archive:start", {
    total_rows: workPlan.rows.length,
    archive_name: workPlan.archive_name
  });

  const chunks: Uint8Array[] = [];
  const totalWorkers = Math.min(ZIP_FETCH_CONCURRENCY, workPlan.rows.length);
  const workerProgress = createWorkerProgress(totalWorkers);
  let completedItems = 0;
  let successfulItems = 0;
  let activeLabel = "Preparing archive";
  let activeSubtitle = "Preparing archive work plan.";

  let settleZipPromise: ((value: Blob) => void) | null = null;
  let rejectZipPromise: ((reason?: unknown) => void) | null = null;
  const zipDone = new Promise<Blob>((resolve, reject) => {
    settleZipPromise = resolve;
    rejectZipPromise = reject;
  });

  const zip = new Zip((error, chunk, final) => {
    if (error) {
      rejectZipPromise?.(error);
      settleZipPromise = null;
      rejectZipPromise = null;
      return;
    }
    chunks.push(chunk);
    if (final) {
      settleZipPromise?.(new Blob(chunks as unknown as BlobPart[], { type: "application/zip" }));
      settleZipPromise = null;
      rejectZipPromise = null;
    }
  });

  const publishProgress = () => {
    const payload: DownloadProgressState = {
      active_label: activeLabel,
      active_subtitle: activeSubtitle,
      completed_items: completedItems,
      preflight_completed_items: 0,
      preflight_stage: "zipping",
      preflight_stage_label: "ZIP Worker",
      preflight_total_items: 0,
      rejection_entries: [],
      running_workers: workerProgress.filter((worker) => worker.status === "running").length,
      swimlanes: [],
      total_items: workPlan.rows.length,
      total_workers: workerProgress.length,
      worker_progress: workerProgress.map((worker) => ({ ...worker })),
      zip_part_completed_items: completedItems,
      zip_part_number: 1,
      zip_part_total_items: workPlan.rows.length,
      zip_total_parts: 1,
      zip_completed: false
    };

    self.postMessage({
      type: "progress",
      payload
    });
  };

  publishProgress();

  if (workPlan.supplemental_entries.length > 0) {
    activeLabel = "Writing archive instructions";
    activeSubtitle = "Adding helper files before video downloads.";
    publishProgress();
    await appendSupplementalEntries(zip, workPlan.supplemental_entries);
  }

  await runWithConcurrency(
    workPlan.rows,
    totalWorkers,
    async (row, _index, workerIndex) => {
      const worker = workerProgress[workerIndex];
      const itemTitle = row.title?.trim();
      const itemLabel = itemTitle ? `${itemTitle} · ${row.video_id}` : row.video_id;
      logZipStep("row:start", {
        worker: worker.worker_id,
        video_id: row.video_id,
        source_bucket: row.source_bucket,
        has_archive_download_url: Boolean(row.archive_download_url)
      });
      worker.status = "running";
      worker.active_item_label = "Preparing download";
      activeLabel = itemLabel;
      activeSubtitle = "Preparing video download.";
      publishProgress();
      try {
        const result = await fetchPreferredVideoBytes(row, (statusLabel) => {
          worker.active_item_label = statusLabel;
          activeLabel = itemLabel;
          activeSubtitle = statusLabel;
          publishProgress();
        });
        worker.active_item_label = "Download ready";
        activeSubtitle = "Adding video to archive.";
        publishProgress();
        appendZipEntry(zip, buildArchiveEntryName(row, result.extension), result.bytes);
        activeSubtitle = "Adding video metadata to archive.";
        publishProgress();
        appendZipEntry(zip, buildMetadataEntryName(row), new TextEncoder().encode(resolveMetadataText(row)));
        successfulItems += 1;
        worker.last_completed_item_label = "Complete!";
        logZipStep("row:complete", {
          worker: worker.worker_id,
          video_id: row.video_id,
          bytes: result.bytes.byteLength
        });
      } catch (_error) {
        worker.last_completed_item_label = "Skipped: download unavailable";
        activeSubtitle = "Skipping video because download was unavailable.";
        logZipStep("row:skipped", {
          worker: worker.worker_id,
          video_id: row.video_id
        });
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

  if (successfulItems === 0) {
    throw new Error("No downloadable files were added to the ZIP. Re-fetch rows and try again.");
  }

  activeLabel = "Finalizing archive";
  activeSubtitle = "Writing final ZIP output.";
  publishProgress();
  logZipStep("build-archive:finalizing", {
    completed_items: completedItems,
    successful_items: successfulItems,
    total_items: workPlan.rows.length
  });

  zip.end();
  const archiveBlob = await zipDone;
  self.postMessage({
    type: "complete",
    payload: {
      archive_name: workPlan.archive_name,
      blob: archiveBlob
    }
  });
  logZipStep("build-archive:zip-end", { successful_items: successfulItems });
}

async function appendSupplementalEntries(
  zip: Zip,
  supplementalEntries: ZipWorkerWorkPlan["supplemental_entries"]
): Promise<void> {
  for (const entry of supplementalEntries) {
    const archivePath = normalizeArchivePath(entry.archive_path || "README.txt");
    const contentBytes = await toBytes(entry.content);
    if (contentBytes.byteLength <= 0) {
      continue;
    }
    appendZipEntry(zip, archivePath, contentBytes);
  }
}

function appendZipEntry(zip: Zip, archivePath: string, contentBytes: Uint8Array): void {
  if (contentBytes.byteLength <= 0) {
    return;
  }
  const entry = new ZipPassThrough(archivePath);
  zip.add(entry);
  entry.push(contentBytes, true);
}

async function toBytes(content: Blob | string): Promise<Uint8Array> {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  const buffer = await content.arrayBuffer();
  return new Uint8Array(buffer);
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
  row: ZipWorkerRow,
  onStatusLabel?: (statusLabel: string) => void
): Promise<DownloadResult> {
  const downloadUrl = row.archive_download_url;
  if (downloadUrl) {
    onStatusLabel?.("Downloading source video.");
    logZipStep("source-flow:direct-download", {
      video_id: row.video_id,
      archive_path: row.archive_path,
      archive_download_url: row.archive_download_url
    });
    return fetchDirectVideoBytes(downloadUrl, { video_id: row.video_id, reason: "source_download" });
  }

  if (SHARED_VIDEO_ID_PATTERN.test(row.video_id)) {
    logZipStep("source-flow:missing-playback-shared-id", { video_id: row.video_id });
    throw new Error(`Missing downloadable source URL for ${row.video_id}. Re-fetch this item before building ZIP.`);
  }

  logZipStep("source-flow:unresolved-no-playback", { video_id: row.video_id });
  throw new Error("Draft is unresolved: missing shared post id (s_*). Re-fetch drafts to resolve before building ZIP.");
}

async function fetchDirectVideoBytes(url: string, context?: { video_id?: string; reason?: string }): Promise<DownloadResult> {
  logZipStep("source-download:request", {
    video_id: context?.video_id ?? "",
    reason: context?.reason ?? "",
    url
  });
  const response = await fetch(url, { credentials: "include" });
  logZipStep("source-download:response", {
    video_id: context?.video_id ?? "",
    status: response.status,
    ok: response.ok
  });
  if (!response.ok) {
    throw new Error(`Source video download failed (status ${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength <= 0) {
    throw new Error("Source video download returned an empty response.");
  }
  const bytes = new Uint8Array(buffer);
  const extension = resolveVideoExtension(response.headers.get("content-type"), url);
  logZipStep("source-download:success", {
    video_id: context?.video_id ?? "",
    bytes: bytes.byteLength,
    extension
  });
  return { bytes, extension };
}

function buildArchiveEntryName(row: ZipWorkerRow, extension: string): string {
  const safePath = normalizeArchivePath(row.archive_path || row.video_id || "video");
  return `${safePath}.${normalizeVideoExtension(extension)}`;
}

function buildMetadataEntryName(row: ZipWorkerRow): string {
  const safePath = normalizeArchivePath(row.archive_path || row.video_id || "video");
  return `${safePath}.txt`;
}

function resolveMetadataText(row: ZipWorkerRow): string {
  return row.metadata_text.trim() ? row.metadata_text : `video_id: ${row.video_id}\n`;
}

function normalizeArchivePath(value: string): string {
  const normalized = value
    .split("/")
    .map((segment) => segment.trim().replace(/[^A-Za-z0-9 _.-]+/g, "_").replace(/^\.+$/, ""))
    .filter(Boolean)
    .join("/");

  return normalized || "video";
}

function resolveVideoExtension(contentType: string | null, url: string): string {
  const fromContentType = extensionFromContentType(contentType ?? "");
  if (fromContentType) {
    return fromContentType;
  }

  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\.([A-Za-z0-9]{2,5})$/);
    if (match) {
      return normalizeVideoExtension(match[1] ?? "");
    }
  } catch (_error) {
    // Ignore parse failures; fallback extension will be applied.
  }

  return FALLBACK_VIDEO_EXTENSION;
}

function extensionFromContentType(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("video/mp4")) return "mp4";
  if (normalized.includes("video/webm")) return "webm";
  if (normalized.includes("video/quicktime")) return "mov";
  if (normalized.includes("video/x-m4v")) return "m4v";
  if (normalized.includes("video/ogg")) return "ogv";
  if (normalized.includes("video/x-matroska")) return "mkv";
  if (normalized.includes("video/x-msvideo")) return "avi";
  if (normalized.includes("video/mpeg")) return "mpeg";
  if (normalized.includes("video/mp2t")) return "ts";
  return "";
}

function normalizeVideoExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\.+/, "");
  if (!normalized || !ALLOWED_VIDEO_EXTENSIONS.has(normalized)) {
    return FALLBACK_VIDEO_EXTENSION;
  }
  return normalized;
}
