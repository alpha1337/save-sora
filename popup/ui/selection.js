import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { getFetchUiState } from "../utils/runtime-state.js";
import { getSelectionScreenActionState, setSourceSelectionSummary } from "./character-selection.js";
import { formatFileSize, formatWholeNumber } from "../utils/format.js";
import { buildFetchSelectionSummary } from "../utils/fetch-copy.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import {
  getCreatorResultsTabLabel,
  getCreatorResultsTabs,
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
  const visibleKeySet = new Set(
    Array.isArray(popupState.virtualList.filteredItems)
      ? popupState.virtualList.filteredItems.map((item) => getItemKey(item)).filter(Boolean)
      : getVisibleItemKeysFromDom(),
  );
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
  const visibleKeySet = new Set(
    Array.isArray(popupState.virtualList.filteredItems)
      ? popupState.virtualList.filteredItems.map((item) => getItemKey(item)).filter(Boolean)
      : getVisibleItemKeysFromDom(),
  );
  return (Array.isArray(popupState.latestRenderState.items) ? popupState.latestRenderState.items : [])
    .filter((item) => isActiveBatchItem(item) && visibleKeySet.has(getItemKey(item)))
    .map((item) => getItemKey(item))
    .filter(Boolean);
}

/**
 * Returns every archive-eligible key in the current filtered result set, even
 * when virtualization means only a slice of cards is currently mounted.
 *
 * @returns {string[]}
 */
export function getBulkArchiveCandidateKeys() {
  const sourceItems =
    Array.isArray(popupState.virtualList.filteredItems) && popupState.virtualList.filteredItems.length > 0
      ? popupState.virtualList.filteredItems
      : Array.isArray(popupState.latestRenderState.items)
        ? popupState.latestRenderState.items
        : [];

  const keys = [];
  for (const item of sourceItems) {
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
 * Returns the currently targeted keys for a bulk archive action, intersected
 * with the live filtered result set so stale selections cannot leak across
 * searches or tab changes.
 *
 * @returns {string[]}
 */
export function getBulkArchiveSelectedKeys() {
  const candidateKeySet = new Set(getBulkArchiveCandidateKeys());
  const selectedKeys = [...new Set(
    (Array.isArray(popupState.bulkArchiveSelectionKeys) ? popupState.bulkArchiveSelectionKeys : [])
      .filter((key) => typeof key === "string" && candidateKeySet.has(key)),
  )];

  if (
    selectedKeys.length !==
    (Array.isArray(popupState.bulkArchiveSelectionKeys) ? popupState.bulkArchiveSelectionKeys.length : 0)
  ) {
    popupState.bulkArchiveSelectionKeys = selectedKeys;
  }

  return selectedKeys;
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
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const countSnapshot =
    popupState.latestRenderState.counts && typeof popupState.latestRenderState.counts === "object"
      ? popupState.latestRenderState.counts
      : null;
  const totalCount = Number.isFinite(Number(countSnapshot && countSnapshot.fetchedCount))
    ? Math.max(0, Number(countSnapshot.fetchedCount))
    : Number.isFinite(Number(popupState.latestRenderState.totalCount))
      ? Math.max(0, Number(popupState.latestRenderState.totalCount))
      : Array.isArray(popupState.latestRenderState.items)
        ? popupState.latestRenderState.items.length
        : 0;
  const selectedCount = Number.isFinite(Number(countSnapshot && countSnapshot.downloadableCount))
    ? Math.max(0, Number(countSnapshot.downloadableCount))
    : Number.isFinite(Number(popupState.latestRenderState.selectedCountTotal))
      ? Math.max(0, Number(popupState.latestRenderState.selectedCountTotal))
      : getSelectedKeysFromDom().length;
  const visibleCount =
    Number.isFinite(popupState.virtualList.visibleCount) && popupState.virtualList.visibleCount >= 0
      ? popupState.virtualList.visibleCount
      : getVisibleActiveKeysFromDom().length;
  const visibleSelectedCount =
    Number.isFinite(popupState.virtualList.visibleSelectedCount) &&
    popupState.virtualList.visibleSelectedCount >= 0
      ? popupState.virtualList.visibleSelectedCount
      : getSelectedKeysFromDom({ visibleOnly: true }).length;

  applySelectionUi(
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    fetchUiState.phase || "ready",
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
        : phase === "fetching"
          ? "Search Results (Loading...)"
          : "Search Results";
  }

  const countSnapshot =
    popupState.latestRenderState.counts && typeof popupState.latestRenderState.counts === "object"
      ? popupState.latestRenderState.counts
      : null;
  const downloadedCount = Number.isFinite(Number(countSnapshot && countSnapshot.downloadedCount))
    ? Math.max(0, Number(countSnapshot.downloadedCount))
    : 0;
  const fetchedCount = Number.isFinite(Number(countSnapshot && countSnapshot.fetchedCount))
    ? Math.max(0, Number(countSnapshot.fetchedCount))
    : totalCount;
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
  const isDownloadedTab = activeCreatorResultsTab === "downloaded";
  const isArchivedTab = activeCreatorResultsTab === "archived";
  const bulkArchiveSelectedCount = getBulkArchiveSelectedKeys().length;
  const hasAnyResults =
    (Array.isArray(popupState.latestRenderState.items) &&
      popupState.latestRenderState.items.length > 0) ||
    fetchedCount > 0;
  const isSourceSelectionMode =
    (selectedSources.includes("characterAccounts") || selectedSources.includes("creators")) &&
    phase !== "fetching" &&
    !hasAnyResults;
  popupState.latestSummaryContext = {
    totalCount,
    selectedCount,
    fetchedCount,
    downloadableCount: selectedCount,
    downloadedCount,
    archivedCount: Number.isFinite(Number(countSnapshot && countSnapshot.archivedCount))
      ? Math.max(0, Number(countSnapshot.archivedCount))
      : 0,
    downloadableBytes:
      countSnapshot && Object.prototype.hasOwnProperty.call(countSnapshot, "downloadableBytes")
        ? countSnapshot.downloadableBytes
        : null,
    downloadedBytes:
      countSnapshot && Object.prototype.hasOwnProperty.call(countSnapshot, "downloadedBytes")
        ? countSnapshot.downloadedBytes
        : null,
    archivedBytes:
      countSnapshot && Object.prototype.hasOwnProperty.call(countSnapshot, "archivedBytes")
        ? countSnapshot.archivedBytes
        : null,
    visibleCount,
    visibleSelectedCount,
    phase,
  };

  if (phase === "fetching") {
    dom.selectionSummary.textContent = buildFetchSelectionSummary({
      runtimeState: popupState.latestRuntimeState,
      flavorMessage: popupState.activeFetchStatusMessage || "Finding videos...",
      hasRenderableResults:
        Array.isArray(popupState.latestRenderState.items) &&
        popupState.latestRenderState.items.length > 0,
    });
    return;
  }

  if (phase === "fetch-paused") {
    dom.selectionSummary.textContent =
      fetchedCount > 0
        ? `Fetch paused • ${formatWholeNumber(fetchedCount)} found so far.`
        : "Fetch paused. Resume when you're ready.";
    return;
  }

  if (isSourceSelectionMode) {
    setSourceSelectionSummary();
    return;
  }

  if (selectedSources.length === 0 && !hasAnyResults) {
    dom.selectionSummary.textContent = "Choose at least one source to fetch.";
    return;
  }

  if (!hasAnyResults) {
    dom.selectionSummary.textContent =
      phase === "fetching" ? "Finding videos..." : "Content Violation?";
    return;
  }

  if (query.trim()) {
    const scopeSuffix = creatorFilterActive ? ` in ${creatorFilterLabel}` : "";
    if (isDownloadedTab) {
      dom.selectionSummary.textContent =
        visibleCount > 0
          ? `${formatWholeNumber(visibleCount)} matches${scopeSuffix} • ${formatWholeNumber(visibleCount)} downloaded in view${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded total` : ""}`
          : `No matches for “${query.trim()}”${scopeSuffix}`;
      return;
    }
      dom.selectionSummary.textContent =
        visibleCount > 0
          ? `${formatWholeNumber(visibleCount)} matches${scopeSuffix} • ${formatWholeNumber(visibleSelectedCount)} selected in view • ${formatWholeNumber(selectedCount)} selected overall${bulkArchiveSelectedCount > 0 ? ` • ${formatWholeNumber(bulkArchiveSelectedCount)} queued to archive` : ""}${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`
          : `No matches for “${query.trim()}”${scopeSuffix}`;
      return;
    }

  if (creatorFilterActive) {
    if (isDownloadedTab) {
      dom.selectionSummary.textContent =
        `${formatWholeNumber(visibleCount)} downloaded • ${formatWholeNumber(downloadedCount)} downloaded total`;
      return;
    }

    if (isArchivedTab) {
      dom.selectionSummary.textContent =
        `${formatWholeNumber(visibleCount)} archived • ${formatWholeNumber(visibleSelectedCount)} selected in view • ${formatWholeNumber(selectedCount)} selected overall${bulkArchiveSelectedCount > 0 ? ` • ${formatWholeNumber(bulkArchiveSelectedCount)} queued to archive` : ""}${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`;
      return;
    }

    dom.selectionSummary.textContent =
      `${formatWholeNumber(visibleCount)} ${creatorFilterLabel.toLowerCase()} • ${formatWholeNumber(visibleSelectedCount)} selected in view • ${formatWholeNumber(selectedCount)} selected overall${bulkArchiveSelectedCount > 0 ? ` • ${formatWholeNumber(bulkArchiveSelectedCount)} queued to archive` : ""}${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`;
    return;
  }

  if (selectedCount === totalCount && downloadedCount === 0) {
    dom.selectionSummary.textContent = "";
    dom.selectionSummary.classList.add("hidden");
    return;
  }

  dom.selectionSummary.textContent = `${formatWholeNumber(selectedCount)} of ${formatWholeNumber(totalCount)} selected${bulkArchiveSelectedCount > 0 ? ` • ${formatWholeNumber(bulkArchiveSelectedCount)} queued to archive` : ""}${downloadedCount > 0 ? ` • ${formatWholeNumber(downloadedCount)} downloaded` : ""}`;
}

/**
 * Shows or hides batch controls to match the current results set.
 *
 * @param {number} totalCount
 * @param {number} selectedCount
 * @param {number} [visibleCount=totalCount]
 */
export function syncSelectionControls(totalCount, selectedCount, visibleCount = totalCount) {
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const hasLoadedResults = popupState.latestRenderState.items.length > 0;
  const sourceSelectionState = getSelectionScreenActionState();
  const showSourceSelectionActions =
    sourceSelectionState.visible && sourceSelectionState.visibleCount > 0;
  const showDownloadButton =
    hasLoadedResults &&
    selectedCount > 0 &&
    !fetchUiState.isBusy &&
    !fetchUiState.isAnyPaused;
  const showBrowseTools = hasLoadedResults;
  const showSummaryPanel = hasLoadedResults;
  const normalizedSelectedCount = Math.max(0, Number(selectedCount) || 0);
  const bulkArchiveCandidateKeys = getBulkArchiveCandidateKeys();
  const bulkArchiveSelectedKeys = getBulkArchiveSelectedKeys();
  const showBulkArchiveActions =
    hasLoadedResults &&
    !showSourceSelectionActions &&
    bulkArchiveCandidateKeys.length > 0;
  const hasBulkArchiveSelection =
    showBulkArchiveActions && bulkArchiveSelectedKeys.length > 0;
  const downloadLabel =
    normalizedSelectedCount === 1
      ? "Download 1 Video"
      : `Download ${formatWholeNumber(normalizedSelectedCount)} Videos`;

  if (dom.downloadButton) {
    dom.downloadButton.textContent = downloadLabel;
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
    dom.selectAllButton.textContent = "Select All";
    dom.selectAllButton.classList.toggle("hidden", !(showSourceSelectionActions || showBulkArchiveActions));
    dom.selectAllButton.disabled =
      showSourceSelectionActions
        ? !showSourceSelectionActions ||
          sourceSelectionState.visibleCount === 0 ||
          sourceSelectionState.visibleSelectedCount >= sourceSelectionState.visibleCount
        : !showBulkArchiveActions ||
          bulkArchiveCandidateKeys.length === 0 ||
          bulkArchiveSelectedKeys.length >= bulkArchiveCandidateKeys.length;
  }
  if (dom.archiveSelectedButton instanceof HTMLButtonElement) {
    const bulkArchiveSelectedCount = bulkArchiveSelectedKeys.length;
    dom.archiveSelectedButton.classList.toggle("hidden", !hasBulkArchiveSelection);
    dom.archiveSelectedButton.disabled = !hasBulkArchiveSelection || bulkArchiveSelectedCount === 0;
    dom.archiveSelectedButton.textContent =
      bulkArchiveSelectedCount > 0
        ? `Archive Selected (${formatWholeNumber(bulkArchiveSelectedCount)})`
        : "Archive Selected";
  }
  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.textContent = "Select None";
    dom.clearSelectionButton.classList.toggle(
      "hidden",
      showSourceSelectionActions ? !showSourceSelectionActions : !hasBulkArchiveSelection,
    );
    dom.clearSelectionButton.disabled =
      showSourceSelectionActions
        ? !showSourceSelectionActions || sourceSelectionState.visibleSelectedCount === 0
        : !hasBulkArchiveSelection || bulkArchiveSelectedKeys.length === 0;
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

  const countSnapshot =
    popupState.latestRenderState.counts && typeof popupState.latestRenderState.counts === "object"
      ? popupState.latestRenderState.counts
      : null;
  const totalCount = Number.isFinite(Number(countSnapshot && countSnapshot.fetchedCount))
    ? Math.max(0, Number(countSnapshot.fetchedCount))
    : Number.isFinite(Number(popupState.latestRenderState.totalCount))
      ? Math.max(0, Number(popupState.latestRenderState.totalCount))
      : Array.isArray(items)
        ? items.length
        : 0;
  const totalBytes =
    countSnapshot && Object.prototype.hasOwnProperty.call(countSnapshot, "downloadableBytes")
      ? countSnapshot.downloadableBytes
      : null;
  const formattedSize = formatFileSize(totalBytes);
  dom.totalCount.textContent =
    formattedSize ? `${formatWholeNumber(totalCount)} / ${formattedSize}` : formatWholeNumber(totalCount);
}
