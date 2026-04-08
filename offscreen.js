const OFFSCREEN_TARGET = "offscreen";
const RELEASE_ARCHIVE_URL = "RELEASE_ARCHIVE_OBJECT_URL";
const START_ARCHIVE_BUILD = "START_ARCHIVE_BUILD";
const ABORT_ARCHIVE_BUILD = "ABORT_ARCHIVE_BUILD";
const ITEM_RESULT_MESSAGE = "OFFSCREEN_ARCHIVE_ITEM_RESULT";
const STAGE_MESSAGE = "OFFSCREEN_ARCHIVE_STAGE";
const COMPLETE_MESSAGE = "OFFSCREEN_ARCHIVE_COMPLETE";
const ERROR_MESSAGE = "OFFSCREEN_ARCHIVE_ERROR";
const ZIP_MIME_TYPE = "application/zip";
const PROFILE_IMAGE_BASENAME = "profile-image";
const ARCHIVE_DEBUG_MAX_JOBS = 8;

let activeArchiveController = null;
let activeArchiveJobId = null;
const activeObjectUrls = new Set();
const offscreenArchiveDebugRoot = getOffscreenArchiveDebugRoot();

function getOffscreenArchiveDebugRoot() {
  if (
    !globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__ ||
    typeof globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__ !== "object"
  ) {
    globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__ = {
      activeJobId: "",
      jobs: [],
    };
  }

  return globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__;
}

function ensureOffscreenArchiveDebugJob(jobId, options = {}) {
  if (typeof jobId !== "string" || !jobId) {
    return null;
  }

  let job = Array.isArray(offscreenArchiveDebugRoot.jobs)
    ? offscreenArchiveDebugRoot.jobs.find((entry) => entry && entry.jobId === jobId) || null
    : null;
  if (!job) {
    job = {
      jobId,
      archiveFilename:
        typeof options.archiveFilename === "string" ? options.archiveFilename : "",
      totalItems: Number(options.totalItems) || 0,
      startedAt: new Date().toISOString(),
      completedAt: "",
      status: "running",
      events: [],
    };
    offscreenArchiveDebugRoot.jobs.unshift(job);
    if (offscreenArchiveDebugRoot.jobs.length > ARCHIVE_DEBUG_MAX_JOBS) {
      offscreenArchiveDebugRoot.jobs.length = ARCHIVE_DEBUG_MAX_JOBS;
    }
  }

  offscreenArchiveDebugRoot.activeJobId = jobId;
  return job;
}

function pushOffscreenArchiveDebugEvent(jobId, type, payload = {}) {
  const job = ensureOffscreenArchiveDebugJob(jobId);
  if (!job) {
    return null;
  }

  if (!Array.isArray(job.events)) {
    job.events = [];
  }

  job.events.push({
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  });
  return job;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== OFFSCREEN_TARGET || typeof message.type !== "string") {
    return false;
  }

  if (message.type === START_ARCHIVE_BUILD) {
    if (activeArchiveController) {
      sendResponse({ ok: false, error: "A ZIP archive is already being assembled." });
      return false;
    }

    const controller = new AbortController();
    activeArchiveController = controller;
    activeArchiveJobId = typeof message.jobId === "string" ? message.jobId : null;

    void buildArchive(message, controller.signal).finally(() => {
      activeArchiveController = null;
      activeArchiveJobId = null;
    });

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === ABORT_ARCHIVE_BUILD) {
    if (activeArchiveController && activeArchiveJobId === message.jobId) {
      activeArchiveController.abort();
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === RELEASE_ARCHIVE_URL) {
    if (typeof message.objectUrl === "string" && activeObjectUrls.has(message.objectUrl)) {
      URL.revokeObjectURL(message.objectUrl);
      activeObjectUrls.delete(message.objectUrl);
    }

    sendResponse({ ok: true });
    return false;
  }

  return false;
});

async function buildArchive(message, signal) {
  const zipApi = globalThis.zip;
  const jobId = typeof message.jobId === "string" ? message.jobId : "";
  const archiveItems = Array.isArray(message.items) ? message.items : [];
  const folderImages = Array.isArray(message.folderImages) ? message.folderImages : [];
  const supplementalEntries = Array.isArray(message.supplementalEntries) ? message.supplementalEntries : [];
  ensureOffscreenArchiveDebugJob(jobId, {
    archiveFilename: typeof message.archiveFilename === "string" ? message.archiveFilename : "",
    totalItems: archiveItems.length,
  });
  pushOffscreenArchiveDebugEvent(jobId, "job-start", {
    archiveFilename: typeof message.archiveFilename === "string" ? message.archiveFilename : "",
    totalItems: archiveItems.length,
    folderImageCount: folderImages.length,
    supplementalEntryCount: supplementalEntries.length,
  });
  console.info("[Save Sora ZIP/offscreen] Starting archive build.", {
    jobId,
    totalItems: archiveItems.length,
    folderImageCount: folderImages.length,
    supplementalEntryCount: supplementalEntries.length,
  });

  try {
    if (!zipApi || typeof zipApi.ZipWriter !== "function" || typeof zipApi.BlobWriter !== "function") {
      throw new Error("The bundled ZIP runtime did not load.");
    }

    zipApi.configure({
      useWebWorkers: false,
    });

    const zipWriter = new zipApi.ZipWriter(new zipApi.BlobWriter(ZIP_MIME_TYPE), {
      useWebWorkers: false,
      level: 0,
    });

    await sendStage(jobId, "preparing", "Preparing archive folders...");
    await addDirectoryEntries(
      zipWriter,
      collectDirectoryPaths(archiveItems, folderImages, supplementalEntries),
      signal,
    );

    if (folderImages.length > 0) {
      await sendStage(jobId, "folder-images", "Adding folder profile images...");
      await addFolderImages(zipWriter, folderImages, signal);
    }

    if (supplementalEntries.length > 0) {
      await sendStage(jobId, "metadata", "Adding prompts and URLs...");
      await addSupplementalArchiveEntries(zipWriter, supplementalEntries, signal);
    }

    await sendStage(jobId, "archiving", "Streaming selected files into the ZIP...");

    for (const item of archiveItems) {
      throwIfAborted(signal);
      const result = await addArchiveItem(zipWriter, item, signal);
      await chrome.runtime.sendMessage({
        type: ITEM_RESULT_MESSAGE,
        jobId,
        itemKey: item && typeof item.key === "string" ? item.key : "",
        success: result.success,
        error: result.error || "",
        debug: result.debug || null,
      });
    }

    await sendStage(jobId, "finalizing", "Finalizing the ZIP archive...");
    const archiveBlob = await zipWriter.close();
    throwIfAborted(signal);

    const objectUrl = URL.createObjectURL(archiveBlob);
    activeObjectUrls.add(objectUrl);

    await chrome.runtime.sendMessage({
      type: COMPLETE_MESSAGE,
      jobId,
      objectUrl,
      sizeBytes: archiveBlob.size,
    });
    const debugJob = ensureOffscreenArchiveDebugJob(jobId);
    if (debugJob) {
      debugJob.status = "complete";
      debugJob.completedAt = new Date().toISOString();
      debugJob.sizeBytes = archiveBlob.size;
    }
    pushOffscreenArchiveDebugEvent(jobId, "job-complete", {
      sizeBytes: archiveBlob.size,
    });
    console.info("[Save Sora ZIP/offscreen] Archive build completed.", {
      jobId,
      sizeBytes: archiveBlob.size,
      debugRef: "globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__",
    });
  } catch (error) {
    const aborted = isAbortError(error, signal);
    await chrome.runtime.sendMessage({
      type: ERROR_MESSAGE,
      jobId,
      aborted,
      error: aborted ? "The ZIP archive was canceled." : getErrorMessage(error),
    });
    const debugJob = ensureOffscreenArchiveDebugJob(jobId);
    if (debugJob) {
      debugJob.status = aborted ? "aborted" : "error";
      debugJob.completedAt = new Date().toISOString();
      debugJob.error = aborted ? "The ZIP archive was canceled." : getErrorMessage(error);
    }
    pushOffscreenArchiveDebugEvent(jobId, "job-error", {
      aborted,
      error: aborted ? "The ZIP archive was canceled." : getErrorMessage(error),
    });
    console.error("[Save Sora ZIP/offscreen] Archive build failed.", {
      jobId,
      aborted,
      error: aborted ? "The ZIP archive was canceled." : getErrorMessage(error),
      debugRef: "globalThis.__SAVE_SORA_OFFSCREEN_ZIP_DEBUG__",
    });
  }
}

async function addSupplementalArchiveEntries(zipWriter, supplementalEntries, signal) {
  const zipApi = globalThis.zip;
  if (!zipApi || typeof zipApi.BlobReader !== "function") {
    throw new Error("The bundled ZIP runtime could not prepare metadata files.");
  }

  for (const entry of Array.isArray(supplementalEntries) ? supplementalEntries : []) {
    throwIfAborted(signal);

    if (!entry || typeof entry.archivePath !== "string" || !entry.archivePath || !(entry.blobContent instanceof Blob)) {
      continue;
    }

    await zipWriter.add(entry.archivePath, new zipApi.BlobReader(entry.blobContent), {
      level: 0,
      signal,
      lastModDate: parseEntryDate(entry.createdAt),
    });
  }
}

async function addArchiveItem(zipWriter, item, signal) {
  let lastError = null;
  let candidate = item;
  const debug = {
    itemKey: item && typeof item.key === "string" ? item.key : "",
    id: item && typeof item.id === "string" ? item.id : "",
    filename: item && typeof item.filename === "string" ? item.filename : "",
    archivePath: item && typeof item.archivePath === "string" ? item.archivePath : "",
    sourcePage: item && typeof item.sourcePage === "string" ? item.sourcePage : "",
    downloadUrl: item && typeof item.downloadUrl === "string" ? item.downloadUrl : "",
    attempts: [],
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);
    const attemptDebug = {
      attempt: attempt + 1,
      downloadUrl: candidate && typeof candidate.downloadUrl === "string" ? candidate.downloadUrl : "",
      refreshed: attempt > 0,
      finalUrl: "",
      status: null,
      statusText: "",
      contentType: "",
      error: "",
      refreshedDownloadUrl: "",
    };
    debug.attempts.push(attemptDebug);

    try {
      const response = await fetchArchiveResponse(candidate.downloadUrl, signal);
      attemptDebug.status = response.status;
      attemptDebug.statusText = response.statusText;
      attemptDebug.finalUrl = typeof response.url === "string" ? response.url : candidate.downloadUrl;
      attemptDebug.contentType =
        response.headers && typeof response.headers.get === "function"
          ? response.headers.get("content-type") || ""
          : "";
      await zipWriter.add(candidate.archivePath, response.body, {
        level: 0,
        signal,
        lastModDate: parseEntryDate(candidate.postedAt || candidate.createdAt),
      });
      pushOffscreenArchiveDebugEvent(activeArchiveJobId || "", "item-success", {
        itemKey: debug.itemKey,
        filename: debug.filename,
        archivePath: debug.archivePath,
        attempts: debug.attempts,
      });
      return {
        success: true,
        debug,
      };
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }

      lastError = error;
      attemptDebug.error = getErrorMessage(error);
      attemptDebug.status =
        Number.isFinite(Number(error && error.status)) ? Number(error.status) : attemptDebug.status;
      attemptDebug.statusText =
        typeof error?.statusText === "string" ? error.statusText : attemptDebug.statusText;
      attemptDebug.finalUrl =
        typeof error?.url === "string" && error.url ? error.url : attemptDebug.finalUrl;

      if (attempt === 0) {
        const refreshedItem = await refreshArchiveItem(candidate);
        if (refreshedItem && typeof refreshedItem.downloadUrl === "string" && refreshedItem.downloadUrl) {
          attemptDebug.refreshedDownloadUrl = refreshedItem.downloadUrl;
          candidate = {
            ...candidate,
            ...refreshedItem,
          };
          continue;
        }
      }
    }
  }

  return {
    success: false,
    error: getErrorMessage(lastError),
    debug,
  };
}

async function refreshArchiveItem(item) {
  if (!item || typeof item.key !== "string" || !item.key) {
    return null;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REFRESH_ARCHIVE_ITEM_URL",
      itemKey: item.key,
    });
    return response && response.ok ? response.item : null;
  } catch (_error) {
    return null;
  }
}

async function fetchArchiveResponse(url, signal) {
  if (typeof url !== "string" || !url) {
    throw new Error("The archive item did not include a download URL.");
  }

  const response = await fetch(url, {
    signal,
  });

  if (!response.ok || !response.body) {
    const error = new Error(
      `Fetch failed with status ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
    );
    error.status = response.status;
    error.statusText = response.statusText;
    error.url = typeof response.url === "string" ? response.url : url;
    throw error;
  }

  return response;
}

async function addFolderImages(zipWriter, folderImages, signal) {
  for (const folderImage of folderImages) {
    throwIfAborted(signal);

    try {
      const response = await fetchArchiveResponse(folderImage.imageUrl, signal);
      const extension = deriveExtension(response, folderImage.imageUrl);
      const archivePath = `${trimTrailingSlash(folderImage.folderPath)}/${PROFILE_IMAGE_BASENAME}.${extension}`;
      await zipWriter.add(archivePath, response.body, {
        level: 0,
        signal,
      });
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      // Folder images are best-effort so a missing avatar never blocks the full archive.
    }
  }
}

async function addDirectoryEntries(zipWriter, directoryPaths, signal) {
  for (const directoryPath of directoryPaths) {
    throwIfAborted(signal);
    await zipWriter.add(`${trimTrailingSlash(directoryPath)}/`, undefined, {
      directory: true,
      signal,
    });
  }
}

function collectDirectoryPaths(items, folderImages, supplementalEntries) {
  const directoryPaths = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.archivePath !== "string") {
      continue;
    }

    const folderPath = getParentPath(item.archivePath);
    addDirectoryChain(directoryPaths, folderPath);
  }

  for (const folderImage of Array.isArray(folderImages) ? folderImages : []) {
    if (!folderImage || typeof folderImage.folderPath !== "string") {
      continue;
    }

    addDirectoryChain(directoryPaths, folderImage.folderPath);
  }

  for (const entry of Array.isArray(supplementalEntries) ? supplementalEntries : []) {
    if (!entry || typeof entry.archivePath !== "string") {
      continue;
    }

    addDirectoryChain(directoryPaths, getParentPath(entry.archivePath));
  }

  return [...directoryPaths].sort();
}

function addDirectoryChain(directoryPaths, folderPath) {
  const normalizedPath = trimSlashes(folderPath);
  if (!normalizedPath) {
    return;
  }

  const segments = normalizedPath.split("/");
  let currentPath = "";

  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    directoryPaths.add(currentPath);
  }
}

function getParentPath(archivePath) {
  const normalizedPath = trimSlashes(archivePath);
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
}

function trimTrailingSlash(value) {
  return typeof value === "string" ? value.replace(/\/+$/g, "") : "";
}

function trimSlashes(value) {
  return typeof value === "string" ? value.replace(/^\/+|\/+$/g, "") : "";
}

function parseEntryDate(value) {
  if (typeof value !== "string" || !value) {
    return new Date();
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
}

function deriveExtension(response, url) {
  const contentType =
    response &&
    response.headers &&
    typeof response.headers.get === "function"
      ? response.headers.get("content-type")
      : "";
  const typeExtension = mapContentTypeToExtension(contentType);
  if (typeExtension) {
    return typeExtension;
  }

  try {
    const parsedUrl = new URL(url);
    const lastSegment = parsedUrl.pathname.split("/").pop() || "";
    const match = lastSegment.match(/\.([A-Za-z0-9]{2,5})$/);
    if (match) {
      return match[1].toLowerCase();
    }
  } catch (_error) {
    // Ignore invalid URLs and fall back to a generic extension below.
  }

  return "bin";
}

function mapContentTypeToExtension(contentType) {
  const normalizedType = typeof contentType === "string" ? contentType.split(";")[0].trim().toLowerCase() : "";
  switch (normalizedType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "image/avif":
      return "avif";
    default:
      return "";
  }
}

async function sendStage(jobId, stage, message) {
  await chrome.runtime.sendMessage({
    type: STAGE_MESSAGE,
    jobId,
    stage,
    message,
  });
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new DOMException("The ZIP archive was canceled.", "AbortError");
  }
}

function isAbortError(error, signal) {
  if (signal && signal.aborted) {
    return true;
  }

  return Boolean(
    error &&
      typeof error === "object" &&
      ((typeof error.name === "string" && error.name === "AbortError") ||
        (typeof error.message === "string" && /abort/i.test(error.message))),
  );
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
