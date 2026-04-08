import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { formatWholeNumber } from "../../utils/format.js";
import { getSortedItems } from "../../utils/search.js";
import { applySelectionUi, updateSelectionSummary } from "../selection.js";
import {
  filterItemsForCreatorResultsTab,
  getCreatorResultsTabs,
} from "../../utils/items.js";
import { createItemCard } from "./item-card.js";
import {
  renderEmptyLibrary,
  renderEmptySearchResult,
  showPopulatedListState,
} from "./list-empty-state.js";
import { buildRenderSignature } from "./list-signature.js";

/**
 * Renders the current list of Sora items.
 *
 * The renderer is intentionally small: it decides which high-level state to
 * show, then delegates card creation and empty states to dedicated modules.
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

  const filteredItems = filterItemsForCreatorResultsTab(
    items,
    popupState.activeCreatorResultsTab,
  );
  const effectiveTotalCount = items.length;
  const selectedCountTotal = Number(popupState.latestRenderState.selectedCountTotal);
  const effectiveSelectedCount =
    Number.isFinite(selectedCountTotal) && selectedCountTotal >= 0
      ? selectedCountTotal
      : selectedKeys.length;
  const sortedItems = getSortedItems(filteredItems, popupState.browseState.sort);
  const renderSignature = buildRenderSignature(
    sortedItems,
    selectedKeys,
    titleOverrides,
    disableInputs,
    phase,
    creatorResultTabs.map((tab) => `${tab.key}:${tab.count}`),
  );
  if (renderSignature === popupState.lastRenderedSignature) {
    return;
  }

  popupState.lastRenderedSignature = renderSignature;
  dom.itemsList.replaceChildren();

  if (!items.length) {
    renderEmptyLibrary(phase);
    updateSelectionSummary({
      totalCount: effectiveTotalCount,
      selectedCount: effectiveSelectedCount,
      phase,
    });
    return;
  }

  showPopulatedListState();

  const selectedSet = new Set(selectedKeys);
  const fragment = document.createDocumentFragment();
  let visibleCount = 0;
  let visibleSelectedCount = 0;

  for (const item of sortedItems) {
    const cardResult = createItemCard(item, {
      selectedSet,
      titleOverrides,
      disableInputs,
      query: popupState.browseState.query,
    });
    fragment.append(cardResult.card);

    if (!cardResult.matchesQuery) {
      continue;
    }

    visibleCount += 1;
    if (cardResult.isSelected) {
      visibleSelectedCount += 1;
    }
  }

  dom.itemsList.append(fragment);

  if (visibleCount === 0) {
    renderEmptySearchResult(popupState.browseState.query);
  } else {
    showPopulatedListState();
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
