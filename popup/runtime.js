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

function normalizeShellViewMode(viewMode) {
  return viewMode === "fullscreen" ? "fullscreen" : "windowed";
}

function buildRuntimeShellUrl(options = {}) {
  const url = new URL(chrome.runtime.getURL("popup.html"));
  const normalizedViewMode = normalizeShellViewMode(options.viewMode);
  url.searchParams.set("view", normalizedViewMode);

  if (typeof options.updatedVersion === "string" && options.updatedVersion) {
    url.searchParams.set("updated", options.updatedVersion);
  }

  if (typeof options.tab === "string" && options.tab) {
    url.searchParams.set("tab", options.tab);
  }

  return url.toString();
}

/**
 * Loads the latest persisted popup status from the background worker.
 *
 * @returns {Promise<object>}
 */
export async function fetchRuntimeState(options = {}) {
  const response = await sendPopupMessage(
    {
      type: "GET_STATUS",
      sortKey: options.sortKey,
      query: options.query,
      creatorTab: options.creatorTab,
    },
    "Could not load the current extension status.",
  );
  return response.state;
}

export async function fetchUpdateStatus() {
  const response = await sendPopupMessage(
    { type: "GET_UPDATE_STATUS" },
    "Could not load the current updater status.",
  );
  return response.updateStatus;
}

export async function requestUpdateCheck(options = {}) {
  const response = await sendPopupMessage(
    {
      type: "CHECK_FOR_UPDATES",
      trigger: typeof options.trigger === "string" ? options.trigger : "popup",
      interactive: options.interactive !== false,
      applyIfAvailable: options.applyIfAvailable !== false,
    },
    "Could not check GitHub for updates.",
  );
  return response.updateStatus;
}

export async function linkRuntimeInstallFolder(handle) {
  const response = await sendPopupMessage(
    {
      type: "LINK_INSTALL_FOLDER",
      handle,
    },
    "Could not link the unpacked extension folder.",
  );
  return response.updateStatus;
}

export async function installPendingRuntimeUpdate(options = {}) {
  const response = await sendPopupMessage(
    {
      type: "INSTALL_PENDING_UPDATE",
      forceApply: options.forceApply === true,
    },
    "Could not install the pending update.",
  );
  return response.updateStatus;
}

export async function openRuntimeShell(options = {}) {
  const normalizedViewMode = normalizeShellViewMode(options.viewMode);
  const url = buildRuntimeShellUrl({
    viewMode: normalizedViewMode,
    updatedVersion: options.updatedVersion,
    tab: options.tab,
  });

  if (normalizedViewMode === "fullscreen") {
    return chrome.tabs.create({
      url,
      active: true,
    });
  }

  try {
    return await chrome.windows.create({
      url,
      type: "popup",
      focused: true,
      width: 760,
      height: 860,
    });
  } catch (_error) {
    return chrome.tabs.create({
      url,
      active: true,
    });
  }
}

/**
 * Loads the available proxy-character accounts for the signed-in user.
 *
 * @param {boolean} force
 * @returns {Promise<object>}
 */
export async function requestCharacterAccounts(force = false) {
  return sendPopupMessage(
    {
      type: "LOAD_CHARACTER_ACCOUNTS",
      force,
    },
    "Could not load the available character accounts.",
  );
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
 * Requests that the active fetch be canceled.
 *
 * @returns {Promise<object>}
 */
export async function requestAbortScan() {
  return sendPopupMessage(
    { type: "ABORT_SCAN" },
    "Could not cancel the active fetch.",
  );
}

/**
 * Requests that the active fetch be paused.
 *
 * @returns {Promise<object>}
 */
export async function requestPauseScan() {
  return sendPopupMessage(
    { type: "PAUSE_SCAN" },
    "Could not pause the active fetch.",
  );
}

/**
 * Requests that the last paused fetch be resumed.
 *
 * @returns {Promise<object>}
 */
export async function requestResumeScan() {
  return sendPopupMessage(
    { type: "RESUME_SCAN" },
    "Could not resume the paused fetch.",
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
 * Clears every value stored in the extension's local storage.
 *
 * @returns {Promise<object>}
 */
export async function requestClearLocalStorage() {
  return sendPopupMessage(
    { type: "CLEAR_LOCAL_STORAGE" },
    "Could not clear the extension's local storage.",
  );
}

/**
 * Clears resumable fetch backups stored in IndexedDB without touching updater linkage.
 *
 * @returns {Promise<object>}
 */
export async function requestClearVolatileBackups() {
  return sendPopupMessage(
    { type: "CLEAR_VOLATILE_BACKUPS" },
    "Could not clear the resumable fetch backup cache.",
  );
}

/**
 * Persists the current selection.
 *
 * @param {string[]} selectedKeys
 * @returns {Promise<object>}
 */
export async function saveSelection(selectedKeys, visibleKeys = []) {
  return sendPopupMessage(
    {
      type: "SET_SELECTION",
      selectedKeys,
      visibleKeys,
    },
    "Could not save the current selection.",
  );
}

/**
 * Persists the selected proxy-character accounts used by the Cameos source.
 *
 * @param {string[]} selectedCharacterAccountIds
 * @returns {Promise<object>}
 */
export async function saveCharacterSelection(selectedCharacterAccountIds) {
  return sendPopupMessage(
    {
      type: "SET_CHARACTER_SELECTION",
      selectedCharacterAccountIds,
    },
    "Could not save the character account selection.",
  );
}

/**
 * Persists the selected saved creators used by the Creators source.
 *
 * @param {string[]} selectedCreatorProfileIds
 * @returns {Promise<object>}
 */
export async function saveCreatorSelection(selectedCreatorProfileIds) {
  return sendPopupMessage(
    {
      type: "SET_CREATOR_SELECTION",
      selectedCreatorProfileIds,
    },
    "Could not save the creator selection.",
  );
}

/**
 * Adds one or more saved creators from pasted Sora usernames or profile URLs.
 *
 * @param {string[]} profileUrls
 * @returns {Promise<object>}
 */
export async function addCreatorProfiles(profileUrls) {
  return sendPopupMessage(
    {
      type: "ADD_CREATOR_PROFILES",
      profileUrls,
    },
    "Could not add the creator profiles.",
  );
}

/**
 * Removes one saved creator from the local list.
 *
 * @param {string} creatorProfileId
 * @returns {Promise<object>}
 */
export async function removeCreatorProfile(creatorProfileId) {
  return sendPopupMessage(
    {
      type: "REMOVE_CREATOR_PROFILE",
      creatorProfileId,
    },
    "Could not remove the creator profile.",
  );
}

/**
 * Persists fetch preferences for a saved creator profile.
 *
 * @param {string} creatorProfileId
 * @param {{includeOfficialPosts?: boolean, includeCommunityPosts?: boolean}} preferences
 * @returns {Promise<object>}
 */
export async function saveCreatorProfilePreferences(creatorProfileId, preferences) {
  return sendPopupMessage(
    {
      type: "SET_CREATOR_PROFILE_PREFERENCES",
      creatorProfileId,
      preferences,
    },
    "Could not save the creator fetch preferences.",
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
