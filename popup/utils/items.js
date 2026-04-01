/**
 * Item-specific helpers shared by rendering and event handling.
 */

/**
 * Returns the stable key used by the popup and background worker for a single item.
 *
 * @param {object} item
 * @returns {string}
 */
export function getItemKey(item) {
  return item && typeof item.key === "string"
    ? item.key
    : `${item.sourcePage}:${item.id}:${item.attachmentIndex}`;
}

/**
 * Derives the default editable title from the current filename or ID.
 *
 * @param {object} item
 * @returns {string}
 */
export function getDefaultItemTitle(item) {
  const discoveryPhrase =
    item && typeof item.discoveryPhrase === "string" ? item.discoveryPhrase.trim() : "";
  if (discoveryPhrase) {
    const attachmentIndex =
      item && Number.isInteger(item.attachmentIndex) ? Number(item.attachmentIndex) : 0;
    const attachmentCount =
      item && Number.isInteger(item.attachmentCount) ? Number(item.attachmentCount) : 1;
    return attachmentCount > 1
      ? `${discoveryPhrase}-${attachmentIndex + 1}`
      : discoveryPhrase;
  }

  if (item && typeof item.filename === "string" && item.filename) {
    return item.filename.replace(/\.mp4$/i, "");
  }

  return item && typeof item.id === "string" ? item.id : "video";
}

/**
 * Resolves the user-visible title, preferring a saved title override when present.
 *
 * @param {object} item
 * @param {Record<string, string>} titleOverrides
 * @returns {string}
 */
export function resolveItemTitle(item, titleOverrides) {
  const key = getItemKey(item);
  const override =
    titleOverrides && typeof titleOverrides[key] === "string" ? titleOverrides[key] : "";
  return override || getDefaultItemTitle(item);
}

/**
 * Resolves the best shareable Sora page URL for an item.
 *
 * Published and liked videos usually map to `/p/<post-id>`. Drafts can be
 * either public (`/p/<id>`) or private (`/d/<generation-id>`), so the helper
 * prefers a normalized `detailUrl` when present and then falls back to the IDs
 * available in the fetched item payload.
 *
 * @param {object} item
 * @returns {string|null}
 */
export function getItemReviewUrl(item) {
  const detailUrl =
    item && typeof item.detailUrl === "string" && item.detailUrl.trim() ? item.detailUrl.trim() : "";
  if (detailUrl) {
    return detailUrl.startsWith("/")
      ? `https://sora.chatgpt.com${detailUrl}`
      : detailUrl;
  }

  const itemId = item && typeof item.id === "string" ? item.id.trim() : "";
  const generationId =
    item && typeof item.generationId === "string" ? item.generationId.trim() : "";

  if (item && (item.sourcePage === "profile" || item.sourcePage === "likes") && itemId) {
    return `https://sora.chatgpt.com/p/${itemId}`;
  }

  if (item && item.sourcePage === "drafts") {
    if (itemId.startsWith("s_")) {
      return `https://sora.chatgpt.com/p/${itemId}`;
    }

    if (generationId.startsWith("s_")) {
      return `https://sora.chatgpt.com/p/${generationId}`;
    }

    if (generationId.startsWith("gen_")) {
      return `https://sora.chatgpt.com/d/${generationId}`;
    }

    if (itemId.startsWith("gen_")) {
      return `https://sora.chatgpt.com/d/${itemId}`;
    }
  }

  return null;
}

/**
 * Returns whether an item should still participate in the active selection batch.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isActiveBatchItem(item) {
  return Boolean(item) && !item.isRemoved && !item.isDownloaded;
}

/**
 * Counts the items that are still eligible for selection.
 *
 * @param {object[]} items
 * @returns {number}
 */
export function getActiveSelectableCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => isActiveBatchItem(item)).length;
}

/**
 * Counts items that have already been downloaded in the current working set.
 *
 * @param {object[]} items
 * @returns {number}
 */
export function getDownloadedCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => Boolean(item && item.isDownloaded))
    .length;
}

/**
 * Computes a compact summary for the current selection batch.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 * @returns {{selectedCount:number,totalBytes:number|null}}
 */
export function getSelectedBatchMetrics(items, selectedKeys) {
  const selectedKeySet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  let selectedCount = 0;
  let totalBytes = 0;
  let hasKnownSize = false;

  for (const item of Array.isArray(items) ? items : []) {
    if (!isActiveBatchItem(item)) {
      continue;
    }

    const itemKey = getItemKey(item);
    if (!selectedKeySet.has(itemKey)) {
      continue;
    }

    selectedCount += 1;
    const fileSizeBytes = Number(item && item.fileSizeBytes);
    if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
      totalBytes += fileSizeBytes;
      hasKnownSize = true;
    }
  }

  return {
    selectedCount,
    totalBytes: hasKnownSize ? totalBytes : null,
  };
}

/**
 * Returns a coarse aspect-ratio label for the item card badge.
 *
 * @param {object} item
 * @returns {string|null}
 */
export function getAspectRatioLabel(item) {
  const width = Number(item && item.width);
  const height = Number(item && item.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.04) {
    return "Square";
  }

  return ratio > 1 ? "Landscape" : "Portrait";
}
