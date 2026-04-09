import { dom } from "../dom.js";
import { saveBulkRemovedState, saveDownloadedState, saveRemovedState } from "../runtime.js";
import { popupState } from "../state.js";
import { buildRenderCountSnapshot } from "../utils/counts.js";
import { getImplicitSelectedKeys, getItemKey } from "../utils/items.js";
import { hideNotice, showNotice, updateBackToTopVisibility } from "../ui/layout.js";
import { renderCurrentItems, renderState } from "../ui/render.js";
import { applyCurrentSelectionUi } from "../ui/selection.js";
import { refreshStatus, stopPolling, syncPollingForState } from "./polling.js";
import { flushPendingTitleSaves } from "./title-edits.js";

/**
 * Handles the remove/restore/download-again button for an item card.
 *
 * Downloaded items reuse the same button to offer "download again", which is
 * implemented by clearing the local downloaded flag and letting the background
 * worker rebuild the queue with the latest title override.
 *
 * @param {MouseEvent} event
 * @param {HTMLButtonElement} removeButton
 */
export async function handleRemoveButtonClick(event, removeButton) {
  event.preventDefault();
  event.stopPropagation();
  hideNotice(dom.errorBox);
  stopPolling();
  const previousScrollTop = dom.pickerScrollRegion instanceof HTMLElement
    ? dom.pickerScrollRegion.scrollTop
    : 0;

  const itemKey = removeButton.dataset.itemKey;
  const currentItem = popupState.latestRenderState.items.find((item) => getItemKey(item) === itemKey);
  const isDownloaded = Boolean(currentItem && currentItem.isDownloaded);
  const nextRemoved = !Boolean(currentItem && currentItem.isRemoved);
  const didOptimisticallyUpdate = isDownloaded
    ? applyOptimisticDownloadedState(itemKey, false, previousScrollTop)
    : applyOptimisticRemovedState([itemKey], nextRemoved, previousScrollTop);

  try {
    await flushPendingTitleSaves();
    const response = isDownloaded
      ? await saveDownloadedState(itemKey, false)
      : await saveRemovedState(itemKey, nextRemoved, {
        sortKey: popupState.browseState.sort,
        query: popupState.browseState.query,
        creatorTab: popupState.activeCreatorResultsTab,
      });

    if (response.state) {
      renderState({
        ...response.state,
        items: popupState.latestRenderState.items,
        selectedKeys: popupState.latestRenderState.selectedKeys,
        titleOverrides: popupState.latestRenderState.titleOverrides,
      });
      syncPollingForState(response.state);
    } else {
      await refreshStatus();
    }

    restorePickerScroll(previousScrollTop);
  } catch (error) {
    if (didOptimisticallyUpdate) {
      await refreshStatus();
    }

    restorePickerScroll(previousScrollTop);

    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    return;
  }
}

/**
 * Applies the archive state change to multiple visible items at once.
 *
 * @param {string[]} itemKeys
 * @param {boolean} removed
 * @returns {Promise<boolean>}
 */
export async function handleBatchArchiveStateChange(itemKeys, removed) {
  const normalizedKeys = [...new Set((Array.isArray(itemKeys) ? itemKeys : []).filter(Boolean))];
  if (normalizedKeys.length === 0) {
    return false;
  }

  hideNotice(dom.errorBox);
  stopPolling();
  const previousScrollTop = dom.pickerScrollRegion instanceof HTMLElement
    ? dom.pickerScrollRegion.scrollTop
    : 0;
  const didOptimisticallyUpdate = applyOptimisticRemovedState(
    normalizedKeys,
    removed,
    previousScrollTop,
  );

  try {
    await flushPendingTitleSaves();
    const response = await saveBulkRemovedState(normalizedKeys, removed, {
      sortKey: popupState.browseState.sort,
      query: popupState.browseState.query,
      creatorTab: popupState.activeCreatorResultsTab,
    });

    if (response && response.state) {
      renderState({
        ...response.state,
        items: popupState.latestRenderState.items,
        selectedKeys: popupState.latestRenderState.selectedKeys,
        titleOverrides: popupState.latestRenderState.titleOverrides,
      });
      syncPollingForState(response.state);
    } else {
      await refreshStatus();
    }

    restorePickerScroll(previousScrollTop);
    return true;
  } catch (error) {
    if (didOptimisticallyUpdate) {
      await refreshStatus();
    }

    restorePickerScroll(previousScrollTop);
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Applies an optimistic remove/restore state in the popup before the background
 * worker confirms the mutation.
 *
 * @param {string} itemKey
 * @param {boolean} removed
 * @returns {boolean}
 */
function applyOptimisticRemovedState(itemKeys, removed, scrollTop = 0) {
  const keySet = new Set((Array.isArray(itemKeys) ? itemKeys : []).filter(Boolean));
  if (keySet.size === 0) {
    return false;
  }

  let didUpdate = false;
  const nextItems = popupState.latestRenderState.items.map((item) => {
    const key = getItemKey(item);
    if (!keySet.has(key) || Boolean(item.isRemoved) === Boolean(removed)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      isRemoved: Boolean(removed),
    };
  });

  if (!didUpdate) {
    return false;
  }

  commitOptimisticItemState(nextItems, getImplicitSelectedKeys(nextItems), scrollTop);
  return true;
}

/**
 * Applies an optimistic downloaded/not-downloaded state in the popup before the
 * background worker confirms the mutation.
 *
 * @param {string} itemKey
 * @param {boolean} downloaded
 * @returns {boolean}
 */
function applyOptimisticDownloadedState(itemKey, downloaded, scrollTop = 0) {
  if (typeof itemKey !== "string" || !itemKey) {
    return false;
  }

  let didUpdate = false;
  const nextItems = popupState.latestRenderState.items.map((item) => {
    const key = getItemKey(item);
    if (key !== itemKey || Boolean(item.isDownloaded) === Boolean(downloaded)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      isDownloaded: Boolean(downloaded),
    };
  });

  if (!didUpdate) {
    return false;
  }

  commitOptimisticItemState(nextItems, getImplicitSelectedKeys(nextItems), scrollTop);
  return true;
}

/**
 * Commits an optimistic item mutation into the popup-local cache and refreshes
 * the derived selection UI.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 */
function commitOptimisticItemState(items, selectedKeys, scrollTop = 0) {
  const countSnapshot = buildRenderCountSnapshot(popupState.latestRuntimeState, items);
  popupState.latestRenderState = {
    ...popupState.latestRenderState,
    items,
    selectedKeys: Array.isArray(selectedKeys) ? selectedKeys : [],
    totalCount: countSnapshot.fetchedCount,
    selectedCountTotal: countSnapshot.downloadableCount,
    counts: countSnapshot,
  };
  popupState.latestSummaryContext = {
    ...popupState.latestSummaryContext,
    totalCount: countSnapshot.fetchedCount,
    selectedCount: countSnapshot.downloadableCount,
    fetchedCount: countSnapshot.fetchedCount,
    downloadableCount: countSnapshot.downloadableCount,
    downloadedCount: countSnapshot.downloadedCount,
    archivedCount: countSnapshot.archivedCount,
    downloadableBytes: countSnapshot.downloadableBytes,
    downloadedBytes: countSnapshot.downloadedBytes,
    archivedBytes: countSnapshot.archivedBytes,
  };

  renderCurrentItems();
  applyCurrentSelectionUi();
  restorePickerScroll(scrollTop);
  updateBackToTopVisibility();
}

function restorePickerScroll(scrollTop) {
  if (!(dom.pickerScrollRegion instanceof HTMLElement)) {
    return;
  }

  dom.pickerScrollRegion.scrollTop = Math.max(0, Number(scrollTop) || 0);
}
