// Save Sora background service worker.
// This is the privileged side of the extension: it owns persistent state, opens the
// hidden Sora tab used for collection, injects packaged code into that tab, and manages
// the download queue through chrome.downloads.
const STATE_KEY = "soraBulkDownloaderState";
const PROFILE_LIMIT = 100;
const DRAFT_BATCH_LIMIT = 100;
const LIKES_BATCH_LIMIT = 100;
const CHARACTERS_BATCH_LIMIT = 100;
const CHARACTER_ACCOUNT_LIMIT = 100;
const DOWNLOAD_PROGRESS_PERSIST_INTERVAL = 25;
const AVAILABLE_SOURCE_VALUES = ["profile", "drafts", "likes", "characters", "characterAccounts"];
const DEFAULT_SOURCE_VALUES = ["profile", "drafts"];
const SOURCE_ROUTES = {
  profile: "https://sora.chatgpt.com/profile",
  drafts: "https://sora.chatgpt.com/drafts",
  likes: "https://sora.chatgpt.com/profile",
  characters: "https://sora.chatgpt.com/profile",
  characterAccounts: "https://sora.chatgpt.com/profile",
  characterDrafts: "https://sora.chatgpt.com/profile",
  characterProfiles: "https://sora.chatgpt.com/profile",
  characterAccountPosts: "https://sora.chatgpt.com/profile",
  characterAccountDrafts: "https://sora.chatgpt.com/profile",
};

let currentState = createDefaultState();
let hiddenTabId = null;
let activeRun = null;
let activeDownloadId = null;
let requestedControlAction = null;

void restoreState();

chrome.runtime.onInstalled.addListener(() => {
  void persistState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Unknown message." });
    return false;
  }

  if (message.type === "GET_STATUS") {
    sendResponse({ ok: true, state: currentState });
    return false;
  }

  if (message.type === "START_SCAN") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    void startScan(message.sources, message.searchQuery).catch((error) => {
      console.error("Sora Bulk Downloader scan failed.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "RESET_STATE") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    void resetExtensionState()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to reset the Sora downloader state.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
    });
    return true;
  }

  if (message.type === "CLEAR_LOCAL_STORAGE") {
    if (activeRun) {
      sendResponse({ ok: false, error: "Wait until the current fetch or download run finishes." });
      return false;
    }

    void clearLocalStorageState()
      .then(() => {
        sendResponse({ ok: true, state: currentState });
      })
      .catch((error) => {
        console.error("Failed to clear the Sora downloader local storage.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_SELECTION") {
    if (!Array.isArray(message.selectedKeys)) {
      sendResponse({ ok: false, error: "The selection payload must be an array." });
      return false;
    }

    void setSelectedKeys(message.selectedKeys).catch((error) => {
      console.error("Failed to update the Sora selection.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "SET_TITLE_OVERRIDE") {
    if (typeof message.itemKey !== "string") {
      sendResponse({ ok: false, error: "A valid item key is required." });
      return false;
    }

    if (typeof message.title !== "string") {
      sendResponse({ ok: false, error: "The title must be a string." });
      return false;
    }

    void setTitleOverride(message.itemKey, message.title).catch((error) => {
      console.error("Failed to update the Sora title override.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "REMOVE_ITEM") {
    if (typeof message.itemKey !== "string") {
      sendResponse({ ok: false, error: "A valid item key is required." });
      return false;
    }

    void setItemRemovedState(message.itemKey, message.removed !== false)
      .then(() => {
        sendResponse({ ok: true, state: currentState });
      })
      .catch((error) => {
        console.error("Failed to remove the item from the Sora master set.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_ITEM_DOWNLOADED") {
    if (typeof message.itemKey !== "string") {
      sendResponse({ ok: false, error: "A valid item key is required." });
      return false;
    }

    void setItemDownloadedState(message.itemKey, message.downloaded !== false)
      .then(() => {
        sendResponse({ ok: true, state: currentState });
      })
      .catch((error) => {
        console.error("Failed to update the downloaded state for the item.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_SETTINGS") {
    void updateSettings(message.settings)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to update the Sora downloader settings.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "LOAD_CHARACTER_ACCOUNTS") {
    if (activeRun) {
      sendResponse({ ok: false, error: "Wait until the current fetch or download run finishes." });
      return false;
    }

    void ensureCharacterAccountsLoaded(Boolean(message.force))
      .then((characterAccounts) => {
        sendResponse({
          ok: true,
          characterAccounts,
          selectedCharacterAccountIds: [...currentState.selectedCharacterAccountIds],
          state: currentState,
        });
      })
      .catch((error) => {
        console.error("Failed to load the Sora character accounts.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_CHARACTER_SELECTION") {
    if (!Array.isArray(message.selectedCharacterAccountIds)) {
      sendResponse({ ok: false, error: "The character selection payload must be an array." });
      return false;
    }

    void setSelectedCharacterAccountIds(message.selectedCharacterAccountIds)
      .then(() => {
        sendResponse({ ok: true, state: currentState });
      })
      .catch((error) => {
        console.error("Failed to update the character selection.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "DOWNLOAD_SELECTED") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    if (!Array.isArray(currentState.items) || currentState.items.length === 0) {
      sendResponse({ ok: false, error: "Fetch videos first so you can choose what to download." });
      return false;
    }

    if (!Array.isArray(currentState.selectedKeys) || currentState.selectedKeys.length === 0) {
      sendResponse({ ok: false, error: "Select at least one video before downloading." });
      return false;
    }

    void beginSelectedDownload()
      .then(() => {
        sendResponse({ ok: true, state: currentState });
      })
      .catch((error) => {
        console.error("Sora Bulk Downloader selected download failed.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "PAUSE_DOWNLOADS") {
    if (currentState.phase !== "downloading") {
      sendResponse({ ok: false, error: "There is no active download to pause." });
      return false;
    }

    void requestRunControl("pause").catch((error) => {
      console.error("Failed to pause the download queue.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "RESUME_DOWNLOADS") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    if (currentState.phase !== "paused" || !Array.isArray(currentState.pendingItems) || currentState.pendingItems.length === 0) {
      sendResponse({ ok: false, error: "There is no paused download queue to resume." });
      return false;
    }

    void resumeDownloads().catch((error) => {
      console.error("Failed to resume the download queue.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "ABORT_DOWNLOADS") {
    if (currentState.phase !== "downloading" && currentState.phase !== "paused") {
      sendResponse({ ok: false, error: "There is no active or paused download queue to abort." });
      return false;
    }

    if (currentState.phase === "paused") {
      void abortPausedDownloads().catch((error) => {
        console.error("Failed to clear the paused download queue.", error);
      });
    } else {
      void requestRunControl("abort").catch((error) => {
        console.error("Failed to abort the download queue.", error);
      });
    }

    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "RETRY_FAILED") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    if (!Array.isArray(currentState.failedItems) || currentState.failedItems.length === 0) {
      sendResponse({ ok: false, error: "There are no failed downloads to retry." });
      return false;
    }

    void retryFailed().catch((error) => {
      console.error("Sora Bulk Downloader retry failed.", error);
    });
    sendResponse({ ok: true });
    return false;
  }

  sendResponse({ ok: false, error: `Unsupported message type: ${message.type}` });
  return false;
});

function createDefaultState(overrides = {}) {
  return {
    phase: "idle",
    message: "Fetch videos to build a download list.",
    fetchedCount: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    partialWarning: "",
    lastError: "",
    currentSource: null,
    profileIds: [],
    draftIds: [],
    likesIds: [],
    cameoIds: [],
    characterIds: [],
    characterAccounts: [],
    selectedCharacterAccountIds: [],
    items: [],
    selectedKeys: [],
    titleOverrides: {},
    pendingItems: [],
    runMode: null,
    runTotal: 0,
    failedItems: [],
    settings: {
      maxVideos: null,
      defaultSource: [...DEFAULT_SOURCE_VALUES],
      defaultSort: "newest",
      theme: "dark",
    },
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

async function restoreState() {
  // Restore local-only extension state so the popup can reopen without losing the current
  // queue, previous results, or user preferences.
  try {
    const stored = await chrome.storage.local.get(STATE_KEY);
    if (stored && stored[STATE_KEY]) {
      const savedState = stored[STATE_KEY];
      currentState = {
        ...createDefaultState(),
        ...savedState,
        settings: {
          ...createDefaultState().settings,
          ...(savedState.settings && typeof savedState.settings === "object"
            ? savedState.settings
            : {}),
        },
      };
      currentState.settings = {
        ...currentState.settings,
        maxVideos: getMaxVideosSetting(currentState.settings),
        defaultSource: normalizeDefaultSource(currentState.settings.defaultSource),
        defaultSort: normalizeDefaultSort(currentState.settings.defaultSort),
        theme: normalizeTheme(currentState.settings.theme),
      };
      currentState.characterAccounts = normalizeCharacterAccounts(currentState.characterAccounts);
      currentState.selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
        currentState.characterAccounts,
        currentState.selectedCharacterAccountIds,
      );
      currentState.titleOverrides = pruneLegacyTitleOverrides(
        currentState.items,
        currentState.titleOverrides,
      );
    }
  } catch (error) {
    console.warn("Failed to restore extension state.", error);
  }
}

async function persistState(state = currentState) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

async function setState(patch, options = {}) {
  currentState = {
    ...currentState,
    ...patch,
  };

  if (options.persist === false) {
    return;
  }

  await persistState(currentState);
}

async function resetExtensionState() {
  await setState(
    createDefaultState({
      settings: {
        ...createDefaultState().settings,
        ...(currentState.settings && typeof currentState.settings === "object"
          ? currentState.settings
          : {}),
      },
    }),
  );
}

async function clearLocalStorageState() {
  await chrome.storage.local.clear();
  currentState = createDefaultState();
}

function normalizeSources(input) {
  return normalizeSourceSelection(input);
}

function getItemKey(item) {
  return `${item.sourcePage}:${item.id}:${item.attachmentIndex}`;
}

function normalizeSelectedKeys(items, requestedKeys) {
  const validKeys = new Set(
    (Array.isArray(items) ? items : [])
      .filter((item) => !item || (!item.isRemoved && !item.isDownloaded))
      .map((item) => item.key || getItemKey(item)),
  );
  const normalized = [];

  for (const key of Array.isArray(requestedKeys) ? requestedKeys : []) {
    if (typeof key !== "string" || !validKeys.has(key) || normalized.includes(key)) {
      continue;
    }
    normalized.push(key);
  }

  return normalized;
}

function sanitizeFilenamePart(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function getLegacyDefaultItemTitle(item) {
  const attachmentIndex =
    item && Number.isInteger(item.attachmentIndex) ? Number(item.attachmentIndex) : 0;
  const attachmentCount =
    item && Number.isInteger(item.attachmentCount) ? Number(item.attachmentCount) : 1;
  const itemId = item && typeof item.id === "string" ? item.id : "";

  if (!itemId) {
    return "video";
  }

  return attachmentCount > 1 ? `${itemId}-${attachmentIndex + 1}` : itemId;
}

function getDefaultItemTitle(item) {
  const discoveryPhrase =
    item && typeof item.discoveryPhrase === "string" ? item.discoveryPhrase.trim() : "";
  if (discoveryPhrase) {
    const attachmentIndex =
      item && Number.isInteger(item.attachmentIndex) ? Number(item.attachmentIndex) : 0;
    const attachmentCount =
      item && Number.isInteger(item.attachmentCount) ? Number(item.attachmentCount) : 1;
    return attachmentCount > 1
      ? `${discoveryPhrase}-${attachmentIndex + 1}`
      : discoveryPhrase;
  }

  const prompt = item && typeof item.prompt === "string" ? sanitizeFilenamePart(item.prompt) : "";
  if (prompt) {
    return prompt;
  }

  if (item && typeof item.filename === "string" && item.filename) {
    return item.filename.replace(/\.mp4$/i, "");
  }

  return item && typeof item.id === "string" ? item.id : "video";
}

function pruneLegacyTitleOverrides(items, titleOverrides) {
  if (!titleOverrides || typeof titleOverrides !== "object") {
    return {};
  }

  const itemsByKey = new Map(
    (Array.isArray(items) ? items : []).map((item) => [item.key || getItemKey(item), item]),
  );
  const nextOverrides = {};

  for (const [itemKey, overrideValue] of Object.entries(titleOverrides)) {
    if (typeof overrideValue !== "string") {
      continue;
    }

    const item = itemsByKey.get(itemKey);
    const sanitizedOverride = sanitizeFilenamePart(overrideValue);
    if (!item || !sanitizedOverride) {
      continue;
    }

    const defaultTitle = sanitizeFilenamePart(getDefaultItemTitle(item));
    if (sanitizedOverride === defaultTitle) {
      continue;
    }

    const hasDiscoveryPhrase =
      typeof item.discoveryPhrase === "string" && item.discoveryPhrase.trim().length > 0;
    const legacyDefaultTitle = sanitizeFilenamePart(getLegacyDefaultItemTitle(item));
    if (hasDiscoveryPhrase && sanitizedOverride === legacyDefaultTitle) {
      continue;
    }

    nextOverrides[itemKey] = sanitizedOverride;
  }

  return nextOverrides;
}

function applyTitleOverride(item, titleOverrides) {
  const key = item.key || getItemKey(item);
  const override =
    titleOverrides && typeof titleOverrides[key] === "string" ? titleOverrides[key] : "";
  const title =
    sanitizeFilenamePart(override) ||
    sanitizeFilenamePart(getDefaultItemTitle(item)) ||
    "video";

  return {
    ...item,
    key,
    title,
    filename: `${title}.mp4`,
  };
}

function getSelectedItems(items, selectedKeys, titleOverrides) {
  const validSelection = new Set(normalizeSelectedKeys(items, selectedKeys));
  return (Array.isArray(items) ? items : [])
    .filter((item) => validSelection.has(item.key || getItemKey(item)))
    .map((item) => applyTitleOverride(item, titleOverrides));
}

function applyCurrentTitlesToQueueItems(queueItems, currentItems, titleOverrides) {
  const currentItemsByKey = new Map(
    (Array.isArray(currentItems) ? currentItems : []).map((item) => [item.key || getItemKey(item), item]),
  );

  return (Array.isArray(queueItems) ? queueItems : []).map((item) => {
    const key = item.key || getItemKey(item);
    const currentItem = currentItemsByKey.get(key);

    return applyTitleOverride(
      currentItem
        ? {
            ...item,
            ...currentItem,
            key,
          }
        : {
            ...item,
            key,
      },
      titleOverrides,
    );
  });
}

function createQueueSnapshotItem(item, errorOverride) {
  const key =
    item && typeof item.key === "string" && item.key ? item.key : getItemKey(item || {});
  const attachmentIndex = Number(item && item.attachmentIndex);
  const snapshot = {
    key,
    id: item && typeof item.id === "string" ? item.id : "",
    sourcePage: item && typeof item.sourcePage === "string" ? item.sourcePage : null,
    attachmentIndex: Number.isFinite(attachmentIndex) ? attachmentIndex : 0,
    filename:
      item && typeof item.filename === "string" && item.filename
        ? item.filename
        : `${(item && item.id) || "video"}.mp4`,
  };
  const error =
    typeof errorOverride === "string" && errorOverride
      ? errorOverride
      : item && typeof item.error === "string" && item.error
        ? item.error
        : "";

  if (error) {
    snapshot.error = error;
  }

  return snapshot;
}

function createQueueSnapshots(items) {
  return (Array.isArray(items) ? items : []).map((item) => createQueueSnapshotItem(item));
}

function rehydrateQueueItems(queueItems, currentItems, titleOverrides) {
  const currentItemsByKey = new Map(
    (Array.isArray(currentItems) ? currentItems : []).map((item) => [item.key || getItemKey(item), item]),
  );

  return (Array.isArray(queueItems) ? queueItems : []).map((queueItem) => {
    const key =
      queueItem && typeof queueItem.key === "string" && queueItem.key
        ? queueItem.key
        : getItemKey(queueItem || {});
    const currentItem = currentItemsByKey.get(key);
    const hydrated = applyTitleOverride(
      currentItem
        ? {
            ...queueItem,
            ...currentItem,
            key,
          }
        : {
            ...queueItem,
            key,
          },
      titleOverrides,
    );

    return queueItem && typeof queueItem.error === "string" && queueItem.error
      ? {
          ...hydrated,
          error: queueItem.error,
        }
      : hydrated;
  });
}

function shouldPersistDownloadProgress(completed, failedCount, pendingCount) {
  if (pendingCount <= 0) {
    return true;
  }

  const processed = Math.max(0, Number(completed) || 0) + Math.max(0, Number(failedCount) || 0);
  return processed <= 1 || processed % DOWNLOAD_PROGRESS_PERSIST_INTERVAL === 0;
}

function deriveSourceIdsFromItems(items) {
  const profileIds = new Set();
  const draftIds = new Set();
  const likesIds = new Set();
  const cameoIds = new Set();
  const characterIds = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item.id !== "string") {
      continue;
    }

    if (item.sourcePage === "drafts") {
      draftIds.add(item.id);
    } else if (item.sourcePage === "profile") {
      profileIds.add(item.id);
    } else if (item.sourcePage === "likes") {
      likesIds.add(item.id);
    } else if (item.sourcePage === "cameos") {
      cameoIds.add(item.id);
    } else if (item.sourcePage === "characters") {
      characterIds.add(item.id);
    }
  }

  return {
    profileIds: [...profileIds],
    draftIds: [...draftIds],
    likesIds: [...likesIds],
    cameoIds: [...cameoIds],
    characterIds: [...characterIds],
  };
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSearchTokens(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean);
}

function getItemSearchText(item) {
  return [
    item && item.prompt,
    item && item.description,
    item && item.caption,
    item && item.discoveryPhrase,
  ]
    .filter(Boolean)
    .join(" ");
}

function itemMatchesSearchQuery(item, searchQuery) {
  const normalizedQuery = normalizeSearchText(searchQuery);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = normalizeSearchText(getItemSearchText(item));
  if (!haystack) {
    return false;
  }

  const queryTokens = getSearchTokens(normalizedQuery);
  const haystackTokens = getSearchTokens(haystack);
  if (!queryTokens.length || !haystackTokens.length) {
    return false;
  }

  const haystackTokenSet = new Set(haystackTokens);
  return queryTokens.every((token) => haystackTokenSet.has(token));
}

function filterItemsBySearchQuery(items, searchQuery) {
  const normalizedQuery = normalizeSearchText(searchQuery);
  if (!normalizedQuery) {
    return Array.isArray(items) ? items : [];
  }

  return (Array.isArray(items) ? items : []).filter((item) =>
    itemMatchesSearchQuery(item, normalizedQuery),
  );
}

function buildReadyMessage(selectedCount) {
  if (selectedCount === 0) {
    return "Select at least one video to download.";
  }

  return `Ready to download ${selectedCount} selected item(s).`;
}

function normalizeMaxVideos(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.floor(numeric);
}

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function normalizeDefaultSource(value) {
  return normalizeSourceSelection(value);
}

function normalizeSourceSelection(input, fallback = DEFAULT_SOURCE_VALUES) {
  const requested = Array.isArray(input) ? input : input == null ? [] : [input];
  const selected = new Set();

  for (const value of requested) {
    if (value === "both") {
      selected.add("profile");
      selected.add("drafts");
      continue;
    }

    if (
      value === "profile" ||
      value === "drafts" ||
      value === "likes" ||
      value === "characters" ||
      value === "characterAccounts"
    ) {
      selected.add(value);
    }
  }

  const ordered = AVAILABLE_SOURCE_VALUES.filter((value) => selected.has(value));
  return ordered.length ? ordered : [...fallback];
}

function normalizeDefaultSort(value) {
  return value === "likes" || value === "views" || value === "remixes" ? value : "newest";
}

function getMaxVideosSetting(settings) {
  return normalizeMaxVideos(settings && settings.maxVideos);
}

function createControlError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isControlError(error, code) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (code ? error.code === code : error.code === "pause" || error.code === "abort"),
  );
}

async function startScan(requestedSources, requestedSearchQuery = "") {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const sources = normalizeSources(requestedSources);
  const searchQuery = normalizeSearchText(requestedSearchQuery);

  if (sources.includes("characterAccounts")) {
    await ensureCharacterAccountsLoaded();
  }

  activeRun = scanSources(sources, searchQuery);
  try {
    await activeRun;
  } finally {
    activeRun = null;
    await cleanupHiddenTab();
  }
}

async function scanSources(sources, searchQuery = "") {
  // A scan always rebuilds the current working set from Sora, then applies the popup's
  // search query locally so the user can start from a filtered shortlist if desired.
  await setState(
    createDefaultState({
      phase: "fetching",
      message: "Opening Sora...",
      settings: currentState.settings,
      currentSource: sources[0] ?? null,
      characterAccounts: currentState.characterAccounts,
      selectedCharacterAccountIds: currentState.selectedCharacterAccountIds,
      startedAt: new Date().toISOString(),
    }),
  );

  try {
    const collected = await collectItems(sources, getMaxVideosSetting(currentState.settings));
    const filteredItems = filterItemsBySearchQuery(collected.items, searchQuery);
    const filteredSourceIds = deriveSourceIdsFromItems(filteredItems);
    const selectedKeys = filteredItems.map((item) => item.key || getItemKey(item));
    const baseState = {
      currentSource: null,
      profileIds: filteredSourceIds.profileIds,
      draftIds: filteredSourceIds.draftIds,
      likesIds: filteredSourceIds.likesIds,
      cameoIds: filteredSourceIds.cameoIds,
      characterIds: filteredSourceIds.characterIds,
      items: filteredItems,
      fetchedCount: filteredItems.length,
      selectedKeys,
      titleOverrides: {},
      pendingItems: [],
      runMode: null,
      runTotal: 0,
      queued: selectedKeys.length,
      completed: 0,
      failed: 0,
      failedItems: [],
      lastError: "",
      partialWarning: collected.partialWarning,
    };

    if (!filteredItems.length) {
      await setState({
        ...baseState,
        phase: "complete",
        message: searchQuery
          ? `No downloadable items matched “${searchQuery}”.`
          : "No downloadable items were found.",
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    await setState({
      ...baseState,
      phase: "ready",
      message: buildReadyMessage(selectedKeys.length),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    await setState({
      phase: "error",
      message: "The fetch run stopped.",
      currentSource: null,
      lastError: getErrorMessage(error),
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

async function setSelectedKeys(requestedKeys) {
  const selectedKeys = normalizeSelectedKeys(currentState.items, requestedKeys);
  const patch = {
    selectedKeys,
    queued: selectedKeys.length,
  };

  if (currentState.phase === "ready") {
    patch.message = buildReadyMessage(selectedKeys.length);
  }

  await setState(patch);
}

function normalizeCharacterAccounts(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (account) =>
        account &&
        typeof account.userId === "string" &&
        account.userId &&
        account.userId.startsWith("ch_"),
    )
    .map((account) => ({
      userId: account.userId,
      username: typeof account.username === "string" ? account.username : "",
      displayName:
        typeof account.displayName === "string" && account.displayName
          ? account.displayName
          : typeof account.username === "string" && account.username
            ? account.username
            : account.userId,
      cameoCount: Number.isFinite(Number(account.cameoCount)) ? Number(account.cameoCount) : 0,
      permalink: typeof account.permalink === "string" ? account.permalink : null,
      profilePictureUrl:
        typeof account.profilePictureUrl === "string" ? account.profilePictureUrl : null,
    }));
}

function normalizeSelectedCharacterAccountIds(characterAccounts, requestedIds, fallbackIds = null) {
  const validIds = new Set(
    normalizeCharacterAccounts(characterAccounts).map((account) => account.userId),
  );
  const selected = [];

  for (const value of Array.isArray(requestedIds) ? requestedIds : []) {
    if (typeof value !== "string" || !validIds.has(value) || selected.includes(value)) {
      continue;
    }
    selected.push(value);
  }

  if (selected.length) {
    return selected;
  }

  if (Array.isArray(fallbackIds) && fallbackIds.length) {
    return normalizeSelectedCharacterAccountIds(characterAccounts, fallbackIds, []);
  }

  return [...validIds];
}

async function ensureCharacterAccountsLoaded(force = false) {
  const existingAccounts = normalizeCharacterAccounts(currentState.characterAccounts);
  if (!force && existingAccounts.length) {
    return existingAccounts;
  }

  const fetchedAccounts = await fetchAllCharacterAccounts();
  const selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
    fetchedAccounts,
    currentState.selectedCharacterAccountIds,
    fetchedAccounts.map((account) => account.userId),
  );

  await setState({
    characterAccounts: fetchedAccounts,
    selectedCharacterAccountIds,
  });

  return fetchedAccounts;
}

async function setSelectedCharacterAccountIds(requestedIds) {
  const characterAccounts =
    currentState.characterAccounts && currentState.characterAccounts.length
      ? normalizeCharacterAccounts(currentState.characterAccounts)
      : await ensureCharacterAccountsLoaded();
  const selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
    characterAccounts,
    requestedIds,
    currentState.selectedCharacterAccountIds,
  );

  await setState({
    characterAccounts,
    selectedCharacterAccountIds,
  });
}

async function setTitleOverride(itemKey, requestedTitle) {
  const validKeys = new Set(
    (Array.isArray(currentState.items) ? currentState.items : []).map(
      (item) => item.key || getItemKey(item),
    ),
  );

  if (!validKeys.has(itemKey)) {
    throw new Error("That video is no longer in the current list.");
  }

  const nextOverrides = {
    ...(currentState.titleOverrides && typeof currentState.titleOverrides === "object"
      ? currentState.titleOverrides
      : {}),
  };

  const matchingItem = (currentState.items || []).find(
    (item) => (item.key || getItemKey(item)) === itemKey,
  );
  const defaultTitle = sanitizeFilenamePart(getDefaultItemTitle(matchingItem));
  const sanitized = sanitizeFilenamePart(requestedTitle);

  if (!sanitized || sanitized === defaultTitle) {
    delete nextOverrides[itemKey];
  } else {
    nextOverrides[itemKey] = sanitized;
  }

  await setState({
    titleOverrides: nextOverrides,
  });
}

async function setItemRemovedState(itemKey, removed) {
  if (currentState.phase === "fetching" || currentState.phase === "downloading" || currentState.phase === "paused") {
    throw new Error("Wait until the current fetch or download run finishes before removing videos.");
  }

  const currentItems = Array.isArray(currentState.items) ? currentState.items : [];
  let didUpdate = false;
  const nextItems = currentItems.map((item) => {
    const key = item.key || getItemKey(item);
    if (key !== itemKey || Boolean(item.isRemoved) === Boolean(removed)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      isRemoved: Boolean(removed),
    };
  });

  if (!didUpdate) {
    throw new Error("That video is no longer in the current set.");
  }

  const nextSelectedKeysSeed = Array.isArray(currentState.selectedKeys)
    ? [...currentState.selectedKeys]
    : [];
  const nextSelectedKeySet = new Set(nextSelectedKeysSeed);
  if (removed) {
    nextSelectedKeySet.delete(itemKey);
  } else {
    nextSelectedKeySet.add(itemKey);
  }

  const nextSelectedKeys = normalizeSelectedKeys(
    nextItems,
    [...nextSelectedKeySet],
  );

  const nextFailedItems = (currentState.failedItems || []).filter(
    (item) => (item.key || getItemKey(item)) !== itemKey,
  );
  const nextPendingItems = (currentState.pendingItems || []).filter(
    (item) => (item.key || getItemKey(item)) !== itemKey,
  );
  const sourceIds = deriveSourceIdsFromItems(nextItems);

  const patch = {
    items: nextItems,
    profileIds: sourceIds.profileIds,
    draftIds: sourceIds.draftIds,
    likesIds: sourceIds.likesIds,
    cameoIds: sourceIds.cameoIds,
    characterIds: sourceIds.characterIds,
    fetchedCount: nextItems.length,
    selectedKeys: nextSelectedKeys,
    titleOverrides:
      currentState.titleOverrides && typeof currentState.titleOverrides === "object"
        ? currentState.titleOverrides
        : {},
    failedItems: nextFailedItems,
    failed: nextFailedItems.length,
    pendingItems: nextPendingItems,
  };

  if (currentState.phase === "ready") {
    patch.queued = nextSelectedKeys.length;
    patch.message = buildReadyMessage(nextSelectedKeys.length);
  }

  await setState(patch);
}

function applyDownloadedState(items, selectedKeys, itemKeys, downloaded) {
  const keySet = new Set(Array.isArray(itemKeys) ? itemKeys : []);
  let didUpdate = false;

  const nextItems = (Array.isArray(items) ? items : []).map((item) => {
    const key = item.key || getItemKey(item);
    if (!keySet.has(key) || Boolean(item.isDownloaded) === Boolean(downloaded)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      isDownloaded: Boolean(downloaded),
    };
  });

  const nextSelectedKeySeed = Array.isArray(selectedKeys) ? [...selectedKeys] : [];
  const nextSelectedKeySet = new Set(nextSelectedKeySeed);
  if (downloaded) {
    for (const key of keySet) {
      nextSelectedKeySet.delete(key);
    }
  } else {
    for (const key of keySet) {
      nextSelectedKeySet.add(key);
    }
  }

  const nextSelectedKeys = normalizeSelectedKeys(nextItems, [...nextSelectedKeySet]);
  return {
    didUpdate,
    nextItems,
    nextSelectedKeys,
  };
}

async function setItemDownloadedState(itemKey, downloaded) {
  if (
    currentState.phase === "fetching" ||
    currentState.phase === "downloading" ||
    currentState.phase === "paused"
  ) {
    throw new Error("Wait until the current fetch or download run finishes before updating downloads.");
  }

  const { didUpdate, nextItems, nextSelectedKeys } = applyDownloadedState(
    currentState.items,
    currentState.selectedKeys,
    [itemKey],
    downloaded,
  );

  if (!didUpdate) {
    throw new Error("That video is no longer in the current set.");
  }

  const patch = {
    items: nextItems,
    selectedKeys: nextSelectedKeys,
    queued: nextSelectedKeys.length,
  };

  if (currentState.phase === "ready" || currentState.phase === "complete") {
    patch.message = buildReadyMessage(nextSelectedKeys.length);
  }

  await setState(patch);
}

async function updateSettings(nextSettings) {
  const settings = {
    ...(currentState.settings && typeof currentState.settings === "object"
      ? currentState.settings
      : {}),
  };

  if (nextSettings && Object.prototype.hasOwnProperty.call(nextSettings, "maxVideos")) {
    const normalizedMaxVideos = getMaxVideosSetting(nextSettings);
    settings.maxVideos = normalizedMaxVideos;
  } else {
    settings.maxVideos = getMaxVideosSetting(settings);
  }
  
  if (nextSettings && Object.prototype.hasOwnProperty.call(nextSettings, "defaultSource")) {
    settings.defaultSource = normalizeDefaultSource(nextSettings.defaultSource);
  } else {
    settings.defaultSource = normalizeDefaultSource(settings.defaultSource);
  }

  if (nextSettings && Object.prototype.hasOwnProperty.call(nextSettings, "defaultSort")) {
    settings.defaultSort = normalizeDefaultSort(nextSettings.defaultSort);
  } else {
    settings.defaultSort = normalizeDefaultSort(settings.defaultSort);
  }

  if (nextSettings && Object.prototype.hasOwnProperty.call(nextSettings, "theme")) {
    settings.theme = normalizeTheme(nextSettings.theme);
  } else {
    settings.theme = normalizeTheme(settings.theme);
  }

  await setState({
    settings,
  });
}

async function downloadSelected() {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const selectedItems = getSelectedItems(
    currentState.items,
    currentState.selectedKeys,
    currentState.titleOverrides,
  );
  if (!selectedItems.length) {
    throw new Error("Select at least one video before downloading.");
  }

  activeRun = (async () => {
    try {
      await performDownloadRun(selectedItems, {
        mode: "selected",
        startingCompleted: 0,
        startingFailedItems: [],
        totalTarget: selectedItems.length,
        introMessage: `Starting ${selectedItems.length} selected download(s)...`,
        progressMessage: (completed, total) => `Downloaded ${completed} of ${total}`,
        failureMessage: (item) => `Failed to download ${item.filename}`,
        completionMessage: (completed, failed) =>
          failed === 0
            ? `Finished downloading ${completed} item(s).`
            : `Finished with ${completed} success(es) and ${failed} failure(s).`,
      });
    } finally {
      await cleanupHiddenTab();
    }
  })();

  try {
    await activeRun;
  } finally {
    activeRun = null;
  }
}

async function beginSelectedDownload() {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const selectedItems = getSelectedItems(
    currentState.items,
    currentState.selectedKeys,
    currentState.titleOverrides,
  );
  if (!selectedItems.length) {
    throw new Error("Select at least one video before downloading.");
  }

  await setState({
    phase: "downloading",
    currentSource: null,
    queued: selectedItems.length,
    completed: 0,
    failed: 0,
    failedItems: [],
    pendingItems: createQueueSnapshots(selectedItems),
    runMode: "selected",
    runTotal: selectedItems.length,
    lastError: "",
    finishedAt: null,
    message: `Starting ${selectedItems.length} selected download(s)...`,
  });

  activeRun = (async () => {
    try {
      await performDownloadRun(selectedItems, {
        mode: "selected",
        startingCompleted: 0,
        startingFailedItems: [],
        totalTarget: selectedItems.length,
        initialStateApplied: true,
        introMessage: `Starting ${selectedItems.length} selected download(s)...`,
        progressMessage: (completed, total) => `Downloaded ${completed} of ${total}`,
        failureMessage: (item) => `Failed to download ${item.filename}`,
        completionMessage: (completed, failed) =>
          failed === 0
            ? `Finished downloading ${completed} item(s).`
            : `Finished with ${completed} success(es) and ${failed} failure(s).`,
      });
    } finally {
      await cleanupHiddenTab();
    }
  })();

  void activeRun.finally(() => {
    activeRun = null;
  });
}

async function resumeDownloads() {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const pendingItems = rehydrateQueueItems(
    Array.isArray(currentState.pendingItems) ? currentState.pendingItems.map(stripFailureError) : [],
    currentState.items,
    currentState.titleOverrides,
  );
  if (!pendingItems.length) {
    throw new Error("There is no paused download queue to resume.");
  }

  const mode = currentState.runMode === "retry" ? "retry" : "selected";
  const totalTarget =
    Number(currentState.runTotal) ||
    pendingItems.length +
      (Number(currentState.completed) || 0) +
      (Array.isArray(currentState.failedItems) ? currentState.failedItems.length : 0);

  activeRun = (async () => {
    try {
      await performDownloadRun(pendingItems, {
        mode,
        startingCompleted: Number(currentState.completed) || 0,
        startingFailedItems: Array.isArray(currentState.failedItems)
          ? currentState.failedItems.map(stripFailureError)
          : [],
        totalTarget,
        introMessage:
          mode === "retry"
            ? `Resuming retry for ${pendingItems.length} item(s)...`
            : `Resuming ${pendingItems.length} queued download(s)...`,
        progressMessage:
          mode === "retry"
            ? (_completed, _total, item) => `Recovered ${item.filename}`
            : (completed, total) => `Downloaded ${completed} of ${total}`,
        failureMessage:
          mode === "retry"
            ? (item) => `Retry failed for ${item.filename}`
            : (item) => `Failed to download ${item.filename}`,
        completionMessage:
          mode === "retry"
            ? (_completed, failed) =>
                failed === 0
                  ? "All failed downloads were recovered."
                  : `Retry finished with ${failed} remaining failure(s).`
            : (completed, failed) =>
                failed === 0
                  ? `Finished downloading ${completed} item(s).`
                  : `Finished with ${completed} success(es) and ${failed} failure(s).`,
      });
    } finally {
      await cleanupHiddenTab();
    }
  })();

  try {
    await activeRun;
  } finally {
    activeRun = null;
  }
}

async function retryFailed() {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const retryItems = rehydrateQueueItems(
    (currentState.failedItems || []).map(stripFailureError),
    currentState.items,
    currentState.titleOverrides,
  );
  if (!retryItems.length) {
    throw new Error("There are no failed downloads to retry.");
  }

  activeRun = (async () => {
    try {
      await performDownloadRun(retryItems, {
        mode: "retry",
        startingCompleted: Number(currentState.completed) || 0,
        startingFailedItems: [],
        totalTarget: retryItems.length,
        introMessage: `Retrying ${retryItems.length} failed download(s)...`,
        progressMessage: (_completed, _total, item) => `Recovered ${item.filename}`,
        failureMessage: (item) => `Retry failed for ${item.filename}`,
        completionMessage: (_completed, failed) =>
          failed === 0
            ? "All failed downloads were recovered."
            : `Retry finished with ${failed} remaining failure(s).`,
      });
    } finally {
      await cleanupHiddenTab();
    }
  })();

  try {
    await activeRun;
  } finally {
    activeRun = null;
  }
}

async function requestRunControl(action) {
  if (currentState.phase !== "downloading") {
    throw new Error(`There is no active download queue to ${action}.`);
  }

  requestedControlAction = action;

  await setState({
    message:
      action === "pause"
        ? "Pausing the active download..."
        : "Aborting the active download...",
  }, { persist: false });

  if (typeof activeDownloadId === "number") {
    try {
      await chrome.downloads.cancel(activeDownloadId);
    } catch (_error) {
      // Ignore cancel errors and let the runner handle the control action on the next cycle.
    }
  }
}

async function abortPausedDownloads() {
  const selectedCount = normalizeSelectedKeys(currentState.items, currentState.selectedKeys).length;

  requestedControlAction = null;
  await setState({
    phase: currentState.items.length ? "ready" : "complete",
    message: "The paused download queue was cleared.",
    currentSource: null,
    queued: selectedCount,
    pendingItems: [],
    runMode: null,
    runTotal: 0,
    finishedAt: new Date().toISOString(),
  });
}

async function performDownloadRun(downloadItems, options) {
  // Downloads run serially so pause/abort/retry stays predictable and the persisted queue
  // always reflects exactly which item is in-flight.
  const pendingItems = [...downloadItems];
  const failedItems = Array.isArray(options && options.startingFailedItems)
    ? options.startingFailedItems.map(stripFailureError)
    : [];
  let completed = Number(options && options.startingCompleted) || 0;
  const total =
    Number(options && options.totalTarget) ||
    pendingItems.length + completed + failedItems.length;

  requestedControlAction = null;

  if (!(options && options.initialStateApplied)) {
    await setState({
      phase: "downloading",
      currentSource: null,
      queued: pendingItems.length,
      completed,
      failed: failedItems.length,
      failedItems: [...failedItems],
      pendingItems: createQueueSnapshots(pendingItems),
      runMode: (options && options.mode) || null,
      runTotal: total,
      lastError: "",
      finishedAt: null,
      message:
        (options && options.introMessage) || `Starting ${total} download(s)...`,
    });
  }

  while (pendingItems.length > 0) {
    if (requestedControlAction === "pause") {
      requestedControlAction = null;
      await setState({
        phase: "paused",
        currentSource: null,
        queued: pendingItems.length,
        completed,
        failed: failedItems.length,
        failedItems: [...failedItems],
        pendingItems: createQueueSnapshots(pendingItems),
        runMode: (options && options.mode) || null,
        runTotal: total,
        message: `Paused with ${pendingItems.length} item(s) remaining.`,
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    if (requestedControlAction === "abort") {
      requestedControlAction = null;
      const selectedCount = normalizeSelectedKeys(currentState.items, currentState.selectedKeys).length;
      await setState({
        phase: currentState.items.length ? "ready" : "complete",
        currentSource: null,
        queued: selectedCount,
        completed,
        failed: failedItems.length,
        failedItems: [...failedItems],
        pendingItems: [],
        runMode: null,
        runTotal: 0,
        message: "The download queue was aborted.",
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const item = pendingItems[0];
    await setState({
      message: `Downloading ${item.filename}`,
      currentSource: item.sourcePage,
    }, { persist: false });

    try {
      await downloadItemWithRetry(item);
      completed += 1;
      pendingItems.shift();
      const { nextItems, nextSelectedKeys } = applyDownloadedState(
        currentState.items,
        currentState.selectedKeys,
        [item.key || getItemKey(item)],
        true,
      );
      await setState({
        items: nextItems,
        selectedKeys: nextSelectedKeys,
        completed,
        queued: pendingItems.length,
        pendingItems: createQueueSnapshots(pendingItems),
        message:
          (options && typeof options.progressMessage === "function"
            ? options.progressMessage(completed, total, item)
            : `Downloaded ${completed} of ${total}`),
      }, {
        persist: shouldPersistDownloadProgress(completed, failedItems.length, pendingItems.length),
      });
    } catch (error) {
      if (isControlError(error, "pause")) {
        requestedControlAction = null;
        await setState({
          phase: "paused",
          currentSource: null,
          queued: pendingItems.length,
          completed,
          failed: failedItems.length,
          failedItems: [...failedItems],
          pendingItems: createQueueSnapshots(pendingItems),
          runMode: (options && options.mode) || null,
          runTotal: total,
          message: `Paused with ${pendingItems.length} item(s) remaining.`,
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      if (isControlError(error, "abort")) {
        requestedControlAction = null;
        const selectedCount = normalizeSelectedKeys(currentState.items, currentState.selectedKeys).length;
        await setState({
          phase: currentState.items.length ? "ready" : "complete",
          currentSource: null,
          queued: selectedCount,
          completed,
          failed: failedItems.length,
          failedItems: [...failedItems],
          pendingItems: [],
          runMode: null,
          runTotal: 0,
          message: "The download queue was aborted.",
          finishedAt: new Date().toISOString(),
        });
        return;
      }

      const message = getErrorMessage(error);
      failedItems.push(createQueueSnapshotItem(item, message));
      pendingItems.shift();
      await setState({
        failed: failedItems.length,
        failedItems: [...failedItems],
        queued: pendingItems.length,
        pendingItems: createQueueSnapshots(pendingItems),
        lastError: message,
        message:
          (options && typeof options.failureMessage === "function"
            ? options.failureMessage(item, message)
            : `Failed to download ${item.filename}`),
      }, {
        persist: shouldPersistDownloadProgress(completed, failedItems.length, pendingItems.length),
      });
    }
  }

  const failureCount = failedItems.length;
  const summary =
    options && typeof options.completionMessage === "function"
      ? options.completionMessage(completed, failureCount)
      : failureCount === 0
        ? `Finished downloading ${completed} item(s).`
        : `Finished with ${completed} success(es) and ${failureCount} failure(s).`;

  await setState({
    phase: "complete",
    message: summary,
    currentSource: null,
    queued: 0,
    completed,
    failed: failureCount,
    failedItems,
    pendingItems: [],
    runMode: null,
    runTotal: 0,
    finishedAt: new Date().toISOString(),
  });
}

async function collectItems(sources, maxVideos) {
  const itemMap = new Map();
  const profileIds = new Set();
  const draftIds = new Set();
  const likesIds = new Set();
  const cameoIds = new Set();
  const characterIds = new Set();
  let partialWarning = "";

  for (const source of sources) {
    const maxRemaining = getRemainingFetchCapacity(itemMap.size, maxVideos);
    if (maxRemaining === 0) {
      break;
    }

    await setState({
      phase: "fetching",
      currentSource: source,
      message:
        source === "profile"
          ? "Fetching published videos..."
          : source === "drafts"
            ? "Fetching drafts..."
            : source === "likes"
              ? "Fetching liked videos..."
              : source === "characters"
                ? "Fetching cameo videos..."
                : "Fetching character videos...",
    });

    const sourceResult =
      source === "profile"
        ? await fetchAllProfileItems({
          maxItems: maxRemaining,
          baseCount: itemMap.size,
          onProgress: async ({ count }) => {
            await setState({
              fetchedCount: itemMap.size + count,
              message: `Fetching published videos... ${itemMap.size + count} found so far.`,
            });
          },
        })
        : source === "drafts"
          ? await fetchAllDraftItems({
            maxItems: maxRemaining,
            baseCount: itemMap.size,
            onProgress: async ({ count }) => {
              await setState({
                fetchedCount: itemMap.size + count,
                message: `Fetching drafts... ${itemMap.size + count} found so far.`,
              });
            },
          })
          : source === "likes"
            ? await fetchAllLikesItems({
              maxItems: maxRemaining,
              baseCount: itemMap.size,
              onProgress: async ({ count }) => {
                await setState({
                  fetchedCount: itemMap.size + count,
                  message: `Fetching liked videos... ${itemMap.size + count} found so far.`,
                });
              },
            })
            : source === "characters"
              ? await fetchAllCameoItems({
                maxItems: maxRemaining,
                baseCount: itemMap.size,
                onProgress: async ({ count }) => {
                  await setState({
                    fetchedCount: itemMap.size + count,
                    message: `Fetching cameo videos... ${itemMap.size + count} found so far.`,
                  });
                },
              })
              : await fetchAllCharacterItems({
                maxItems: maxRemaining,
                characterAccounts: currentState.characterAccounts,
                selectedCharacterAccountIds: currentState.selectedCharacterAccountIds,
                baseCount: itemMap.size,
                onProgress: async ({ count }) => {
                  await setState({
                    fetchedCount: itemMap.size + count,
                    message: `Fetching character videos... ${itemMap.size + count} found so far.`,
                  });
                },
              });

    for (const item of sourceResult.items) {
      const key = getItemKey(item);
      if (!itemMap.has(key)) {
        itemMap.set(key, {
          ...item,
          key,
        });
      }
    }

    for (const id of sourceResult.ids) {
      if (source === "profile") {
        profileIds.add(id);
      } else if (source === "drafts") {
        draftIds.add(id);
      } else if (source === "likes") {
        likesIds.add(id);
      } else if (source === "characters") {
        cameoIds.add(id);
      } else {
        characterIds.add(id);
      }
    }

    if (sourceResult.partialWarning) {
      partialWarning = sourceResult.partialWarning;
    }
  }

  return {
    items: [...itemMap.values()],
    profileIds: [...profileIds],
    draftIds: [...draftIds],
    likesIds: [...likesIds],
    cameoIds: [...cameoIds],
    characterIds: [...characterIds],
    partialWarning,
  };
}

function getRemainingFetchCapacity(currentCount, maxVideos) {
  const normalizedMax = normalizeMaxVideos(maxVideos);
  if (!normalizedMax) {
    return null;
  }

  return Math.max(0, normalizedMax - currentCount);
}

function getComparableItemTimestamp(item) {
  const timestamp = Number(item && (item.createdAt ?? item.postedAt));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortItemsByNewest(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const timestampDelta = getComparableItemTimestamp(right) - getComparableItemTimestamp(left);
    if (timestampDelta !== 0) {
      return timestampDelta;
    }

    return getItemKey(left).localeCompare(getItemKey(right));
  });
}

function joinPartialWarnings(warnings) {
  return [...new Set((Array.isArray(warnings) ? warnings : []).filter(Boolean))].join(" ");
}

async function fetchAllProfileItems(options = {}) {
  const ids = new Set();
  const items = [];
  const cut = "nf2";
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("profile", {
      limit: PROFILE_LIMIT,
      cut,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }
    items.push(...page.items);

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllDraftItems(options = {}) {
  const ids = new Set();
  const itemMap = new Map();
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;
  let offset = 0;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("drafts", {
      limit: DRAFT_BATCH_LIMIT,
      offset,
      cursor,
    });

    const beforeSize = itemMap.size;

    for (const id of page.ids) {
      ids.add(id);
    }

    for (const item of page.items) {
      const key = getItemKey(item);
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
      }
    }

    const items = [...itemMap.values()];
    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    const madeProgress = itemMap.size > beforeSize;
    if (page.rowCount === 0 || (maxItems && items.length >= maxItems)) {
      return {
        ids: [...ids],
        items,
        partialWarning: "",
      };
    }

    if (page.nextCursor && page.nextCursor !== previousCursor) {
      previousCursor = cursor;
      cursor = page.nextCursor;
      continue;
    }

    if (!madeProgress || page.rowCount < DRAFT_BATCH_LIMIT) {
      return {
        ids: [...ids],
        items,
        partialWarning: "",
      };
    }

    offset += DRAFT_BATCH_LIMIT;
  }

  return {
    ids: [...ids],
    items: [...itemMap.values()].slice(0, maxItems || undefined),
    partialWarning: "Stopped fetching drafts after many batches to avoid an infinite loop.",
  };
}

async function fetchAllLikesItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("likes", {
      limit: LIKES_BATCH_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }
    items.push(...page.items);

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllCharacterAppearanceItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("characters", {
      limit: CHARACTERS_BATCH_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }
    items.push(...page.items);

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllCharacterDraftItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("characterDrafts", {
      limit: CHARACTERS_BATCH_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }
    items.push(...page.items);

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllCharacterAccounts() {
  const accountMap = new Map();
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("characterProfiles", {
      limit: CHARACTER_ACCOUNT_LIMIT,
      cursor,
    });

    for (const account of Array.isArray(page.accounts) ? page.accounts : []) {
      if (!account || typeof account.userId !== "string" || !account.userId) {
        continue;
      }

      accountMap.set(account.userId, account);
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return [...accountMap.values()];
}

function appendCharacterAccountContext(item, characterAccount) {
  if (!item || !characterAccount) {
    return item;
  }

  const metadataEntries = Array.isArray(item.metadataEntries)
    ? [...item.metadataEntries]
    : [];

  if (characterAccount.displayName) {
    metadataEntries.push({
      label: "Character Account",
      value: characterAccount.displayName,
      type: "text",
    });
  }

  if (characterAccount.username) {
    metadataEntries.push({
      label: "Character Username",
      value: `@${characterAccount.username}`,
      type: "text",
    });
  }

  if (characterAccount.permalink) {
    metadataEntries.push({
      label: "Character Profile",
      value: characterAccount.permalink,
      type: "link",
    });
  }

  return {
    ...item,
    characterAccountId: characterAccount.userId,
    characterAccountUsername: characterAccount.username,
    characterAccountDisplayName: characterAccount.displayName,
    metadataEntries,
  };
}

async function fetchAllCharacterAccountPublishedItems(characterAccount, options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("characterAccountPosts", {
      characterId: characterAccount.userId,
      limit: CHARACTERS_BATCH_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }

    for (const item of page.items) {
      items.push(appendCharacterAccountContext(item, characterAccount));
    }

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllCharacterAccountDraftItems(characterAccount, options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    const page = await fetchSourceDataFromTab("characterAccountDrafts", {
      characterId: characterAccount.userId,
      limit: CHARACTERS_BATCH_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }

    for (const item of page.items) {
      items.push(appendCharacterAccountContext(item, characterAccount));
    }

    if (maxItems && items.length > maxItems) {
      items.length = maxItems;
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: items.length,
        pageNumber: pageNumber + 1,
      });
    }

    if (
      page.rowCount === 0 ||
      !page.nextCursor ||
      page.nextCursor === previousCursor ||
      (maxItems && items.length >= maxItems)
    ) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
  };
}

async function fetchAllCharacterItems(options = {}) {
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const normalizedCharacterAccounts = normalizeCharacterAccounts(options.characterAccounts);
  const selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
    normalizedCharacterAccounts,
    options.selectedCharacterAccountIds,
  );
  const selectedCharacterAccounts = normalizedCharacterAccounts.filter((account) =>
    selectedCharacterAccountIds.includes(account.userId),
  );
  const ids = new Set();
  const itemMap = new Map();
  const partialWarnings = [];
  let totalCount = 0;

  const mergeResult = (result) => {
    for (const id of result.ids) {
      ids.add(id);
    }

    for (const item of result.items) {
      const key = getItemKey(item);
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
      }
    }
  };

  const reportProgress = async (messagePrefix) => {
    if (typeof options.onProgress !== "function") {
      return;
    }

    await options.onProgress({
      count: totalCount,
      pageNumber: 1,
      message: messagePrefix,
    });
  };

  for (const characterAccount of selectedCharacterAccounts) {
    const maxRemaining = getRemainingFetchCapacity(itemMap.size, maxItems);
    if (maxRemaining === 0) {
      break;
    }

    const characterPublishedResult = await fetchAllCharacterAccountPublishedItems(
      characterAccount,
      {
        maxItems: maxRemaining,
        onProgress: async ({ count }) => {
          totalCount = maxItems
            ? Math.min(maxItems, itemMap.size + count)
            : itemMap.size + count;
          await reportProgress(`Fetching ${characterAccount.displayName} posts...`);
        },
      },
    );
    mergeResult(characterPublishedResult);

    const nextMaxRemaining = getRemainingFetchCapacity(itemMap.size, maxItems);
    if (nextMaxRemaining === 0) {
      break;
    }

    const characterDraftResult = await fetchAllCharacterAccountDraftItems(
      characterAccount,
      {
        maxItems: nextMaxRemaining,
        onProgress: async ({ count }) => {
          totalCount = maxItems
            ? Math.min(maxItems, itemMap.size + count)
            : itemMap.size + count;
          await reportProgress(`Fetching ${characterAccount.displayName} drafts...`);
        },
      },
    );
    mergeResult(characterDraftResult);
  }

  const items = sortItemsByNewest([...itemMap.values()]);
  if (maxItems && items.length > maxItems) {
    items.length = maxItems;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: joinPartialWarnings([
      ...partialWarnings,
    ]),
  };
}

async function fetchAllCameoItems(options = {}) {
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const ids = new Set();
  const itemMap = new Map();
  let totalCount = 0;

  const mergeResult = (result) => {
    for (const id of result.ids) {
      ids.add(id);
    }

    for (const item of result.items) {
      const key = getItemKey(item);
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
      }
    }
  };

  const reportProgress = async (messagePrefix) => {
    if (typeof options.onProgress !== "function") {
      return;
    }

    await options.onProgress({
      count: totalCount,
      pageNumber: 1,
      message: messagePrefix,
    });
  };

  const publishedResult = await fetchAllCharacterAppearanceItems({
    maxItems,
    onProgress: async ({ count }) => {
      totalCount = maxItems ? Math.min(maxItems, count) : count;
      await reportProgress("Fetching cameo videos...");
    },
  });
  mergeResult(publishedResult);

  const nextMaxRemaining = getRemainingFetchCapacity(itemMap.size, maxItems);
  if (nextMaxRemaining !== 0) {
    const draftResult = await fetchAllCharacterDraftItems({
      maxItems: nextMaxRemaining,
      onProgress: async ({ count }) => {
        totalCount = maxItems
          ? Math.min(maxItems, itemMap.size + count)
          : itemMap.size + count;
        await reportProgress("Fetching cameo videos...");
      },
    });
    mergeResult(draftResult);

    return {
      ids: [...ids],
      items: sortItemsByNewest([...itemMap.values()]).slice(0, maxItems || undefined),
      partialWarning: joinPartialWarnings([
        publishedResult.partialWarning,
        draftResult.partialWarning,
      ]),
    };
  }

  return {
    ids: [...ids],
    items: sortItemsByNewest([...itemMap.values()]).slice(0, maxItems || undefined),
    partialWarning: joinPartialWarnings([publishedResult.partialWarning]),
  };
}

async function fetchSourceDataFromTab(source, options) {
  const tabId = await ensureHiddenTab(SOURCE_ROUTES[source]);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectedFetchSource,
      args: [{ source, options }],
    });

    if (!results || !results.length) {
      throw new Error("Chrome did not return data from the injected fetch.");
    }

    const payload = results[0].result;
    if (!payload || typeof payload !== "object") {
      throw new Error("Sora returned an invalid payload.");
    }

    if (payload.error) {
      throw new Error(payload.error);
    }

    return payload;
  } catch (error) {
    const sourceLabel =
      source === "profile"
        ? "published"
        : source === "drafts"
          ? "drafts"
          : source === "likes"
            ? "liked"
            : source === "characterProfiles"
              ? "character account"
              : source === "characterAccountPosts"
                ? "character account post"
            : source === "characterDrafts"
              ? "cameo drafts"
              : source === "characterAccountDrafts"
                ? "character account drafts"
            : "cameo";
    throw new Error(`Failed to fetch ${sourceLabel} data: ${getErrorMessage(error)}`);
  }
}

async function ensureHiddenTab(url) {
  // The extension reuses one inactive Sora tab across requests. That keeps tab creation
  // predictable and lets chrome.scripting run packaged code inside the user's existing
  // logged-in Sora session without requiring a visible browsing interruption.
  if (hiddenTabId !== null) {
    try {
      const existingTab = await chrome.tabs.get(hiddenTabId);
      if (existingTab.url !== url) {
        await chrome.tabs.update(hiddenTabId, { url, active: false });
        await waitForTabComplete(hiddenTabId);
      } else if (existingTab.status !== "complete") {
        await waitForTabComplete(hiddenTabId);
      }
      return hiddenTabId;
    } catch (_error) {
      hiddenTabId = null;
    }
  }

  const tab = await chrome.tabs.create({
    url,
    active: false,
  });

  if (typeof tab.id !== "number") {
    throw new Error("Chrome did not create the hidden Sora tab.");
  }

  hiddenTabId = tab.id;
  await waitForTabComplete(hiddenTabId);
  return hiddenTabId;
}

async function cleanupHiddenTab() {
  if (hiddenTabId === null) {
    return;
  }

  const tabId = hiddenTabId;
  hiddenTabId = null;

  try {
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    // Ignore cleanup failures if the tab was already closed.
  }
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
      reject(new Error("Timed out waiting for the Sora tab to finish loading."));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    }

    function handleUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete" || resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve();
    }

    function handleRemoved(removedTabId) {
      if (removedTabId !== tabId || resolved) {
        return;
      }
      resolved = true;
      cleanup();
      reject(new Error("The hidden Sora tab was closed before it finished loading."));
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
  });
}

async function downloadItemWithRetry(item) {
  let lastError = null;
  let candidate = item;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (attempt === 1) {
        await setState({
          message: `Refreshing ${item.id} after a failed download...`,
          currentSource: item.sourcePage,
        }, { persist: false });
        candidate = await refreshDownloadUrl(item);
      }

      await startDownloadAndWait(candidate);
      return;
    } catch (error) {
      if (isControlError(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error(`Could not download ${item.filename}.`);
}

function matchesRefreshTarget(candidate, item) {
  return Boolean(
    candidate &&
      item &&
      candidate.id === item.id &&
      candidate.attachmentIndex === item.attachmentIndex &&
      candidate.sourceType === item.sourceType,
  );
}

async function refreshDownloadUrl(item) {
  if (item.sourcePage === "profile") {
    const refreshed = await fetchAllProfileItems();
    const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));
    if (!match) {
      throw new Error(`Could not refresh ${item.id} from your published feed.`);
    }
    return {
      ...item,
      downloadUrl: match.downloadUrl,
    };
  }

  if (item.sourcePage === "likes") {
    const refreshed = await fetchAllLikesItems();
    const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));

    if (!match) {
      throw new Error(`Could not refresh liked post ${item.id}.`);
    }

    return {
      ...item,
      downloadUrl: match.downloadUrl,
    };
  }

  if (item.sourcePage === "cameos") {
    const refreshed = await fetchAllCameoItems();
    const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));

    if (!match) {
      throw new Error(`Could not refresh cameo video ${item.id}.`);
    }

    return {
      ...item,
      downloadUrl: match.downloadUrl,
    };
  }

  if (item.sourcePage === "characters") {
    const refreshed = await fetchAllCharacterItems({
      characterAccounts: currentState.characterAccounts,
      selectedCharacterAccountIds: item.characterAccountId
        ? [item.characterAccountId]
        : currentState.selectedCharacterAccountIds,
    });
    const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));

    if (!match) {
      throw new Error(`Could not refresh character video ${item.id}.`);
    }

    return {
      ...item,
      downloadUrl: match.downloadUrl,
    };
  }

  const refreshed = await fetchAllDraftItems();
  const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));

  if (!match) {
    throw new Error(`Could not refresh draft ${item.id}.`);
  }

  return {
    ...item,
    downloadUrl: match.downloadUrl,
  };
}

async function startDownloadAndWait(item) {
  let downloadId;

  try {
    downloadId = await chrome.downloads.download({
      url: item.downloadUrl,
      filename: item.filename,
      saveAs: false,
      conflictAction: "uniquify",
    });
  } catch (error) {
    throw new Error(`Chrome could not start ${item.filename}: ${getErrorMessage(error)}`);
  }

  if (typeof downloadId !== "number") {
    throw new Error(`Chrome did not provide a download id for ${item.filename}.`);
  }

  activeDownloadId = downloadId;

  try {
    await waitForDownloadCompletion(downloadId, item.filename);
  } finally {
    if (activeDownloadId === downloadId) {
      activeDownloadId = null;
    }
  }
}

async function waitForDownloadCompletion(downloadId, filename, timeoutMs = 300000) {
  await new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      chrome.downloads.onChanged.removeListener(handleChanged);
      reject(new Error(`Timed out while downloading ${filename}.`));
    }, timeoutMs);

    function finishSuccess() {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(handleChanged);
      resolve();
    }

    function finishFailure(reason) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(handleChanged);
      if (reason instanceof Error) {
        reject(reason);
        return;
      }
      reject(new Error(`${filename}: ${reason}`));
    }

    async function handleChanged(delta) {
      if (finished || delta.id !== downloadId || !delta.state) {
        return;
      }

      if (delta.state.current === "complete") {
        finishSuccess();
        return;
      }

      if (delta.state.current === "interrupted") {
        if (requestedControlAction === "pause") {
          finishFailure(createControlError("pause", "Download paused."));
          return;
        }

        if (requestedControlAction === "abort") {
          finishFailure(createControlError("abort", "Download aborted."));
          return;
        }

        let reason = delta.error && delta.error.current ? delta.error.current : "download interrupted";
        try {
          const [downloadItem] = await chrome.downloads.search({ id: downloadId });
          if (downloadItem && downloadItem.error) {
            reason = downloadItem.error;
          }
        } catch (_error) {
          // Ignore lookup errors and keep the current reason.
        }

        finishFailure(reason);
      }
    }

    chrome.downloads.onChanged.addListener(handleChanged);

    void chrome.downloads
      .search({ id: downloadId })
      .then(([downloadItem]) => {
        if (!downloadItem || finished) {
          return;
        }

        if (downloadItem.state === "complete") {
          finishSuccess();
          return;
        }

        if (downloadItem.state === "interrupted") {
          if (requestedControlAction === "pause") {
            finishFailure(createControlError("pause", "Download paused."));
            return;
          }

          if (requestedControlAction === "abort") {
            finishFailure(createControlError("abort", "Download aborted."));
            return;
          }

          finishFailure(downloadItem.error || "download interrupted");
        }
      })
      .catch(() => {
        // Ignore lookup errors and continue waiting for the download listener.
      });
  });
}

function stripFailureError(item) {
  const { error: _error, ...rest } = item;
  return rest;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function injectedFetchSource(config) {
  // This function is serialized and executed inside the Sora page with chrome.scripting.
  // It must stay self-contained because it does not share lexical scope with the service
  // worker once Chrome injects it into the tab.
  return (async () => {
    const source = config && config.source;
    const options = (config && config.options) || {};

    function sanitizeFilenamePart(value) {
      if (typeof value !== "string") {
        return "";
      }

      return value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    }

    function buildFilename(baseName, attachmentIndex, attachmentCount) {
      const safeBaseName = sanitizeFilenamePart(baseName) || "video";
      return attachmentCount > 1
        ? `${safeBaseName}-${attachmentIndex + 1}.mp4`
        : `${safeBaseName}.mp4`;
    }

    function getCookieValue(name) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
      return match ? decodeURIComponent(match[1]) : null;
    }

    function normalizeTokenString(value) {
      if (typeof value !== "string") {
        return null;
      }

      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      return trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
    }

    function isLikelyAccessToken(value, keyName = "") {
      if (typeof value !== "string") {
        return false;
      }

      const trimmed = value.trim();
      if (!trimmed || trimmed.length < 32) {
        return false;
      }

      if (/token|auth|bearer|jwt/i.test(keyName)) {
        return true;
      }

      return /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(trimmed);
    }

    function findTokenInObject(input, depth = 0, keyName = "") {
      if (depth > 5 || input == null) {
        return null;
      }

      if (typeof input === "string") {
        return isLikelyAccessToken(input, keyName) ? normalizeTokenString(input) : null;
      }

      if (Array.isArray(input)) {
        for (const entry of input) {
          const match = findTokenInObject(entry, depth + 1, keyName);
          if (match) {
            return match;
          }
        }
        return null;
      }

      if (typeof input !== "object") {
        return null;
      }

      const priorityKeys = [
        "accessToken",
        "access_token",
        "token",
        "bearer",
        "jwt",
        "idToken",
        "id_token",
      ];

      for (const candidateKey of priorityKeys) {
        if (candidateKey in input) {
          const match = findTokenInObject(input[candidateKey], depth + 1, candidateKey);
          if (match) {
            return match;
          }
        }
      }

      for (const [entryKey, entryValue] of Object.entries(input)) {
        const match = findTokenInObject(entryValue, depth + 1, entryKey);
        if (match) {
          return match;
        }
      }

      return null;
    }

    function findTokenInWebStorage(storage) {
      if (!storage) {
        return null;
      }

      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key) {
          continue;
        }

        let rawValue;
        try {
          rawValue = storage.getItem(key);
        } catch (_error) {
          continue;
        }

        if (!rawValue) {
          continue;
        }

        const directMatch = isLikelyAccessToken(rawValue, key) ? normalizeTokenString(rawValue) : null;
        if (directMatch) {
          return directMatch;
        }

        try {
          const parsed = JSON.parse(rawValue);
          const nestedMatch = findTokenInObject(parsed, 0, key);
          if (nestedMatch) {
            return nestedMatch;
          }
        } catch (_error) {
          // Ignore non-JSON storage values.
        }
      }

      return null;
    }

    function decodeJwtPayload(token) {
      if (typeof token !== "string") {
        return null;
      }

      const parts = token.split(".");
      if (parts.length < 2 || !parts[1]) {
        return null;
      }

      try {
        const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
        return JSON.parse(atob(padded));
      } catch (_error) {
        return null;
      }
    }

    function findViewerUserIdFromPayload(payload, depth = 0, keyName = "") {
      if (depth > 5 || payload == null) {
        return null;
      }

      if (typeof payload === "string") {
        if ((/user_?id/i.test(keyName) || /chatgpt_?user_?id/i.test(keyName)) && /^user-[A-Za-z0-9_-]+$/.test(payload)) {
          return payload;
        }
        return null;
      }

      if (Array.isArray(payload)) {
        for (const value of payload) {
          const match = findViewerUserIdFromPayload(value, depth + 1, keyName);
          if (match) {
            return match;
          }
        }
        return null;
      }

      if (typeof payload !== "object") {
        return null;
      }

      const priorityKeys = ["user_id", "userId", "chatgpt_user_id", "chatgptUserId"];
      for (const candidateKey of priorityKeys) {
        if (candidateKey in payload) {
          const match = findViewerUserIdFromPayload(payload[candidateKey], depth + 1, candidateKey);
          if (match) {
            return match;
          }
        }
      }

      for (const [entryKey, entryValue] of Object.entries(payload)) {
        const match = findViewerUserIdFromPayload(entryValue, depth + 1, entryKey);
        if (match) {
          return match;
        }
      }

      return null;
    }

    async function deriveAuthContext() {
      // Save Sora does not ask the user for credentials or ship tokens anywhere else.
      // Instead, the injected code derives the auth context already present in the user's
      // own signed-in Sora tab and uses it only for the in-page fetches needed to list the
      // user's downloadable items.
      const deviceId = getCookieValue("oai-did");
      const language = navigator.language || "en-US";
      const attempts = [];

      async function trySessionEndpoint(url) {
        attempts.push(url);
        try {
          const response = await fetch(url, {
            credentials: "include",
            headers: {
              accept: "application/json, text/plain, */*",
            },
          });

          if (!response.ok) {
            return null;
          }

          const payload = await response.json();
          return findTokenInObject(payload, 0, url);
        } catch (_error) {
          return null;
        }
      }

      const sessionToken =
        (await trySessionEndpoint("/api/auth/session")) ||
        (await trySessionEndpoint("/auth/session"));

      const storageToken =
        sessionToken ||
        findTokenInWebStorage(globalThis.sessionStorage) ||
        findTokenInWebStorage(globalThis.localStorage) ||
        findTokenInObject(globalThis.__NEXT_DATA__, 0, "__NEXT_DATA__");

      if (!storageToken) {
        throw new Error(
          `Could not derive a Sora bearer token from the signed-in browser session. Tried ${attempts.join(
            ", ",
          )}, sessionStorage, localStorage, and __NEXT_DATA__.`,
        );
      }

      return {
        token: storageToken,
        deviceId,
        language,
      };
    }

    function deriveViewerUserId(authContext) {
      const tokenPayload = decodeJwtPayload(authContext && authContext.token);
      const authClaims =
        tokenPayload &&
        tokenPayload["https://api.openai.com/auth"] &&
        typeof tokenPayload["https://api.openai.com/auth"] === "object"
          ? tokenPayload["https://api.openai.com/auth"]
          : null;

      const tokenUserId = pickFirstString([
        authClaims && authClaims.user_id,
        authClaims && authClaims.chatgpt_user_id,
        tokenPayload && tokenPayload.user_id,
        tokenPayload && tokenPayload.chatgpt_user_id,
      ]);

      if (typeof tokenUserId === "string" && /^user-[A-Za-z0-9_-]+$/.test(tokenUserId)) {
        return tokenUserId;
      }

      const nextDataUserId = findViewerUserIdFromPayload(globalThis.__NEXT_DATA__, 0, "__NEXT_DATA__");
      if (nextDataUserId) {
        return nextDataUserId;
      }

      throw new Error("Could not derive your Sora user id from the signed-in browser session.");
    }

    async function fetchJson(relativeUrl) {
      // All Sora API reads happen from inside the Sora tab so requests inherit the user's
      // current browser session and remain scoped to the declared host permissions.
      const authContext = await deriveAuthContext();
      const headers = {
        accept: "application/json, text/plain, */*",
        authorization: `Bearer ${authContext.token}`,
        "oai-language": authContext.language,
      };

      if (authContext.deviceId) {
        headers["oai-device-id"] = authContext.deviceId;
      }

      const response = await fetch(relativeUrl, {
        credentials: "include",
        headers,
      });

      const raw = await response.text();
      let data = null;

      try {
        data = JSON.parse(raw);
      } catch (_error) {
        throw new Error(
          "Sora returned a non-JSON response. Open Sora in this Chrome profile and make sure you're signed in.",
        );
      }

      if (!response.ok) {
        const message =
          (data && (data.message || (data.error && data.error.message))) ||
          `Sora request failed with status ${response.status}.`;
        throw new Error(message);
      }

      return data;
    }

    function pickFirstString(candidates) {
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate) {
          return candidate;
        }
      }

      return null;
    }

    function pickFirstArray(candidates) {
      for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length) {
          return candidate;
        }
      }

      return [];
    }

    function getThumbnailUrl(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      return pickFirstString([
        value.thumbnail_url,
        value.thumbnailUrl,
        value.preview_image_url,
        value.previewImageUrl,
        value.cover_photo_url,
        value.coverPhotoUrl,
        value.poster_url,
        value.posterUrl,
        value.image_url,
        value.imageUrl,
        value.encodings &&
        value.encodings.thumbnail &&
        typeof value.encodings.thumbnail.path === "string"
          ? value.encodings.thumbnail.path
          : null,
      ]);
    }

    function getDurationSeconds(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const candidates = [
        value.duration_s,
        value.durationSecs,
        value.duration_secs,
        value.durationSeconds,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          return candidate;
        }
      }

      return null;
    }

    function getFileSizeBytes(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      return pickFirstNumber([
        value.size,
        value.file_size,
        value.fileSize,
        value.encodings &&
        value.encodings.source &&
        typeof value.encodings.source.size === "number"
          ? value.encodings.source.size
          : null,
        value.encodings &&
        value.encodings.source_wm &&
        typeof value.encodings.source_wm.size === "number"
          ? value.encodings.source_wm.size
          : null,
        value.encodings &&
        value.encodings.md &&
        typeof value.encodings.md.size === "number"
          ? value.encodings.md.size
          : null,
        value.encodings &&
        value.encodings.ld &&
        typeof value.encodings.ld.size === "number"
          ? value.encodings.ld.size
          : null,
        value.output && typeof value.output.size === "number" ? value.output.size : null,
        value.draft && typeof value.draft.size === "number" ? value.draft.size : null,
        value.item && typeof value.item.size === "number" ? value.item.size : null,
        value.data && typeof value.data.size === "number" ? value.data.size : null,
      ]);
    }

    function formatFileSize(value) {
      const bytes = Number(value);
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return null;
      }

      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = bytes;
      let unitIndex = 0;

      while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
      }

      const rounded = size >= 100 || unitIndex === 0 ? Math.round(size) : Number(size.toFixed(1));
      return `${rounded} ${units[unitIndex]}`;
    }

    function pickFirstNumber(candidates) {
      for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          return candidate;
        }
      }

      return null;
    }

    function pickFirstBoolean(candidates) {
      for (const candidate of candidates) {
        if (typeof candidate === "boolean") {
          return candidate;
        }
      }

      return null;
    }

    function compactMetadataEntries(entries) {
      return entries
        .filter((entry) => entry && entry.label && entry.value !== null && entry.value !== undefined && entry.value !== "")
        .map((entry) => ({
          label: entry.label,
          value: entry.value,
          type: entry.type === "link" ? "link" : "text",
        }));
    }

    function getDownloadUrl(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const attachments = Array.isArray(value.attachments) ? value.attachments : [];
      const nested = [
        value.output,
        value.result,
        value.generation,
        value.draft,
        value.item,
        value.data,
        value.asset,
      ].filter(Boolean);

      return pickFirstString([
        value.downloadable_url,
        value.downloadUrl,
        value.download_urls && value.download_urls.no_watermark,
        value.download_urls && value.download_urls.watermark,
        value.download_urls && value.download_urls.endcard_watermark,
        ...attachments.flatMap((attachment) => [
          attachment && attachment.downloadable_url,
          attachment && attachment.downloadUrl,
          attachment && attachment.download_urls && attachment.download_urls.no_watermark,
          attachment && attachment.download_urls && attachment.download_urls.watermark,
        ]),
        ...nested.flatMap((candidate) => [
          candidate && candidate.downloadable_url,
          candidate && candidate.downloadUrl,
          candidate && candidate.download_urls && candidate.download_urls.no_watermark,
          candidate && candidate.download_urls && candidate.download_urls.watermark,
          candidate && candidate.download_urls && candidate.download_urls.endcard_watermark,
        ]),
      ]);
    }

    function isDirectMediaUrl(value) {
      return typeof value === "string" && /(?:videos\.openai\.com|\/az\/files\/|\/drvs\/)/i.test(value);
    }

    function getDirectMediaUrl(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      const nested = [
        value.output,
        value.result,
        value.generation,
        value.draft,
        value.item,
        value.data,
        value.asset,
      ].filter(Boolean);
      const candidates = [
        value.url,
        value.encodings && value.encodings.md && value.encodings.md.path,
        value.encodings && value.encodings.source && value.encodings.source.path,
        value.encodings && value.encodings.ld && value.encodings.ld.path,
        ...nested.flatMap((candidate) => [
          candidate && candidate.url,
          candidate && candidate.encodings && candidate.encodings.md && candidate.encodings.md.path,
          candidate && candidate.encodings && candidate.encodings.source && candidate.encodings.source.path,
          candidate && candidate.encodings && candidate.encodings.ld && candidate.encodings.ld.path,
        ]),
      ];

      for (const candidate of candidates) {
        if (isDirectMediaUrl(candidate)) {
          return candidate;
        }
      }

      return null;
    }

    function getDraftRows(payload) {
      if (Array.isArray(payload)) {
        return payload;
      }

      return pickFirstArray([
        payload && payload.items,
        payload && payload.data,
        payload && payload.results,
        payload && payload.drafts,
      ]);
    }

    function getDraftId(row) {
      return pickFirstString([
        row && row.id,
        row && row.generation_id,
        row && row.generationId,
        row && row.output && row.output.id,
        row && row.output && row.output.generation_id,
        row && row.output && row.output.generationId,
        row && row.draft && row.draft.id,
        row && row.draft && row.draft.generation_id,
        row && row.item && row.item.id,
        row && row.data && row.data.id,
      ]);
    }

    function getDraftKind(row) {
      return pickFirstString([
        row && row.kind,
        row && row.type,
        row && row.draft && row.draft.kind,
        row && row.item && row.item.kind,
        row && row.data && row.data.kind,
      ]);
    }

    function getDraftDiscoveryPhrase(row) {
      return pickFirstString([
        row && row.discovery_phrase,
        row && row.discoveryPhrase,
        row && row.draft && row.draft.discovery_phrase,
        row && row.draft && row.draft.discoveryPhrase,
        row && row.item && row.item.discovery_phrase,
        row && row.item && row.item.discoveryPhrase,
        row && row.data && row.data.discovery_phrase,
        row && row.data && row.data.discoveryPhrase,
        row && row.output && row.output.discovery_phrase,
        row && row.output && row.output.discoveryPhrase,
        row && row.creation_config && row.creation_config.discovery_phrase,
        row && row.creation_config && row.creation_config.discoveryPhrase,
      ]);
    }

    function normalizePostListingResponse(payload, config = {}) {
      const rows = Array.isArray(payload && payload.items) ? payload.items : [];
      const ids = [];
      const items = [];
      const sourcePage =
        pickFirstString([
          config && config.sourcePage,
        ]) || "profile";
      const sourceLabel =
        pickFirstString([
          config && config.sourceLabel,
        ]) ||
        (sourcePage === "likes"
          ? "Liked"
          : sourcePage === "cameos"
            ? "Cameo"
            : sourcePage === "characters"
              ? "Character"
              : "Published");
      const requireOwner = Boolean(config && config.requireOwner);

      for (const row of rows) {
        const post = row && row.post ? row.post : null;
        if (!post || typeof post.id !== "string" || (requireOwner && !post.is_owner)) {
          continue;
        }

        const attachments = Array.isArray(post.attachments)
          ? post.attachments.filter((attachment) => attachment && getDownloadUrl(attachment))
          : [];

        if (!attachments.length) {
          continue;
        }

        ids.push(post.id);

        attachments.forEach((attachment, attachmentIndex) => {
          const durationSeconds = getDurationSeconds(attachment) || null;
          const fileSizeBytes = getFileSizeBytes(attachment) || null;
          const downloadUrl = getDownloadUrl(attachment);
          const discoveryPhrase = pickFirstString([
            post.discovery_phrase,
            post.discoveryPhrase,
          ]);
          const preferredTitle = pickFirstString([
            discoveryPhrase,
            post.text,
            attachment.prompt,
            post.id,
          ]);
          items.push({
            id: post.id,
            sourcePage,
            sourceType: "post",
            detailUrl:
              typeof post.permalink === "string" && post.permalink
                ? post.permalink
                : `https://sora.chatgpt.com/p/${post.id}`,
            downloadUrl,
            filename: buildFilename(preferredTitle, attachmentIndex, attachments.length),
            thumbnailUrl:
              getThumbnailUrl(attachment) ||
              getThumbnailUrl(post) ||
              null,
            prompt:
              (typeof post.text === "string" && post.text) ||
              (typeof attachment.prompt === "string" && attachment.prompt) ||
              null,
            discoveryPhrase,
            createdAt: post.posted_at ?? post.updated_at ?? null,
            postedAt: post.posted_at ?? null,
            durationSeconds,
            fileSizeBytes,
            width: attachment.width ?? null,
            height: attachment.height ?? null,
            likeCount: post.like_count ?? null,
            viewCount: post.view_count ?? null,
            shareCount: post.share_count ?? null,
            repostCount: post.repost_count ?? null,
            remixCount: post.remix_count ?? null,
            attachmentIndex,
            attachmentCount: attachments.length,
            metadataEntries: compactMetadataEntries([
              { label: "Source", value: sourceLabel },
              { label: "Source Type", value: "post" },
              { label: "Post ID", value: post.id },
              { label: "Attachment ID", value: attachment.id },
              { label: "Generation ID", value: attachment.generation_id },
              { label: "Generation Type", value: attachment.generation_type },
              { label: "Attachment Kind", value: attachment.kind },
              { label: "Task ID", value: attachment.task_id },
              { label: "Width", value: attachment.width },
              { label: "Height", value: attachment.height },
              { label: "Duration (s)", value: durationSeconds },
              { label: "File Size", value: formatFileSize(fileSizeBytes) },
              { label: "File Size (bytes)", value: fileSizeBytes },
              { label: "Frames", value: attachment.n_frames },
              { label: "Posted At", value: post.posted_at ?? null },
              { label: "Updated At", value: post.updated_at ?? null },
              { label: "Likes", value: post.like_count },
              { label: "Replies", value: post.reply_count },
              { label: "Views", value: post.view_count },
              { label: "Unique Views", value: post.unique_view_count },
              { label: "Shares", value: post.share_count },
              { label: "Reposts", value: post.repost_count },
              { label: "Remixes", value: post.remix_count },
              { label: "Emoji", value: post.emoji },
              { label: "Discovery Phrase", value: discoveryPhrase },
              { label: "Has Captions", value: pickFirstBoolean([attachment.has_captions]) },
              { label: "Output Blocked", value: pickFirstBoolean([attachment.output_blocked]) },
              { label: "Can Create Cameo", value: pickFirstBoolean([attachment.can_create_character]) },
              {
                label: "Share Setting",
                value: post.permissions && typeof post.permissions.share_setting === "string"
                  ? post.permissions.share_setting
                  : null,
              },
              { label: "Detail URL", value: post.permalink, type: "link" },
              { label: "Download URL", value: downloadUrl, type: "link" },
              { label: "Thumbnail URL", value: getThumbnailUrl(attachment) || getThumbnailUrl(post), type: "link" },
              { label: "SRT URL", value: post.srt_url, type: "link" },
              { label: "VTT URL", value: post.vtt_url, type: "link" },
            ]),
          });
        });
      }

      return {
        ids: [...new Set(ids)],
        items,
        rowCount: rows.length,
        nextCursor: typeof payload.cursor === "string" && payload.cursor ? payload.cursor : null,
        partialWarning: "",
      };
    }

    function normalizeProfileResponse(payload) {
      return normalizePostListingResponse(payload, {
        sourcePage: "profile",
        requireOwner: true,
      });
    }

    function normalizeLikesResponse(payload) {
      return normalizePostListingResponse(payload, {
        sourcePage: "likes",
        sourceLabel: "Liked",
        requireOwner: false,
      });
    }

    function normalizeCharactersResponse(payload) {
      return normalizePostListingResponse(payload, {
        sourcePage: "cameos",
        sourceLabel: "Cameo",
        requireOwner: false,
      });
    }

    function normalizeCharacterAccountsIndexResponse(payload) {
      const rows = Array.isArray(payload && payload.items) ? payload.items : [];
      const accounts = rows
        .filter(
          (row) =>
            row &&
            typeof row.user_id === "string" &&
            row.user_id &&
            row.user_id.startsWith("ch_"),
        )
        .map((row) => ({
          userId: row.user_id,
          username: typeof row.username === "string" ? row.username : "",
          displayName:
            typeof row.display_name === "string" && row.display_name
              ? row.display_name
              : typeof row.username === "string" && row.username
                ? row.username
                : row.user_id,
          cameoCount: Number.isFinite(Number(row.cameo_count)) ? Number(row.cameo_count) : 0,
          permalink: typeof row.permalink === "string" ? row.permalink : null,
          profilePictureUrl:
            typeof row.profile_picture_url === "string" ? row.profile_picture_url : null,
        }));

      return {
        accounts,
        rowCount: rows.length,
        nextCursor: typeof payload.cursor === "string" && payload.cursor ? payload.cursor : null,
        partialWarning: "",
      };
    }

    async function fetchFirstSuccessfulJson(urls) {
      let lastError = null;

      for (const url of urls) {
        try {
          return await fetchJson(url);
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError || new Error("Sora did not return a valid response.");
    }

    function normalizeDraftResponse(payload, config = {}) {
      const rows = getDraftRows(payload);
      const ids = [];
      const items = [];
      const sourcePage =
        pickFirstString([
          config && config.sourcePage,
        ]) || "drafts";
      const sourceLabel =
        pickFirstString([
          config && config.sourceLabel,
        ]) || (sourcePage === "cameos" ? "Cameo" : sourcePage === "characters" ? "Character" : "Draft");
      const allowMediaUrlFallback = Boolean(config && config.allowMediaUrlFallback);

      for (const row of rows) {
        const kind = getDraftKind(row);
        const id = getDraftId(row);
        const downloadUrl = getDownloadUrl(row) || (allowMediaUrlFallback ? getDirectMediaUrl(row) : null);
        const durationSeconds =
          getDurationSeconds(row) ||
          (row.draft && getDurationSeconds(row.draft)) ||
          (row.item && getDurationSeconds(row.item)) ||
          (row.data && getDurationSeconds(row.data)) ||
          (row.output && getDurationSeconds(row.output)) ||
          null;
        const generationId = pickFirstString([
          row && row.generation_id,
          row && row.generationId,
          row && row.output && row.output.generation_id,
          row && row.output && row.output.generationId,
        ]);
        const generationType = pickFirstString([
          row && row.generation_type,
          row && row.generationType,
          row && row.output && row.output.generation_type,
          row && row.output && row.output.generationType,
        ]);
        const taskId = pickFirstString([
          row && row.task_id,
          row && row.taskId,
          row && row.output && row.output.task_id,
          row && row.output && row.output.taskId,
        ]);
        const width = pickFirstNumber([
          row && row.width,
          row && row.output && row.output.width,
          row && row.draft && row.draft.width,
          row && row.item && row.item.width,
          row && row.data && row.data.width,
        ]);
        const height = pickFirstNumber([
          row && row.height,
          row && row.output && row.output.height,
          row && row.draft && row.draft.height,
          row && row.item && row.item.height,
          row && row.data && row.data.height,
        ]);
        const frameCount = pickFirstNumber([
          row && row.n_frames,
          row && row.nFrames,
          row && row.output && row.output.n_frames,
          row && row.output && row.output.nFrames,
        ]);
        const fileSizeBytes =
          getFileSizeBytes(row) ||
          getFileSizeBytes(row.output) ||
          getFileSizeBytes(row.draft) ||
          getFileSizeBytes(row.item) ||
          getFileSizeBytes(row.data) ||
          null;
        const createdAt =
          row.created_at ??
          row.createdAt ??
          (row.draft && (row.draft.created_at ?? row.draft.createdAt)) ??
          (row.item && (row.item.created_at ?? row.item.createdAt)) ??
          (row.data && (row.data.created_at ?? row.data.createdAt)) ??
          null;
        const updatedAt =
          row.updated_at ??
          row.updatedAt ??
          (row.draft && (row.draft.updated_at ?? row.draft.updatedAt)) ??
          (row.item && (row.item.updated_at ?? row.item.updatedAt)) ??
          (row.data && (row.data.updated_at ?? row.data.updatedAt)) ??
          null;
        const thumbnailUrl =
          getThumbnailUrl(row) ||
          getThumbnailUrl(row.creation_config) ||
          getThumbnailUrl(row.draft) ||
          getThumbnailUrl(row.item) ||
          getThumbnailUrl(row.data) ||
          getThumbnailUrl(row.output) ||
          null;
        const hasCaptions = pickFirstBoolean([
          row && row.has_captions,
          row && row.output && row.output.has_captions,
        ]);
        const outputBlocked = pickFirstBoolean([
          row && row.output_blocked,
          row && row.output && row.output.output_blocked,
        ]);
        const detailUrl = getDraftDetailUrl(row, id, generationId);
        const discoveryPhrase = getDraftDiscoveryPhrase(row);
        const preferredTitle = pickFirstString([
          discoveryPhrase,
          row && row.prompt,
          row && row.draft && row.draft.prompt,
          row && row.item && row.item.prompt,
          row && row.data && row.data.prompt,
          row && row.creation_config && row.creation_config.prompt,
          id,
        ]);

        if (
          !row ||
          kind === "sora_error" ||
          (typeof kind === "string" && kind !== "sora_draft" && kind !== "draft") ||
          !downloadUrl ||
          typeof id !== "string"
        ) {
          continue;
        }

        ids.push(id);
        items.push({
          id,
          sourcePage,
          sourceType: "draft",
          detailUrl,
          downloadUrl,
          filename: buildFilename(preferredTitle, 0, 1),
          thumbnailUrl,
          prompt:
            (typeof row.prompt === "string" && row.prompt) ||
            (row.draft && typeof row.draft.prompt === "string" ? row.draft.prompt : null) ||
            (row.item && typeof row.item.prompt === "string" ? row.item.prompt : null) ||
            (row.data && typeof row.data.prompt === "string" ? row.data.prompt : null) ||
            (row.creation_config && typeof row.creation_config.prompt === "string"
              ? row.creation_config.prompt
              : null),
          discoveryPhrase,
          createdAt,
          postedAt: createdAt,
          generationId,
          durationSeconds,
          fileSizeBytes,
          width,
          height,
          likeCount: null,
          viewCount: null,
          shareCount: null,
          repostCount: null,
          remixCount: null,
          attachmentIndex: 0,
          metadataEntries: compactMetadataEntries([
            { label: "Source", value: sourceLabel },
            { label: "Source Type", value: "draft" },
            { label: "Draft ID", value: id },
            { label: "Kind", value: kind || null },
            { label: "Generation ID", value: generationId },
            { label: "Generation Type", value: generationType },
            { label: "Task ID", value: taskId },
            { label: "Width", value: width },
            { label: "Height", value: height },
            { label: "Duration (s)", value: durationSeconds },
            { label: "File Size", value: formatFileSize(fileSizeBytes) },
            { label: "File Size (bytes)", value: fileSizeBytes },
            { label: "Frames", value: frameCount },
            { label: "Created At", value: createdAt },
            { label: "Updated At", value: updatedAt },
            { label: "Discovery Phrase", value: discoveryPhrase },
            { label: "Has Captions", value: hasCaptions },
            { label: "Output Blocked", value: outputBlocked },
            { label: "Detail URL", value: detailUrl, type: "link" },
            { label: "Download URL", value: downloadUrl, type: "link" },
            { label: "Thumbnail URL", value: thumbnailUrl, type: "link" },
          ]),
      });
    }

      return {
        ids: [...new Set(ids)],
        items,
        rowCount: rows.length,
        nextCursor:
          pickFirstString([
            payload && payload.cursor,
            payload && payload.next_cursor,
            payload && payload.nextCursor,
            payload && payload.pagination && payload.pagination.cursor,
            payload && payload.pagination && payload.pagination.next_cursor,
            payload && payload.pagination && payload.pagination.nextCursor,
          ]) || null,
        partialWarning: "",
      };
    }

    function getDraftDetailUrl(row, id, generationId) {
      const directUrl = pickFirstString([
        row && row.permalink,
        row && row.detail_url,
        row && row.detailUrl,
        row && row.share_url,
        row && row.shareUrl,
        row && row.public_url,
        row && row.publicUrl,
        row && row.url,
        row && row.draft && row.draft.permalink,
        row && row.draft && row.draft.detail_url,
        row && row.draft && row.draft.detailUrl,
        row && row.draft && row.draft.share_url,
        row && row.draft && row.draft.shareUrl,
        row && row.item && row.item.permalink,
        row && row.item && row.item.detail_url,
        row && row.item && row.item.detailUrl,
        row && row.data && row.data.permalink,
        row && row.data && row.data.detail_url,
        row && row.data && row.data.detailUrl,
      ]);

      if (directUrl) {
        return directUrl.startsWith("/") ? new URL(directUrl, window.location.origin).toString() : directUrl;
      }

      if (typeof id === "string" && id.startsWith("s_")) {
        return `${window.location.origin}/p/${id}`;
      }

      if (typeof generationId === "string" && generationId.startsWith("s_")) {
        return `${window.location.origin}/p/${generationId}`;
      }

      if (typeof generationId === "string" && generationId.startsWith("gen_")) {
        return `${window.location.origin}/d/${generationId}`;
      }

      if (typeof id === "string" && id.startsWith("gen_")) {
        return `${window.location.origin}/d/${id}`;
      }

      return null;
    }

    try {
      if (source === "profile") {
        const limit = Number(options.limit) || 100;
        const cut = typeof options.cut === "string" && options.cut ? options.cut : "nf2";
        const url = new URL("/backend/project_y/profile_feed/me", window.location.origin);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("cut", cut);
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeProfileResponse(payload);
      }

      if (source === "drafts") {
        const limit = Number(options.limit) || 100;
        const url = new URL("/backend/project_y/profile/drafts/v2", window.location.origin);
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        if (Number.isFinite(Number(options.offset)) && Number(options.offset) > 0) {
          url.searchParams.set("offset", String(Math.floor(Number(options.offset))));
        }
        const payload = await fetchJson(url);
        return normalizeDraftResponse(payload, {
          sourcePage: "drafts",
          sourceLabel: "Draft",
        });
      }

      if (source === "likes") {
        const authContext = await deriveAuthContext();
        const userId = deriveViewerUserId(authContext);
        const limit = Number(options.limit) || 100;
        const url = new URL(
          `/backend/project_y/profile/${encodeURIComponent(userId)}/post_listing/likes`,
          window.location.origin,
        );
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeLikesResponse(payload);
      }

      if (source === "characters") {
        const limit = Number(options.limit) || 100;
        const cut = typeof options.cut === "string" && options.cut ? options.cut : "appearances";
        const url = new URL("/backend/project_y/profile_feed/me", window.location.origin);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("cut", cut);
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeCharactersResponse(payload);
      }

      if (source === "characterDrafts") {
        const limit = Number(options.limit) || 100;
        const url = new URL("/backend/project_y/profile/drafts/cameos", window.location.origin);
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeDraftResponse(payload, {
          sourcePage: "cameos",
          sourceLabel: "Cameo",
          allowMediaUrlFallback: true,
        });
      }

      if (source === "characterProfiles") {
        const authContext = await deriveAuthContext();
        const viewerUserId = deriveViewerUserId(authContext);
        const limit = Number(options.limit) || 100;
        const url = new URL(
          `/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`,
          window.location.origin,
        );
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeCharacterAccountsIndexResponse(payload);
      }

      if (source === "characterAccountPosts") {
        const characterId =
          typeof options.characterId === "string" && options.characterId ? options.characterId : "";
        if (!characterId) {
          throw new Error("A character account id is required to fetch proxy-account posts.");
        }

        const limit = Number(options.limit) || 100;
        const candidateUrls = [];
        const listingCandidates = ["posts", "profile", "public"];

        for (const listingName of listingCandidates) {
          const url = new URL(
            `/backend/project_y/profile/${encodeURIComponent(characterId)}/post_listing/${listingName}`,
            window.location.origin,
          );
          url.searchParams.set("limit", String(limit));
          if (typeof options.cursor === "string" && options.cursor) {
            url.searchParams.set("cursor", options.cursor);
          }
          candidateUrls.push(url.toString());
        }

        const feedUrl = new URL(
          `/backend/project_y/profile_feed/${encodeURIComponent(characterId)}`,
          window.location.origin,
        );
        feedUrl.searchParams.set("limit", String(limit));
        feedUrl.searchParams.set("cut", "nf2");
        if (typeof options.cursor === "string" && options.cursor) {
          feedUrl.searchParams.set("cursor", options.cursor);
        }
        candidateUrls.push(feedUrl.toString());

        const payload = await fetchFirstSuccessfulJson(candidateUrls);
        return normalizePostListingResponse(payload, {
          sourcePage: "characters",
          sourceLabel: "Character",
          requireOwner: false,
        });
      }

      if (source === "characterAccountDrafts") {
        const characterId =
          typeof options.characterId === "string" && options.characterId ? options.characterId : "";
        if (!characterId) {
          throw new Error("A character account id is required to fetch proxy-account drafts.");
        }

        const limit = Number(options.limit) || 100;
        const url = new URL(
          `/backend/project_y/profile/drafts/cameos/character/${encodeURIComponent(characterId)}`,
          window.location.origin,
        );
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeDraftResponse(payload, {
          sourcePage: "characters",
          sourceLabel: "Character",
          allowMediaUrlFallback: true,
        });
      }

      throw new Error(`Unsupported source: ${String(source)}`);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
}
