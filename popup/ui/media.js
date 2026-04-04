import { formatCompactCount, formatDuration } from "../utils/format.js";
import { getItemSourceLabel, resolveItemTitle } from "../utils/items.js";

/**
 * Media-preview helpers for item cards.
 */

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

  media.onclick = null;
  media.onkeydown = null;
  media.classList.toggle("is-playable", Boolean(item.downloadUrl));
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

  if (item.downloadUrl) {
    const playLabel = `Preview ${resolveItemTitle(item, titleOverrides)}`;
    media.setAttribute("role", "button");
    media.setAttribute("tabindex", "0");
    media.setAttribute("aria-label", playLabel);
    media.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item, titleOverrides);
    };
    media.onkeydown = (event) => {
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
 * Replaces the thumbnail preview with an inline video player.
 *
 * @param {HTMLElement} media
 * @param {object} item
 * @param {Record<string, string>} titleOverrides
 */
function activateInlineVideo(media, item, titleOverrides) {
  if (!media || !(media instanceof HTMLElement) || !item || !item.downloadUrl) {
    return;
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
  video.src = item.downloadUrl;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.muted = true;
  media.append(video);

  const replayButton = document.createElement("button");
  replayButton.type = "button";
  replayButton.className = "item-replay-button";
  replayButton.textContent = "Back to thumbnail";
  replayButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderMediaPreview(media, item, titleOverrides);
  });
  media.append(replayButton);

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
