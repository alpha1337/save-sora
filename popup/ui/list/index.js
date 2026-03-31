import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { getSortedItems } from "../../utils/search.js";
import { applySelectionUi, updateSelectionSummary } from "../selection.js";
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

  const sortedItems = getSortedItems(items, popupState.browseState.sort);
  const renderSignature = buildRenderSignature(
    sortedItems,
    selectedKeys,
    titleOverrides,
    disableInputs,
    phase,
  );
  if (renderSignature === popupState.lastRenderedSignature) {
    return;
  }

  popupState.lastRenderedSignature = renderSignature;
  dom.itemsList.replaceChildren();

  if (!items.length) {
    renderEmptyLibrary(phase);
    updateSelectionSummary({
      totalCount: 0,
      selectedCount: 0,
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

  applySelectionUi(items.length, selectedKeys.length, visibleCount, visibleSelectedCount, phase);
}
