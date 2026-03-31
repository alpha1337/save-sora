import { dom } from "../dom.js";
import { saveDownloadedState, saveRemovedState } from "../runtime.js";
import { popupState } from "../state.js";
import { getItemKey } from "../utils/items.js";
import { hideNotice, showNotice, updateBackToTopVisibility } from "../ui/layout.js";
import { renderCurrentItems, renderState } from "../ui/render.js";
import { applyCurrentSelectionUi } from "../ui/selection.js";
import { refreshStatus, startPolling, stopPolling } from "./polling.js";
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

  const itemKey = removeButton.dataset.itemKey;
  const currentItem = popupState.latestRenderState.items.find((item) => getItemKey(item) === itemKey);
  const isDownloaded = Boolean(currentItem && currentItem.isDownloaded);
  const nextRemoved = !Boolean(currentItem && currentItem.isRemoved);
  const didOptimisticallyUpdate = isDownloaded
    ? applyOptimisticDownloadedState(itemKey, false)
    : applyOptimisticRemovedState(itemKey, nextRemoved);

  try {
    await flushPendingTitleSaves();
    const response = isDownloaded
      ? await saveDownloadedState(itemKey, false)
      : await saveRemovedState(itemKey, nextRemoved);

    if (response.state) {
      renderState(response.state);
    } else {
      await refreshStatus();
    }
  } catch (error) {
    if (didOptimisticallyUpdate) {
      await refreshStatus();
    }

    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    startPolling();
    return;
  }

  startPolling();
}

/**
 * Applies an optimistic remove/restore state in the popup before the background
 * worker confirms the mutation.
 *
 * @param {string} itemKey
 * @param {boolean} removed
 * @returns {boolean}
 */
function applyOptimisticRemovedState(itemKey, removed) {
  if (typeof itemKey !== "string" || !itemKey) {
    return false;
  }

  let didUpdate = false;
  const nextItems = popupState.latestRenderState.items.map((item) => {
    const key = getItemKey(item);
    if (key !== itemKey || Boolean(item.isRemoved) === Boolean(removed)) {
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

  const nextSelectedKeySet = new Set(popupState.latestRenderState.selectedKeys);
  if (removed) {
    nextSelectedKeySet.delete(itemKey);
  } else {
    nextSelectedKeySet.add(itemKey);
  }

  commitOptimisticItemState(nextItems, nextSelectedKeySet);
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
function applyOptimisticDownloadedState(itemKey, downloaded) {
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

  const nextSelectedKeySet = new Set(popupState.latestRenderState.selectedKeys);
  if (downloaded) {
    nextSelectedKeySet.delete(itemKey);
  } else {
    nextSelectedKeySet.add(itemKey);
  }

  commitOptimisticItemState(nextItems, nextSelectedKeySet);
  return true;
}

/**
 * Commits an optimistic item mutation into the popup-local cache and refreshes
 * the derived selection UI.
 *
 * @param {object[]} items
 * @param {Set<string>} selectedKeySet
 */
function commitOptimisticItemState(items, selectedKeySet) {
  popupState.latestRenderState = {
    ...popupState.latestRenderState,
    items,
    selectedKeys: [...selectedKeySet],
  };

  renderCurrentItems();
  applyCurrentSelectionUi();
  updateBackToTopVisibility();
}
