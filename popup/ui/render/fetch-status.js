import {
  FETCH_STATUS_MESSAGES,
  FETCH_STATUS_ROTATION_MS,
} from "../../config.js";
import { dom } from "../../dom.js";
import { popupState } from "../../state.js";

/**
 * Starts rotating the fetch status flavor text.
 */
export function startFetchStatusRotation() {
  if (!popupState.activeFetchStatusMessage) {
    popupState.activeFetchStatusMessage = getRandomFetchStatusMessage();
    applyFetchStatusMessage();
  }

  if (popupState.fetchStatusTimer !== null) {
    return;
  }

  popupState.fetchStatusTimer = window.setInterval(() => {
    popupState.activeFetchStatusMessage = getRandomFetchStatusMessage(
      popupState.activeFetchStatusMessage,
    );
    applyFetchStatusMessage();
  }, FETCH_STATUS_ROTATION_MS);
}

/**
 * Stops rotating the fetch status flavor text.
 */
export function stopFetchStatusRotation() {
  if (popupState.fetchStatusTimer !== null) {
    window.clearInterval(popupState.fetchStatusTimer);
    popupState.fetchStatusTimer = null;
  }

  popupState.activeFetchStatusMessage = "";
}

/**
 * Applies the active fetch status message to the summary line.
 */
function applyFetchStatusMessage() {
  if (popupState.latestSummaryContext.phase !== "fetching" || !(dom.selectionSummary instanceof HTMLElement)) {
    return;
  }

  const flavor = popupState.activeFetchStatusMessage || "Finding videos...";
  const fetchedCount = Math.max(0, Number(popupState.latestSummaryContext.fetchedCount) || 0);
  dom.selectionSummary.textContent =
    fetchedCount > 0
      ? `${flavor} • ${fetchedCount.toLocaleString()} found so far.`
      : flavor;
}

/**
 * Returns a random status message that differs from the current one when possible.
 *
 * @param {string} [previous=""]
 * @returns {string}
 */
function getRandomFetchStatusMessage(previous = "") {
  if (!FETCH_STATUS_MESSAGES.length) {
    return "Finding videos...";
  }

  if (FETCH_STATUS_MESSAGES.length === 1) {
    return FETCH_STATUS_MESSAGES[0];
  }

  let next = previous;
  while (next === previous) {
    next = FETCH_STATUS_MESSAGES[Math.floor(Math.random() * FETCH_STATUS_MESSAGES.length)];
  }

  return next;
}
