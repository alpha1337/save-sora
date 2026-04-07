import { POLL_INTERVAL_MS } from "../config.js";
import { dom } from "../dom.js";
import { fetchRuntimeState } from "../runtime.js";
import { popupState } from "../state.js";
import { setControlsDisabled, showNotice } from "../ui/layout.js";
import { renderState } from "../ui/render.js";

/**
 * Background-status polling helpers.
 */

/**
 * Fetches the latest background state and re-renders the popup.
 *
 * @returns {Promise<void>}
 */
export async function refreshStatus() {
  try {
    const state = await fetchRuntimeState({
      pageSize: popupState.resultsPageSize,
      sortKey: popupState.browseState.sort,
      query: popupState.browseState.query,
      creatorTab: popupState.activeCreatorResultsTab,
    });
    renderState(state);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    setControlsDisabled(false);
  }
}

/**
 * Starts polling the background worker for progress updates.
 */
export function startPolling() {
  stopPolling();
  popupState.pollTimer = window.setInterval(() => {
    void refreshStatus();
  }, POLL_INTERVAL_MS);
}

/**
 * Stops polling the background worker.
 */
export function stopPolling() {
  if (popupState.pollTimer !== null) {
    window.clearInterval(popupState.pollTimer);
    popupState.pollTimer = null;
  }
}
