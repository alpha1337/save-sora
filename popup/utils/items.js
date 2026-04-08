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
  if (item && typeof item === "object") {
    const sourcePage = typeof item.sourcePage === "string" ? item.sourcePage : "";
    const sourceType =
      typeof item.sourceType === "string" && item.sourceType ? item.sourceType : "";
    const itemId = typeof item.id === "string" ? item.id : "";
    const attachmentIndex = Number.isInteger(item.attachmentIndex) ? item.attachmentIndex : 0;

    if (sourcePage && itemId) {
      return sourceType
        ? `${sourcePage}:${sourceType}:${itemId}:${attachmentIndex}`
        : `${sourcePage}:${itemId}:${attachmentIndex}`;
    }

    if (typeof item.key === "string") {
      return item.key;
    }
  }

  return "";
}

/**
 * Returns a human-readable label for the item's fetched source bucket.
 *
 * @param {object} item
 * @returns {string}
 */
export function getItemSourceLabel(item) {
  switch (item && item.sourcePage) {
    case "drafts":
      return "Draft";
    case "likes":
      return "Liked";
    case "creatorPublished":
      return "Posts";
    case "creatorCameos":
      return "Cast In";
    case "creatorCharacters":
      return "Side Character";
    case "creatorCharacterCameos":
      return "Side Character";
    case "cameos":
      return "Cameo";
    case "characters":
      return "Character";
    default:
      return item && typeof item.sourceLabel === "string" && item.sourceLabel.trim()
        ? item.sourceLabel.trim()
        : "Published";
  }
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

  const prompt =
    item && typeof item.prompt === "string" ? item.prompt.trim().replace(/\s+/g, " ") : "";
  if (prompt) {
    return prompt;
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
 * Published and liked videos usually map to `/p/<post-id>`. Draft-backed items can be
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

  const shouldUseDraftFallback =
    item &&
    (item.sourcePage === "drafts" ||
      ((item.sourcePage === "cameos" ||
        item.sourcePage === "characters" ||
        item.sourcePage === "creatorCharacterCameos") &&
        item.sourceType === "draft"));

  if (shouldUseDraftFallback) {
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

  if (
    item &&
    (item.sourcePage === "profile" ||
      item.sourcePage === "creatorPublished" ||
      item.sourcePage === "creatorCameos" ||
      item.sourcePage === "creatorCharacters" ||
      item.sourcePage === "likes" ||
      item.sourcePage === "cameos" ||
      item.sourcePage === "characters") &&
    itemId
  ) {
    return `https://sora.chatgpt.com/p/${itemId}`;
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
 * Returns the stable keys for every item that is still included in the active batch.
 *
 * Archive state is the selection model: active items are selected, archived items are not.
 *
 * @param {object[]} items
 * @returns {string[]}
 */
export function getImplicitSelectedKeys(items) {
  const keys = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!isActiveBatchItem(item)) {
      continue;
    }

    const key = getItemKey(item);
    if (!key || keys.includes(key)) {
      continue;
    }

    keys.push(key);
  }

  return keys;
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
 * Computes total result metrics for the current working set, excluding only items the
 * user explicitly removed from the batch.
 *
 * @param {object[]} items
 * @returns {{totalCount:number,totalBytes:number|null}}
 */
export function getTotalBatchMetrics(items) {
  let totalCount = 0;
  let totalBytes = 0;
  let hasKnownSize = false;

  for (const item of Array.isArray(items) ? items : []) {
    if (!isActiveBatchItem(item)) {
      continue;
    }

    totalCount += 1;
    const fileSizeBytes = Number(item && item.fileSizeBytes);
    if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
      totalBytes += fileSizeBytes;
      hasKnownSize = true;
    }
  }

  return {
    totalCount,
    totalBytes: hasKnownSize ? totalBytes : null,
  };
}

/**
 * Returns whether the item should be presented as a draft-state result.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isDraftVideoItem(item) {
  if (!item || typeof item !== "object") {
    return false;
  }

  if (item.sourceType === "draft") {
    return true;
  }

  if (typeof item.id === "string" && item.id.startsWith("gen_")) {
    return true;
  }

  return false;
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

/**
 * Returns whether the item came from a saved creator profile result bucket.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isCreatorScopedItem(item) {
  return (
    item &&
    (item.sourcePage === "creatorPublished" ||
      item.sourcePage === "creatorCameos" ||
      item.sourcePage === "creatorCharacters" ||
      item.sourcePage === "creatorCharacterCameos")
  );
}

/**
 * Maps a creator-scoped item into a stable sub-tab key.
 *
 * @param {object} item
 * @returns {"published"|"castIn"|"characters"|"characterCameos"|"all"}
 */
export function getCreatorResultsTabKey(item) {
  switch (item && item.sourcePage) {
    case "creatorPublished":
      return "published";
    case "creatorCameos":
      return "castIn";
    case "creatorCharacters":
      return "characters";
    case "creatorCharacterCameos":
      return "characterCameos";
    default:
      return "all";
  }
}

/**
 * Returns the user-facing label for a creator result tab key.
 *
 * @param {string} tabKey
 * @returns {string}
 */
export function getCreatorResultsTabLabel(tabKey) {
  switch (tabKey) {
    case "archived":
      return "Archived";
    case "downloaded":
      return "Downloaded";
    case "published":
      return "Posts";
    case "castIn":
      return "Cast In";
    case "characters":
      return "Characters";
    case "characterCameos":
      return "Character Cameos";
    default:
      return "Queue";
  }
}

/**
 * Builds the creator-only tab list for the current result set.
 *
 * Tabs are only shown when every rendered item came from the Creators source and
 * at least two creator subtypes are present.
 *
 * @param {object[]} items
 * @returns {{key:string,label:string,count:number}[]}
 */
export function getCreatorResultsTabs(items) {
  const nextItems = Array.isArray(items) ? items : [];
  if (!nextItems.length) {
    return [];
  }

  const activeItems = nextItems.filter((item) => isActiveBatchItem(item));
  const archivedCount = nextItems.filter(
    (item) => Boolean(item && item.isRemoved) && !Boolean(item && item.isDownloaded),
  ).length;
  const downloadedCount = nextItems.filter((item) => Boolean(item && item.isDownloaded)).length;
  const canShowCreatorTabs =
    activeItems.length > 0 && activeItems.every((item) => isCreatorScopedItem(item));
  const counts = new Map();
  for (const item of activeItems) {
    const tabKey = getCreatorResultsTabKey(item);
    if (tabKey === "all") {
      continue;
    }

    counts.set(tabKey, (counts.get(tabKey) || 0) + 1);
  }

  if (!canShowCreatorTabs || counts.size <= 1) {
    if (archivedCount <= 0 && downloadedCount <= 0) {
      return [];
    }

    const tabs = [];
    if (activeItems.length > 0) {
      tabs.push({
        key: "all",
        label: getCreatorResultsTabLabel("all"),
        count: activeItems.length,
      });
    }

    tabs.push({
      key: "archived",
      label: getCreatorResultsTabLabel("archived"),
      count: archivedCount,
    });

    if (downloadedCount > 0) {
      tabs.push({
        key: "downloaded",
        label: getCreatorResultsTabLabel("downloaded"),
        count: downloadedCount,
      });
    }

    return tabs.filter((tab) => tab.count > 0);
  }

  const tabs = [
    {
      key: "all",
      label: getCreatorResultsTabLabel("all"),
      count: activeItems.length,
    },
    ...["published", "castIn", "characters", "characterCameos"]
      .filter((tabKey) => counts.has(tabKey))
      .map((tabKey) => ({
        key: tabKey,
        label: getCreatorResultsTabLabel(tabKey),
        count: counts.get(tabKey) || 0,
      })),
  ];

  if (archivedCount > 0) {
    tabs.push({
      key: "archived",
      label: getCreatorResultsTabLabel("archived"),
      count: archivedCount,
    });
  }

  if (downloadedCount > 0) {
    tabs.push({
      key: "downloaded",
      label: getCreatorResultsTabLabel("downloaded"),
      count: downloadedCount,
    });
  }

  return tabs;
}

/**
 * Filters items to the active creator result tab.
 *
 * @param {object[]} items
 * @param {string} activeTabKey
 * @returns {object[]}
 */
export function filterItemsForCreatorResultsTab(items, activeTabKey) {
  const nextItems = Array.isArray(items) ? items : [];
  if (!nextItems.length) {
    return [];
  }

  if (activeTabKey === "archived") {
    return nextItems.filter(
      (item) => Boolean(item && item.isRemoved) && !Boolean(item && item.isDownloaded),
    );
  }

  if (activeTabKey === "downloaded") {
    return nextItems.filter((item) => Boolean(item && item.isDownloaded));
  }

  const activeItems = nextItems.filter((item) => isActiveBatchItem(item));
  if (!activeTabKey || activeTabKey === "all") {
    return activeItems;
  }

  return activeItems.filter((item) => getCreatorResultsTabKey(item) === activeTabKey);
}
