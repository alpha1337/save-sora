import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { formatWholeNumber } from "../../utils/format.js";
import { getItemKey } from "../../utils/items.js";
import { getSortedItems, matchesSmartSearch } from "../../utils/search.js";
import { applySelectionUi, updateSelectionSummary } from "../selection.js";
import {
  filterItemsForCreatorResultsTab,
  getCreatorResultsTabs,
} from "../../utils/items.js";
import { disposeMediaPreview } from "../media.js";
import { createItemCard } from "./item-card.js";
import { createItemContentSurface } from "./item-card-parts.js";
import { buildRenderSignature } from "./list-signature.js";
import {
  renderEmptyLibrary,
  renderEmptySearchResult,
  showPopulatedListState,
} from "./list-empty-state.js";

const LIST_OVERSCAN_ITEMS = 8;
const LIST_VERTICAL_GAP = 10;
const DEFAULT_LIST_ROW_HEIGHT = 214;
const GRID_OVERSCAN_ROWS = 2;
const GRID_TARGET_CARD_WIDTH = 156;
const GRID_TOOLTIP_MIN_WIDTH = 260;
const GRID_TOOLTIP_MAX_WIDTH = 360;
const GRID_TOOLTIP_MARGIN = 12;

/**
 * Renders the current list of Sora items.
 *
 * The renderer now keeps the full logical result set in memory while only
 * realizing the visible window in the DOM. This preserves the single
 * scrollable-list experience without rendering thousands of live cards.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 * @param {Record<string, string>} titleOverrides
 * @param {boolean} disableInputs
 * @param {string} phase
 */
export function renderItemsList(items, selectedKeys, titleOverrides, disableInputs, phase) {
  if (!(dom.itemsList instanceof HTMLElement) || !(dom.emptyState instanceof HTMLElement)) {
    return;
  }

  const resultsViewMode = popupState.browseState.viewMode === "grid" ? "grid" : "list";
  syncResultsViewMode(resultsViewMode, items.length > 0);

  const creatorResultTabs = getCreatorResultsTabs(items);
  syncCreatorResultsTabs(creatorResultTabs);

  const effectiveTotalCount = items.length;
  const selectedCountTotal = Number(popupState.latestRenderState.selectedCountTotal);
  const effectiveSelectedCount =
    Number.isFinite(selectedCountTotal) && selectedCountTotal >= 0
      ? selectedCountTotal
      : selectedKeys.length;

  if (!items.length) {
    resetResultsPresentation();
    renderEmptyLibrary(phase);
    updateSelectionSummary({
      totalCount: effectiveTotalCount,
      selectedCount: effectiveSelectedCount,
      phase,
    });
    return;
  }

  const creatorTabsSignature = creatorResultTabs
    .map((tab) => `${tab.key}:${tab.count}`)
    .join("|");
  prepareVirtualDataset(
    items,
    selectedKeys,
    titleOverrides,
    disableInputs,
    phase,
    resultsViewMode,
    creatorTabsSignature,
  );

  const { visibleCount, visibleSelectedCount } = popupState.virtualList;
  if (visibleCount === 0) {
    resetRenderedWindow();
    renderEmptySearchResult(popupState.browseState.query);
  } else {
    showPopulatedListState();
    renderVisibleItemsWindow(false);
  }

  applySelectionUi(
    effectiveTotalCount,
    effectiveSelectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
  );
}

/**
 * Re-renders the currently visible DOM window after a scroll or resize.
 *
 * @param {boolean} [force=false]
 */
export function renderVisibleItemsWindow(force = false) {
  if (!(dom.itemsList instanceof HTMLElement)) {
    return;
  }

  const cache = popupState.virtualList;
  if (!Array.isArray(cache.filteredItems) || cache.filteredItems.length === 0) {
    resetRenderedWindow();
    return;
  }

  const nextWindow = computeVisibleWindow(cache.viewMode, cache.filteredItems.length);
  if (!nextWindow) {
    return;
  }

  const visibleItems = cache.filteredItems.slice(nextWindow.startIndex, nextWindow.endIndex);
  const visibleWindowSignature = buildRenderSignature(
    visibleItems,
    popupState.latestRenderState.selectedKeys,
    popupState.latestRenderState.titleOverrides,
    popupState.latestRenderState.disableInputs,
    cache.phase,
  );
  const sameWindowGeometry =
    cache.rangeStart === nextWindow.startIndex &&
    cache.rangeEnd === nextWindow.endIndex &&
    cache.lastViewportWidth === nextWindow.viewportWidth &&
    cache.lastViewportHeight === nextWindow.viewportHeight &&
    cache.lastScrollTop === nextWindow.scrollTop &&
    cache.gridColumns === nextWindow.columns &&
    cache.gridCardWidth === nextWindow.cardWidth &&
    cache.gridRowHeight === nextWindow.rowHeight;
  const samePadding =
    cache.lastPaddingTop === nextWindow.paddingTop &&
    cache.lastPaddingBottom === nextWindow.paddingBottom;

  if (!force && sameWindowGeometry && samePadding && cache.lastWindowSignature === visibleWindowSignature) {
    return;
  }

  if (!force && sameWindowGeometry && cache.lastWindowSignature === visibleWindowSignature) {
    cache.lastPaddingTop = nextWindow.paddingTop;
    cache.lastPaddingBottom = nextWindow.paddingBottom;
    dom.itemsList.style.paddingTop = `${Math.max(0, nextWindow.paddingTop)}px`;
    dom.itemsList.style.paddingBottom = `${Math.max(0, nextWindow.paddingBottom)}px`;
    if (cache.viewMode === "grid") {
      dom.itemsList.style.setProperty("--virtual-grid-card-width", `${nextWindow.cardWidth}px`);
    }
    return;
  }

  hideSharedGridTooltip({ immediate: true });
  disposeCurrentRenderedWindow();

  cache.rangeStart = nextWindow.startIndex;
  cache.rangeEnd = nextWindow.endIndex;
  cache.lastViewportWidth = nextWindow.viewportWidth;
  cache.lastViewportHeight = nextWindow.viewportHeight;
  cache.lastScrollTop = nextWindow.scrollTop;
  cache.gridColumns = nextWindow.columns;
  cache.gridCardWidth = nextWindow.cardWidth;
  cache.gridRowHeight = nextWindow.rowHeight;
  cache.lastPaddingTop = nextWindow.paddingTop;
  cache.lastPaddingBottom = nextWindow.paddingBottom;
  cache.lastWindowSignature = visibleWindowSignature;

  dom.itemsList.style.paddingTop = `${Math.max(0, nextWindow.paddingTop)}px`;
  dom.itemsList.style.paddingBottom = `${Math.max(0, nextWindow.paddingBottom)}px`;
  if (cache.viewMode === "grid") {
    dom.itemsList.style.setProperty("--virtual-grid-card-width", `${nextWindow.cardWidth}px`);
  } else {
    dom.itemsList.style.removeProperty("--virtual-grid-card-width");
  }

  const selectedSet = new Set(popupState.latestRenderState.selectedKeys);
  const renderedItemsByKey = new Map();
  const fragment = document.createDocumentFragment();

  for (const item of visibleItems) {
    const key = getItemKey(item);
    renderedItemsByKey.set(key, item);
    const { card } = createItemCard(item, {
      selectedSet,
      titleOverrides: popupState.latestRenderState.titleOverrides,
      disableInputs: popupState.latestRenderState.disableInputs,
      viewMode: cache.viewMode,
    });
    fragment.append(card);
  }

  cache.renderedItemsByKey = renderedItemsByKey;
  dom.itemsList.replaceChildren(fragment);

  if (cache.viewMode !== "grid") {
    scheduleListMeasurement();
  }
}

/**
 * Schedules a lightweight re-render for the current visible window.
 */
export function scheduleVisibleItemsWindowRender(force = false) {
  if (popupState.virtualList.scrollFrame) {
    return;
  }

  popupState.virtualList.scrollFrame = window.requestAnimationFrame(() => {
    popupState.virtualList.scrollFrame = 0;
    renderVisibleItemsWindow(force);
  });
}

/**
 * Requests a row-height measurement pass for list mode after the current frame.
 */
export function scheduleVirtualListMeasurement() {
  scheduleListMeasurement();
}

/**
 * Clears any shared tooltip and rendered-card window state.
 */
export function resetResultsPresentation() {
  hideSharedGridTooltip({ immediate: true });
  disposeCurrentRenderedWindow();
  resetRenderedWindow();

  popupState.virtualList.filteredItems = [];
  popupState.virtualList.visibleCount = 0;
  popupState.virtualList.visibleSelectedCount = 0;
  popupState.virtualList.renderedItemsByKey = new Map();
  popupState.virtualList.rangeStart = 0;
  popupState.virtualList.rangeEnd = 0;
}

/**
 * Shows the shared grid tooltip for the hovered/focused result card.
 *
 * @param {MouseEvent|FocusEvent} event
 */
export function handleItemsListPointerOver(event) {
  if (popupState.virtualList.viewMode !== "grid") {
    return;
  }

  const currentCard = getEventCard(event.target);
  const previousCard = getEventCard(event.relatedTarget);
  if (!(currentCard instanceof HTMLElement) || currentCard === previousCard) {
    return;
  }

  showSharedGridTooltipForCard(currentCard);
}

/**
 * Hides the shared grid tooltip when the pointer leaves the active card.
 *
 * @param {MouseEvent|FocusEvent} event
 */
export function handleItemsListPointerOut(event) {
  if (popupState.virtualList.viewMode !== "grid") {
    return;
  }

  const currentCard = getEventCard(event.target);
  if (!(currentCard instanceof HTMLElement)) {
    return;
  }

  const relatedElement = getEventElement(event.relatedTarget);
  if (relatedElement?.closest("#shared-grid-tooltip")) {
    return;
  }

  const nextCard = getEventCard(event.relatedTarget);
  if (nextCard instanceof HTMLElement) {
    return;
  }

  scheduleHideSharedGridTooltip();
}

export function handleItemsListFocusIn(event) {
  if (popupState.virtualList.viewMode !== "grid") {
    return;
  }

  const currentCard = getEventCard(event.target);
  if (!(currentCard instanceof HTMLElement)) {
    return;
  }

  showSharedGridTooltipForCard(currentCard);
}

export function handleItemsListFocusOut(event) {
  if (popupState.virtualList.viewMode !== "grid") {
    return;
  }

  const relatedElement = getEventElement(event.relatedTarget);
  if (relatedElement?.closest("#shared-grid-tooltip")) {
    return;
  }

  const nextCard = getEventCard(event.relatedTarget);
  if (nextCard instanceof HTMLElement) {
    return;
  }

  scheduleHideSharedGridTooltip();
}

export function handleSharedGridTooltipPointerEnter() {
  clearSharedGridTooltipHideTimer();
}

export function handleSharedGridTooltipPointerLeave(event) {
  const relatedElement = getEventElement(event.relatedTarget);
  if (relatedElement?.closest(".item-card[data-item-key]")) {
    return;
  }

  scheduleHideSharedGridTooltip();
}

/**
 * Hides and destroys the shared grid tooltip surface.
 *
 * @param {{immediate?: boolean}} [options]
 */
export function hideSharedGridTooltip(options = {}) {
  if (!(dom.sharedGridTooltip instanceof HTMLElement)) {
    return;
  }

  const immediate = options.immediate === true;
  if (!immediate) {
    scheduleHideSharedGridTooltip();
    return;
  }

  clearSharedGridTooltipHideTimer();
  popupState.virtualList.tooltipItemKey = "";
  dom.sharedGridTooltip.classList.add("hidden");
  dom.sharedGridTooltip.setAttribute("aria-hidden", "true");
  dom.sharedGridTooltip.style.removeProperty("width");
  dom.sharedGridTooltip.style.removeProperty("left");
  dom.sharedGridTooltip.style.removeProperty("right");
  dom.sharedGridTooltip.style.removeProperty("top");
  delete dom.sharedGridTooltip.dataset.side;
  delete dom.sharedGridTooltip.dataset.itemKey;
  dom.sharedGridTooltip.replaceChildren();
  if (dom.pickerScrollRegion instanceof HTMLElement) {
    dom.pickerScrollRegion.append(dom.sharedGridTooltip);
  }
}

function prepareVirtualDataset(
  items,
  selectedKeys,
  titleOverrides,
  disableInputs,
  phase,
  viewMode,
  creatorTabsSignature,
) {
  const cache = popupState.virtualList;
  const filteredItems = filterItemsForCreatorResultsTab(
    items,
    popupState.activeCreatorResultsTab,
  );
  const queriedItems = popupState.browseState.query.trim()
    ? filteredItems.filter((item) =>
        matchesSmartSearch(item, titleOverrides, popupState.browseState.query),
      )
    : filteredItems;
  const sortedItems = getSortedItems(queriedItems, popupState.browseState.sort);
  const selectedSet = new Set(selectedKeys);
  let visibleSelectedCount = 0;

  for (const item of sortedItems) {
    if (selectedSet.has(getItemKey(item))) {
      visibleSelectedCount += 1;
    }
  }

  cache.disableInputs = disableInputs;
  cache.phase = phase;
  cache.sort = popupState.browseState.sort;
  cache.query = popupState.browseState.query;
  cache.activeCreatorResultsTab = popupState.activeCreatorResultsTab;
  cache.viewMode = viewMode;
  cache.creatorTabsSignature = creatorTabsSignature;
  cache.filteredItems = sortedItems;
  cache.visibleCount = sortedItems.length;
  cache.visibleSelectedCount = visibleSelectedCount;
}

function computeVisibleWindow(viewMode, itemCount) {
  if (!(dom.pickerScrollRegion instanceof HTMLElement)) {
    return null;
  }

  const viewportHeight = Math.max(dom.pickerScrollRegion.clientHeight, 1);
  const viewportWidth = Math.max(dom.pickerScrollRegion.clientWidth, 1);
  const scrollTop = Math.max(0, dom.pickerScrollRegion.scrollTop);

  if (viewMode === "grid") {
    const columns = Math.max(1, Math.min(itemCount, Math.floor(viewportWidth / GRID_TARGET_CARD_WIDTH) || 1));
    const cardWidth = Math.max(1, Math.floor(viewportWidth / columns));
    const rowHeight = Math.max(1, Math.ceil((cardWidth * 16) / 9));
    const totalRows = Math.max(1, Math.ceil(itemCount / columns));
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - GRID_OVERSCAN_ROWS);
    const endRow = Math.min(
      totalRows,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + GRID_OVERSCAN_ROWS,
    );

    return {
      startIndex: startRow * columns,
      endIndex: Math.min(itemCount, endRow * columns),
      paddingTop: startRow * rowHeight,
      paddingBottom: Math.max(0, (totalRows - endRow) * rowHeight),
      scrollTop,
      viewportWidth,
      viewportHeight,
      columns,
      cardWidth,
      rowHeight,
    };
  }

  const rowHeight = Math.max(1, popupState.virtualList.listRowHeight || DEFAULT_LIST_ROW_HEIGHT);
  const rowStride = rowHeight + LIST_VERTICAL_GAP;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowStride) - LIST_OVERSCAN_ITEMS);
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + viewportHeight) / rowStride) + LIST_OVERSCAN_ITEMS,
  );

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowStride,
    paddingBottom: Math.max(0, (itemCount - endIndex) * rowStride),
    scrollTop,
    viewportWidth,
    viewportHeight,
    columns: 1,
    cardWidth: viewportWidth,
    rowHeight,
  };
}

function scheduleListMeasurement() {
  if (popupState.virtualList.viewMode === "grid") {
    return;
  }

  if (popupState.virtualList.measureFrame) {
    window.cancelAnimationFrame(popupState.virtualList.measureFrame);
  }

  popupState.virtualList.measureFrame = window.requestAnimationFrame(() => {
    popupState.virtualList.measureFrame = 0;
    const firstCard = dom.itemsList?.querySelector(".item-card");
    if (!(firstCard instanceof HTMLElement)) {
      return;
    }

    const nextRowHeight = Math.max(
      DEFAULT_LIST_ROW_HEIGHT,
      Math.ceil(firstCard.getBoundingClientRect().height),
    );
    if (Math.abs(nextRowHeight - popupState.virtualList.listRowHeight) <= 2) {
      return;
    }

    popupState.virtualList.listRowHeight = nextRowHeight;
    renderVisibleItemsWindow(true);
  });
}

function disposeCurrentRenderedWindow() {
  if (!(dom.itemsList instanceof HTMLElement)) {
    return;
  }

  for (const media of dom.itemsList.querySelectorAll(".item-media")) {
    disposeMediaPreview(media);
  }
}

function resetRenderedWindow() {
  if (!(dom.itemsList instanceof HTMLElement)) {
    return;
  }

  dom.itemsList.replaceChildren();
  dom.itemsList.style.paddingTop = "0px";
  dom.itemsList.style.paddingBottom = "0px";
  dom.itemsList.style.removeProperty("--virtual-grid-card-width");
  popupState.virtualList.renderedItemsByKey = new Map();
  popupState.virtualList.rangeStart = 0;
  popupState.virtualList.rangeEnd = 0;
  popupState.virtualList.lastPaddingTop = 0;
  popupState.virtualList.lastPaddingBottom = 0;
  popupState.virtualList.lastWindowSignature = "";
}

function showSharedGridTooltipForCard(card) {
  if (!(card instanceof HTMLElement) || !(dom.sharedGridTooltip instanceof HTMLElement)) {
    return;
  }

  const itemKey = card.dataset.itemKey || "";
  const item = popupState.virtualList.renderedItemsByKey.get(itemKey);
  if (!item) {
    return;
  }

  clearSharedGridTooltipHideTimer();
  popupState.virtualList.tooltipItemKey = itemKey;
  const shouldReuseSurface =
    dom.sharedGridTooltip.parentElement === card &&
    dom.sharedGridTooltip.dataset.itemKey === itemKey &&
    !dom.sharedGridTooltip.classList.contains("hidden");

  if (!shouldReuseSurface) {
    const surface = createItemContentSurface(
      item,
      {
        key: itemKey,
        disableInputs: popupState.latestRenderState.disableInputs,
        titleOverrides: popupState.latestRenderState.titleOverrides,
      },
      "item-grid-tooltip-surface",
    );

    dom.sharedGridTooltip.replaceChildren(surface);
    card.append(dom.sharedGridTooltip);
    dom.sharedGridTooltip.dataset.itemKey = itemKey;
  }
  dom.sharedGridTooltip.classList.remove("hidden");
  dom.sharedGridTooltip.setAttribute("aria-hidden", "false");
  positionSharedGridTooltip(card);
}

function positionSharedGridTooltip(card) {
  if (
    !(card instanceof HTMLElement) ||
    !(dom.sharedGridTooltip instanceof HTMLElement) ||
    !(dom.pickerScrollRegion instanceof HTMLElement)
  ) {
    return;
  }

  const regionRect = dom.pickerScrollRegion.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const availableWidth = Math.max(
    Math.min(
      GRID_TOOLTIP_MAX_WIDTH,
      Math.max(
        GRID_TOOLTIP_MIN_WIDTH,
        Math.floor(dom.pickerScrollRegion.clientWidth * 0.34),
      ),
    ),
  );
  const availableLeft = Math.max(0, cardRect.left - regionRect.left);
  const availableRight = Math.max(0, regionRect.right - cardRect.right);
  const preferredRight = availableRight >= GRID_TOOLTIP_MIN_WIDTH || availableRight >= availableLeft;

  dom.sharedGridTooltip.style.width = `${availableWidth}px`;
  dom.sharedGridTooltip.style.top = "0px";
  dom.sharedGridTooltip.dataset.side = preferredRight ? "right" : "left";
  if (preferredRight) {
    dom.sharedGridTooltip.style.left = `calc(100% + ${GRID_TOOLTIP_MARGIN}px)`;
    dom.sharedGridTooltip.style.right = "auto";
  } else {
    dom.sharedGridTooltip.style.right = `calc(100% + ${GRID_TOOLTIP_MARGIN}px)`;
    dom.sharedGridTooltip.style.left = "auto";
  }
}

function scheduleHideSharedGridTooltip() {
  clearSharedGridTooltipHideTimer();
  popupState.virtualList.tooltipHideTimer = window.setTimeout(() => {
    popupState.virtualList.tooltipHideTimer = 0;
    hideSharedGridTooltip({ immediate: true });
  }, 90);
}

function clearSharedGridTooltipHideTimer() {
  if (!popupState.virtualList.tooltipHideTimer) {
    return;
  }

  window.clearTimeout(popupState.virtualList.tooltipHideTimer);
  popupState.virtualList.tooltipHideTimer = 0;
}

function getEventElement(target) {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node && target.parentElement instanceof Element) {
    return target.parentElement;
  }

  return null;
}

function getEventCard(target) {
  const element = getEventElement(target);
  return element?.closest(".item-card[data-item-key]") || null;
}

/**
 * Renders the creator-only result tabs when the working set contains multiple
 * creator subtypes like authored posts and cast-in appearances.
 *
 * @param {{key:string,label:string,count:number}[]} tabs
 */
function syncCreatorResultsTabs(tabs) {
  if (!(dom.creatorResultsTabs instanceof HTMLElement)) {
    return;
  }

  if (!Array.isArray(tabs) || tabs.length === 0) {
    popupState.activeCreatorResultsTab = "all";
    dom.creatorResultsTabs.replaceChildren();
    dom.creatorResultsTabs.classList.add("hidden");
    return;
  }

  const validKeys = new Set(tabs.map((tab) => tab.key));
  if (!validKeys.has(popupState.activeCreatorResultsTab)) {
    popupState.activeCreatorResultsTab = tabs[0].key;
  }

  const fragment = document.createDocumentFragment();
  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "creator-results-tab";
    button.dataset.creatorResultsTab = tab.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", tab.key === popupState.activeCreatorResultsTab ? "true" : "false");
    button.classList.toggle("is-active", tab.key === popupState.activeCreatorResultsTab);

    const label = document.createElement("span");
    label.className = "creator-results-tab-label";
    label.textContent = tab.label;

    const count = document.createElement("span");
    count.className = "creator-results-tab-count";
    count.textContent = formatWholeNumber(tab.count);

    button.append(label, count);
    fragment.append(button);
  }

  dom.creatorResultsTabs.replaceChildren(fragment);
  dom.creatorResultsTabs.classList.remove("hidden");
}

function syncResultsViewMode(viewMode, hasItems) {
  if (!(dom.itemsList instanceof HTMLElement)) {
    return;
  }

  dom.itemsList.classList.toggle("is-grid-view", viewMode === "grid");
  dom.itemsList.classList.toggle("is-list-view", viewMode !== "grid");

  if (!(dom.resultsViewToggle instanceof HTMLElement)) {
    return;
  }

  dom.resultsViewToggle.classList.toggle("hidden", !hasItems);

  if (dom.resultsViewListButton instanceof HTMLButtonElement) {
    const isActive = viewMode !== "grid";
    dom.resultsViewListButton.classList.toggle("is-active", isActive);
    dom.resultsViewListButton.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  if (dom.resultsViewGridButton instanceof HTMLButtonElement) {
    const isActive = viewMode === "grid";
    dom.resultsViewGridButton.classList.toggle("is-active", isActive);
    dom.resultsViewGridButton.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}
