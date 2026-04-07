import { POLL_INTERVAL_MS } from "../config.js";
import { dom } from "../dom.js";
import { fetchRuntimeState } from "../runtime.js";
import { popupState } from "../state.js";
import { setControlsDisabled, showNotice } from "../ui/layout.js";
import { renderState } from "../ui/render.js";

/**
 * Background-status polling helpers.
 */

const ACTIVE_RUNTIME_PHASES = new Set(["fetching", "downloading"]);
const ACTIVE_UPDATE_PHASES = new Set(["checking", "downloading", "applying", "reloading"]);

/**
 * Fetches the latest background state and re-renders the popup.
 *
 * @returns {Promise<void>}
 */
export async function refreshStatus() {
  try {
    const state = await fetchRuntimeState({
      sortKey: popupState.browseState.sort,
      query: popupState.browseState.query,
      creatorTab: popupState.activeCreatorResultsTab,
    });
    renderState(state);
    syncPollingForState(state);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    setControlsDisabled(false);
  }
}

/**
 * Starts polling the background worker for progress updates.
 */
export function startPolling() {
  if (document.hidden || popupState.pollTimer !== null) {
    return;
  }

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

/**
 * Aligns the background polling timer with whether the runtime is still changing.
 *
 * @param {object|null} state
 */
export function syncPollingForState(state) {
  if (document.hidden) {
    stopPolling();
    return;
  }

  if (shouldPollForState(state)) {
    startPolling();
    return;
  }

  stopPolling();
}

function shouldPollForState(state) {
  const phase = state && typeof state.phase === "string" ? state.phase : "idle";
  if (ACTIVE_RUNTIME_PHASES.has(phase)) {
    return true;
  }

  const updatePhase =
    state &&
    state.updateStatus &&
    typeof state.updateStatus === "object" &&
    typeof state.updateStatus.phase === "string"
      ? state.updateStatus.phase
      : "idle";

  return ACTIVE_UPDATE_PHASES.has(updatePhase);
}
