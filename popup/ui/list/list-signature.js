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
  return JSON.stringify({
    phase,
    sort: popupState.browseState.sort,
    query: normalizeSearchText(popupState.browseState.query),
    creatorTab: popupState.activeCreatorResultsTab,
    creatorResultTabs,
    items: sortedItems.map((item) => ({
      key: getItemKey(item),
      selected: selectedKeys.includes(getItemKey(item)),
      title: resolveItemTitle(item, titleOverrides),
      disabled: disableInputs,
      thumb: item.thumbnailUrl || "",
      date: item.postedAt || item.createdAt || "",
      duration: item.durationSeconds || null,
      likes: item.likeCount ?? null,
      views: item.viewCount ?? null,
      remixes: item.remixCount ?? null,
      shares: item.shareCount ?? null,
      reposts: item.repostCount ?? null,
      fileSizeBytes: item.fileSizeBytes ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      prompt: item.prompt || "",
      removed: Boolean(item.isRemoved),
      downloaded: Boolean(item.isDownloaded),
    })),
  });
}
