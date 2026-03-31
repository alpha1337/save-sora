import { dom } from "../../dom.js";

/**
 * Renders the empty pre-fetch state.
 *
 * @param {string} phase
 */
export function renderEmptyLibrary(phase) {
  dom.itemsList?.classList.add("hidden");

  if (phase === "fetching") {
    dom.emptyState?.classList.add("hidden");
    return;
  }

  dom.emptyState?.classList.remove("hidden");
  if (dom.emptyStateImage instanceof HTMLElement) {
    dom.emptyStateImage.classList.remove("hidden");
  }
  if (dom.emptyStateText instanceof HTMLElement) {
    dom.emptyStateText.classList.add("hidden");
    dom.emptyStateText.textContent = "";
  }
}

/**
 * Renders the empty state shown when the local search query returns no matches.
 *
 * @param {string} query
 */
export function renderEmptySearchResult(query) {
  dom.itemsList?.classList.add("hidden");
  dom.emptyState?.classList.remove("hidden");

  if (dom.emptyStateImage instanceof HTMLElement) {
    dom.emptyStateImage.classList.add("hidden");
  }
  if (dom.emptyStateText instanceof HTMLElement) {
    dom.emptyStateText.classList.remove("hidden");
    dom.emptyStateText.textContent = query.trim() ? `No videos match “${query.trim()}”.` : "Content Violation?";
  }
}

/**
 * Restores the standard populated-list presentation.
 */
export function showPopulatedListState() {
  dom.itemsList?.classList.remove("hidden");
  dom.emptyState?.classList.add("hidden");

  if (dom.emptyStateImage instanceof HTMLElement) {
    dom.emptyStateImage.classList.remove("hidden");
  }
  if (dom.emptyStateText instanceof HTMLElement) {
    dom.emptyStateText.classList.add("hidden");
    dom.emptyStateText.textContent = "";
  }
}
