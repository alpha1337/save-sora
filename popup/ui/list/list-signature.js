import { popupState } from "../../state.js";
import { getItemKey, resolveItemTitle } from "../../utils/items.js";
import { normalizeSearchText } from "../../utils/search.js";

/**
 * Builds a cheap signature representing the visible render state.
 *
 * This avoids rebuilding the entire DOM when the popup receives a background
 * status payload that does not materially change the list presentation.
 *
 * @param {object[]} sortedItems
 * @param {string[]} selectedKeys
 * @param {Record<string, string>} titleOverrides
 * @param {boolean} disableInputs
 * @param {string} phase
 * @returns {string}
 */
export function buildRenderSignature(
  sortedItems,
  selectedKeys,
  titleOverrides,
  disableInputs,
  phase,
  creatorResultTabs = [],
) {
  const selectedSet = new Set(selectedKeys);
  const itemSignatures = sortedItems.map((item) => {
    const key = getItemKey(item);
    return [
      key,
      selectedSet.has(key) ? "1" : "0",
      resolveItemTitle(item, titleOverrides),
      disableInputs ? "1" : "0",
      item.thumbnailUrl || "",
      item.postedAt || item.createdAt || "",
      item.durationSeconds ?? "",
      item.likeCount ?? "",
      item.viewCount ?? "",
      item.remixCount ?? "",
      item.repostCount ?? "",
      item.fileSizeBytes ?? "",
      Boolean(item.isRemoved) ? "1" : "0",
      Boolean(item.isDownloaded) ? "1" : "0",
      typeof item.prompt === "string" ? item.prompt.slice(0, 160) : "",
    ].join("§");
  });

  return [
    phase,
    popupState.browseState.sort,
    popupState.browseState.viewMode === "grid" ? "grid" : "list",
    normalizeSearchText(popupState.browseState.query),
    popupState.activeCreatorResultsTab,
    creatorResultTabs.join("|"),
    itemSignatures.join("||"),
  ].join("|||");
}
