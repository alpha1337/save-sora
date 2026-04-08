import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { setSourceSelectionSummary } from "./character-selection.js";
import { formatFileSize, formatWholeNumber } from "../utils/format.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import {
  getCreatorResultsTabLabel,
  getCreatorResultsTabs,
  getDownloadedCount,
  getTotalBatchMetrics,
  getImplicitSelectedKeys,
  getItemKey,
  isActiveBatchItem,
} from "../utils/items.js";

/**
 * Selection and summary helpers for the item list.
 */

/**
 * Returns the rendered item cards that are currently visible in the results list.
 *
 * @returns {HTMLElement[]}
 */
export function getVisibleItemCards() {
  if (!(dom.itemsList instanceof HTMLElement)) {
    return [];
  }

  return [...dom.itemsList.querySelectorAll(".item-card[data-item-key]")].filter((card) =>
    card instanceof HTMLElement && !card.classList.contains("hidden"),
  );
}

/**
 * Returns the visible item keys, optionally restricted to active batch items.
 *
 * @returns {string[]}
 */
export function getVisibleItemKeysFromDom() {
  return getVisibleItemCards()
    .map((card) => card.dataset.itemKey || "")
    .filter(Boolean);
}

/**
 * Returns the active, download-eligible item keys.
 *
 * Archive state is the selection model, so this derives selection from the working set
 * instead of a separate checkbox state.
 *
 * @param {{visibleOnly?: boolean}} [options]
 * @returns {string[]}
 */
export function getSelectedKeysFromDom(options = {}) {
  const visibleOnly = Boolean(options.visibleOnly);
  if (!visibleOnly) {
    return getImplicitSelectedKeys(popupState.latestRenderState.items);
  }

  const visibleKeySet = new Set(getVisibleItemKeysFromDom());
  return getImplicitSelectedKeys(popupState.latestRenderState.items)
    .filter((key) => visibleKeySet.has(key));
}

/**
 * Returns the archived item keys visible in the current list.
 *
 * @returns {string[]}
 */
export function getVisibleArchivedKeysFromDom() {
  const visibleKeySet = new Set(getVisibleItemKeysFromDom());
  return (Array.isArray(popupState.latestRenderState.items) ? popupState.latestRenderState.items : [])
    .filter((item) => Boolean(item && item.isRemoved) && visibleKeySet.has(getItemKey(item)))
    .map((item) => getItemKey(item))
    .filter(Boolean);
}

/**
 * Returns the active item keys visible in the current list.
 *
 * @returns {string[]}
 */
export function getVisibleActiveKeysFromDom() {
  const visibleKeySet = new Set(getVisibleItemKeysFromDom());
  return (Array.isArray(popupState.latestRenderState.items) ? popupState.latestRenderState.items : [])
    .filter((item) => isActiveBatchItem(item) && visibleKeySet.has(getItemKey(item)))
    .map((item) => getItemKey(item))
    .filter(Boolean);
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
  const totalCount = Array.isArray(popupState.latestRenderState.items)
    ? popupState.latestRenderState.items.length
    : 0;
  const selectedCount = getSelectedKeysFromDom().length;
  const visibleCount = getVisibleActiveKeysFromDom().length;
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

  dom.selectionSummary.classList.remove("hidden");

  if (dom.pickerPanelLabel instanceof HTMLElement) {
    dom.pickerPanelLabel.textContent =
      totalCount > 0
        ? `Search Results (${formatWholeNumber(totalCount)})`
        : "Search Results";
  }

  const downloadedCount = getDownloadedCount(popupState.latestRenderState.items);
  const selectedSources = getSelectedSourceValues(dom.sourceSelectInputs);
  const creatorResultTabs = getCreatorResultsTabs(popupState.latestRenderState.items);
  const activeCreatorResultsTab = new Set(creatorResultTabs.map((tab) => tab.key)).has(
    popupState.activeCreatorResultsTab,
  )
    ? popupState.activeCreatorResultsTab
    : creatorResultTabs[0]?.key || "all";
  const creatorFilterActive =
    creatorResultTabs.length > 0 && activeCreatorResultsTab !== "all";
  const creatorFilterLabel = getCreatorResultsTabLabel(activeCreatorResultsTab);
  const isSourceSelectionMode =
    (selectedSources.includes("characterAccounts") || selectedSources.includes("creators")) &&
    phase !== "fetching" &&
    totalCount === 0;
  popupState.latestSummaryContext = {
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
  };

  if (phase === "fetching") {
    const flavor = popupState.activeFetchStatusMessage || "Finding videos...";
    dom.selectionSummary.textContent = flavor;
    return;
  }

  if (phase === "fetch-paused") {
    dom.selectionSummary.textContent =
      totalCount > 0
        ? `Fetch paused • ${formatWholeNumber(totalCount)} found so far.`
        : "Fetch paused. Resume when you're ready.";
    return;
  }

  if (isSourceSelectionMode) {
    setSourceSelectionSummary();
    return;
  }

  if (selectedSources.length === 0 && totalCount === 0) {
    dom.selectionSummary.textContent = "Choose at least one source to fetch.";
    return;
  }

  if (totalCount === 0) {
    dom.selectionSummary.textContent =
      phase === "fetching" ? "Finding videos..." : "Content Violation?";
    return;
  }

  if (query.trim()) {
    const scopeSuffix = creatorFilterActive ? ` in ${creatorFilterLabel}` : "";
    dom.selectionSummary.textContent =
      visibleCount > 0
        ? `${formatWholeNumber(visibleCount)} matches${scopeSuffix} • ${formatWholeNumber(visibleSelectedCount)} selected in view • ${formatWholeNumber(selectedCount)} selected overall${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`
        : `No matches for “${query.trim()}”${scopeSuffix}`;
    return;
  }

  if (creatorFilterActive) {
    dom.selectionSummary.textContent =
      `${formatWholeNumber(visibleCount)} ${creatorFilterLabel.toLowerCase()} • ${formatWholeNumber(visibleSelectedCount)} selected in view • ${formatWholeNumber(selectedCount)} selected overall${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`;
    return;
  }

  if (selectedCount === totalCount && downloadedCount === 0) {
    dom.selectionSummary.textContent = "";
    dom.selectionSummary.classList.add("hidden");
    return;
  }

  dom.selectionSummary.textContent = `${formatWholeNumber(selectedCount)} of ${formatWholeNumber(totalCount)} selected${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`;
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
  const showBrowseTools = hasLoadedResults;
  const showSummaryPanel = hasLoadedResults && !isFetching;

  if (dom.downloadButton) {
    dom.downloadButton.classList.toggle("hidden", !showDownloadButton);
    dom.downloadButton.disabled = !showDownloadButton;
  }
  if (dom.exportControl instanceof HTMLElement) {
    dom.exportControl.classList.toggle("hidden", !showDownloadButton);
  }
  if (dom.exportButton) {
    dom.exportButton.disabled = !showDownloadButton;
  }
  if (dom.exportMenuButton) {
    dom.exportMenuButton.disabled = !showDownloadButton;
  }
  if (!showDownloadButton) {
    if (dom.exportMenuButton instanceof HTMLButtonElement) {
      dom.exportMenuButton.setAttribute("aria-expanded", "false");
    }
    if (dom.exportControl instanceof HTMLElement) {
      dom.exportControl.classList.remove("is-open");
    }
    if (dom.exportMenu instanceof HTMLElement) {
      dom.exportMenu.classList.add("hidden");
    }
    popupState.exportMenuOpen = false;
  }
  if (dom.selectAllButton) {
    dom.selectAllButton.classList.add("hidden");
    dom.selectAllButton.disabled = true;
  }
  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.classList.add("hidden");
    dom.clearSelectionButton.disabled = true;
  }
  if (dom.resultsViewToggle instanceof HTMLElement) {
    dom.resultsViewToggle.classList.toggle("hidden", !showBrowseTools);
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
 * Updates the left summary card with total result count and aggregate file size.
 *
 * @param {object[]} items
 */
export function updateTotalSummary(items) {
  if (!(dom.totalCount instanceof HTMLElement)) {
    return;
  }

  const { totalCount, totalBytes } = getTotalBatchMetrics(items);
  const formattedSize = formatFileSize(totalBytes);
  dom.totalCount.textContent =
    formattedSize ? `${formatWholeNumber(totalCount)} / ${formattedSize}` : formatWholeNumber(totalCount);
}
