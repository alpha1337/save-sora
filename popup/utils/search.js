import { resolveItemTitle } from "./items.js";

/**
 * Search and sorting helpers for the popup's local library view.
 */

/**
 * Normalizes arbitrary text into a token-friendly search string.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Splits a normalized search string into tokens.
 *
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
export function getSearchTokens(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean);
}

/**
 * Builds the searchable text for one item.
 *
 * @param {object} item
 * @param {Record<string, string>} titleOverrides
 * @returns {string}
 */
export function getItemSearchText(item, titleOverrides) {
  return [
    resolveItemTitle(item, titleOverrides),
    item && item.id,
    item && item.prompt,
    item && item.description,
    item && item.caption,
    item && item.discoveryPhrase,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Returns whether an item matches the current local search query.
 *
 * @param {object} item
 * @param {Record<string, string>} titleOverrides
 * @param {string} query
 * @returns {boolean}
 */
export function matchesSmartSearch(item, titleOverrides, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = normalizeSearchText(getItemSearchText(item, titleOverrides));
  if (!haystack) {
    return false;
  }

  const queryTokens = getSearchTokens(normalizedQuery);
  const haystackTokens = getSearchTokens(haystack);
  if (!queryTokens.length || !haystackTokens.length) {
    return false;
  }

  const haystackTokenSet = new Set(haystackTokens);
  return queryTokens.every((token) => haystackTokenSet.has(token));
}

/**
 * Converts a created-at value into a comparable timestamp.
 *
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
export function getComparableTimestamp(value) {
  if (value == null || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Returns the primary sort value for a given sort key.
 *
 * @param {object} item
 * @param {string} sortKey
 * @returns {number}
 */
export function getItemSortValue(item, sortKey) {
  if (sortKey === "likes") {
    return Number(item && item.likeCount) || 0;
  }

  if (sortKey === "views") {
    return Number(item && item.viewCount) || 0;
  }

  if (sortKey === "remixes") {
    return Number(item && item.remixCount) || 0;
  }

  return getComparableTimestamp(item && (item.createdAt || item.postedAt));
}

/**
 * Comparator used by the local results list.
 *
 * Removed and downloaded items always sink to the bottom before the active
 * sort key is applied.
 *
 * @param {object} left
 * @param {object} right
 * @param {string} sortKey
 * @returns {number}
 */
export function compareItems(left, right, sortKey) {
  const leftRemoved = Boolean(left && left.isRemoved);
  const rightRemoved = Boolean(right && right.isRemoved);
  if (leftRemoved !== rightRemoved) {
    return leftRemoved ? 1 : -1;
  }

  const leftDownloaded = Boolean(left && left.isDownloaded);
  const rightDownloaded = Boolean(right && right.isDownloaded);
  if (leftDownloaded !== rightDownloaded) {
    return leftDownloaded ? 1 : -1;
  }

  const primaryLeft = getItemSortValue(left, sortKey);
  const primaryRight = getItemSortValue(right, sortKey);
  if (primaryLeft !== primaryRight) {
    return primaryRight - primaryLeft;
  }

  const fallbackLeft = getItemSortValue(left, "newest");
  const fallbackRight = getItemSortValue(right, "newest");
  if (fallbackLeft !== fallbackRight) {
    return fallbackRight - fallbackLeft;
  }

  return String((left && left.id) || "").localeCompare(String((right && right.id) || ""));
}

/**
 * Returns a new array sorted for the active local browse mode.
 *
 * @param {object[]} items
 * @param {string} sortKey
 * @returns {object[]}
 */
export function getSortedItems(items, sortKey) {
  const nextItems = [...items];
  nextItems.sort((left, right) => compareItems(left, right, sortKey));
  return nextItems;
}
