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

let activeArchiveController = null;
let activeArchiveJobId = null;
const activeObjectUrls = new Set();

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
    await addDirectoryEntries(zipWriter, collectDirectoryPaths(archiveItems, folderImages), signal);

    if (folderImages.length > 0) {
      await sendStage(jobId, "folder-images", "Adding folder profile images...");
      await addFolderImages(zipWriter, folderImages, signal);
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
  } catch (error) {
    const aborted = isAbortError(error, signal);
    await chrome.runtime.sendMessage({
      type: ERROR_MESSAGE,
      jobId,
      aborted,
      error: aborted ? "The ZIP archive was canceled." : getErrorMessage(error),
    });
  }
}

async function addArchiveItem(zipWriter, item, signal) {
  let lastError = null;
  let candidate = item;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    throwIfAborted(signal);

    try {
      const response = await fetchArchiveResponse(candidate.downloadUrl, signal);
      await zipWriter.add(candidate.archivePath, response.body, {
        level: 0,
        signal,
        lastModDate: parseEntryDate(candidate.postedAt || candidate.createdAt),
      });
      return {
        success: true,
      };
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }

      lastError = error;

      if (attempt === 0) {
        const refreshedItem = await refreshArchiveItem(candidate);
        if (refreshedItem && typeof refreshedItem.downloadUrl === "string" && refreshedItem.downloadUrl) {
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
    throw new Error(`Fetch failed with status ${response.status}.`);
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

function collectDirectoryPaths(items, folderImages) {
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
