/**
 * Thin wrappers around `chrome.runtime.sendMessage(...)`.
 *
 * These helpers keep message names in one place and give the UI modules a
 * friendlier, promise-based API.
 */

/**
 * Sends a runtime message and throws a readable error when the background worker
 * rejects the request.
 *
 * @param {object} message
 * @param {string} fallbackMessage
 * @returns {Promise<object>}
 */
async function sendPopupMessage(message, fallbackMessage) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error((response && response.error) || fallbackMessage);
  }

  return response;
}

/**
 * Loads the latest persisted popup status from the background worker.
 *
 * @returns {Promise<object>}
 */
export async function fetchRuntimeState() {
  const response = await sendPopupMessage(
    { type: "GET_STATUS" },
    "Could not load the current extension status.",
  );
  return response.state;
}

/**
 * Starts a new scan of the requested Sora sources.
 *
 * @param {string[]} sources
 * @param {string} searchQuery
 * @returns {Promise<object>}
 */
export async function requestScan(sources, searchQuery) {
  return sendPopupMessage(
    {
      type: "START_SCAN",
      sources,
      searchQuery,
    },
    "Could not fetch the video list.",
  );
}

/**
 * Resets the current working set in the background worker.
 *
 * @returns {Promise<object>}
 */
export async function requestResetState() {
  return sendPopupMessage(
    { type: "RESET_STATE" },
    "Could not reset the current video list.",
  );
}

/**
 * Persists the current selection.
 *
 * @param {string[]} selectedKeys
 * @returns {Promise<object>}
 */
export async function saveSelection(selectedKeys) {
  return sendPopupMessage(
    {
      type: "SET_SELECTION",
      selectedKeys,
    },
    "Could not save the current selection.",
  );
}

/**
 * Persists a custom title override for a single item.
 *
 * @param {string} itemKey
 * @param {string} title
 * @returns {Promise<object>}
 */
export async function saveRuntimeTitleOverride(itemKey, title) {
  return sendPopupMessage(
    {
      type: "SET_TITLE_OVERRIDE",
      itemKey,
      title,
    },
    "Could not save the custom title.",
  );
}

/**
 * Toggles whether an item is removed from the working set.
 *
 * @param {string} itemKey
 * @param {boolean} removed
 * @returns {Promise<object>}
 */
export async function saveRemovedState(itemKey, removed) {
  return sendPopupMessage(
    {
      type: "REMOVE_ITEM",
      itemKey,
      removed,
    },
    "Could not remove the video.",
  );
}

/**
 * Toggles whether an item is marked downloaded.
 *
 * @param {string} itemKey
 * @param {boolean} downloaded
 * @returns {Promise<object>}
 */
export async function saveDownloadedState(itemKey, downloaded) {
  return sendPopupMessage(
    {
      type: "SET_ITEM_DOWNLOADED",
      itemKey,
      downloaded,
    },
    "Could not update the downloaded state.",
  );
}

/**
 * Persists popup settings in the background worker.
 *
 * @param {object} settings
 * @returns {Promise<object>}
 */
export async function saveRuntimeSettings(settings) {
  return sendPopupMessage(
    {
      type: "SET_SETTINGS",
      settings,
    },
    "Could not save the settings.",
  );
}

/**
 * Starts downloading the current selection.
 *
 * @returns {Promise<object>}
 */
export async function requestDownloadSelected() {
  return sendPopupMessage(
    { type: "DOWNLOAD_SELECTED" },
    "Could not start the selected downloads.",
  );
}

/**
 * Requests that the active or paused download queue be aborted.
 *
 * @returns {Promise<object>}
 */
export async function requestAbortDownloads() {
  return sendPopupMessage(
    { type: "ABORT_DOWNLOADS" },
    "Could not cancel the active download.",
  );
}
