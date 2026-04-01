import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { formatFileSize } from "../utils/format.js";
import {
  getActiveSelectableCount,
  getDownloadedCount,
  getSelectedBatchMetrics,
} from "../utils/items.js";

/**
 * Selection and summary helpers for the item list.
 */

/**
 * Returns the rendered item checkboxes, optionally filtered to the visible and/or
 * enabled subset.
 *
 * @param {{visibleOnly?: boolean, enabledOnly?: boolean}} [options]
 * @returns {HTMLInputElement[]}
 */
export function getItemCheckboxesWithOptions(options = {}) {
  const visibleOnly = Boolean(options.visibleOnly);
  const enabledOnly = Boolean(options.enabledOnly);

  if (!(dom.itemsList instanceof HTMLElement)) {
    return [];
  }

  return [...dom.itemsList.querySelectorAll('input[type="checkbox"][data-item-key]')].filter((input) => {
    if (!(input instanceof HTMLInputElement)) {
      return false;
    }

    if (enabledOnly && input.disabled) {
      return false;
    }

    if (!visibleOnly) {
      return true;
    }

    const card = input.closest(".item-card");
    return !(card instanceof HTMLElement) || !card.classList.contains("hidden");
  });
}

/**
 * Returns all rendered item checkboxes.
 *
 * @returns {HTMLInputElement[]}
 */
export function getItemCheckboxes() {
  return getItemCheckboxesWithOptions();
}

/**
 * Reads the current checked state from the DOM.
 *
 * @param {{visibleOnly?: boolean, enabledOnly?: boolean}} [options]
 * @returns {string[]}
 */
export function getSelectedKeysFromDom(options = {}) {
  return getItemCheckboxesWithOptions(options)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

/**
 * Recomputes the summary and batch controls using explicit counts.
 *
 * @param {number} totalCount
 * @param {number} selectedCount
 * @param {number} visibleCount
 * @param {number} visibleSelectedCount
 * @param {string} phase
 */
export function applySelectionUi(
  totalCount,
  selectedCount,
  visibleCount,
  visibleSelectedCount,
  phase,
) {
  updateTotalSummary(popupState.latestRenderState.items, popupState.latestRenderState.selectedKeys);
  updateSelectionSummary({
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
    query: popupState.browseState.query,
  });
  syncSelectionControls(totalCount, selectedCount, visibleCount);
}

/**
 * Recomputes the summary and batch controls from current popup state and DOM.
 */
export function applyCurrentSelectionUi() {
  const totalCount = getActiveSelectableCount(popupState.latestRenderState.items);
  const selectedCount = getSelectedKeysFromDom().length;
  const visibleCount = getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true }).length;
  const visibleSelectedCount = getSelectedKeysFromDom({ visibleOnly: true }).length;

  applySelectionUi(
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    popupState.latestBusy ? "fetching" : popupState.latestRenderState.phase || "ready",
  );
}

/**
 * Updates the short line of copy above the item list.
 *
 * @param {object} context
 */
export function updateSelectionSummary({
  totalCount,
  selectedCount,
  visibleCount = totalCount,
  visibleSelectedCount = selectedCount,
  phase,
  query = "",
}) {
  if (!(dom.selectionSummary instanceof HTMLElement)) {
    return;
  }

  const downloadedCount = getDownloadedCount(popupState.latestRenderState.items);
  popupState.latestSummaryContext = {
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
  };

  if (phase === "fetching") {
    const flavor = popupState.activeFetchStatusMessage || "Finding videos...";
    dom.selectionSummary.textContent =
      totalCount > 0 ? `${flavor} ${totalCount} found so far.` : flavor;
    return;
  }

  if (totalCount === 0) {
    dom.selectionSummary.textContent =
      phase === "fetching" ? "Finding videos..." : "Content Violation?";
    return;
  }

  if (query.trim()) {
    dom.selectionSummary.textContent =
      visibleCount > 0
        ? `${visibleCount} matches • ${visibleSelectedCount} selected in view • ${selectedCount} selected overall${downloadedCount > 0 ? ` • ${downloadedCount} downloaded` : ""}`
        : `No matches for “${query.trim()}”`;
    return;
  }

  dom.selectionSummary.textContent = `${selectedCount} of ${totalCount} selected${downloadedCount > 0 ? ` • ${downloadedCount} downloaded` : ""}`;
}

/**
 * Shows or hides batch controls to match the current results set.
 *
 * @param {number} totalCount
 * @param {number} selectedCount
 * @param {number} [visibleCount=totalCount]
 */
export function syncSelectionControls(totalCount, selectedCount, visibleCount = totalCount) {
  const phase = popupState.latestRenderState.phase || "idle";
  const hasLoadedResults = popupState.latestRenderState.items.length > 0;
  const isFetching = phase === "fetching";
  const showDownloadButton =
    hasLoadedResults && selectedCount > 0 && !popupState.latestBusy && !popupState.latestPaused && !isFetching;
  const showBatchActions = hasLoadedResults && visibleCount > 0 && !isFetching;
  const showBrowseTools = hasLoadedResults;
  const showSummaryPanel = hasLoadedResults && !isFetching;

  if (dom.downloadButton) {
    dom.downloadButton.classList.toggle("hidden", !showDownloadButton);
    dom.downloadButton.disabled = !showDownloadButton;
  }
  if (dom.exportUrlsButton) {
    dom.exportUrlsButton.classList.toggle("hidden", !showDownloadButton);
    dom.exportUrlsButton.disabled = !showDownloadButton;
  }
  if (dom.selectAllButton) {
    dom.selectAllButton.classList.toggle("hidden", !showBatchActions);
  }
  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.classList.toggle("hidden", !showBatchActions);
  }
  if (dom.summaryPanel instanceof HTMLElement) {
    dom.summaryPanel.classList.toggle("hidden", !showSummaryPanel);
  }
  if (dom.pickerToolbar instanceof HTMLElement) {
    dom.pickerToolbar.classList.toggle("hidden", !showBrowseTools);
  }
  if (dom.sourceSelectField instanceof HTMLElement) {
    dom.sourceSelectField.classList.toggle("hidden", showBrowseTools);
  }
  if (dom.controlsPanel instanceof HTMLElement) {
    dom.controlsPanel.dataset.hasResults = showBrowseTools ? "true" : "false";
  }
}

/**
 * Updates the left summary count with selection totals and aggregate file size.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 */
export function updateTotalSummary(items, selectedKeys) {
  if (!(dom.totalCount instanceof HTMLElement)) {
    return;
  }

  const { selectedCount, totalBytes } = getSelectedBatchMetrics(items, selectedKeys);
  const formattedSize = formatFileSize(totalBytes);
  dom.totalCount.textContent = formattedSize ? `${selectedCount} / ${formattedSize}` : String(selectedCount);
}
