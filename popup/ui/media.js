import { formatCompactCount, formatDuration } from "../utils/format.js";
import { getItemSourceLabel, isDraftVideoItem, resolveItemTitle } from "../utils/items.js";

/**
 * Media-preview helpers for item cards.
 */
let activeInlinePreview = null;

function buildNoWatermarkProxyUrl(itemId) {
  if (typeof itemId !== "string" || !/^s_[A-Za-z0-9_-]+$/.test(itemId)) {
    return "";
  }

  return `https://soravdl.com/api/proxy/video/${encodeURIComponent(itemId)}`;
}

function resolveNoWatermarkPlaybackUrl(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const itemId = typeof item.id === "string" ? item.id : "";
  const generationId = typeof item.generationId === "string" ? item.generationId : "";

  return (
    (item.download_urls &&
    typeof item.download_urls === "object" &&
    typeof item.download_urls.no_watermark === "string" &&
    item.download_urls.no_watermark) ||
    (typeof item.no_watermark === "string" && item.no_watermark) ||
    buildNoWatermarkProxyUrl(itemId) ||
    buildNoWatermarkProxyUrl(generationId) ||
    ""
  );
}

function getItemPlaybackUrl(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const watermarkUrl =
    (item.download_urls &&
    typeof item.download_urls === "object" &&
    typeof item.download_urls.watermark === "string" &&
    item.download_urls.watermark) ||
    "";
  const noWatermarkUrl = resolveNoWatermarkPlaybackUrl(item);

  return (
    noWatermarkUrl ||
    watermarkUrl ||
    (typeof item.downloadUrl === "string" && item.downloadUrl) ||
    ""
  );
}

function tryWebkitPictureInPicture(video) {
  if (
    !(video instanceof HTMLVideoElement) ||
    typeof video.webkitSupportsPresentationMode !== "function" ||
    typeof video.webkitSetPresentationMode !== "function"
  ) {
    return false;
  }

  try {
    if (!video.webkitSupportsPresentationMode("picture-in-picture")) {
      return false;
    }

    if (video.webkitPresentationMode === "picture-in-picture") {
      return true;
    }

    video.webkitSetPresentationMode("picture-in-picture");
    return video.webkitPresentationMode === "picture-in-picture";
  } catch (_error) {
    return false;
  }
}

function requestPictureInPictureIfPossible(video) {
  if (!(video instanceof HTMLVideoElement) || video.disablePictureInPicture) {
    return;
  }

  if (tryWebkitPictureInPicture(video)) {
    return;
  }

  if (
    typeof document === "undefined" ||
    !document.pictureInPictureEnabled ||
    typeof video.requestPictureInPicture !== "function"
  ) {
    return;
  }

  if (document.pictureInPictureElement === video) {
    return;
  }

  try {
    const pipPromise = video.requestPictureInPicture();
    if (pipPromise && typeof pipPromise.catch === "function") {
      void pipPromise.catch(() => {});
    }
  } catch (_error) {
    // Ignore Picture-in-Picture failures and keep the inline player as the fallback.
  }
}

function getEventElement(target) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node && target.parentElement instanceof Element) {
    return target.parentElement;
  }

  return null;
}

function schedulePictureInPictureRetries(video) {
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }

  const attempt = () => {
    requestPictureInPictureIfPossible(video);
  };

  video.addEventListener("loadedmetadata", attempt, { once: true });
  video.addEventListener("canplay", attempt, { once: true });
  video.addEventListener("playing", attempt, { once: true });
}

function exitPictureInPictureIfActive(video) {
  if (!(video instanceof HTMLVideoElement) || typeof document === "undefined") {
    return;
  }

  if (document.pictureInPictureElement === video && typeof document.exitPictureInPicture === "function") {
    try {
      const exitPromise = document.exitPictureInPicture();
      if (exitPromise && typeof exitPromise.catch === "function") {
        void exitPromise.catch(() => {});
      }
    } catch (_error) {
      // Ignore PiP exit failures and continue restoring the thumbnail view.
    }
  }

  if (
    typeof video.webkitSetPresentationMode === "function" &&
    typeof video.webkitPresentationMode === "string" &&
    video.webkitPresentationMode === "picture-in-picture"
  ) {
    try {
      video.webkitSetPresentationMode("inline");
    } catch (_error) {
      // Ignore presentation-mode failures and continue cleaning up the preview.
    }
  }
}

function stopInlineVideo(video) {
  if (!(video instanceof HTMLVideoElement)) {
    return;
  }

  exitPictureInPictureIfActive(video);

  try {
    video.pause();
  } catch (_error) {
    // Ignore pause failures during teardown.
  }

  try {
    video.currentTime = 0;
  } catch (_error) {
    // Ignore currentTime failures during teardown.
  }

  video.removeAttribute("src");
  try {
    video.load();
  } catch (_error) {
    // Ignore load failures during teardown.
  }
}

function restoreThumbnailPreview(context, skipRerender = false) {
  if (!context || typeof context !== "object") {
    return;
  }

  const { media, item, titleOverrides, video } = context;
  if (activeInlinePreview === context) {
    activeInlinePreview = null;
  }

  stopInlineVideo(video);

  if (!skipRerender && media instanceof HTMLElement && media.isConnected) {
    renderMediaPreview(media, item, titleOverrides);
  }
}

/**
 * Renders either the thumbnail preview or the inline video player for an item.
 *
 * @param {HTMLElement} media
 * @param {object} item
 * @param {Record<string, string>} [titleOverrides={}]
 */
export function renderMediaPreview(media, item, titleOverrides = {}) {
  if (!media || !(media instanceof HTMLElement) || !item) {
    return;
  }

  if (activeInlinePreview && activeInlinePreview.media === media) {
    restoreThumbnailPreview(activeInlinePreview, true);
  }

  media.onclick = null;
  media.onkeydown = null;
  const playbackUrl = getItemPlaybackUrl(item);
  media.classList.toggle("is-playable", Boolean(playbackUrl));
  media.classList.remove("is-inline-video");
  media.removeAttribute("role");
  media.removeAttribute("tabindex");
  media.removeAttribute("aria-label");
  media.replaceChildren();

  const fallback = createThumbnailFallback(item);
  media.append(fallback);

  if (item.thumbnailUrl) {
    const image = document.createElement("img");
    image.className = "item-thumbnail";
    image.src = item.thumbnailUrl;
    image.alt = `${item.id} thumbnail`;
    image.loading = "lazy";
    image.decoding = "async";
    image.fetchPriority = "low";
    image.referrerPolicy = "no-referrer";

    image.addEventListener(
      "error",
      () => {
        image.remove();
      },
      { once: true },
    );

    media.append(image);
  }

  const overlay = document.createElement("div");
  overlay.className = "item-media-overlay";

  const topRow = document.createElement("div");
  topRow.className = "item-media-top";
  if (item.durationSeconds) {
    const duration = document.createElement("span");
    duration.className = "item-duration";
    duration.textContent = formatDuration(item.durationSeconds);
    topRow.append(duration);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "item-media-spacer";
    topRow.append(spacer);
  }

  if (isDraftVideoItem(item)) {
    const draftBadge = document.createElement("span");
    draftBadge.className = "item-media-state-badge";
    draftBadge.textContent = "Draft";
    topRow.append(draftBadge);
  }
  overlay.append(topRow);

  const bottomRow = document.createElement("div");
  bottomRow.className = "item-media-bottom";
  const engagement = document.createElement("div");
  engagement.className = "item-engagement";

  const likeBadge = createOverlayStat("heart", item.likeCount);
  if (likeBadge) {
    engagement.append(likeBadge);
  }

  const viewBadge = createOverlayStat("view", item.viewCount);
  if (viewBadge) {
    engagement.append(viewBadge);
  }

  const remixBadge = createOverlayStat("remix", item.remixCount);
  if (remixBadge) {
    engagement.append(remixBadge);
  }

  if (engagement.childElementCount > 0) {
    bottomRow.append(engagement);
  }
  overlay.append(bottomRow);

  if (playbackUrl) {
    const playLabel = `Preview ${resolveItemTitle(item, titleOverrides)}`;
    media.setAttribute("role", "button");
    media.setAttribute("tabindex", "0");
    media.setAttribute("aria-label", playLabel);
    media.onclick = (event) => {
      if (getEventElement(event.target)?.closest(".item-grid-overlay")) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item, titleOverrides);
    };
    media.onkeydown = (event) => {
      if (getEventElement(event.target)?.closest(".item-grid-overlay")) {
        return;
      }

      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item, titleOverrides);
    };

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "item-play-button";
    playButton.setAttribute("aria-label", playLabel);
    playButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor"/></svg>';
    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item, titleOverrides);
    });
    overlay.append(playButton);
  }

  media.append(overlay);
}

/**
 * Cleans up transient media resources before a card leaves the DOM.
 *
 * The virtualized results renderer reuses a moving window of cards, so media
 * nodes that scroll out of view should release any inline preview state before
 * the DOM subtree is discarded.
 *
 * @param {HTMLElement|null|undefined} media
 */
export function disposeMediaPreview(media) {
  if (!(media instanceof HTMLElement)) {
    return;
  }

  if (activeInlinePreview && activeInlinePreview.media === media) {
    restoreThumbnailPreview(activeInlinePreview, true);
  }
}

/**
 * Replaces the thumbnail preview with an inline video player.
 *
 * @param {HTMLElement} media
 * @param {object} item
 * @param {Record<string, string>} titleOverrides
 */
function activateInlineVideo(media, item, titleOverrides) {
  const playbackUrl = getItemPlaybackUrl(item);
  if (!media || !(media instanceof HTMLElement) || !item || !playbackUrl) {
    return;
  }

  if (activeInlinePreview && activeInlinePreview.media !== media) {
    restoreThumbnailPreview(activeInlinePreview);
  }

  media.onclick = null;
  media.onkeydown = null;
  media.classList.remove("is-playable");
  media.classList.add("is-inline-video");
  media.removeAttribute("role");
  media.removeAttribute("tabindex");
  media.removeAttribute("aria-label");
  media.replaceChildren();

  const video = document.createElement("video");
  video.className = "item-video";
  video.src = playbackUrl;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.autoplay = true;
  video.defaultMuted = false;
  video.muted = false;
  video.volume = 1;
  video.disablePictureInPicture = false;
  media.append(video);
  requestPictureInPictureIfPossible(video);

  const previewContext = {
    media,
    item,
    titleOverrides,
    video,
  };
  activeInlinePreview = previewContext;

  const replayButton = document.createElement("button");
  replayButton.type = "button";
  replayButton.className = "item-replay-button";
  replayButton.textContent = "Back to thumbnail";
  replayButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    restoreThumbnailPreview(previewContext);
  });
  media.append(replayButton);

  schedulePictureInPictureRetries(video);
  void video.play().catch(() => {});
}

/**
 * Creates the fallback thumbnail label shown before a real image loads.
 *
 * @param {object} item
 * @returns {HTMLDivElement}
 */
function createThumbnailFallback(item) {
  const fallback = document.createElement("div");
  fallback.className = "item-thumbnail-fallback";
  fallback.textContent = getItemSourceLabel(item);
  return fallback;
}

/**
 * Creates an engagement badge for the thumbnail overlay.
 *
 * @param {"heart"|"view"|"remix"} kind
 * @param {number|string|null|undefined} value
 * @returns {HTMLSpanElement|null}
 */
function createOverlayStat(kind, value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) {
    return null;
  }

  const numeric = Number(value);
  if (kind === "remix" && numeric <= 0) {
    return null;
  }

  const stat = document.createElement("span");
  stat.className = "item-engagement-pill";

  const icon = document.createElement("span");
  icon.className = "item-engagement-icon";
  icon.innerHTML = getOverlayIconSvg(kind);

  const text = document.createElement("span");
  text.className = "item-engagement-text";
  text.textContent = formatCompactCount(numeric);

  stat.append(icon, text);
  return stat;
}

/**
 * Returns the SVG icon for an overlay badge.
 *
 * @param {"heart"|"view"|"remix"} kind
 * @returns {string}
 */
function getOverlayIconSvg(kind) {
  if (kind === "heart") {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 13.2 2.6 8A3.4 3.4 0 0 1 7.4 3.2L8 3.8l.6-.6A3.4 3.4 0 1 1 13.4 8L8 13.2Z" fill="currentColor"/></svg>';
  }

  if (kind === "remix") {
    return '<svg viewBox="0 0 19 18" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="6.75" stroke="currentColor" stroke-width="2" fill="none"></circle><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M11.25 9a4.5 4.5 0 0 0-9 0M15.75 9a4.5 4.5 0 1 1-9 0"></path></svg>';
  }

  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 3c3.8 0 6.8 3.6 7.4 4.4a1 1 0 0 1 0 1.2C14.8 9.4 11.8 13 8 13S1.2 9.4.6 8.6a1 1 0 0 1 0-1.2C1.2 6.6 4.2 3 8 3Zm0 2.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.4A1.4 1.4 0 1 1 8 9.4 1.4 1.4 0 0 1 8 6.6Z" fill="currentColor"/></svg>';
}
