// Save Sora background service worker.
// This is the privileged side of the extension: it owns persistent state, opens the
// hidden Sora tab used for collection, injects packaged code into that tab, assembles
// the final ZIP archive through an offscreen document, and saves the completed archive
// through chrome.downloads.
const STATE_KEY = "soraBulkDownloaderState";
const CATALOG_STORAGE_KEY = "soraBulkDownloaderCatalog";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const OFFSCREEN_TARGET = "offscreen";
const START_ARCHIVE_BUILD = "START_ARCHIVE_BUILD";
const ABORT_ARCHIVE_BUILD = "ABORT_ARCHIVE_BUILD";
const RELEASE_ARCHIVE_OBJECT_URL = "RELEASE_ARCHIVE_OBJECT_URL";
const PROFILE_LIMIT = 100;
const CREATOR_PROFILE_FEED_LIMIT = 8;
const CREATOR_PROFILE_FEED_MIN_PAGE_CAP = 250;
const CREATOR_PROFILE_FEED_PAGE_BUFFER = 50;
const CREATOR_PROFILE_FEED_MAX_PAGE_CAP = 50000;
const POPUP_STATE_ITEM_LIMIT = 3000;
const POPUP_STATE_TARGET_BYTES = 8 * 1024 * 1024;
const VOLATILE_SOURCE_PREVIEW_LIMIT = 3000;
const VOLATILE_BACKUP_DB_NAME = "saveSoraVolatileBackup";
const VOLATILE_BACKUP_DB_VERSION = 3;
const VOLATILE_BACKUP_ITEM_STORE = "items";
const VOLATILE_BACKUP_META_STORE = "meta";
const VOLATILE_BACKUP_UPDATER_STORE = "updater";
const VOLATILE_BACKUP_WRITE_CHUNK_SIZE = 250;
const UPDATE_ALARM_NAME = "saveSoraCheckForUpdates";
const UPDATE_CHECK_INTERVAL_MINUTES = 30;
const GITHUB_OWNER = "alpha1337";
const GITHUB_REPO = "save-sora";
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=12`;
const UPDATE_MANIFEST_ASSET_NAME = "save-sora-update-manifest.json";
const UPDATE_FOLDER_RECORD_KEY = "install-folder";
const UPDATE_META_RECORD_KEY = "updater-meta";
const UPDATE_PENDING_RECORD_KEY = "pending-update";
const UPDATE_ROLLBACK_RECORD_KEY = "rollback-snapshot";
const UPDATE_MANAGED_ROOT_ENTRIES = [
  "assets",
  "background.js",
  "manifest.json",
  "offscreen.html",
  "offscreen.js",
  "popup",
  "popup.css",
  "popup.html",
  "popup.js",
  "vendor",
];
const CURRENT_EXTENSION_MANIFEST = chrome.runtime.getManifest();
const CURRENT_EXTENSION_VERSION =
  CURRENT_EXTENSION_MANIFEST && typeof CURRENT_EXTENSION_MANIFEST.version === "string"
    ? CURRENT_EXTENSION_MANIFEST.version
    : "0.0.0";
const CURRENT_EXTENSION_NAME =
  CURRENT_EXTENSION_MANIFEST && typeof CURRENT_EXTENSION_MANIFEST.name === "string"
    ? CURRENT_EXTENSION_MANIFEST.name
    : "Save Sora: Sora Bulk Downloader";
const DRAFT_BATCH_LIMIT = 100;
const LIKES_BATCH_LIMIT = 100;
const CHARACTERS_BATCH_LIMIT = 100;
const CHARACTER_ACCOUNT_LIMIT = 100;
const DOWNLOAD_PROGRESS_PERSIST_INTERVAL = 25;
const CATALOG_FULL_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 6;
const CREATOR_SOURCE_SELECTION_SIGNATURE_VERSION = "creator-feed-v13";
const FETCH_OPENING_PROGRESS_RATIO = 0.04;
const FETCH_SOURCE_PROGRESS_RATIO = 0.74;
const FETCH_PROCESSING_PROGRESS_RATIO = 0.22;
const FETCH_PROCESSING_STEP_COUNT = 2;
const FETCH_PROGRESS_CHUNK_SIZE = 250;
const AVAILABLE_SOURCE_VALUES = [
  "profile",
  "drafts",
  "likes",
  "characters",
  "characterAccounts",
  "creators",
];
const DEFAULT_SOURCE_VALUES = [];
const SOURCE_ROUTES = {
  profile: "https://sora.chatgpt.com/profile",
  drafts: "https://sora.chatgpt.com/drafts",
  likes: "https://sora.chatgpt.com/profile",
  characters: "https://sora.chatgpt.com/profile",
  characterAccounts: "https://sora.chatgpt.com/profile",
  creators: "https://sora.chatgpt.com/profile",
  characterDrafts: "https://sora.chatgpt.com/profile",
  characterProfiles: "https://sora.chatgpt.com/profile",
  characterAccountPosts: "https://sora.chatgpt.com/profile",
  characterAccountAppearances: "https://sora.chatgpt.com/profile",
  characterAccountDrafts: "https://sora.chatgpt.com/profile",
  creatorProfileLookup: "https://sora.chatgpt.com/profile",
  creatorPublished: "https://sora.chatgpt.com/profile",
  creatorCameos: "https://sora.chatgpt.com/profile",
  creatorCharacters: "https://sora.chatgpt.com/profile",
};

let currentState = createDefaultState();
let currentCatalog = createDefaultCatalogState();
let hiddenTabId = null;
let activeRun = null;
let activeDownloadId = null;
let activeArchiveJob = null;
let creatingOffscreenDocument = null;
let requestedControlAction = null;
let keepAwakeRequested = false;
let volatileBackupDbPromise = null;
let activeVolatileBackupSessionKey = "";
let activeVolatileBackupResumeMeta = null;
let pausedFetchRequest = null;
let currentUpdateState = createDefaultUpdateState();
let linkedInstallFolderRecordCache = null;
let updaterReadyPromise = null;
let zipLibraryLoaded = false;

initializeZipLibrary();

void initializeBackgroundRuntime();

chrome.runtime.onInstalled.addListener(() => {
  void persistState();
  void persistCatalogState();
  void scheduleUpdateAlarm();
  void restoreUpdaterState();
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleUpdateAlarm();
  void restoreUpdaterState();
  void runUpdateCheck({ trigger: "startup", interactive: false, applyIfAvailable: false }).catch((error) => {
    console.warn("Failed to check for updates during startup.", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== UPDATE_ALARM_NAME) {
    return;
  }

  void runUpdateCheck({ trigger: "alarm", interactive: false, applyIfAvailable: false }).catch((error) => {
    console.warn("Failed to check for updates from the scheduled alarm.", error);
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    sendResponse({ ok: false, error: "Unknown message." });
    return false;
  }

  if (message.type === "OFFSCREEN_ARCHIVE_STAGE") {
    void handleOffscreenArchiveStage(message)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_ARCHIVE_ITEM_RESULT") {
    void handleOffscreenArchiveItemResult(message)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_ARCHIVE_COMPLETE") {
    void handleOffscreenArchiveComplete(message)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "OFFSCREEN_ARCHIVE_ERROR") {
    void handleOffscreenArchiveError(message)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "REFRESH_ARCHIVE_ITEM_URL") {
    void refreshArchiveItemUrl(message.itemKey)
      .then((item) => {
        sendResponse({ ok: true, item });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "GET_STATUS") {
    sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
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

  if (message.type === "PAUSE_SCAN") {
    if (currentState.phase !== "fetching") {
      sendResponse({ ok: false, error: "There is no active fetch to pause." });
      return false;
    }

    void requestScanPause()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to pause the Sora fetch.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "RESUME_SCAN") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    if (currentState.phase !== "fetch-paused" || !pausedFetchRequest) {
      sendResponse({ ok: false, error: "There is no paused fetch to resume." });
      return false;
    }

    void resumeScan()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to resume the Sora fetch.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "ABORT_SCAN") {
    if (currentState.phase !== "fetching" && currentState.phase !== "fetch-paused") {
      sendResponse({ ok: false, error: "There is no active fetch to cancel." });
      return false;
    }

    if (currentState.phase === "fetch-paused") {
      void abortPausedScan()
        .then(() => {
          sendResponse({ ok: true });
        })
        .catch((error) => {
          console.error("Failed to abort the paused Sora fetch.", error);
          sendResponse({ ok: false, error: getErrorMessage(error) });
        });
      return true;
    }

    void requestScanAbort()
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("Failed to abort the Sora fetch.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
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
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
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
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
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
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
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

  if (message.type === "GET_UPDATE_STATUS") {
    sendResponse({ ok: true, updateStatus: buildUpdateStatusSnapshot() });
    return false;
  }

  if (message.type === "CHECK_FOR_UPDATES") {
    void runUpdateCheck({
      trigger: typeof message.trigger === "string" ? message.trigger : "popup",
      interactive: message.interactive !== false,
      applyIfAvailable: message.applyIfAvailable !== false,
    })
      .then((updateStatus) => {
        sendResponse({ ok: true, updateStatus });
      })
      .catch((error) => {
        console.error("Failed to check for Save Sora updates.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "LINK_INSTALL_FOLDER") {
    void linkInstallFolder(message.handle)
      .then((updateStatus) => {
        sendResponse({ ok: true, updateStatus });
      })
      .catch((error) => {
        console.error("Failed to link the unpacked extension folder.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "INSTALL_PENDING_UPDATE") {
    void installPendingUpdate()
      .then((updateStatus) => {
        sendResponse({ ok: true, updateStatus });
      })
      .catch((error) => {
        console.error("Failed to install the pending Save Sora update.", error);
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
          state: buildPopupStateSnapshot(currentState),
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
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to update the character selection.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "ADD_CREATOR_PROFILE") {
    if (typeof message.profileUrl !== "string" || !message.profileUrl.trim()) {
      sendResponse({ ok: false, error: "Paste a valid Sora creator username or profile link." });
      return false;
    }

    void addCreatorProfile(message.profileUrl)
      .then((creatorProfile) => {
        sendResponse({ ok: true, creatorProfile, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to add the creator profile.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "ADD_CREATOR_PROFILES") {
    if (!Array.isArray(message.profileUrls) || message.profileUrls.length === 0) {
      sendResponse({ ok: false, error: "Paste at least one Sora creator username or profile link." });
      return false;
    }

    void addCreatorProfiles(message.profileUrls)
      .then((result) => {
        sendResponse({ ok: true, ...result, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to add creator profiles.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "REMOVE_CREATOR_PROFILE") {
    if (typeof message.creatorProfileId !== "string" || !message.creatorProfileId) {
      sendResponse({ ok: false, error: "A valid creator profile id is required." });
      return false;
    }

    void removeCreatorProfile(message.creatorProfileId)
      .then(() => {
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to remove the creator profile.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_CREATOR_SELECTION") {
    if (!Array.isArray(message.selectedCreatorProfileIds)) {
      sendResponse({ ok: false, error: "The creator selection payload must be an array." });
      return false;
    }

    void setSelectedCreatorProfileIds(message.selectedCreatorProfileIds)
      .then(() => {
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to update the creator selection.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "SET_CREATOR_PROFILE_PREFERENCES") {
    if (typeof message.creatorProfileId !== "string" || !message.creatorProfileId) {
      sendResponse({ ok: false, error: "A valid creator profile id is required." });
      return false;
    }

    if (!message.preferences || typeof message.preferences !== "object") {
      sendResponse({ ok: false, error: "Valid creator fetch preferences are required." });
      return false;
    }

    void setCreatorProfilePreferences(message.creatorProfileId, message.preferences)
      .then((creatorProfile) => {
        sendResponse({ ok: true, creatorProfile, state: buildPopupStateSnapshot(currentState) });
      })
      .catch((error) => {
        console.error("Failed to update the creator profile preferences.", error);
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });
    return true;
  }

  if (message.type === "DOWNLOAD_SELECTED") {
    if (activeRun) {
      sendResponse({ ok: false, error: "A fetch or download run is already in progress." });
      return false;
    }

    if (currentState.phase === "fetch-paused") {
      sendResponse({ ok: false, error: "Resume or cancel the paused fetch before downloading." });
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
        sendResponse({ ok: true, state: buildPopupStateSnapshot(currentState) });
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
    backedUpItemCount: 0,
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
    creatorIds: [],
    characterAccounts: [],
    selectedCharacterAccountIds: [],
    hasExplicitCharacterAccountSelection: true,
    creatorProfiles: [],
    selectedCreatorProfileIds: [],
    hasExplicitCreatorProfileSelection: true,
    items: [],
    selectedKeys: [],
    titleOverrides: {},
    pendingItems: [],
    runMode: null,
    runTotal: 0,
    failedItems: [],
    fetchProgress: createDefaultFetchProgress(),
    settings: {
      maxVideos: null,
      defaultSource: [...DEFAULT_SOURCE_VALUES],
      defaultSort: "newest",
      theme: "dark",
      automaticUpdatesEnabled: true,
    },
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function createDefaultUpdateState(overrides = {}) {
  return {
    phase: "idle",
    currentVersion: CURRENT_EXTENSION_VERSION,
    latestVersion: CURRENT_EXTENSION_VERSION,
    latestGitHubVersion: "",
    latestManifestDetected: false,
    latestZipDetected: false,
    message: "",
    detail: "",
    progress: 0,
    lastCheckedAt: null,
    installFolderLinked: false,
    automaticUpdatesEnabled: true,
    updateAvailable: false,
    pendingUpdateVersion: "",
    pendingUpdateUrl: "",
    pendingReleaseUrl: "",
    pendingManifestUrl: "",
    pendingManagedFiles: [],
    changelogMarkdown: "",
    pendingDeferred: false,
    pendingUpdateReady: false,
    error: "",
    ...overrides,
  };
}

function createDefaultCatalogSyncEntry(overrides = {}) {
  return {
    lastIncrementalSyncAt: null,
    lastFullSyncAt: null,
    isExhaustive: false,
    selectionSignature: "",
    backupItemCount: 0,
    usesVolatileBackup: false,
    ...overrides,
  };
}

function createDefaultCatalogState(overrides = {}) {
  return {
    items: [],
    sourceSync: {
      profile: createDefaultCatalogSyncEntry(),
      drafts: createDefaultCatalogSyncEntry(),
      likes: createDefaultCatalogSyncEntry(),
      characters: createDefaultCatalogSyncEntry(),
      characterAccounts: createDefaultCatalogSyncEntry(),
      creators: createDefaultCatalogSyncEntry(),
    },
    ...overrides,
  };
}

function createDefaultFetchProgress(overrides = {}) {
  return {
    stage: "idle",
    stageLabel: "",
    detail: "",
    progressRatio: 0,
    currentSource: null,
    currentSourceLabel: "",
    currentSourceIndex: 0,
    totalSources: 0,
    itemsFound: 0,
    processedCount: 0,
    totalCount: 0,
    ...overrides,
  };
}

function getCurrentFetchProgress() {
  return currentState.fetchProgress && typeof currentState.fetchProgress === "object"
    ? currentState.fetchProgress
    : createDefaultFetchProgress();
}

function getNextFetchProgress(patch = {}) {
  return createDefaultFetchProgress({
    ...getCurrentFetchProgress(),
    ...patch,
  });
}

function clampFetchProgressRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function getFetchSourceLabel(source) {
  if (source === "profile") {
    return "published videos";
  }

  if (source === "drafts") {
    return "drafts";
  }

  if (source === "likes") {
    return "liked videos";
  }

  if (source === "characters") {
    return "cameo videos";
  }

  if (source === "characterAccounts") {
    return "character videos";
  }

  if (source === "creators") {
    return "creator videos";
  }

  return "videos";
}

function getFetchSourceProgressRatio(sourceIndex, totalSources, pageNumber = 0) {
  const safeTotalSources = Math.max(1, Number(totalSources) || 1);
  const normalizedSourceIndex = Math.max(0, Number(sourceIndex) || 0);
  const sourceSlot = FETCH_SOURCE_PROGRESS_RATIO / safeTotalSources;
  const normalizedPageNumber = Math.max(0, Number(pageNumber) || 0);
  const sourceProgress = Math.min(0.94, 1 - Math.pow(0.62, normalizedPageNumber));

  return clampFetchProgressRatio(
    FETCH_OPENING_PROGRESS_RATIO +
      normalizedSourceIndex * sourceSlot +
      sourceSlot * sourceProgress,
  );
}

function getFetchSourceCompleteRatio(sourceIndex, totalSources) {
  const safeTotalSources = Math.max(1, Number(totalSources) || 1);
  const normalizedSourceIndex = Math.max(0, Number(sourceIndex) || 0);
  const sourceSlot = FETCH_SOURCE_PROGRESS_RATIO / safeTotalSources;

  return clampFetchProgressRatio(
    FETCH_OPENING_PROGRESS_RATIO + sourceSlot * (normalizedSourceIndex + 1),
  );
}

function getFetchProcessingProgressRatio(stepIndex, stepProgress = 0) {
  const safeStepCount = Math.max(1, FETCH_PROCESSING_STEP_COUNT);
  const normalizedStepIndex = Math.max(0, Number(stepIndex) || 0);
  const normalizedStepProgress = clampFetchProgressRatio(stepProgress);
  const stepSlot = FETCH_PROCESSING_PROGRESS_RATIO / safeStepCount;

  return clampFetchProgressRatio(
    FETCH_OPENING_PROGRESS_RATIO +
      FETCH_SOURCE_PROGRESS_RATIO +
      stepSlot * normalizedStepIndex +
      stepSlot * normalizedStepProgress,
  );
}

async function yieldForUi() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createVolatileBackupSessionKey() {
  return `volatile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function initializeBackgroundRuntime() {
  if (updaterReadyPromise) {
    return;
  }

  updaterReadyPromise = (async () => {
    await restoreState();
    await restoreUpdaterState();
    await scheduleUpdateAlarm();
  })().catch((error) => {
    console.warn("Failed to initialize the Save Sora background runtime.", error);
  });
}

function createIndexedDbRequestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function openVolatileBackupDb() {
  if (volatileBackupDbPromise) {
    return volatileBackupDbPromise;
  }

  volatileBackupDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(VOLATILE_BACKUP_DB_NAME, VOLATILE_BACKUP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let itemStore;
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_ITEM_STORE)) {
        itemStore = db.createObjectStore(VOLATILE_BACKUP_ITEM_STORE, {
          keyPath: "id",
        });
      } else {
        itemStore = request.transaction.objectStore(VOLATILE_BACKUP_ITEM_STORE);
      }
      if (!itemStore.indexNames.contains("sessionKey")) {
        itemStore.createIndex("sessionKey", "sessionKey", { unique: false });
      }
      if (!itemStore.indexNames.contains("sessionProgressKey")) {
        itemStore.createIndex("sessionProgressKey", "sessionProgressKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_META_STORE)) {
        db.createObjectStore(VOLATILE_BACKUP_META_STORE, {
          keyPath: "sessionKey",
        });
      }
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_UPDATER_STORE)) {
        db.createObjectStore(VOLATILE_BACKUP_UPDATER_STORE, {
          keyPath: "key",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open the volatile backup database."));
  }).catch((error) => {
    volatileBackupDbPromise = null;
    throw error;
  });

  return volatileBackupDbPromise;
}

async function clearVolatileBackups() {
  const db = await openVolatileBackupDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(
      [VOLATILE_BACKUP_ITEM_STORE, VOLATILE_BACKUP_META_STORE],
      "readwrite",
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not clear the volatile backup database."));
    transaction.objectStore(VOLATILE_BACKUP_ITEM_STORE).clear();
    transaction.objectStore(VOLATILE_BACKUP_META_STORE).clear();
  });
}

async function readUpdaterRecord(key) {
  if (!key) {
    return null;
  }

  const db = await openVolatileBackupDb();
  const transaction = db.transaction([VOLATILE_BACKUP_UPDATER_STORE], "readonly");
  const store = transaction.objectStore(VOLATILE_BACKUP_UPDATER_STORE);
  const record = await createIndexedDbRequestPromise(store.get(key));
  return record && typeof record === "object" ? record : null;
}

async function writeUpdaterRecord(key, patch = {}) {
  if (!key) {
    return null;
  }

  const existingRecord = await readUpdaterRecord(key);
  const nextRecord = {
    ...(existingRecord && typeof existingRecord === "object" ? existingRecord : {}),
    ...(patch && typeof patch === "object" ? patch : {}),
    key,
    updatedAt: new Date().toISOString(),
  };

  const db = await openVolatileBackupDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([VOLATILE_BACKUP_UPDATER_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not write updater data."));
    transaction.objectStore(VOLATILE_BACKUP_UPDATER_STORE).put(nextRecord);
  });

  return nextRecord;
}

async function deleteUpdaterRecord(key) {
  if (!key) {
    return;
  }

  if (key === UPDATE_FOLDER_RECORD_KEY) {
    linkedInstallFolderRecordCache = null;
  }

  const db = await openVolatileBackupDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([VOLATILE_BACKUP_UPDATER_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not delete updater data."));
    transaction.objectStore(VOLATILE_BACKUP_UPDATER_STORE).delete(key);
  });
}

function buildUpdateStatusSnapshot() {
  const source = currentUpdateState && typeof currentUpdateState === "object"
    ? currentUpdateState
    : createDefaultUpdateState();

  return {
    phase: source.phase,
    currentVersion: source.currentVersion,
    latestVersion: source.latestVersion,
    latestGitHubVersion: source.latestGitHubVersion || "",
    latestManifestDetected: source.latestManifestDetected === true,
    latestZipDetected: source.latestZipDetected === true,
    message: source.message,
    detail: source.detail,
    progress: clampFetchProgressRatio(source.progress),
    lastCheckedAt: source.lastCheckedAt,
    installFolderLinked: source.installFolderLinked === true,
    automaticUpdatesEnabled: source.automaticUpdatesEnabled !== false,
    updateAvailable: source.updateAvailable === true,
    pendingUpdateVersion: source.pendingUpdateVersion || "",
    pendingDeferred: source.pendingDeferred === true,
    pendingUpdateReady: source.pendingUpdateReady === true,
    changelogMarkdown: typeof source.changelogMarkdown === "string" ? source.changelogMarkdown : "",
    error: source.error || "",
  };
}

function normalizeAutomaticUpdatesEnabled(value) {
  return value !== false;
}

function hasStoredInstallFolderHandle(record) {
  return Boolean(record && record.handle && record.handle.kind === "directory");
}

async function persistUpdateMeta() {
  const snapshot = buildUpdateStatusSnapshot();
  await writeUpdaterRecord(UPDATE_META_RECORD_KEY, {
    phase: snapshot.phase,
    currentVersion: snapshot.currentVersion,
    latestVersion: snapshot.latestVersion,
    latestGitHubVersion: snapshot.latestGitHubVersion,
    latestManifestDetected: snapshot.latestManifestDetected,
    latestZipDetected: snapshot.latestZipDetected,
    message: snapshot.message,
    detail: snapshot.detail,
    progress: snapshot.progress,
    lastCheckedAt: snapshot.lastCheckedAt,
    installFolderLinked: snapshot.installFolderLinked,
    automaticUpdatesEnabled: snapshot.automaticUpdatesEnabled,
    updateAvailable: snapshot.updateAvailable,
    pendingUpdateVersion: snapshot.pendingUpdateVersion,
    pendingDeferred: snapshot.pendingDeferred,
    pendingUpdateReady: snapshot.pendingUpdateReady,
    changelogMarkdown: snapshot.changelogMarkdown,
    error: snapshot.error,
  });
}

async function setUpdateState(patch = {}, options = {}) {
  currentUpdateState = createDefaultUpdateState({
    ...currentUpdateState,
    ...patch,
    currentVersion: CURRENT_EXTENSION_VERSION,
    automaticUpdatesEnabled: normalizeAutomaticUpdatesEnabled(
      patch && Object.prototype.hasOwnProperty.call(patch, "automaticUpdatesEnabled")
        ? patch.automaticUpdatesEnabled
        : currentState &&
            currentState.settings &&
            Object.prototype.hasOwnProperty.call(currentState.settings, "automaticUpdatesEnabled")
          ? currentState.settings.automaticUpdatesEnabled
          : currentUpdateState.automaticUpdatesEnabled,
    ),
  });

  if (options.persist !== false) {
    await persistUpdateMeta();
  }
}

async function restoreUpdaterState() {
  const installRecord = await readUpdaterRecord(UPDATE_FOLDER_RECORD_KEY);
  const pendingRecord = await readUpdaterRecord(UPDATE_PENDING_RECORD_KEY);
  const metaRecord = await readUpdaterRecord(UPDATE_META_RECORD_KEY);
  const installFolderLinked = hasStoredInstallFolderHandle(installRecord);
  const automaticUpdatesEnabled = normalizeAutomaticUpdatesEnabled(
    currentState &&
      currentState.settings &&
      Object.prototype.hasOwnProperty.call(currentState.settings, "automaticUpdatesEnabled")
      ? currentState.settings.automaticUpdatesEnabled
      : true,
  );

  currentUpdateState = createDefaultUpdateState({
    ...(metaRecord && typeof metaRecord === "object" ? metaRecord : {}),
    installFolderLinked,
    automaticUpdatesEnabled,
    latestVersion:
      pendingRecord && typeof pendingRecord.version === "string" && pendingRecord.version
        ? pendingRecord.version
        : metaRecord && typeof metaRecord.latestVersion === "string" && metaRecord.latestVersion
          ? metaRecord.latestVersion
          : CURRENT_EXTENSION_VERSION,
    latestGitHubVersion:
      pendingRecord && typeof pendingRecord.version === "string" && pendingRecord.version
        ? pendingRecord.version
        : metaRecord && typeof metaRecord.latestGitHubVersion === "string" && metaRecord.latestGitHubVersion
          ? metaRecord.latestGitHubVersion
          : "",
    latestManifestDetected:
      pendingRecord && typeof pendingRecord.version === "string"
        ? pendingRecord.manifestDetected !== false
        : metaRecord && metaRecord.latestManifestDetected === true,
    latestZipDetected:
      pendingRecord && typeof pendingRecord.version === "string"
        ? pendingRecord.zipDetected !== false
        : metaRecord && metaRecord.latestZipDetected === true,
    pendingUpdateVersion:
      pendingRecord && typeof pendingRecord.version === "string" ? pendingRecord.version : "",
    pendingUpdateUrl:
      pendingRecord && typeof pendingRecord.zipUrl === "string" ? pendingRecord.zipUrl : "",
    pendingReleaseUrl:
      pendingRecord && typeof pendingRecord.releaseUrl === "string" ? pendingRecord.releaseUrl : "",
    pendingManifestUrl:
      pendingRecord && typeof pendingRecord.manifestUrl === "string"
        ? pendingRecord.manifestUrl
        : "",
    pendingManagedFiles:
      pendingRecord && Array.isArray(pendingRecord.managedFiles) ? pendingRecord.managedFiles : [],
    changelogMarkdown:
      pendingRecord && typeof pendingRecord.changelogMarkdown === "string"
        ? pendingRecord.changelogMarkdown
        : metaRecord && typeof metaRecord.changelogMarkdown === "string"
          ? metaRecord.changelogMarkdown
          : "",
    updateAvailable:
      pendingRecord && typeof pendingRecord.version === "string"
        ? compareSemver(pendingRecord.version, CURRENT_EXTENSION_VERSION) > 0
        : metaRecord && metaRecord.updateAvailable === true,
    pendingUpdateReady:
      pendingRecord && typeof pendingRecord.version === "string"
        ? compareSemver(pendingRecord.version, CURRENT_EXTENSION_VERSION) > 0
        : metaRecord && metaRecord.pendingUpdateReady === true,
    phase:
      pendingRecord &&
      typeof pendingRecord.version === "string" &&
      compareSemver(pendingRecord.version, CURRENT_EXTENSION_VERSION) > 0 &&
      metaRecord &&
      metaRecord.phase !== "downloading" &&
      metaRecord.phase !== "applying" &&
      metaRecord.phase !== "reloading"
        ? metaRecord && metaRecord.pendingDeferred === true
          ? "deferred"
          : "update-available"
        : metaRecord &&
            typeof metaRecord.phase === "string" &&
            metaRecord.phase &&
            metaRecord.phase !== "awaiting-folder"
          ? metaRecord.phase
          : "idle",
  });

  await persistUpdateMeta();
}

async function scheduleUpdateAlarm() {
  if (!chrome.alarms) {
    return;
  }

  await chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
    periodInMinutes: UPDATE_CHECK_INTERVAL_MINUTES,
  });
}

function compareSemver(leftVersion, rightVersion) {
  const leftParts = String(leftVersion || "")
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = String(rightVersion || "")
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

async function hasStoredInstallFolderAccess(record) {
  const handle = record && record.handle ? record.handle : null;
  if (!handle || typeof handle.queryPermission !== "function") {
    return false;
  }

  try {
    return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
  } catch (_error) {
    return false;
  }
}

async function getLinkedInstallFolderRecord() {
  if (
    linkedInstallFolderRecordCache &&
    typeof linkedInstallFolderRecordCache === "object" &&
    (await hasStoredInstallFolderAccess(linkedInstallFolderRecordCache))
  ) {
    return linkedInstallFolderRecordCache;
  }

  const record = await readUpdaterRecord(UPDATE_FOLDER_RECORD_KEY);
  if (!record || !(await hasStoredInstallFolderAccess(record))) {
    linkedInstallFolderRecordCache = null;
    return null;
  }

  linkedInstallFolderRecordCache = record;
  return record;
}

async function validateInstallFolderHandle(handle) {
  if (!handle || handle.kind !== "directory") {
    throw new Error("Select the unpacked Save Sora extension folder.");
  }

  const manifestHandle = await handle.getFileHandle("manifest.json", { create: false });
  const manifestFile = await manifestHandle.getFile();
  const manifestText = await manifestFile.text();
  const parsedManifest = JSON.parse(manifestText);
  if (!parsedManifest || parsedManifest.name !== CURRENT_EXTENSION_NAME) {
    throw new Error("The selected folder does not look like the Save Sora unpacked extension.");
  }

  return {
    manifestVersion:
      parsedManifest && typeof parsedManifest.version === "string" ? parsedManifest.version : "",
    manifestName:
      parsedManifest && typeof parsedManifest.name === "string" ? parsedManifest.name : "",
  };
}

async function linkInstallFolder(handle) {
  const folderInfo = await validateInstallFolderHandle(handle);
  const record = await writeUpdaterRecord(UPDATE_FOLDER_RECORD_KEY, {
    handle,
    linkedAt: new Date().toISOString(),
    manifestVersion: folderInfo.manifestVersion,
    manifestName: folderInfo.manifestName,
  });
  linkedInstallFolderRecordCache = record;

  await setUpdateState({
    installFolderLinked: true,
    error: "",
    message: "",
    detail: "",
    phase: currentUpdateState.updateAvailable ? currentUpdateState.phase : "idle",
  });

  return buildUpdateStatusSnapshot();
}

function sanitizeManagedRelativePath(path) {
  if (typeof path !== "string") {
    return "";
  }

  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized === "..") {
    return "";
  }

  return normalized;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    const error = new Error(`Request failed (${response.status}) while loading ${url}.`);
    error.status = response.status;
    error.url = url;
    throw error;
  }
  return response.json();
}

async function fetchGitHubReleases() {
  const releases = await fetchJson(GITHUB_RELEASES_URL);
  return Array.isArray(releases) ? releases : [];
}

function extractGitHubReleaseVersion(release) {
  const rawValue =
    release && typeof release.tag_name === "string" && release.tag_name
      ? release.tag_name
      : release && typeof release.name === "string" && release.name
        ? release.name
        : "";
  const trimmedValue = rawValue.trim().replace(/^v/i, "");
  const matchedVersion = trimmedValue.match(/\d+\.\d+\.\d+/);
  return matchedVersion ? matchedVersion[0] : trimmedValue;
}

async function fetchLatestReleaseManifest() {
  const releases = await fetchGitHubReleases();
  const release = releases
    .filter((candidate) => candidate && candidate.draft !== true && candidate.prerelease !== true)
    .map((candidate) => ({
      release: candidate,
      version: extractGitHubReleaseVersion(candidate),
    }))
    .filter((candidate) => candidate.version)
    .sort((leftCandidate, rightCandidate) =>
      compareSemver(rightCandidate.version, leftCandidate.version),
    )[0]?.release;

  if (!release) {
    const error = new Error("No published GitHub releases are available yet.");
    error.code = "NO_PUBLISHED_RELEASES";
    error.url = GITHUB_RELEASES_URL;
    throw error;
  }

  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const releaseVersion = extractGitHubReleaseVersion(release);
  const manifestAsset = assets.find(
    (asset) => asset && asset.name === UPDATE_MANIFEST_ASSET_NAME && asset.browser_download_url,
  );
  if (!manifestAsset) {
    const error = new Error("The latest GitHub release is missing the update manifest asset.");
    error.code = "MISSING_UPDATE_MANIFEST";
    error.releaseVersion = releaseVersion;
    error.manifestDetected = false;
    error.zipDetected = false;
    throw error;
  }

  const manifest = await fetchJson(manifestAsset.browser_download_url);
  if (!manifest || typeof manifest !== "object") {
    throw new Error("The GitHub update manifest is invalid.");
  }

  const zipFileName =
    typeof manifest.zipFileName === "string" && manifest.zipFileName ? manifest.zipFileName : "";
  const zipAsset = assets.find(
    (asset) => asset && asset.name === zipFileName && asset.browser_download_url,
  );
  if (!zipAsset) {
    const error = new Error("The latest GitHub release is missing the packaged update zip.");
    error.code = "MISSING_UPDATE_ZIP";
    error.releaseVersion = typeof manifest.version === "string" && manifest.version ? manifest.version : releaseVersion;
    error.manifestDetected = true;
    error.zipDetected = false;
    throw error;
  }

  const managedFiles = Array.isArray(manifest.managedFiles)
    ? manifest.managedFiles
        .map((value) => sanitizeManagedRelativePath(value))
        .filter(Boolean)
    : [];

  return {
    version:
      typeof manifest.version === "string" && manifest.version ? manifest.version : releaseVersion,
    releaseVersion,
    packageSlug:
      typeof manifest.packageSlug === "string" && manifest.packageSlug
        ? sanitizeManagedRelativePath(manifest.packageSlug)
        : "",
    zipUrl: zipAsset.browser_download_url,
    zipSha256: typeof manifest.zipSha256 === "string" ? manifest.zipSha256.toLowerCase() : "",
    manifestUrl: manifestAsset.browser_download_url,
    releaseUrl: typeof release.html_url === "string" ? release.html_url : "",
    managedFiles,
    releaseId: release && release.id ? release.id : "",
    generatedAt: typeof manifest.generatedAt === "string" ? manifest.generatedAt : "",
    changelogMarkdown: typeof release.body === "string" ? release.body : "",
    manifestDetected: true,
    zipDetected: true,
  };
}

async function downloadBinaryWithProgress(url, onProgress) {
  const response = await fetch(url, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) while downloading the update package.`);
  }

  const totalBytes = Number(response.headers.get("content-length")) || 0;
  if (!response.body || typeof response.body.getReader !== "function") {
    const arrayBuffer = await response.arrayBuffer();
    if (typeof onProgress === "function") {
      onProgress(1, arrayBuffer.byteLength, arrayBuffer.byteLength || totalBytes);
    }
    return arrayBuffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value && value.byteLength > 0) {
      chunks.push(value);
      receivedBytes += value.byteLength;
      if (typeof onProgress === "function") {
        onProgress(totalBytes > 0 ? receivedBytes / totalBytes : 0, receivedBytes, totalBytes);
      }
    }
  }

  const merged = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (typeof onProgress === "function") {
    onProgress(1, receivedBytes, totalBytes || receivedBytes);
  }

  return merged.buffer;
}

async function digestSha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function initializeZipLibrary() {
  if (globalThis.zip && globalThis.zip.ZipReader) {
    zipLibraryLoaded = true;
    return;
  }
  importScripts(chrome.runtime.getURL("vendor/zip-core.min.js"));
  zipLibraryLoaded = Boolean(globalThis.zip && globalThis.zip.ZipReader);
}

function ensureZipLibraryLoaded() {
  if (zipLibraryLoaded && globalThis.zip && globalThis.zip.ZipReader) {
    return;
  }

  throw new Error("Save Sora could not initialize the bundled zip library during startup.");
}

function normalizeManagedZipEntryPath(entryPath, packageSlug) {
  const normalizedPath = sanitizeManagedRelativePath(entryPath);
  if (!normalizedPath) {
    return "";
  }

  if (packageSlug) {
    const normalizedPackageSlug = sanitizeManagedRelativePath(packageSlug);
    if (normalizedPath === normalizedPackageSlug) {
      return "";
    }
    if (normalizedPath.startsWith(`${normalizedPackageSlug}/`)) {
      return normalizedPath.slice(normalizedPackageSlug.length + 1);
    }
  }

  return normalizedPath;
}

async function extractManagedFilesFromZip(arrayBuffer, managedFiles, packageSlug = "") {
  ensureZipLibraryLoaded();
  const normalizedManagedFiles = new Set(
    Array.isArray(managedFiles)
      ? managedFiles.map((value) => sanitizeManagedRelativePath(value)).filter(Boolean)
      : [],
  );
  const zipReader = new globalThis.zip.ZipReader(
    new globalThis.zip.Uint8ArrayReader(new Uint8Array(arrayBuffer)),
  );
  const entries = await zipReader.getEntries();
  const extractedFiles = new Map();

  for (const entry of entries) {
    if (!entry || entry.directory) {
      continue;
    }

    const relativePath = normalizeManagedZipEntryPath(entry.filename, packageSlug);
    if (!relativePath) {
      await zipReader.close();
      throw new Error("The downloaded update contains an invalid file path.");
    }

    if (!normalizedManagedFiles.has(relativePath)) {
      await zipReader.close();
      throw new Error(`The downloaded update contains an unmanaged file: ${relativePath}`);
    }

    const bytes = await entry.getData(new globalThis.zip.Uint8ArrayWriter());
    extractedFiles.set(relativePath, bytes);
  }

  await zipReader.close();
  return extractedFiles;
}

function isUpdaterBusyPhase() {
  return (
    currentUpdateState.phase === "checking" ||
    currentUpdateState.phase === "downloading" ||
    currentUpdateState.phase === "applying" ||
    currentUpdateState.phase === "reloading"
  );
}

function isUpdaterApplyBlocked() {
  return Boolean(activeRun) || currentState.phase === "fetch-paused" || currentState.phase === "paused";
}

async function readManagedFileBytes(rootHandle, relativePath) {
  const normalizedPath = sanitizeManagedRelativePath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  const pathParts = normalizedPath.split("/");
  let directoryHandle = rootHandle;
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    directoryHandle = await directoryHandle.getDirectoryHandle(pathParts[index], { create: false });
  }

  const fileHandle = await directoryHandle.getFileHandle(pathParts[pathParts.length - 1], {
    create: false,
  });
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function ensureDirectoryHandle(rootHandle, directorySegments) {
  let directoryHandle = rootHandle;
  for (const segment of directorySegments) {
    directoryHandle = await directoryHandle.getDirectoryHandle(segment, { create: true });
  }
  return directoryHandle;
}

async function writeManagedFileBytes(rootHandle, relativePath, bytes) {
  const normalizedPath = sanitizeManagedRelativePath(relativePath);
  if (!normalizedPath) {
    throw new Error(`Could not write invalid managed path: ${relativePath}`);
  }

  const pathParts = normalizedPath.split("/");
  const directoryHandle = await ensureDirectoryHandle(rootHandle, pathParts.slice(0, -1));
  const fileHandle = await directoryHandle.getFileHandle(pathParts[pathParts.length - 1], {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

async function removeManagedPath(rootHandle, relativePath) {
  const normalizedPath = sanitizeManagedRelativePath(relativePath);
  if (!normalizedPath) {
    return;
  }

  const pathParts = normalizedPath.split("/");
  let directoryHandle = rootHandle;
  for (let index = 0; index < pathParts.length - 1; index += 1) {
    directoryHandle = await directoryHandle.getDirectoryHandle(pathParts[index], { create: false });
  }

  await directoryHandle.removeEntry(pathParts[pathParts.length - 1]);
}

async function snapshotExistingManagedFiles(rootHandle, managedFiles) {
  const snapshot = new Map();

  for (const relativePath of managedFiles) {
    try {
      snapshot.set(relativePath, await readManagedFileBytes(rootHandle, relativePath));
    } catch (_error) {
      snapshot.set(relativePath, null);
    }
  }

  return snapshot;
}

async function applyExtractedManagedFiles(rootHandle, extractedFiles, onProgress) {
  const fileEntries = [...extractedFiles.entries()];
  const rollbackSnapshot = await snapshotExistingManagedFiles(
    rootHandle,
    fileEntries.map(([relativePath]) => relativePath),
  );
  await writeUpdaterRecord(UPDATE_ROLLBACK_RECORD_KEY, {
    createdAt: new Date().toISOString(),
    fileCount: fileEntries.length,
    files: fileEntries.map(([relativePath]) => relativePath),
  });

  try {
    for (let index = 0; index < fileEntries.length; index += 1) {
      const [relativePath, bytes] = fileEntries[index];
      await writeManagedFileBytes(rootHandle, relativePath, bytes);
      if (typeof onProgress === "function") {
        onProgress((index + 1) / fileEntries.length, index + 1, fileEntries.length);
      }
    }
  } catch (error) {
    for (const [relativePath, previousBytes] of rollbackSnapshot.entries()) {
      if (previousBytes) {
        await writeManagedFileBytes(rootHandle, relativePath, previousBytes);
      } else {
        try {
          await removeManagedPath(rootHandle, relativePath);
        } catch (_rollbackError) {
          // Ignore rollback deletes for files that still do not exist.
        }
      }
    }
    throw error;
  }
}

async function storePendingUpdate(updateInfo) {
  if (!updateInfo) {
    await deleteUpdaterRecord(UPDATE_PENDING_RECORD_KEY);
    return null;
  }

  return writeUpdaterRecord(UPDATE_PENDING_RECORD_KEY, {
    version: updateInfo.version,
    packageSlug: updateInfo.packageSlug || "",
    zipUrl: updateInfo.zipUrl,
    zipSha256: updateInfo.zipSha256,
    manifestUrl: updateInfo.manifestUrl,
    releaseUrl: updateInfo.releaseUrl,
    managedFiles: updateInfo.managedFiles,
    generatedAt: updateInfo.generatedAt,
    releaseId: updateInfo.releaseId,
    manifestDetected: updateInfo.manifestDetected === true,
    zipDetected: updateInfo.zipDetected === true,
    changelogMarkdown: updateInfo.changelogMarkdown || "",
    pendingDeferred: updateInfo.pendingDeferred === true,
  });
}

async function installPendingUpdate(options = {}) {
  await restoreUpdaterState();
  const pendingUpdate =
    options.pendingUpdate && typeof options.pendingUpdate === "object"
      ? options.pendingUpdate
      : await readUpdaterRecord(UPDATE_PENDING_RECORD_KEY);
  if (!pendingUpdate || !pendingUpdate.version || compareSemver(pendingUpdate.version, CURRENT_EXTENSION_VERSION) <= 0) {
    await setUpdateState({
      phase: "idle",
      latestVersion: CURRENT_EXTENSION_VERSION,
      pendingUpdateVersion: "",
      updateAvailable: false,
      pendingDeferred: false,
      pendingUpdateReady: false,
      message: "",
      detail: "",
      error: "",
    });
    return buildUpdateStatusSnapshot();
  }

  const installRecord = await getLinkedInstallFolderRecord();
  if (!installRecord || !installRecord.handle) {
    await setUpdateState({
      phase: "awaiting-folder",
      latestVersion: pendingUpdate.version,
      latestGitHubVersion: pendingUpdate.version,
      latestManifestDetected: true,
      latestZipDetected: true,
      updateAvailable: true,
      pendingUpdateVersion: pendingUpdate.version,
      pendingUpdateUrl: pendingUpdate.zipUrl || "",
      pendingReleaseUrl: pendingUpdate.releaseUrl || "",
      pendingManifestUrl: pendingUpdate.manifestUrl || "",
      pendingPackageSlug: pendingUpdate.packageSlug || "",
      pendingManagedFiles: Array.isArray(pendingUpdate.managedFiles) ? pendingUpdate.managedFiles : [],
      changelogMarkdown:
        typeof pendingUpdate.changelogMarkdown === "string" ? pendingUpdate.changelogMarkdown : "",
      pendingUpdateReady: true,
      message: "Link the Save Sora install folder to enable self-updates.",
      detail: "Choose the unpacked extension folder once so Save Sora can apply future GitHub releases automatically.",
      error: "",
    });
    return buildUpdateStatusSnapshot();
  }

  if (isUpdaterApplyBlocked()) {
    await storePendingUpdate({
      ...pendingUpdate,
      pendingDeferred: true,
    });
    await setUpdateState({
      phase: "deferred",
      latestVersion: pendingUpdate.version,
      latestGitHubVersion: pendingUpdate.version,
      latestManifestDetected: true,
      latestZipDetected: true,
      updateAvailable: true,
      pendingUpdateVersion: pendingUpdate.version,
      pendingDeferred: true,
      pendingUpdateReady: true,
      changelogMarkdown:
        typeof pendingUpdate.changelogMarkdown === "string" ? pendingUpdate.changelogMarkdown : "",
      message: "Update ready to install.",
      detail: "Save Sora will install the pending update after the current fetch or download finishes.",
      error: "",
    });
    return buildUpdateStatusSnapshot();
  }

  await setUpdateState(
    {
      phase: "downloading",
      latestVersion: pendingUpdate.version,
      latestGitHubVersion: pendingUpdate.version,
      latestManifestDetected: true,
      latestZipDetected: true,
      updateAvailable: true,
      pendingUpdateVersion: pendingUpdate.version,
      pendingUpdateUrl: pendingUpdate.zipUrl || "",
      pendingReleaseUrl: pendingUpdate.releaseUrl || "",
      pendingManifestUrl: pendingUpdate.manifestUrl || "",
      pendingPackageSlug: pendingUpdate.packageSlug || "",
      pendingManagedFiles: Array.isArray(pendingUpdate.managedFiles) ? pendingUpdate.managedFiles : [],
      changelogMarkdown:
        typeof pendingUpdate.changelogMarkdown === "string" ? pendingUpdate.changelogMarkdown : "",
      pendingDeferred: false,
      pendingUpdateReady: true,
      message: `Downloading Save Sora ${pendingUpdate.version}…`,
      detail: "Downloading the latest GitHub release package.",
      progress: 0.4,
      error: "",
    },
    { persist: true },
  );

  try {
    const packageBuffer = await downloadBinaryWithProgress(pendingUpdate.zipUrl, async (progressRatio) => {
      await setUpdateState(
        {
          phase: "downloading",
          progress: 0.4 + progressRatio * 0.24,
        },
        { persist: false },
      );
    });
    await setUpdateState(
      {
        phase: "downloading",
        message: `Verifying Save Sora ${pendingUpdate.version}…`,
        detail: "Checking the package checksum and preparing the release archive.",
        progress: 0.68,
      },
      { persist: false },
    );
    const actualDigest = await digestSha256Hex(packageBuffer);
    if (
      pendingUpdate.zipSha256 &&
      pendingUpdate.zipSha256.toLowerCase() !== actualDigest.toLowerCase()
    ) {
      throw new Error("The downloaded update package failed checksum verification.");
    }

    await setUpdateState(
      {
        phase: "applying",
        message: `Unzipping Save Sora ${pendingUpdate.version}…`,
        detail: "Opening the verified archive and validating the managed runtime files.",
        progress: 0.76,
      },
      { persist: false },
    );
    const extractedFiles = await extractManagedFilesFromZip(
      packageBuffer,
      pendingUpdate.managedFiles,
      pendingUpdate.packageSlug || "",
    );
    const extractedManifestBytes = extractedFiles.get("manifest.json");
    if (!extractedManifestBytes) {
      throw new Error("The update package does not contain manifest.json.");
    }

    const extractedManifest = JSON.parse(new TextDecoder().decode(extractedManifestBytes));
    if (!extractedManifest || extractedManifest.name !== CURRENT_EXTENSION_NAME) {
      throw new Error("The update package does not match the Save Sora extension.");
    }
    if (
      typeof extractedManifest.version !== "string" ||
      compareSemver(extractedManifest.version, CURRENT_EXTENSION_VERSION) <= 0
    ) {
      throw new Error("The update package is not newer than the installed extension.");
    }

    await setUpdateState(
      {
        phase: "applying",
        message: `Installing Save Sora ${pendingUpdate.version}…`,
        detail: "Writing the updated runtime into the unpacked extension folder.",
        progress: 0.82,
      },
      { persist: true },
    );

    await applyExtractedManagedFiles(installRecord.handle, extractedFiles, async (progressRatio) => {
      await setUpdateState(
        {
          phase: "applying",
          progress: 0.82 + progressRatio * 0.14,
        },
        { persist: false },
      );
    });

    await deleteUpdaterRecord(UPDATE_PENDING_RECORD_KEY);
    await writeUpdaterRecord(UPDATE_META_RECORD_KEY, {
      lastSuccessfulUpdateAt: new Date().toISOString(),
      lastSuccessfulUpdateVersion: pendingUpdate.version,
      latestVersion: pendingUpdate.version,
      latestGitHubVersion: pendingUpdate.version,
      latestManifestDetected: true,
      latestZipDetected: true,
      updateAvailable: false,
      pendingUpdateVersion: "",
      pendingDeferred: false,
      pendingUpdateReady: false,
      error: "",
      phase: "reloading",
      progress: 1,
      message: `Installed Save Sora ${pendingUpdate.version}.`,
      detail: "Reloading the extension with the updated runtime files.",
    });
    currentUpdateState = createDefaultUpdateState({
      ...currentUpdateState,
      phase: "reloading",
      latestVersion: pendingUpdate.version,
      updateAvailable: false,
      pendingUpdateVersion: "",
      pendingDeferred: false,
      progress: 1,
      message: `Installed Save Sora ${pendingUpdate.version}.`,
      detail: "Reloading the extension with the updated runtime files.",
      error: "",
    });
    const snapshot = buildUpdateStatusSnapshot();
    setTimeout(() => {
      chrome.runtime.reload();
    }, 80);
    return snapshot;
  } catch (error) {
    await setUpdateState({
      phase: "error",
      latestVersion: pendingUpdate.version,
      latestGitHubVersion: pendingUpdate.version,
      latestManifestDetected: true,
      latestZipDetected: true,
      updateAvailable: true,
      pendingUpdateVersion: pendingUpdate.version,
      pendingDeferred: false,
      pendingUpdateReady: true,
      changelogMarkdown:
        typeof pendingUpdate.changelogMarkdown === "string" ? pendingUpdate.changelogMarkdown : "",
      message: "Could not install the latest update.",
      detail: getErrorMessage(error),
      error: getErrorMessage(error),
      progress: 0,
    });
    return buildUpdateStatusSnapshot();
  }
}

async function runUpdateCheck(options = {}) {
  if (isUpdaterBusyPhase()) {
    return buildUpdateStatusSnapshot();
  }

  await restoreUpdaterState();
  const automaticUpdatesEnabled = normalizeAutomaticUpdatesEnabled(
    currentState &&
      currentState.settings &&
      Object.prototype.hasOwnProperty.call(currentState.settings, "automaticUpdatesEnabled")
      ? currentState.settings.automaticUpdatesEnabled
      : true,
  );

  await setUpdateState({
    phase: "checking",
    message: "Checking GitHub for updates…",
    detail: "Looking for the latest Save Sora release before opening the dashboard.",
    progress: 0.16,
    automaticUpdatesEnabled,
    error: "",
  });

  try {
    const latestRelease = await fetchLatestReleaseManifest();
    const installFolderLinked = currentUpdateState.installFolderLinked === true;
    const updateAvailable = compareSemver(latestRelease.version, CURRENT_EXTENSION_VERSION) > 0;
    const lastCheckedAt = new Date().toISOString();

    if (!updateAvailable) {
      await storePendingUpdate(null);
      await setUpdateState({
        phase:
          automaticUpdatesEnabled && !installFolderLinked ? "awaiting-folder" : "idle",
        latestVersion: CURRENT_EXTENSION_VERSION,
        latestGitHubVersion: latestRelease.version || latestRelease.releaseVersion || "",
        latestManifestDetected: latestRelease.manifestDetected === true,
        latestZipDetected: latestRelease.zipDetected === true,
        lastCheckedAt,
        installFolderLinked,
        updateAvailable: false,
        pendingUpdateVersion: "",
        pendingManagedFiles: [],
        changelogMarkdown: "",
        pendingDeferred: false,
        pendingUpdateReady: false,
        message:
          automaticUpdatesEnabled && !installFolderLinked
            ? "Finish one-time update setup."
            : "",
        detail:
          automaticUpdatesEnabled && !installFolderLinked
            ? "Chrome requires one-time access to the unpacked Save Sora folder so future GitHub releases can install automatically."
            : "",
        progress: 1,
        error: "",
      });
      return buildUpdateStatusSnapshot();
    }

    const pendingUpdate = {
      ...latestRelease,
      pendingDeferred: false,
    };
    await storePendingUpdate(pendingUpdate);
    await setUpdateState({
      phase: !installFolderLinked ? "awaiting-folder" : "update-available",
      latestVersion: latestRelease.version,
      latestGitHubVersion: latestRelease.version || latestRelease.releaseVersion || "",
      latestManifestDetected: latestRelease.manifestDetected === true,
      latestZipDetected: latestRelease.zipDetected === true,
      lastCheckedAt,
      installFolderLinked,
      updateAvailable: true,
      pendingUpdateVersion: latestRelease.version,
      pendingUpdateUrl: latestRelease.zipUrl,
      pendingReleaseUrl: latestRelease.releaseUrl,
      pendingManifestUrl: latestRelease.manifestUrl,
      pendingPackageSlug: latestRelease.packageSlug || "",
      pendingManagedFiles: latestRelease.managedFiles,
      changelogMarkdown: latestRelease.changelogMarkdown || "",
      pendingDeferred: false,
      pendingUpdateReady: true,
      message: !installFolderLinked
        ? "Link the Save Sora install folder to install the latest update."
        : automaticUpdatesEnabled
          ? `Save Sora ${latestRelease.version} is ready to install.`
          : `Save Sora ${latestRelease.version} is ready to install.`,
      detail: !installFolderLinked
        ? "Choose the unpacked extension folder once so Save Sora can update itself from GitHub."
        : automaticUpdatesEnabled
          ? "Review the latest release notes before Save Sora installs the update automatically."
          : "Automatic updates are turned off. Install the latest GitHub release when you are ready.",
      progress: installFolderLinked ? 0.34 : 0.28,
      error: "",
    });

    if (!installFolderLinked || !automaticUpdatesEnabled || options.applyIfAvailable === false) {
      return buildUpdateStatusSnapshot();
    }

    return installPendingUpdate({ pendingUpdate });
  } catch (error) {
    const releaseVersion =
      error && typeof error.releaseVersion === "string" ? error.releaseVersion : "";
    const missingManifestForOlderOrCurrentRelease =
      error &&
      error.code === "MISSING_UPDATE_MANIFEST" &&
      compareSemver(releaseVersion || CURRENT_EXTENSION_VERSION, CURRENT_EXTENSION_VERSION) <= 0;
    const noPublishedReleaseYet =
      error &&
      ((error.code === "NO_PUBLISHED_RELEASES" && error.url === GITHUB_RELEASES_URL) ||
        (error.status === 404 && error.url === GITHUB_RELEASES_URL));

    if (missingManifestForOlderOrCurrentRelease || noPublishedReleaseYet) {
      const installFolderLinked = currentUpdateState.installFolderLinked === true;
      await storePendingUpdate(null);
      await setUpdateState({
        phase:
          automaticUpdatesEnabled && !installFolderLinked ? "awaiting-folder" : "idle",
        latestVersion: CURRENT_EXTENSION_VERSION,
        latestGitHubVersion: releaseVersion || "",
        latestManifestDetected:
          error && Object.prototype.hasOwnProperty.call(error, "manifestDetected")
            ? error.manifestDetected === true
            : false,
        latestZipDetected:
          error && Object.prototype.hasOwnProperty.call(error, "zipDetected")
            ? error.zipDetected === true
            : false,
        lastCheckedAt: new Date().toISOString(),
        installFolderLinked,
        updateAvailable: false,
        pendingUpdateVersion: "",
        pendingManagedFiles: [],
        changelogMarkdown: "",
        pendingDeferred: false,
        pendingUpdateReady: false,
        message:
          automaticUpdatesEnabled && !installFolderLinked
            ? "Finish one-time update setup."
            : "",
        detail:
          automaticUpdatesEnabled && !installFolderLinked
            ? "Chrome requires one-time access to the unpacked Save Sora folder so future GitHub releases can install automatically."
            : "",
        progress: 1,
        error: "",
      });
      return buildUpdateStatusSnapshot();
    }

    await setUpdateState({
      phase: "error",
      latestGitHubVersion: releaseVersion || currentUpdateState.latestGitHubVersion,
      latestManifestDetected:
        error && Object.prototype.hasOwnProperty.call(error, "manifestDetected")
          ? error.manifestDetected === true
          : currentUpdateState.latestManifestDetected,
      latestZipDetected:
        error && Object.prototype.hasOwnProperty.call(error, "zipDetected")
          ? error.zipDetected === true
          : currentUpdateState.latestZipDetected,
      message: "Could not check GitHub for updates.",
      detail: getErrorMessage(error),
      progress: 0,
      pendingUpdateReady: currentUpdateState.pendingUpdateReady,
      changelogMarkdown: currentUpdateState.changelogMarkdown,
      error: getErrorMessage(error),
    });
    return buildUpdateStatusSnapshot();
  }
}

async function readVolatileBackupMeta(sessionKey) {
  if (!sessionKey) {
    return null;
  }

  const db = await openVolatileBackupDb();
  const transaction = db.transaction([VOLATILE_BACKUP_META_STORE], "readonly");
  const store = transaction.objectStore(VOLATILE_BACKUP_META_STORE);
  const record = await createIndexedDbRequestPromise(store.get(sessionKey));
  return record && typeof record === "object" ? record : null;
}

async function listVolatileBackupMetas() {
  const db = await openVolatileBackupDb();
  const transaction = db.transaction([VOLATILE_BACKUP_META_STORE], "readonly");
  const store = transaction.objectStore(VOLATILE_BACKUP_META_STORE);
  const records = await createIndexedDbRequestPromise(store.getAll());
  return Array.isArray(records) ? records : [];
}

async function loadVolatileBackupItemsByProgressKey(
  sessionKey,
  progressKey,
  limit = VOLATILE_SOURCE_PREVIEW_LIMIT,
) {
  if (!sessionKey || !progressKey) {
    return [];
  }

  const db = await openVolatileBackupDb();
  const transaction = db.transaction([VOLATILE_BACKUP_ITEM_STORE], "readonly");
  const store = transaction.objectStore(VOLATILE_BACKUP_ITEM_STORE);
  const index = store.index("sessionProgressKey");
  const request = index.getAll(
    IDBKeyRange.only(`${sessionKey}:${progressKey}`),
    Math.max(1, Number(limit) || VOLATILE_SOURCE_PREVIEW_LIMIT),
  );
  const records = await createIndexedDbRequestPromise(request);

  return (Array.isArray(records) ? records : [])
    .sort((left, right) => (Number(left && left.storedAt) || 0) - (Number(right && right.storedAt) || 0))
    .map((record) => (record && record.item ? record.item : null))
    .filter(Boolean);
}

function buildVolatileBackupItemRecord(sessionKey, item, progressKey = "") {
  const compactItem = compactItemForPopup(item);
  if (!compactItem) {
    return null;
  }

  return {
    id: `${sessionKey}:${compactItem.key}`,
    sessionKey,
    progressKey,
    sessionProgressKey: `${sessionKey}:${progressKey}`,
    key: compactItem.key,
    sourcePage: compactItem.sourcePage,
    storedAt: Date.now(),
    item: compactItem,
  };
}

async function writeVolatileBackupMeta(sessionKey, meta = {}, options = {}) {
  if (!sessionKey) {
    return null;
  }

  const existingMeta =
    options && options.merge === false ? null : await readVolatileBackupMeta(sessionKey);
  const nextMeta = {
    ...(existingMeta && typeof existingMeta === "object" ? existingMeta : {}),
    ...(meta && typeof meta === "object" ? meta : {}),
    sessionKey,
    updatedAt: new Date().toISOString(),
  };

  const db = await openVolatileBackupDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([VOLATILE_BACKUP_META_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not write volatile backup metadata."));
    transaction.objectStore(VOLATILE_BACKUP_META_STORE).put(nextMeta);
  });
  return nextMeta;
}

function getVolatileBackupProgressKey(sourcePage, profileId) {
  if (!sourcePage || !profileId) {
    return "";
  }

  return `${sourcePage}:${profileId}`;
}

async function updateVolatileBackupProgress(sessionKey, progressKey, patch = {}) {
  if (!sessionKey || !progressKey) {
    return null;
  }

  const existingMeta = await readVolatileBackupMeta(sessionKey);
  const existingProgressMap =
    existingMeta && existingMeta.progressByKey && typeof existingMeta.progressByKey === "object"
      ? existingMeta.progressByKey
      : {};
  const nextProgressMap = {
    ...existingProgressMap,
    [progressKey]: {
      ...(existingProgressMap[progressKey] && typeof existingProgressMap[progressKey] === "object"
        ? existingProgressMap[progressKey]
        : {}),
      ...(patch && typeof patch === "object" ? patch : {}),
    },
  };

  return writeVolatileBackupMeta(sessionKey, {
    progressByKey: nextProgressMap,
  });
}

async function findLatestVolatileBackupMeta(options = {}) {
  const source = typeof options.source === "string" ? options.source : "";
  const selectionSignature =
    typeof options.selectionSignature === "string" ? options.selectionSignature : "";
  const statusSet = new Set(
    Array.isArray(options.statuses)
      ? options.statuses.filter((value) => typeof value === "string" && value)
      : [],
  );

  const metas = await listVolatileBackupMetas();
  const matchingMetas = metas.filter((meta) => {
    if (!meta || typeof meta !== "object") {
      return false;
    }

    if (source && meta.source !== source) {
      return false;
    }

    if (selectionSignature && meta.selectionSignature !== selectionSignature) {
      return false;
    }

    if (statusSet.size > 0 && !statusSet.has(meta.status)) {
      return false;
    }

    return typeof meta.sessionKey === "string" && meta.sessionKey;
  });

  matchingMetas.sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.startedAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.startedAt || 0).getTime();
    return rightTime - leftTime;
  });

  return matchingMetas[0] || null;
}

async function appendVolatileBackupItems(sessionKey, items, meta = {}) {
  if (!sessionKey) {
    return 0;
  }

  const sourceItems = Array.isArray(items) ? items : [];
  if (!sourceItems.length) {
    return 0;
  }

  const db = await openVolatileBackupDb();
  let storedCount = 0;
  const progressKey = typeof meta.progressKey === "string" ? meta.progressKey : "";

  for (let index = 0; index < sourceItems.length; index += VOLATILE_BACKUP_WRITE_CHUNK_SIZE) {
    const slice = sourceItems.slice(index, index + VOLATILE_BACKUP_WRITE_CHUNK_SIZE);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([VOLATILE_BACKUP_ITEM_STORE], "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not write volatile backup items."));
      const store = transaction.objectStore(VOLATILE_BACKUP_ITEM_STORE);
      for (const item of slice) {
        const record = buildVolatileBackupItemRecord(sessionKey, item, progressKey);
        if (!record) {
          continue;
        }
        storedCount += 1;
        store.put(record);
      }
    });
    await yieldForUi();
  }

  const {
    progressKey: _progressKey,
    ...metaWithoutProgressKey
  } = meta && typeof meta === "object" ? meta : {};
  await writeVolatileBackupMeta(sessionKey, metaWithoutProgressKey);
  return storedCount;
}

function normalizeCatalogSyncEntry(entry) {
  const sourceEntry = entry && typeof entry === "object" ? entry : {};

  return createDefaultCatalogSyncEntry({
    lastIncrementalSyncAt:
      typeof sourceEntry.lastIncrementalSyncAt === "string" && sourceEntry.lastIncrementalSyncAt
        ? sourceEntry.lastIncrementalSyncAt
        : null,
    lastFullSyncAt:
      typeof sourceEntry.lastFullSyncAt === "string" && sourceEntry.lastFullSyncAt
        ? sourceEntry.lastFullSyncAt
        : null,
    isExhaustive: sourceEntry.isExhaustive === true,
    selectionSignature:
      typeof sourceEntry.selectionSignature === "string" ? sourceEntry.selectionSignature : "",
    backupItemCount: Number.isFinite(Number(sourceEntry.backupItemCount))
      ? Math.max(0, Number(sourceEntry.backupItemCount))
      : 0,
    usesVolatileBackup: sourceEntry.usesVolatileBackup === true,
  });
}

function normalizeCatalogSourceSync(sourceSync) {
  const normalizedSync = sourceSync && typeof sourceSync === "object" ? sourceSync : {};

  return {
    profile: normalizeCatalogSyncEntry(normalizedSync.profile),
    drafts: normalizeCatalogSyncEntry(normalizedSync.drafts),
    likes: normalizeCatalogSyncEntry(normalizedSync.likes),
    characters: normalizeCatalogSyncEntry(normalizedSync.characters),
    characterAccounts: normalizeCatalogSyncEntry(normalizedSync.characterAccounts),
    creators: normalizeCatalogSyncEntry(normalizedSync.creators),
  };
}

function normalizeCatalogItems(items) {
  const itemMap = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") {
      continue;
    }

    const key = item.key || getItemKey(item);
    const { metadataEntries: _metadataEntries, ...compactItem } = item;
    itemMap.set(key, {
      ...compactItem,
      key,
    });
  }

  return [...itemMap.values()];
}

function compactItemForPopup(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") {
    return null;
  }

  return {
    key: item.key || getItemKey(item),
    id: item.id,
    sourcePage: item.sourcePage || "",
    sourceLabel: item.sourceLabel || "",
    sourceType: item.sourceType || "",
    attachmentIndex: Number.isInteger(item.attachmentIndex) ? item.attachmentIndex : 0,
    attachmentCount: Number.isInteger(item.attachmentCount) ? item.attachmentCount : 1,
    filename: typeof item.filename === "string" ? item.filename : "",
    thumbnailUrl: typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : "",
    downloadUrl: typeof item.downloadUrl === "string" ? item.downloadUrl : "",
    detailUrl: typeof item.detailUrl === "string" ? item.detailUrl : "",
    prompt: typeof item.prompt === "string" ? item.prompt : "",
    description: typeof item.description === "string" ? item.description : "",
    caption: typeof item.caption === "string" ? item.caption : "",
    discoveryPhrase: typeof item.discoveryPhrase === "string" ? item.discoveryPhrase : "",
    createdAt: item.createdAt ?? null,
    postedAt: item.postedAt ?? null,
    generationId: typeof item.generationId === "string" ? item.generationId : "",
    durationSeconds: item.durationSeconds ?? null,
    fileSizeBytes: item.fileSizeBytes ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
    likeCount: item.likeCount ?? null,
    viewCount: item.viewCount ?? null,
    shareCount: item.shareCount ?? null,
    repostCount: item.repostCount ?? null,
    remixCount: item.remixCount ?? null,
    isRemoved: item.isRemoved === true,
    isDownloaded: item.isDownloaded === true,
    creatorProfileId: typeof item.creatorProfileId === "string" ? item.creatorProfileId : "",
    creatorProfileDisplayName:
      typeof item.creatorProfileDisplayName === "string" ? item.creatorProfileDisplayName : "",
    creatorProfileUsername:
      typeof item.creatorProfileUsername === "string" ? item.creatorProfileUsername : "",
    characterAccountId: typeof item.characterAccountId === "string" ? item.characterAccountId : "",
    characterAccountDisplayName:
      typeof item.characterAccountDisplayName === "string" ? item.characterAccountDisplayName : "",
    characterAccountUsername:
      typeof item.characterAccountUsername === "string" ? item.characterAccountUsername : "",
  };
}

function estimatePopupPayloadBytes(value) {
  try {
    return JSON.stringify(value).length;
  } catch (_error) {
    return 0;
  }
}

function buildPopupStateSnapshot(state = currentState) {
  const sourceState = state && typeof state === "object" ? state : createDefaultState();
  const sourceItems = Array.isArray(sourceState.items) ? sourceState.items : [];
  const backedUpItemCount = Number.isFinite(Number(sourceState.backedUpItemCount))
    ? Math.max(0, Number(sourceState.backedUpItemCount))
    : 0;
  const limitedItems = [];
  let popupItemsBytes = 0;

  for (const item of sourceItems) {
    if (limitedItems.length >= POPUP_STATE_ITEM_LIMIT) {
      break;
    }

    const compactItem = compactItemForPopup(item);
    if (!compactItem) {
      continue;
    }

    const compactItemBytes = estimatePopupPayloadBytes(compactItem);
    if (
      limitedItems.length > 0 &&
      popupItemsBytes + compactItemBytes > POPUP_STATE_TARGET_BYTES
    ) {
      break;
    }

    limitedItems.push(compactItem);
    popupItemsBytes += compactItemBytes;
  }

  const visibleKeys = new Set(limitedItems.map((item) => item.key || getItemKey(item)));
  const selectedKeysTotal = Array.isArray(sourceState.selectedKeys)
    ? sourceState.selectedKeys.filter((key) => typeof key === "string").length
    : 0;
  const selectedKeys = Array.isArray(sourceState.selectedKeys)
    ? sourceState.selectedKeys.filter((key) => typeof key === "string" && visibleKeys.has(key))
    : [];
  const titleOverrides = pruneLegacyTitleOverrides(limitedItems, sourceState.titleOverrides);
  const totalItemCount = sourceItems.length + backedUpItemCount;
  const hiddenItemCount = Math.max(0, totalItemCount - limitedItems.length);
  const truncationWarning = hiddenItemCount > 0
    ? `Showing ${limitedItems.length.toLocaleString()} of ${totalItemCount.toLocaleString()} results in the popup to stay under Chrome's runtime and memory limits. Refine search or source scope to work with a smaller slice.`
    : "";
  const partialWarning = joinPartialWarnings([
    sourceState.partialWarning,
    truncationWarning,
  ]);

  return {
    ...sourceState,
    items: limitedItems,
    selectedKeys,
    titleOverrides,
    updateStatus: buildUpdateStatusSnapshot(),
    queued: Number.isFinite(Number(sourceState.queued))
      ? Number(sourceState.queued)
      : selectedKeysTotal,
    partialWarning,
    popupItemsTruncated: hiddenItemCount > 0,
    popupHiddenItemCount: hiddenItemCount,
    popupVisibleItemCount: limitedItems.length,
    popupTotalItemCount: totalItemCount,
    popupSelectedCountTotal: selectedKeysTotal,
  };
}

function setKeepAwakeEnabled(enabled) {
  if (!chrome.power) {
    keepAwakeRequested = false;
    return;
  }

  if (enabled) {
    if (keepAwakeRequested) {
      return;
    }

    chrome.power.requestKeepAwake("system");
    keepAwakeRequested = true;
    return;
  }

  if (!keepAwakeRequested) {
    return;
  }

  chrome.power.releaseKeepAwake();
  keepAwakeRequested = false;
}

function isVolatileLargeSourcePage(sourcePage) {
  return sourcePage === "creatorCharacters" || sourcePage === "creatorCharacterCameos";
}

function shouldPersistCatalogItem(item) {
  return !isVolatileLargeSourcePage(item && item.sourcePage);
}

function stripItemForPersistence(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string") {
    return null;
  }

  if (!shouldPersistCatalogItem(item)) {
    return null;
  }

  const {
    metadataEntries: _metadataEntries,
    ...persistedItem
  } = item;

  const key = persistedItem.key || getItemKey(persistedItem);
  return {
    ...persistedItem,
    key,
  };
}

function normalizePersistedItems(items) {
  const persistedItems = [];

  for (const item of normalizeCatalogItems(items)) {
    const persistedItem = stripItemForPersistence(item);
    if (persistedItem) {
      persistedItems.push(persistedItem);
    }
  }

  return persistedItems;
}

function buildPersistedItemKeys(items) {
  return normalizeCatalogItems(items)
    .filter((item) => shouldPersistCatalogItem(item))
    .map((item) => item.key || getItemKey(item));
}

function serializeStateForPersistence(state = currentState) {
  const persistedItemKeys = buildPersistedItemKeys(state && state.items);
  const persistedItemKeySet = new Set(persistedItemKeys);
  const nextState = {
    ...(state && typeof state === "object" ? state : createDefaultState()),
    profileIds: [],
    draftIds: [],
    likesIds: [],
    cameoIds: [],
    characterIds: [],
    creatorIds: [],
    items: [],
    itemKeys: persistedItemKeys,
    pendingItems: normalizePersistedItems(state && state.pendingItems),
    failedItems: normalizePersistedItems(state && state.failedItems),
    fetchProgress: createDefaultFetchProgress(),
  };

  nextState.selectedKeys = Array.isArray(nextState.selectedKeys)
    ? nextState.selectedKeys.filter(
      (value) => typeof value === "string" && persistedItemKeySet.has(value),
    )
    : [];
  nextState.titleOverrides = pruneLegacyTitleOverrides(
    normalizeCatalogItems(state && state.items).filter((item) => shouldPersistCatalogItem(item)),
    nextState.titleOverrides,
  );
  nextState.queued = nextState.selectedKeys.length;

  return nextState;
}

function serializeCatalogForPersistence(catalog = currentCatalog) {
  const sourceCatalog = catalog && typeof catalog === "object" ? catalog : createDefaultCatalogState();
  return {
    ...sourceCatalog,
    items: normalizePersistedItems(sourceCatalog.items),
    sourceSync: normalizeCatalogSourceSync(sourceCatalog.sourceSync),
  };
}

function restorePersistedItems(savedState, catalogItems) {
  const sourceState = savedState && typeof savedState === "object" ? savedState : null;
  const catalogByKey = new Map(
    normalizeCatalogItems(catalogItems).map((item) => [item.key || getItemKey(item), item]),
  );
  const savedItemKeys = Array.isArray(sourceState && sourceState.itemKeys)
    ? sourceState.itemKeys.filter((value) => typeof value === "string" && value)
    : [];

  if (savedItemKeys.length > 0) {
    return savedItemKeys
      .map((key) => catalogByKey.get(key))
      .filter((item) => Boolean(item));
  }

  return normalizeCatalogItems(sourceState && sourceState.items);
}

async function restoreState() {
  // Restore local-only extension state so the popup can reopen without losing the current
  // queue, previous results, or user preferences.
  try {
    const stored = await chrome.storage.local.get([STATE_KEY, CATALOG_STORAGE_KEY]);
    const savedState = stored && stored[STATE_KEY] ? stored[STATE_KEY] : null;
    if (stored && stored[STATE_KEY]) {
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
        automaticUpdatesEnabled: normalizeAutomaticUpdatesEnabled(
          currentState.settings.automaticUpdatesEnabled,
        ),
      };
      currentState.characterAccounts = normalizeCharacterAccounts(currentState.characterAccounts);
      if (currentState.hasExplicitCharacterAccountSelection !== true) {
        const savedSelection = Array.isArray(currentState.selectedCharacterAccountIds)
          ? currentState.selectedCharacterAccountIds.filter((value) => typeof value === "string")
          : [];
        const savedCharacterAccountIds = currentState.characterAccounts.map((account) => account.userId);
        const selectionMatchedEveryCharacterAccount =
          savedCharacterAccountIds.length > 0 &&
          savedSelection.length === savedCharacterAccountIds.length &&
          savedCharacterAccountIds.every((accountId) => savedSelection.includes(accountId));

        currentState = {
          ...currentState,
          selectedCharacterAccountIds: selectionMatchedEveryCharacterAccount ? [] : savedSelection,
          hasExplicitCharacterAccountSelection: true,
        };
      }
      currentState.creatorProfiles = normalizeResolvedCreatorProfiles(currentState.creatorProfiles);
      if (currentState.hasExplicitCreatorProfileSelection !== true) {
        const savedSelection = Array.isArray(currentState.selectedCreatorProfileIds)
          ? currentState.selectedCreatorProfileIds.filter((value) => typeof value === "string")
          : [];
        const savedCreatorIds = currentState.creatorProfiles.map((profile) => profile.profileId);
        const selectionMatchedEveryCreator =
          savedCreatorIds.length > 0 &&
          savedSelection.length === savedCreatorIds.length &&
          savedCreatorIds.every((profileId) => savedSelection.includes(profileId));

        currentState = {
          ...currentState,
          selectedCreatorProfileIds: selectionMatchedEveryCreator ? [] : savedSelection,
          hasExplicitCreatorProfileSelection: true,
        };
      }
      currentState.selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
        currentState.characterAccounts,
        currentState.selectedCharacterAccountIds,
        null,
        {
          allowEmpty: currentState.hasExplicitCharacterAccountSelection === true,
        },
      );
      currentState.selectedCreatorProfileIds = normalizeSelectedCreatorProfileIds(
        currentState.creatorProfiles,
        currentState.selectedCreatorProfileIds,
        null,
        {
          allowEmpty: currentState.hasExplicitCreatorProfileSelection === true,
        },
      );
      currentState.items = normalizeCatalogItems(currentState.items);
      currentState.titleOverrides = pruneLegacyTitleOverrides(
        currentState.items,
        currentState.titleOverrides,
      );
    }

    if (stored && stored[CATALOG_STORAGE_KEY]) {
      const savedCatalog = stored[CATALOG_STORAGE_KEY];
      currentCatalog = createDefaultCatalogState({
        ...savedCatalog,
        items: normalizeCatalogItems(savedCatalog.items),
        sourceSync: normalizeCatalogSourceSync(savedCatalog.sourceSync),
      });
    }

    const restoredItems = restorePersistedItems(savedState, currentCatalog.items);
    if (restoredItems.length > 0 || (savedState && Array.isArray(savedState.itemKeys))) {
      const restoredSourceIds = deriveSourceIdsFromItems(restoredItems);
      currentState = {
        ...currentState,
        items: restoredItems,
        profileIds: restoredSourceIds.profileIds,
        draftIds: restoredSourceIds.draftIds,
        likesIds: restoredSourceIds.likesIds,
        cameoIds: restoredSourceIds.cameoIds,
        characterIds: restoredSourceIds.characterIds,
        creatorIds: restoredSourceIds.creatorIds,
        fetchedCount: restoredItems.length,
        selectedKeys: normalizeSelectedKeys(restoredItems, currentState.selectedKeys),
        titleOverrides: pruneLegacyTitleOverrides(restoredItems, currentState.titleOverrides),
      };
    }
  } catch (error) {
    console.warn("Failed to restore extension state.", error);
  }
}

async function persistState(state = currentState) {
  const serializedState = serializeStateForPersistence(state);

  try {
    await chrome.storage.local.set({ [STATE_KEY]: serializedState });
  } catch (error) {
    if (!/quota/i.test(getErrorMessage(error))) {
      throw error;
    }

    console.warn("Storage quota exceeded while persisting state. Retrying with a minimal snapshot.");
    await chrome.storage.local.set({
      [STATE_KEY]: {
        ...serializedState,
        itemKeys: [],
        selectedKeys: [],
        titleOverrides: {},
        pendingItems: [],
        failedItems: [],
        queued: 0,
      },
    });
  }
}

async function persistCatalogState(catalog = currentCatalog) {
  const serializedCatalog = serializeCatalogForPersistence(catalog);

  try {
    await chrome.storage.local.set({ [CATALOG_STORAGE_KEY]: serializedCatalog });
  } catch (error) {
    if (!/quota/i.test(getErrorMessage(error))) {
      throw error;
    }

    console.warn("Storage quota exceeded while persisting the catalog. Retrying without cached items.");
    await chrome.storage.local.set({
      [CATALOG_STORAGE_KEY]: {
        ...serializedCatalog,
        items: [],
      },
    });
  }
}

async function setState(patch, options = {}) {
  currentState = {
    ...currentState,
    ...patch,
  };
  currentState.creatorProfiles = normalizeResolvedCreatorProfiles(currentState.creatorProfiles);
  currentState.selectedCreatorProfileIds = normalizeSelectedCreatorProfileIds(
    currentState.creatorProfiles,
    currentState.selectedCreatorProfileIds,
    [],
    { allowEmpty: true },
  );

  if (options.persist === false) {
    maybeResumeDeferredUpdate();
    return;
  }

  await persistState(currentState);
  maybeResumeDeferredUpdate();
}

async function setCatalogState(patch, options = {}) {
  currentCatalog = {
    ...currentCatalog,
    ...patch,
  };
  currentCatalog.items = normalizeCatalogItems(currentCatalog.items);
  currentCatalog.sourceSync = normalizeCatalogSourceSync(currentCatalog.sourceSync);

  if (options.persist === false) {
    return;
  }

  await persistCatalogState(currentCatalog);
}

function maybeResumeDeferredUpdate() {
  if (
    (currentUpdateState.phase !== "deferred" && currentUpdateState.phase !== "update-available") ||
    currentUpdateState.automaticUpdatesEnabled !== true ||
    isUpdaterBusyPhase() ||
    isUpdaterApplyBlocked()
  ) {
    return;
  }

  queueMicrotask(() => {
    void installPendingUpdate().catch((error) => {
      console.warn("Failed to resume the deferred Save Sora update.", error);
    });
  });
}

async function resetExtensionState() {
  activeVolatileBackupSessionKey = "";
  activeVolatileBackupResumeMeta = null;
  pausedFetchRequest = null;
  try {
    await clearVolatileBackups();
  } catch (error) {
    console.warn("Failed to clear volatile backups while resetting the extension state.", error);
  }

  await setState(
    createDefaultState({
      settings: {
        ...createDefaultState().settings,
        ...(currentState.settings && typeof currentState.settings === "object"
          ? currentState.settings
          : {}),
      },
      creatorProfiles: normalizeResolvedCreatorProfiles(currentState.creatorProfiles),
      selectedCreatorProfileIds: normalizeSelectedCreatorProfileIds(
        normalizeResolvedCreatorProfiles(currentState.creatorProfiles),
        currentState.selectedCreatorProfileIds,
        [],
        { allowEmpty: true },
      ),
      hasExplicitCreatorProfileSelection: true,
    }),
  );
}

async function clearLocalStorageState() {
  await chrome.storage.local.clear();
  activeVolatileBackupSessionKey = "";
  activeVolatileBackupResumeMeta = null;
  pausedFetchRequest = null;
  currentState = createDefaultState();
  currentCatalog = createDefaultCatalogState();
  await restoreUpdaterState();
}

function normalizeSources(input) {
  return normalizeSourceSelection(input, []);
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

function createArchiveJobId() {
  return `archive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildArchiveFilename(mode, now = new Date()) {
  const isoDate = now.toISOString().slice(0, 10);
  return mode === "retry" || mode === "archive-retry"
    ? `save-sora-retry-backup-${isoDate}.zip`
    : `save-sora-backup-${isoDate}.zip`;
}

function buildArchiveWorkItems(items) {
  const usedPaths = new Set();

  return (Array.isArray(items) ? items : []).map((item) => {
    const archivePath = uniquifyArchivePath(buildArchiveEntryPath(item), usedPaths);
    return {
      ...item,
      archivePath,
    };
  });
}

function buildArchiveEntryPath(item) {
  return `${getArchiveMediaFolderPath(item)}/${getArchiveFilename(item)}`;
}

function getArchiveMediaFolderPath(item) {
  switch (item && item.sourcePage) {
    case "profile":
      return "published";
    case "drafts":
      return "drafts";
    case "likes":
      return "liked";
    case "cameos":
      return "cameos";
    case "characters":
      return `characters/${getArchiveCharacterFolderName(item)}/${item && item.sourceType === "draft" ? "drafts" : "published"}`;
    case "creatorPublished":
      return `creators/${getArchiveCreatorFolderName(item)}/published`;
    case "creatorCameos":
      return `creators/${getArchiveCreatorFolderName(item)}/cameos`;
    case "creatorCharacters":
      return `creators/${getArchiveCreatorFolderName(item)}/characters`;
    case "creatorCharacterCameos":
      return `creators/${getArchiveCreatorFolderName(item)}/character-cameos`;
    default:
      return "videos";
  }
}

function getArchiveFolderImagePath(item) {
  if (!item || item.sourcePage !== "characters") {
    if (
      item &&
      (item.sourcePage === "creatorPublished" ||
        item.sourcePage === "creatorCameos" ||
        item.sourcePage === "creatorCharacters" ||
        item.sourcePage === "creatorCharacterCameos")
    ) {
      return getArchiveMediaFolderPath(item);
    }
    return getArchiveMediaFolderPath(item);
  }

  return `characters/${getArchiveCharacterFolderName(item)}`;
}

function getArchiveCharacterFolderName(item) {
  const preferredName =
    (item && item.characterAccountDisplayName) ||
    (item && item.characterAccountUsername) ||
    (item && item.characterAccountId) ||
    "character";
  return sanitizeFilenamePart(preferredName) || "character";
}

function getArchiveCreatorFolderName(item) {
  const preferredName =
    (item && item.creatorProfileDisplayName) ||
    (item && item.creatorProfileUsername) ||
    (item && item.creatorProfileId) ||
    "creator";
  return sanitizeFilenamePart(preferredName) || "creator";
}

function getArchiveFilename(item) {
  const rawFilename =
    item && typeof item.filename === "string" && item.filename
      ? item.filename
      : `${(item && item.id) || "video"}.mp4`;
  const lastSegment = rawFilename.split("/").pop() || rawFilename;
  const extensionMatch = lastSegment.match(/(\.[A-Za-z0-9]{1,10})$/);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : ".bin";
  const basename = extensionMatch ? lastSegment.slice(0, -extension.length) : lastSegment;
  const safeBasename = sanitizeFilenamePart(basename) || "video";
  return `${safeBasename}${extension}`;
}

function uniquifyArchivePath(desiredPath, usedPaths) {
  const normalizedPath = String(desiredPath || "").replace(/^\/+|\/+$/g, "");
  if (!usedPaths.has(normalizedPath)) {
    usedPaths.add(normalizedPath);
    return normalizedPath;
  }

  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  const folderPath = lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
  const filename = lastSlashIndex === -1 ? normalizedPath : normalizedPath.slice(lastSlashIndex + 1);
  const extensionMatch = filename.match(/(\.[A-Za-z0-9]{1,10})$/);
  const extension = extensionMatch ? extensionMatch[1] : "";
  const basename = extensionMatch ? filename.slice(0, -extension.length) : filename;

  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidateFilename = `${basename}-${suffix}${extension}`;
    const candidatePath = folderPath ? `${folderPath}/${candidateFilename}` : candidateFilename;
    if (!usedPaths.has(candidatePath)) {
      usedPaths.add(candidatePath);
      return candidatePath;
    }
  }

  usedPaths.add(normalizedPath);
  return normalizedPath;
}

function buildArchiveFolderImages(items) {
  const folderImages = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const candidate = getArchiveFolderImageCandidate(item);
    if (!candidate || folderImages.has(candidate.folderPath)) {
      continue;
    }

    folderImages.set(candidate.folderPath, candidate);
  }

  return [...folderImages.values()].sort((left, right) => left.folderPath.localeCompare(right.folderPath));
}

function getArchiveFolderImageCandidate(item) {
  if (!item) {
    return null;
  }

  if (
    item.sourcePage === "characters" &&
    typeof item.characterAccountProfilePictureUrl === "string" &&
    item.characterAccountProfilePictureUrl
  ) {
    return {
      folderPath: getArchiveFolderImagePath(item),
      imageUrl: item.characterAccountProfilePictureUrl,
    };
  }

  if (typeof item.creatorProfilePictureUrl === "string" && item.creatorProfilePictureUrl) {
    return {
      folderPath: getArchiveFolderImagePath(item),
      imageUrl: item.creatorProfilePictureUrl,
    };
  }

  return null;
}

function createArchiveJobContext(downloadItems, options) {
  const archiveItems = buildArchiveWorkItems(downloadItems);
  return {
    jobId: createArchiveJobId(),
    mode: options && options.mode ? options.mode : "selected",
    archiveFilename: buildArchiveFilename(options && options.mode ? options.mode : "selected"),
    total: Number(options && options.totalTarget) || archiveItems.length,
    itemsByKey: new Map(archiveItems.map((item) => [item.key || getItemKey(item), item])),
    pendingItems: [...archiveItems],
    successfulItems: [],
    failedItems: [],
    folderImages: buildArchiveFolderImages(archiveItems),
    resolve: null,
    reject: null,
  };
}

function deriveSourceIdsFromItems(items) {
  const profileIds = new Set();
  const draftIds = new Set();
  const likesIds = new Set();
  const cameoIds = new Set();
  const characterIds = new Set();
  const creatorIds = new Set();

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
    } else if (
      item.sourcePage === "creatorPublished" ||
      item.sourcePage === "creatorCameos" ||
      item.sourcePage === "creatorCharacters" ||
      item.sourcePage === "creatorCharacterCameos"
    ) {
      creatorIds.add(item.id);
    }
  }

  return {
    profileIds: [...profileIds],
    draftIds: [...draftIds],
    likesIds: [...likesIds],
    cameoIds: [...cameoIds],
    characterIds: [...characterIds],
    creatorIds: [...creatorIds],
  };
}

function getCatalogSourceForItem(item) {
  if (!item || typeof item.sourcePage !== "string") {
    return null;
  }

  if (item.sourcePage === "profile") {
    return "profile";
  }

  if (item.sourcePage === "drafts") {
    return "drafts";
  }

  if (item.sourcePage === "likes") {
    return "likes";
  }

  if (item.sourcePage === "cameos") {
    return "characters";
  }

  if (item.sourcePage === "characters") {
    return "characterAccounts";
  }

  if (
    item.sourcePage === "creatorPublished" ||
    item.sourcePage === "creatorCameos" ||
    item.sourcePage === "creatorCharacters" ||
    item.sourcePage === "creatorCharacterCameos"
  ) {
    return "creators";
  }

  return null;
}

function itemMatchesSourceSelection(
  item,
  sources,
  selectedCharacterAccountIds = [],
  selectedCreatorProfileIds = [],
) {
  const source = getCatalogSourceForItem(item);
  if (!source || !Array.isArray(sources) || !sources.includes(source)) {
    return false;
  }

  if (source !== "characterAccounts" && source !== "creators") {
    return true;
  }

  const selectedIds = new Set(source === "characterAccounts"
    ? Array.isArray(selectedCharacterAccountIds)
      ? selectedCharacterAccountIds
      : []
    : Array.isArray(selectedCreatorProfileIds)
      ? selectedCreatorProfileIds
      : []);
  if (selectedIds.size === 0) {
    return false;
  }

  if (source === "creators") {
    return (
      typeof item.creatorProfileId === "string" &&
      item.creatorProfileId &&
      selectedIds.has(item.creatorProfileId)
    );
  }

  return (
    typeof item.characterAccountId !== "string" ||
    !item.characterAccountId ||
    selectedIds.has(item.characterAccountId)
  );
}

function getCharacterAccountSelectionSignature(selectedCharacterAccountIds = []) {
  return [...new Set(Array.isArray(selectedCharacterAccountIds) ? selectedCharacterAccountIds : [])]
    .filter((value) => typeof value === "string" && value)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function getCreatorProfileSelectionSignature(selectedCreatorProfileIds = []) {
  const selectedIds = [...new Set(Array.isArray(selectedCreatorProfileIds) ? selectedCreatorProfileIds : [])]
    .filter((value) => typeof value === "string" && value)
    .sort((left, right) => left.localeCompare(right));
  return `${CREATOR_SOURCE_SELECTION_SIGNATURE_VERSION}:${selectedIds.join("|")}`;
}

function getCreatorProfileSelectionPreferenceSignature(creatorProfiles, selectedCreatorProfileIds = []) {
  const profileMap = new Map(
    normalizeCreatorProfiles(creatorProfiles).map((profile) => [profile.profileId, profile]),
  );
  const selectedIds = normalizeSelectedCreatorProfileIds(
    creatorProfiles,
    selectedCreatorProfileIds,
    [],
    { allowEmpty: true },
  );

  const signature = selectedIds
    .map((profileId) => {
      const profile = profileMap.get(profileId);
      const preferences = normalizeCreatorFetchPreferences(profile);
      return `${profileId}:${preferences.includeOfficialPosts ? "1" : "0"}:${preferences.includeCommunityPosts ? "1" : "0"}`;
    })
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  return `${CREATOR_SOURCE_SELECTION_SIGNATURE_VERSION}:${signature}`;
}

function getSourceSelectionSignature(source, options = {}) {
  if (source === "characterAccounts") {
    return getCharacterAccountSelectionSignature(options.selectedCharacterAccountIds);
  }

  if (source === "creators") {
    return getCreatorProfileSelectionPreferenceSignature(
      options.creatorProfiles,
      options.selectedCreatorProfileIds,
    );
  }

  return "";
}

function getCreatorProfileExpectedPostCount(profile) {
  const profileData =
    profile && profile.profileData && typeof profile.profileData === "object"
      ? profile.profileData
      : null;
  const candidates = [
    profileData && profileData.post_count,
    profileData && profileData.postCount,
    profileData && profileData.posts_count,
    profileData && profileData.postsCount,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }

  return 0;
}

function getExpectedCreatorSelectionCount(creatorProfiles, selectedCreatorProfileIds) {
  const selectedIds = new Set(
    normalizeSelectedCreatorProfileIds(creatorProfiles, selectedCreatorProfileIds, [], {
      allowEmpty: true,
    }),
  );

  if (selectedIds.size === 0) {
    return 0;
  }

  let expectedCount = 0;
  for (const profile of normalizeCreatorProfiles(creatorProfiles)) {
    if (!selectedIds.has(profile.profileId)) {
      continue;
    }

    expectedCount += getCreatorProfileExpectedItemCount(profile);
  }

  return expectedCount;
}

function getCreatorFeedPageCap(creatorProfile) {
  const expectedCount = getCreatorProfileExpectedPostCount(creatorProfile);
  if (!expectedCount) {
    return CREATOR_PROFILE_FEED_MIN_PAGE_CAP;
  }

  const expectedPages =
    Math.ceil(expectedCount / Math.max(1, CREATOR_PROFILE_FEED_LIMIT)) +
    CREATOR_PROFILE_FEED_PAGE_BUFFER;

  return Math.min(
    CREATOR_PROFILE_FEED_MAX_PAGE_CAP,
    Math.max(CREATOR_PROFILE_FEED_MIN_PAGE_CAP, expectedPages),
  );
}

function getProfileFeedPageCap(expectedCount) {
  const numericExpectedCount = Number(expectedCount);
  if (!Number.isFinite(numericExpectedCount) || numericExpectedCount <= 0) {
    return CREATOR_PROFILE_FEED_MIN_PAGE_CAP;
  }

  const expectedPages =
    Math.ceil(numericExpectedCount / Math.max(1, CREATOR_PROFILE_FEED_LIMIT)) +
    CREATOR_PROFILE_FEED_PAGE_BUFFER;

  return Math.min(
    CREATOR_PROFILE_FEED_MAX_PAGE_CAP,
    Math.max(CREATOR_PROFILE_FEED_MIN_PAGE_CAP, expectedPages),
  );
}

function buildWorkingItemsFromCatalog(
  catalogItems,
  sources,
  maxVideos,
  selectedCharacterAccountIds = currentState.selectedCharacterAccountIds,
  selectedCreatorProfileIds = currentState.selectedCreatorProfileIds,
) {
  const matchingItems = normalizeCatalogItems(catalogItems).filter((item) =>
    itemMatchesSourceSelection(item, sources, selectedCharacterAccountIds, selectedCreatorProfileIds),
  );
  const sortedItems = sortItemsByNewest(matchingItems);
  const normalizedMaxVideos = getMaxVideosSetting({ maxVideos });
  if (normalizedMaxVideos && sortedItems.length > normalizedMaxVideos) {
    sortedItems.length = normalizedMaxVideos;
  }

  return sortedItems;
}

function getKnownItemKeysForSource(
  source,
  catalogItems = currentCatalog.items,
  selectedCharacterAccountIds = currentState.selectedCharacterAccountIds,
  selectedCreatorProfileIds = currentState.selectedCreatorProfileIds,
) {
  const knownKeys = new Set();

  for (const item of normalizeCatalogItems(catalogItems)) {
    if (!itemMatchesSourceSelection(item, [source], selectedCharacterAccountIds, selectedCreatorProfileIds)) {
      continue;
    }

    knownKeys.add(item.key || getItemKey(item));
  }

  return knownKeys;
}

function getCatalogSyncEntryForSource(source) {
  const sourceSync = currentCatalog.sourceSync && typeof currentCatalog.sourceSync === "object"
    ? currentCatalog.sourceSync
    : createDefaultCatalogState().sourceSync;

  return normalizeCatalogSyncEntry(sourceSync[source]);
}

function shouldRunFullSourceRefresh(source, options = {}) {
  const existingKeys = getKnownItemKeysForSource(
    source,
    options.catalogItems,
    options.selectedCharacterAccountIds,
    options.selectedCreatorProfileIds,
  );
  if (existingKeys.size === 0) {
    return true;
  }

  const syncEntry = getCatalogSyncEntryForSource(source);
  if (syncEntry.usesVolatileBackup === true) {
    return true;
  }
  const selectionSignature =
    getSourceSelectionSignature(source, options);
  if (!syncEntry.lastFullSyncAt) {
    return true;
  }

  if ((source === "characterAccounts" || source === "creators") && syncEntry.selectionSignature !== selectionSignature) {
    return true;
  }

  if (source === "creators") {
    const expectedCreatorCount = getExpectedCreatorSelectionCount(
      options.creatorProfiles,
      options.selectedCreatorProfileIds,
    );
    const availableCount = Math.max(existingKeys.size, Number(syncEntry.backupItemCount) || 0);
    if (expectedCreatorCount > 0 && availableCount < expectedCreatorCount) {
      return true;
    }
  }

  const lastFullSyncTime = new Date(syncEntry.lastFullSyncAt).getTime();
  if (!Number.isFinite(lastFullSyncTime)) {
    return true;
  }

  if (Date.now() - lastFullSyncTime >= CATALOG_FULL_REFRESH_INTERVAL_MS) {
    return true;
  }

  const normalizedMaxVideos = getMaxVideosSetting({ maxVideos: options.maxVideos });
  if (!syncEntry.isExhaustive) {
    if (!normalizedMaxVideos) {
      return true;
    }

    if (normalizedMaxVideos > existingKeys.size) {
      return true;
    }
  }

  return false;
}

function shouldReplaceCatalogItemForSource(
  item,
  source,
  selectedCharacterAccountIds = [],
  selectedCreatorProfileIds = [],
) {
  if (!itemMatchesSourceSelection(item, [source], selectedCharacterAccountIds, selectedCreatorProfileIds)) {
    if (source === "characterAccounts" || source === "creators") {
      return getCatalogSourceForItem(item) === source;
    }
    return false;
  }

  if (source !== "characterAccounts" && source !== "creators") {
    return true;
  }

  const selectedIds = new Set(source === "characterAccounts"
    ? Array.isArray(selectedCharacterAccountIds)
      ? selectedCharacterAccountIds
      : []
    : Array.isArray(selectedCreatorProfileIds)
      ? selectedCreatorProfileIds
      : []);
  if (selectedIds.size === 0) {
    return true;
  }

  if (source === "creators") {
    return typeof item.creatorProfileId === "string" && selectedIds.has(item.creatorProfileId);
  }

  return typeof item.characterAccountId === "string" && selectedIds.has(item.characterAccountId);
}

function mergeCatalogItemsWithSourceResults(
  existingItems,
  sourceResults,
  selectedCharacterAccountIds = currentState.selectedCharacterAccountIds,
  selectedCreatorProfileIds = currentState.selectedCreatorProfileIds,
) {
  const itemMap = new Map(
    normalizeCatalogItems(existingItems).map((item) => [item.key || getItemKey(item), item]),
  );

  for (const sourceResult of Array.isArray(sourceResults) ? sourceResults : []) {
    if (!sourceResult || typeof sourceResult.source !== "string") {
      continue;
    }

    if (sourceResult.syncMode === "full") {
      for (const [key, item] of itemMap.entries()) {
        if (
          shouldReplaceCatalogItemForSource(
            item,
            sourceResult.source,
            selectedCharacterAccountIds,
            selectedCreatorProfileIds,
          )
        ) {
          itemMap.delete(key);
        }
      }
    }

    for (const item of normalizeCatalogItems(sourceResult.items)) {
      const key = item.key || getItemKey(item);
      itemMap.set(key, {
        ...item,
        key,
      });
    }
  }

  return [...itemMap.values()];
}

function buildUpdatedCatalogSourceSync(sourceResults) {
  const nextSourceSync = normalizeCatalogSourceSync(currentCatalog.sourceSync);
  const syncedAt = new Date().toISOString();

  for (const sourceResult of Array.isArray(sourceResults) ? sourceResults : []) {
    if (!sourceResult || typeof sourceResult.source !== "string") {
      continue;
    }

    nextSourceSync[sourceResult.source] = {
      ...nextSourceSync[sourceResult.source],
      lastIncrementalSyncAt: syncedAt,
      lastFullSyncAt:
        sourceResult.syncMode === "full"
          ? syncedAt
          : nextSourceSync[sourceResult.source].lastFullSyncAt,
      isExhaustive:
        sourceResult.syncMode === "full"
          ? sourceResult.isExhaustive === true
          : nextSourceSync[sourceResult.source].isExhaustive,
      selectionSignature:
        typeof sourceResult.selectionSignature === "string"
          ? sourceResult.selectionSignature
          : nextSourceSync[sourceResult.source].selectionSignature,
      backupItemCount: Number.isFinite(Number(sourceResult.backupItemCount))
        ? Math.max(0, Number(sourceResult.backupItemCount))
        : 0,
      usesVolatileBackup: sourceResult.usesVolatileBackup === true,
    };
  }

  return nextSourceSync;
}

function updateCatalogItemsWithMutation(itemKeys, mutation) {
  const keySet = new Set(Array.isArray(itemKeys) ? itemKeys : []);
  if (!keySet.size || typeof mutation !== "function") {
    return currentCatalog.items;
  }

  return normalizeCatalogItems(currentCatalog.items).map((item) => {
    const key = item.key || getItemKey(item);
    if (!keySet.has(key)) {
      return item;
    }

    return {
      ...mutation(item),
      key,
    };
  });
}

async function applyCatalogItemMutation(itemKeys, mutation, options = {}) {
  await setCatalogState({
    items: updateCatalogItemsWithMutation(itemKeys, mutation),
  }, options);
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
    item && typeof item.id === "string" ? item.id : "",
    getDefaultItemTitle(item),
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

async function filterItemsBySearchQueryWithProgress(items, searchQuery, options = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  const normalizedQuery = normalizeSearchText(searchQuery);
  if (!normalizedQuery) {
    if (typeof options.onProgress === "function") {
      await options.onProgress({
        processedCount: sourceItems.length,
        totalCount: sourceItems.length,
        matchedCount: sourceItems.length,
      });
    }
    return sourceItems;
  }

  const filteredItems = [];
  for (let index = 0; index < sourceItems.length; index += FETCH_PROGRESS_CHUNK_SIZE) {
    throwIfFetchAbortRequested();
    const sliceEnd = Math.min(sourceItems.length, index + FETCH_PROGRESS_CHUNK_SIZE);

    for (let itemIndex = index; itemIndex < sliceEnd; itemIndex += 1) {
      const item = sourceItems[itemIndex];
      if (itemMatchesSearchQuery(item, normalizedQuery)) {
        filteredItems.push(item);
      }
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        processedCount: sliceEnd,
        totalCount: sourceItems.length,
        matchedCount: filteredItems.length,
      });
    }

    if (sliceEnd < sourceItems.length) {
      await yieldForUi();
    }
  }

  return filteredItems;
}

async function buildScanSelectionState(items, options = {}) {
  const profileIds = new Set();
  const draftIds = new Set();
  const likesIds = new Set();
  const cameoIds = new Set();
  const characterIds = new Set();
  const creatorIds = new Set();
  const selectedKeys = [];
  const sourceItems = Array.isArray(items) ? items : [];

  for (let index = 0; index < sourceItems.length; index += FETCH_PROGRESS_CHUNK_SIZE) {
    throwIfFetchAbortRequested();
    const sliceEnd = Math.min(sourceItems.length, index + FETCH_PROGRESS_CHUNK_SIZE);

    for (let itemIndex = index; itemIndex < sliceEnd; itemIndex += 1) {
      const item = sourceItems[itemIndex];
      if (!item) {
        continue;
      }

      const key = item.key || getItemKey(item);
      selectedKeys.push(key);

      if (typeof item.id === "string") {
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
        } else if (
          item.sourcePage === "creatorPublished" ||
          item.sourcePage === "creatorCameos" ||
          item.sourcePage === "creatorCharacters" ||
          item.sourcePage === "creatorCharacterCameos"
        ) {
          creatorIds.add(item.id);
        }
      }
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        processedCount: sliceEnd,
        totalCount: sourceItems.length,
        selectedCount: selectedKeys.length,
      });
    }

    if (sliceEnd < sourceItems.length) {
      await yieldForUi();
    }
  }

  return {
    filteredSourceIds: {
      profileIds: [...profileIds],
      draftIds: [...draftIds],
      likesIds: [...likesIds],
      cameoIds: [...cameoIds],
      characterIds: [...characterIds],
      creatorIds: [...creatorIds],
    },
    selectedKeys: normalizeSelectedKeys(sourceItems, selectedKeys),
  };
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
  return normalizeSourceSelection(value, []);
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
      value === "characterAccounts" ||
      value === "creators"
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

function getEffectiveMaxVideosForSources(sources, settings = currentState.settings) {
  const normalizedSources = Array.isArray(sources) ? sources : [];
  if (normalizedSources.includes("creators")) {
    return null;
  }

  return getMaxVideosSetting(settings);
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

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== "function") {
    throw new Error("This version of Chrome does not support the ZIP archive worker.");
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (await hasOffscreenDocument(offscreenUrl)) {
    return;
  }

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["BLOBS"],
    justification: "Build a local ZIP archive and create the final blob URL without opening a visible tab.",
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function hasOffscreenDocument(offscreenUrl) {
  if (chrome.runtime && typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function closeOffscreenDocumentIfPresent() {
  if (!chrome.offscreen || typeof chrome.offscreen.closeDocument !== "function") {
    return;
  }

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  if (!(await hasOffscreenDocument(offscreenUrl))) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
  } catch (_error) {
    // Ignore close races when the document has already been torn down.
  }
}

async function releaseOffscreenArchiveObjectUrl(objectUrl) {
  if (typeof objectUrl !== "string" || !objectUrl) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      target: OFFSCREEN_TARGET,
      type: RELEASE_ARCHIVE_OBJECT_URL,
      objectUrl,
    });
  } catch (_error) {
    // Ignore cleanup failures because the object URL only lives within the extension process.
  }
}

async function startOffscreenArchiveBuild(job) {
  if (!job || typeof job.jobId !== "string") {
    throw new Error("The archive job could not be initialized.");
  }

  await ensureOffscreenDocument();

  const completionPromise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  const response = await chrome.runtime.sendMessage({
    target: OFFSCREEN_TARGET,
    type: START_ARCHIVE_BUILD,
    jobId: job.jobId,
    items: job.pendingItems.map(serializeArchiveItemForOffscreen),
    folderImages: job.folderImages,
  });

  if (!response || !response.ok) {
    job.resolve = null;
    job.reject = null;
    throw new Error((response && response.error) || "Could not start the ZIP archive worker.");
  }

  return completionPromise;
}

function serializeArchiveItemForOffscreen(item) {
  return {
    key: item && typeof item.key === "string" ? item.key : getItemKey(item || {}),
    downloadUrl: item && typeof item.downloadUrl === "string" ? item.downloadUrl : "",
    archivePath: item && typeof item.archivePath === "string" ? item.archivePath : "",
    createdAt: item && typeof item.createdAt === "string" ? item.createdAt : null,
    postedAt: item && typeof item.postedAt === "string" ? item.postedAt : null,
  };
}

async function requestArchiveAbort(jobId) {
  if (typeof jobId !== "string" || !jobId) {
    return;
  }

  try {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      target: OFFSCREEN_TARGET,
      type: ABORT_ARCHIVE_BUILD,
      jobId,
    });
  } catch (_error) {
    // Ignore abort transport failures and let the active run settle naturally.
  }
}

async function handleOffscreenArchiveStage(message) {
  if (!activeArchiveJob || activeArchiveJob.jobId !== message.jobId) {
    return;
  }

  await setState({
    message:
      typeof message.message === "string" && message.message
        ? message.message
        : currentState.message,
  }, { persist: false });
}

async function handleOffscreenArchiveItemResult(message) {
  if (!activeArchiveJob || activeArchiveJob.jobId !== message.jobId) {
    return;
  }

  const item = takeActiveArchivePendingItem(message.itemKey);
  if (!item) {
    return;
  }

  if (message.success) {
    activeArchiveJob.successfulItems.push(item);
  } else {
    activeArchiveJob.failedItems.push(
      createQueueSnapshotItem(
        item,
        typeof message.error === "string" && message.error
          ? message.error
          : "Could not add the item to the ZIP archive.",
      ),
    );
  }

  const completed = activeArchiveJob.successfulItems.length;
  const failedCount = activeArchiveJob.failedItems.length;
  const pendingCount = activeArchiveJob.pendingItems.length;
  const shouldPersistProgress = shouldPersistDownloadProgress(completed, failedCount, pendingCount);

  await setState({
    completed,
    failed: failedCount,
    failedItems: [...activeArchiveJob.failedItems],
    queued: pendingCount,
    pendingItems: createQueueSnapshots(activeArchiveJob.pendingItems),
    currentSource: item.sourcePage,
    lastError:
      message.success || !(typeof message.error === "string")
        ? ""
        : message.error,
    message: message.success
      ? `Packed ${completed + failedCount} of ${activeArchiveJob.total} into the ZIP archive...`
      : `Skipped ${item.filename}`,
  }, {
    persist: shouldPersistProgress,
  });
}

async function handleOffscreenArchiveComplete(message) {
  if (
    !activeArchiveJob ||
    activeArchiveJob.jobId !== message.jobId ||
    typeof activeArchiveJob.resolve !== "function"
  ) {
    return;
  }

  const resolve = activeArchiveJob.resolve;
  activeArchiveJob.resolve = null;
  activeArchiveJob.reject = null;
  resolve({
    objectUrl:
      typeof message.objectUrl === "string" && message.objectUrl ? message.objectUrl : null,
    sizeBytes: Number(message.sizeBytes) || 0,
  });
}

async function handleOffscreenArchiveError(message) {
  if (
    !activeArchiveJob ||
    activeArchiveJob.jobId !== message.jobId ||
    typeof activeArchiveJob.reject !== "function"
  ) {
    return;
  }

  const reject = activeArchiveJob.reject;
  activeArchiveJob.resolve = null;
  activeArchiveJob.reject = null;
  reject(
    message && message.aborted
      ? createControlError("abort", (message && message.error) || "The ZIP archive was canceled.")
      : new Error((message && message.error) || "Could not build the ZIP archive."),
  );
}

function takeActiveArchivePendingItem(itemKey) {
  if (!activeArchiveJob || typeof itemKey !== "string" || !itemKey) {
    return null;
  }

  const itemIndex = activeArchiveJob.pendingItems.findIndex(
    (candidate) => (candidate.key || getItemKey(candidate)) === itemKey,
  );
  if (itemIndex === -1) {
    return null;
  }

  const [item] = activeArchiveJob.pendingItems.splice(itemIndex, 1);
  return item;
}

async function refreshArchiveItemUrl(itemKey) {
  if (typeof itemKey !== "string" || !itemKey) {
    throw new Error("A valid archive item key is required.");
  }

  const activeItem =
    activeArchiveJob && activeArchiveJob.itemsByKey instanceof Map
      ? activeArchiveJob.itemsByKey.get(itemKey)
      : null;
  const currentItem =
    activeItem ||
    normalizeCatalogItems(currentState.items).find((item) => (item.key || getItemKey(item)) === itemKey);

  if (!currentItem) {
    throw new Error("The archive item could not be found.");
  }

  const refreshedItem = applyTitleOverride(
    {
      ...currentItem,
      ...(await refreshDownloadUrl(currentItem)),
      key: itemKey,
      archivePath: activeItem && typeof activeItem.archivePath === "string" ? activeItem.archivePath : undefined,
    },
    currentState.titleOverrides,
  );

  if (activeArchiveJob && activeArchiveJob.itemsByKey instanceof Map) {
    const previousItem = activeArchiveJob.itemsByKey.get(itemKey);
    const nextItem = {
      ...(previousItem || currentItem),
      ...refreshedItem,
      archivePath:
        previousItem && typeof previousItem.archivePath === "string"
          ? previousItem.archivePath
          : refreshedItem.archivePath,
    };
    activeArchiveJob.itemsByKey.set(itemKey, nextItem);
    activeArchiveJob.pendingItems = activeArchiveJob.pendingItems.map((item) =>
      (item.key || getItemKey(item)) === itemKey
        ? {
            ...item,
            ...nextItem,
            archivePath: item.archivePath,
          }
        : item,
    );
  }

  return {
    downloadUrl: refreshedItem.downloadUrl,
  };
}

function isFetchAbortRequested() {
  return currentState.phase === "fetching" && requestedControlAction === "abort";
}

function throwIfFetchAbortRequested() {
  if (currentState.phase === "fetching" && requestedControlAction === "pause") {
    throw createControlError("pause", "Fetch paused.");
  }

  if (isFetchAbortRequested()) {
    throw createControlError("abort", "Fetch aborted.");
  }
}

async function startScan(requestedSources, requestedSearchQuery = "") {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  const sources = normalizeSources(requestedSources);
  const searchQuery = normalizeSearchText(requestedSearchQuery);
  pausedFetchRequest = {
    sources: [...sources],
    searchQuery,
  };

  if (sources.length === 0) {
    throw new Error("Select at least one source to fetch.");
  }

  if (sources.includes("characterAccounts")) {
    await ensureCharacterAccountsLoaded();
  }

  activeVolatileBackupSessionKey = "";
  activeVolatileBackupResumeMeta = null;
  if (sources.includes("creators") && !searchQuery) {
    try {
      const selectionSignature = getSourceSelectionSignature("creators", {
        creatorProfiles: currentState.creatorProfiles,
        selectedCreatorProfileIds: currentState.selectedCreatorProfileIds,
      });
      const resumableMeta = await findLatestVolatileBackupMeta({
        source: "creators",
        selectionSignature,
        statuses: ["running", "paused", "error"],
      });

      if (resumableMeta) {
        activeVolatileBackupSessionKey = resumableMeta.sessionKey;
        activeVolatileBackupResumeMeta = resumableMeta;
        await writeVolatileBackupMeta(activeVolatileBackupSessionKey, {
          source: "creators",
          selectionSignature,
          status: "running",
          resumedAt: new Date().toISOString(),
          error: "",
        });
      } else {
        activeVolatileBackupSessionKey = createVolatileBackupSessionKey();
        await writeVolatileBackupMeta(
          activeVolatileBackupSessionKey,
          {
            startedAt: new Date().toISOString(),
            source: "creators",
            selectionSignature,
            status: "running",
            progressByKey: {},
          },
          { merge: false },
        );
      }
    } catch (error) {
      console.warn("Could not initialize the volatile backup store.", error);
      activeVolatileBackupSessionKey = "";
      activeVolatileBackupResumeMeta = null;
    }
  }

  setKeepAwakeEnabled(true);
  activeRun = scanSources(sources, searchQuery);
  try {
    await activeRun;
    pausedFetchRequest = null;
  } finally {
    activeRun = null;
    activeVolatileBackupSessionKey = "";
    activeVolatileBackupResumeMeta = null;
    try {
      await cleanupHiddenTab();
    } finally {
      setKeepAwakeEnabled(false);
    }
  }
}

async function requestScanAbort() {
  if (currentState.phase !== "fetching") {
    throw new Error("There is no active fetch to cancel.");
  }

  requestedControlAction = "abort";

  await setState({
    message: "Stopping the active fetch...",
    fetchProgress: getNextFetchProgress({
      stage: "aborting",
      stageLabel: "Stopping fetch",
      detail: "Canceling the active fetch and restoring your current results...",
    }),
  }, { persist: false });

  await cleanupHiddenTab();
}

async function requestScanPause() {
  if (currentState.phase !== "fetching") {
    throw new Error("There is no active fetch to pause.");
  }

  requestedControlAction = "pause";

  await setState({
    message: "Pausing the active fetch...",
    fetchProgress: getNextFetchProgress({
      stage: "pausing",
      stageLabel: "Pausing fetch",
      detail: "Saving progress so you can resume this crawl without starting over...",
    }),
  }, { persist: false });

  await cleanupHiddenTab();
}

async function resumeScan() {
  if (activeRun) {
    throw new Error("A fetch or download run is already in progress.");
  }

  if (currentState.phase !== "fetch-paused" || !pausedFetchRequest) {
    throw new Error("There is no paused fetch to resume.");
  }

  const request = { ...pausedFetchRequest };
  pausedFetchRequest = null;
  await startScan(request.sources, request.searchQuery);
}

async function abortPausedScan() {
  if (currentState.phase !== "fetch-paused") {
    throw new Error("There is no paused fetch to cancel.");
  }

  const activeItems = Array.isArray(currentState.items) ? currentState.items : [];
  const nextSelectedKeys = normalizeSelectedKeys(activeItems, currentState.selectedKeys);
  const volatileBackupSessionKey =
    activeVolatileBackupSessionKey ||
    (activeVolatileBackupResumeMeta && activeVolatileBackupResumeMeta.sessionKey) ||
    "";

  await setState({
    phase: activeItems.length ? "ready" : "complete",
    message: activeItems.length
      ? "The paused fetch was canceled. Showing your current results."
      : "The paused fetch was canceled.",
    currentSource: null,
    fetchedCount: activeItems.length + (Number(currentState.backedUpItemCount) || 0),
    selectedKeys: nextSelectedKeys,
    queued: nextSelectedKeys.length,
    fetchProgress: createDefaultFetchProgress(),
    lastError: "",
    finishedAt: new Date().toISOString(),
  });

  pausedFetchRequest = null;
  activeVolatileBackupResumeMeta = null;

  if (volatileBackupSessionKey) {
    await writeVolatileBackupMeta(volatileBackupSessionKey, {
      status: "aborted",
      error: "",
    });
  }
}

async function scanSources(sources, searchQuery = "") {
  // A scan now starts from the local catalog so previously fetched results appear
  // immediately, then reconciles against Sora and merges any new or changed items.
  const maxVideos = getEffectiveMaxVideosForSources(sources, currentState.settings);
  const selectedCharacterAccountIds = [...currentState.selectedCharacterAccountIds];
  const selectedCreatorProfileIds = [...currentState.selectedCreatorProfileIds];
  const cachedWorkingItems = buildWorkingItemsFromCatalog(
    currentCatalog.items,
    sources,
    maxVideos,
    selectedCharacterAccountIds,
    selectedCreatorProfileIds,
  );
  const cachedFilteredItems = filterItemsBySearchQuery(cachedWorkingItems, searchQuery);
  const cachedSelectedKeys = normalizeSelectedKeys(
    cachedFilteredItems,
    cachedFilteredItems.map((item) => item.key || getItemKey(item)),
  );
  const cachedSourceIds = deriveSourceIdsFromItems(cachedFilteredItems);
  const cachedTitleOverrides = pruneLegacyTitleOverrides(
    cachedFilteredItems,
    currentState.titleOverrides,
  );

  await setState(
    createDefaultState({
      phase: "fetching",
      message: cachedFilteredItems.length
        ? `Loaded ${cachedFilteredItems.length} cached item(s). Checking Sora for updates...`
        : "Opening Sora...",
      settings: currentState.settings,
      currentSource: sources[0] ?? null,
      characterAccounts: currentState.characterAccounts,
      selectedCharacterAccountIds,
      creatorProfiles: currentState.creatorProfiles,
      selectedCreatorProfileIds,
      profileIds: cachedSourceIds.profileIds,
      draftIds: cachedSourceIds.draftIds,
      likesIds: cachedSourceIds.likesIds,
      cameoIds: cachedSourceIds.cameoIds,
      characterIds: cachedSourceIds.characterIds,
      creatorIds: cachedSourceIds.creatorIds,
      items: cachedFilteredItems,
      fetchedCount: cachedFilteredItems.length,
      selectedKeys: cachedSelectedKeys,
      titleOverrides: cachedTitleOverrides,
      queued: cachedSelectedKeys.length,
      fetchProgress: createDefaultFetchProgress({
        stage: "opening",
        stageLabel: "Opening Sora",
        detail: cachedFilteredItems.length
          ? "Showing cached results while preparing a background Sora tab..."
          : "Preparing a background Sora tab...",
        progressRatio: FETCH_OPENING_PROGRESS_RATIO,
        currentSource: sources[0] ?? null,
        currentSourceLabel: getFetchSourceLabel(sources[0] ?? null),
        currentSourceIndex: sources.length ? 1 : 0,
        totalSources: sources.length,
        itemsFound: cachedFilteredItems.length,
      }),
      startedAt: new Date().toISOString(),
    }),
  );

  try {
    throwIfFetchAbortRequested();
    const collected = await collectItems(sources, maxVideos, {
      catalogItems: currentCatalog.items,
      selectedCharacterAccountIds,
      selectedCreatorProfileIds,
      enableVolatileBackup: !searchQuery,
    });
    const mergedCatalogItems = mergeCatalogItemsWithSourceResults(
      currentCatalog.items,
      collected.sourceResults,
      selectedCharacterAccountIds,
      selectedCreatorProfileIds,
    );
    await setCatalogState({
      items: normalizeCatalogItems(mergedCatalogItems),
      sourceSync: buildUpdatedCatalogSourceSync(collected.sourceResults),
    });

    const workingItems = buildWorkingItemsFromCatalog(
      currentCatalog.items,
      sources,
      maxVideos,
      selectedCharacterAccountIds,
      selectedCreatorProfileIds,
    );
    await setState({
      message: `Processing ${workingItems.length} item(s)...`,
      fetchedCount: workingItems.length + (Number(collected.backedUpItemCount) || 0),
      backedUpItemCount: Number(collected.backedUpItemCount) || 0,
      fetchProgress: getNextFetchProgress({
        stage: "processing",
        stageLabel: "Processing fetched videos",
        detail: searchQuery
          ? `Applying your search to ${workingItems.length} item(s)...`
          : `Preparing ${workingItems.length} item(s) for review...`,
        progressRatio: getFetchProcessingProgressRatio(0, 0),
        itemsFound: workingItems.length + (Number(collected.backedUpItemCount) || 0),
        processedCount: 0,
        totalCount: workingItems.length,
      }),
    }, { persist: false });
    await yieldForUi();

    const filteredItems = await filterItemsBySearchQueryWithProgress(workingItems, searchQuery, {
      onProgress: async ({ processedCount, totalCount, matchedCount }) => {
        await setState({
          fetchedCount: matchedCount + (Number(collected.backedUpItemCount) || 0),
          backedUpItemCount: Number(collected.backedUpItemCount) || 0,
          message: searchQuery
            ? `Filtering results... ${processedCount} of ${totalCount}`
            : `Processing results... ${processedCount} of ${totalCount}`,
          fetchProgress: getNextFetchProgress({
            stage: "processing",
            stageLabel: searchQuery ? "Filtering results" : "Processing fetched videos",
            detail: searchQuery
              ? `Applying your search to ${totalCount} item(s)...`
              : `Preparing ${totalCount} item(s) for review...`,
            progressRatio: getFetchProcessingProgressRatio(
              0,
              totalCount > 0 ? processedCount / totalCount : 1,
            ),
            itemsFound: matchedCount + (Number(collected.backedUpItemCount) || 0),
            processedCount,
            totalCount,
          }),
        }, { persist: false });
      },
    });

    await setState({
      message: `Finalizing ${filteredItems.length} item(s)...`,
      fetchedCount: filteredItems.length + (Number(collected.backedUpItemCount) || 0),
      backedUpItemCount: Number(collected.backedUpItemCount) || 0,
      fetchProgress: getNextFetchProgress({
        stage: "finalizing",
        stageLabel: "Finalizing results",
        detail: `Building the review list for ${filteredItems.length} item(s)...`,
        progressRatio: getFetchProcessingProgressRatio(1, 0),
        itemsFound: filteredItems.length + (Number(collected.backedUpItemCount) || 0),
        processedCount: 0,
        totalCount: filteredItems.length,
      }),
    }, { persist: false });
    await yieldForUi();

    const { filteredSourceIds, selectedKeys } = await buildScanSelectionState(filteredItems, {
      onProgress: async ({ processedCount, totalCount, selectedCount }) => {
        await setState({
          message: `Finalizing results... ${processedCount} of ${totalCount}`,
          fetchProgress: getNextFetchProgress({
            stage: "finalizing",
            stageLabel: "Finalizing results",
            detail: `Building the review list for ${totalCount} item(s)...`,
            progressRatio: getFetchProcessingProgressRatio(
              1,
              totalCount > 0 ? processedCount / totalCount : 1,
            ),
            itemsFound: selectedCount,
            processedCount,
            totalCount,
          }),
        }, { persist: false });
      },
    });

    const baseState = {
      currentSource: null,
      profileIds: filteredSourceIds.profileIds,
      draftIds: filteredSourceIds.draftIds,
      likesIds: filteredSourceIds.likesIds,
      cameoIds: filteredSourceIds.cameoIds,
      characterIds: filteredSourceIds.characterIds,
      creatorIds: filteredSourceIds.creatorIds,
      items: filteredItems,
      fetchedCount: filteredItems.length + (Number(collected.backedUpItemCount) || 0),
      backedUpItemCount: Number(collected.backedUpItemCount) || 0,
      selectedKeys,
      titleOverrides: pruneLegacyTitleOverrides(filteredItems, currentState.titleOverrides),
      pendingItems: [],
      runMode: null,
      runTotal: 0,
      queued: selectedKeys.length,
      completed: 0,
      failed: 0,
      failedItems: [],
      fetchProgress: createDefaultFetchProgress(),
      lastError: "",
      partialWarning: collected.partialWarning,
    };

    if (!filteredItems.length) {
      requestedControlAction = null;
      if (activeVolatileBackupSessionKey && Number(collected.backedUpItemCount) > 0) {
        void writeVolatileBackupMeta(activeVolatileBackupSessionKey, {
          status: "completed",
          fetchedCount: Number(collected.backedUpItemCount) || 0,
        }).catch((error) => {
          console.warn("Failed to finalize the volatile backup metadata.", error);
        });
      }
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

    requestedControlAction = null;
    if (activeVolatileBackupSessionKey && Number(collected.backedUpItemCount) > 0) {
      void writeVolatileBackupMeta(activeVolatileBackupSessionKey, {
        status: "completed",
        fetchedCount: filteredItems.length + (Number(collected.backedUpItemCount) || 0),
        previewCount: filteredItems.length,
      }).catch((error) => {
        console.warn("Failed to finalize the volatile backup metadata.", error);
      });
    }
    await setState({
      ...baseState,
      phase: "ready",
      message: buildReadyMessage(selectedKeys.length),
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isControlError(error, "pause")) {
      requestedControlAction = null;
      const activeItems = Array.isArray(currentState.items) ? currentState.items : [];
      const nextSelectedKeys = normalizeSelectedKeys(activeItems, currentState.selectedKeys);
      const backedUpCount = Number(currentState.backedUpItemCount) || 0;
      const fetchMessage = activeItems.length
        ? "Fetch paused. Resume when you're ready."
        : "Fetch paused before any results were loaded. Resume when you're ready.";
      const fetchProgress = getNextFetchProgress({
        stage: "paused",
        stageLabel: "Fetch paused",
        detail: activeItems.length
          ? "Your current preview stays available while this crawl is paused."
          : "Resume the crawl to continue loading results.",
        itemsFound: activeItems.length + backedUpCount,
      });

      await setState({
        phase: "fetch-paused",
        message: fetchMessage,
        currentSource: null,
        fetchedCount: activeItems.length + backedUpCount,
        selectedKeys: nextSelectedKeys,
        queued: nextSelectedKeys.length,
        fetchProgress,
        lastError: "",
        finishedAt: new Date().toISOString(),
      });

      const volatileBackupSessionKey =
        activeVolatileBackupSessionKey ||
        (activeVolatileBackupResumeMeta && activeVolatileBackupResumeMeta.sessionKey) ||
        "";
      if (volatileBackupSessionKey) {
        void writeVolatileBackupMeta(volatileBackupSessionKey, {
          status: "paused",
          fetchedCount: activeItems.length + backedUpCount,
          previewCount: activeItems.length,
        }).catch((metaError) => {
          console.warn("Failed to mark the volatile backup as paused.", metaError);
        });
      }
      return;
    }

    if (isControlError(error, "abort")) {
      requestedControlAction = null;
      pausedFetchRequest = null;
      const activeItems = Array.isArray(currentState.items) ? currentState.items : [];
      const nextSelectedKeys = normalizeSelectedKeys(activeItems, currentState.selectedKeys);

      await setState({
        phase: activeItems.length ? "ready" : "complete",
        message: activeItems.length
          ? "Fetch canceled. Showing your current results."
          : "Fetch canceled. Start another fetch when you're ready.",
        currentSource: null,
        fetchedCount: activeItems.length + (Number(currentState.backedUpItemCount) || 0),
        selectedKeys: nextSelectedKeys,
        queued: nextSelectedKeys.length,
        fetchProgress: createDefaultFetchProgress(),
        lastError: "",
        finishedAt: new Date().toISOString(),
      });
      if (activeVolatileBackupSessionKey && Number(currentState.backedUpItemCount) > 0) {
        void writeVolatileBackupMeta(activeVolatileBackupSessionKey, {
          status: "aborted",
          fetchedCount: activeItems.length + (Number(currentState.backedUpItemCount) || 0),
          previewCount: activeItems.length,
        }).catch((metaError) => {
          console.warn("Failed to mark the volatile backup as aborted.", metaError);
        });
      }
      return;
    }

    requestedControlAction = null;
    pausedFetchRequest = null;
    if (activeVolatileBackupSessionKey) {
      void writeVolatileBackupMeta(activeVolatileBackupSessionKey, {
        status: "error",
        error: getErrorMessage(error),
      }).catch((metaError) => {
        console.warn("Failed to mark the volatile backup as failed.", metaError);
      });
    }
    await setState({
      phase: "error",
      message: "The fetch run stopped.",
      currentSource: null,
      fetchProgress: createDefaultFetchProgress(),
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
      postCount: Number.isFinite(Number(account.postCount)) ? Number(account.postCount) : 0,
      cameoCount: Number.isFinite(Number(account.cameoCount)) ? Number(account.cameoCount) : 0,
      permalink: typeof account.permalink === "string" ? account.permalink : null,
      profilePictureUrl:
        typeof account.profilePictureUrl === "string" ? account.profilePictureUrl : null,
    }));
}

function decodeCreatorUrlSegment(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

function normalizeCreatorUsername(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = decodeCreatorUrlSegment(value)
    .trim()
    .replace(/^@+/, "")
    .replace(/\/+$/, "");

  if (!cleaned) {
    return "";
  }

  const reservedSegments = new Set(["profile", "profiles", "drafts", "characters", "likes"]);
  return reservedSegments.has(cleaned.toLowerCase()) ? "" : cleaned;
}

function getCreatorUsernameFromPathname(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const segments = value
    .split("/")
    .map((segment) => normalizeCreatorUsername(segment))
    .filter(Boolean);

  if (!segments.length) {
    return "";
  }

  if (value.includes("/@")) {
    const atSegment = value
      .split("/")
      .find((segment) => typeof segment === "string" && segment.trim().startsWith("@"));
    return normalizeCreatorUsername(atSegment || "");
  }

  if (segments[0].toLowerCase() === "profile") {
    return normalizeCreatorUsername(segments[1] || "");
  }

  return normalizeCreatorUsername(segments[0]);
}

function getCreatorUsernameFromUrl(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  try {
    return getCreatorUsernameFromPathname(new URL(value, "https://sora.chatgpt.com").pathname);
  } catch (_error) {
    return getCreatorUsernameFromPathname(value);
  }
}

function isGenericCreatorDisplayName(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized === "sora" ||
    normalized === "chatgpt" ||
    normalized === "openai" ||
    /^sora\s*[-|:]/.test(normalized) ||
    /^chatgpt\s*[-|:]/.test(normalized) ||
    /^openai\s*[-|:]/.test(normalized) ||
    normalized.includes("guardrails around content") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

function normalizeCreatorDisplayName(value, fallbackUsername = "") {
  if (typeof value === "string" && value.trim() && !isGenericCreatorDisplayName(value)) {
    return value.trim().replace(/\s+/g, " ");
  }

  return normalizeCreatorUsername(fallbackUsername);
}

function getDefaultCreatorFetchPreferences(profile) {
  const sourceProfile = profile && typeof profile === "object" ? profile : {};
  const profileData =
    sourceProfile.profileData && typeof sourceProfile.profileData === "object"
      ? sourceProfile.profileData
      : null;
  const characterUserId =
    typeof sourceProfile.characterUserId === "string" && isCharacterAccountUserId(sourceProfile.characterUserId)
      ? sourceProfile.characterUserId
      : profileData && typeof profileData.user_id === "string" && isCharacterAccountUserId(profileData.user_id)
        ? profileData.user_id
        : profileData && typeof profileData.userId === "string" && isCharacterAccountUserId(profileData.userId)
          ? profileData.userId
          : "";

  return {
    includeOfficialPosts: true,
    includeCommunityPosts: true,
  };
}

function normalizeCreatorFetchPreferences(profile) {
  const defaults = getDefaultCreatorFetchPreferences(profile);
  const sourceProfile = profile && typeof profile === "object" ? profile : {};
  const hasCustomFetchPreferences = sourceProfile.hasCustomFetchPreferences === true;
  const hasExplicitOfficialPreference = typeof sourceProfile.includeOfficialPosts === "boolean";
  const hasExplicitCommunityPreference = typeof sourceProfile.includeCommunityPosts === "boolean";

  if (
    !hasCustomFetchPreferences &&
    hasExplicitOfficialPreference &&
    hasExplicitCommunityPreference &&
    ((sourceProfile.includeOfficialPosts === true &&
      sourceProfile.includeCommunityPosts === false) ||
      (sourceProfile.includeOfficialPosts === false &&
        sourceProfile.includeCommunityPosts === true))
  ) {
    return { ...defaults };
  }

  return {
    includeOfficialPosts: hasExplicitOfficialPreference
      ? sourceProfile.includeOfficialPosts
      : defaults.includeOfficialPosts,
    includeCommunityPosts: hasExplicitCommunityPreference
      ? sourceProfile.includeCommunityPosts
      : defaults.includeCommunityPosts,
  };
}

function normalizeCreatorProfiles(value) {
  return (Array.isArray(value) ? value : [])
    .filter(
      (profile) =>
        profile &&
        typeof profile.profileId === "string" &&
        profile.profileId,
    )
    .map((profile) => {
      const profileId = profile.profileId;
      const userId = typeof profile.userId === "string" ? profile.userId : "";
      const profileData =
        profile.profileData && typeof profile.profileData === "object"
          ? profile.profileData
          : null;
      const ownerUserId =
        typeof profile.ownerUserId === "string" && profile.ownerUserId
          ? profile.ownerUserId
          : userId;
      const characterUserId =
        typeof profile.characterUserId === "string" && isCharacterAccountUserId(profile.characterUserId)
          ? profile.characterUserId
          : "";
      const ownerUsername =
        typeof profile.ownerUsername === "string" ? normalizeCreatorUsername(profile.ownerUsername) : "";
      const permalink =
        typeof profile.permalink === "string" && profile.permalink ? profile.permalink : null;
      const username =
        normalizeCreatorUsername(profile.username) ||
        getCreatorUsernameFromUrl(permalink) ||
        (/[/:@]/.test(profileId) ? getCreatorUsernameFromUrl(profileId) : "");
      const displayName =
        normalizeCreatorDisplayName(
          profileData && typeof profileData.display_name === "string" ? profileData.display_name : profile.displayName,
          username,
        ) ||
        username ||
        userId ||
        profileId;
      const fetchPreferences = normalizeCreatorFetchPreferences(profile);

      return {
        profileId,
        userId,
        username,
        displayName,
        permalink,
        profilePictureUrl:
          typeof profile.profilePictureUrl === "string" ? profile.profilePictureUrl : null,
        ownerUserId,
        ownerUsername: ownerUsername || "",
        characterUserId,
        profileFetchedAt:
          typeof profile.profileFetchedAt === "string" && profile.profileFetchedAt
            ? profile.profileFetchedAt
            : null,
        profileData,
        hasCustomFetchPreferences: profile.hasCustomFetchPreferences === true,
        includeOfficialPosts: fetchPreferences.includeOfficialPosts,
        includeCommunityPosts: fetchPreferences.includeCommunityPosts,
      };
    });
}

function normalizeResolvedCreatorProfiles(value) {
  return normalizeCreatorProfiles(value).filter((profile) =>
    isCanonicalCreatorUserId(profile.userId),
  );
}

function normalizeSelectedCharacterAccountIds(
  characterAccounts,
  requestedIds,
  fallbackIds = null,
  options = {},
) {
  const validIds = new Set(
    normalizeCharacterAccounts(characterAccounts).map((account) => account.userId),
  );
  const selected = [];
  const allowEmpty = options && options.allowEmpty === true;

  for (const value of Array.isArray(requestedIds) ? requestedIds : []) {
    if (typeof value !== "string" || !validIds.has(value) || selected.includes(value)) {
      continue;
    }
    selected.push(value);
  }

  if (selected.length) {
    return selected;
  }

  if (allowEmpty && Array.isArray(requestedIds)) {
    return [];
  }

  if (Array.isArray(fallbackIds) && fallbackIds.length) {
    return normalizeSelectedCharacterAccountIds(characterAccounts, fallbackIds, [], options);
  }

  return [...validIds];
}

function normalizeSelectedCreatorProfileIds(
  creatorProfiles,
  requestedIds,
  fallbackIds = null,
  options = {},
) {
  const validIds = new Set(
    normalizeCreatorProfiles(creatorProfiles).map((profile) => profile.profileId),
  );
  const selected = [];
  const allowEmpty = options && options.allowEmpty === true;

  for (const value of Array.isArray(requestedIds) ? requestedIds : []) {
    if (typeof value !== "string" || !validIds.has(value) || selected.includes(value)) {
      continue;
    }
    selected.push(value);
  }

  if (selected.length) {
    return selected;
  }

  if (allowEmpty && Array.isArray(requestedIds)) {
    return [];
  }

  if (Array.isArray(fallbackIds) && fallbackIds.length) {
    return normalizeSelectedCreatorProfileIds(creatorProfiles, fallbackIds, [], options);
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
    [],
    {
      allowEmpty: true,
    },
  );

  await setState({
    characterAccounts: fetchedAccounts,
    selectedCharacterAccountIds,
    hasExplicitCharacterAccountSelection: true,
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
    [],
    {
      allowEmpty: true,
    },
  );

  await setState({
    characterAccounts,
    selectedCharacterAccountIds,
    hasExplicitCharacterAccountSelection: true,
  });
}

async function setSelectedCreatorProfileIds(requestedIds) {
  const creatorProfiles = normalizeResolvedCreatorProfiles(currentState.creatorProfiles);
  const selectedCreatorProfileIds = normalizeSelectedCreatorProfileIds(
    creatorProfiles,
    requestedIds,
    [],
    {
      allowEmpty: true,
    },
  );

  await setState({
    creatorProfiles,
    selectedCreatorProfileIds,
    hasExplicitCreatorProfileSelection: true,
  });
}

async function setCreatorProfilePreferences(creatorProfileId, requestedPreferences) {
  if (activeRun) {
    throw new Error("Wait until the current fetch or download run finishes.");
  }

  const creatorProfiles = normalizeResolvedCreatorProfiles(currentState.creatorProfiles);
  const profileIndex = creatorProfiles.findIndex((profile) => profile.profileId === creatorProfileId);
  if (profileIndex === -1) {
    throw new Error("That creator profile is no longer in your saved list.");
  }

  const currentProfile = creatorProfiles[profileIndex];
  const normalizedPreferences = normalizeCreatorFetchPreferences({
    ...currentProfile,
    ...(requestedPreferences && typeof requestedPreferences === "object" ? requestedPreferences : {}),
  });
  const nextProfile = normalizeCreatorProfiles([
    {
      ...currentProfile,
      hasCustomFetchPreferences: true,
      ...normalizedPreferences,
    },
  ])[0];

  if (!nextProfile) {
    throw new Error("Could not update that creator profile.");
  }

  const nextCreatorProfiles = [...creatorProfiles];
  nextCreatorProfiles.splice(profileIndex, 1, nextProfile);

  await setState({
    creatorProfiles: nextCreatorProfiles,
    selectedCreatorProfileIds: normalizeSelectedCreatorProfileIds(
      nextCreatorProfiles,
      currentState.selectedCreatorProfileIds,
      [],
      { allowEmpty: true },
    ),
    hasExplicitCreatorProfileSelection: true,
  });

  return nextProfile;
}

function normalizeCreatorProfileUrl(profileUrl) {
  if (typeof profileUrl !== "string" || !profileUrl.trim()) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  const trimmedValue = profileUrl.trim();
  const buildCanonicalProfileUrl = (username) =>
    `https://sora.chatgpt.com/profile/${encodeURIComponent(username)}`;

  const directUsername = normalizeCreatorUsername(trimmedValue);
  if (directUsername && !/[/:]/.test(trimmedValue.replace(/^@+/, ""))) {
    return buildCanonicalProfileUrl(directUsername);
  }

  const pathUsername = getCreatorUsernameFromPathname(trimmedValue);
  if (pathUsername && !/^https?:\/\//i.test(trimmedValue)) {
    return buildCanonicalProfileUrl(pathUsername);
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(
      /^sora\.chatgpt\.com(?:\/|$)/i.test(trimmedValue)
        ? `https://${trimmedValue}`
        : trimmedValue,
    );
  } catch (_error) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  if (normalizedUrl.origin !== "https://sora.chatgpt.com") {
    throw new Error("Only sora.chatgpt.com creator usernames and profile links are supported.");
  }

  const username = getCreatorUsernameFromUrl(normalizedUrl.toString());
  if (!username) {
    throw new Error("Paste a valid Sora creator username or profile link.");
  }

  return buildCanonicalProfileUrl(username);
}

function shouldRefreshCreatorProfileMetadata(profile) {
  const lookupId = getCreatorLookupId(profile);
  return Boolean(
    profile &&
    typeof profile === "object" &&
    lookupId &&
    (!profile.userId ||
      !profile.username ||
      !profile.displayName ||
      isGenericCreatorDisplayName(profile.displayName) ||
      !profile.profilePictureUrl ||
      !profile.profileData),
  );
}

async function enrichCreatorProfile(profile) {
  const normalizedProfile = normalizeCreatorProfiles([profile])[0];
  if (!normalizedProfile || !shouldRefreshCreatorProfileMetadata(normalizedProfile)) {
    return normalizedProfile || profile;
  }

  const candidateSources = ["creatorPublished"];
  const creatorLookupId = getCreatorLookupId(normalizedProfile);
  if (!creatorLookupId) {
    return normalizedProfile;
  }

  for (const source of candidateSources) {
    try {
      const response = await fetchSourceDataFromTab(source, {
        routeUrl: getCreatorRouteUrl(normalizedProfile),
        creatorId: creatorLookupId,
        limit: 1,
      });
      const item = Array.isArray(response && response.items) ? response.items[0] : null;
      if (!item || typeof item !== "object") {
        continue;
      }

      const enrichedProfile = normalizeCreatorProfiles([
        {
          ...normalizedProfile,
          username:
            typeof item.creatorUsername === "string" && item.creatorUsername
              ? item.creatorUsername
              : normalizedProfile.username,
          displayName:
            typeof item.creatorDisplayName === "string" && item.creatorDisplayName
              ? item.creatorDisplayName
              : normalizedProfile.displayName,
          profilePictureUrl:
            typeof item.creatorProfilePictureUrl === "string" && item.creatorProfilePictureUrl
              ? item.creatorProfilePictureUrl
              : normalizedProfile.profilePictureUrl,
        },
      ])[0];

      if (
        enrichedProfile &&
        enrichedProfile.username &&
        enrichedProfile.displayName &&
        enrichedProfile.profilePictureUrl
      ) {
        return enrichedProfile;
      }

      if (enrichedProfile) {
        return enrichedProfile;
      }
    } catch (_error) {
      // Best-effort enrichment only. The saved creator still remains usable if the follow-up
      // lookup cannot improve the card metadata.
    }
  }

  return normalizedProfile;
}

function findMatchingCreatorProfileKey(creatorMap, creatorProfile) {
  for (const [profileId, existingProfile] of creatorMap.entries()) {
    const candidateCharacterUserId = getCreatorProfileCharacterUserId(creatorProfile);
    const existingCharacterUserId = getCreatorProfileCharacterUserId(existingProfile);

    if (
      candidateCharacterUserId &&
      existingCharacterUserId &&
      candidateCharacterUserId === existingCharacterUserId
    ) {
      return profileId;
    }

    if (!candidateCharacterUserId && !existingCharacterUserId &&
      creatorProfile.userId &&
      existingProfile &&
      typeof existingProfile.userId === "string" &&
      existingProfile.userId === creatorProfile.userId
    ) {
      return profileId;
    }

    if (
      creatorProfile.permalink &&
      existingProfile &&
      typeof existingProfile.permalink === "string" &&
      existingProfile.permalink === creatorProfile.permalink
    ) {
      return profileId;
    }

    if (
      creatorProfile.username &&
      existingProfile &&
      typeof existingProfile.username === "string" &&
      existingProfile.username === creatorProfile.username
    ) {
      return profileId;
    }
  }

  return null;
}

async function resolveCreatorProfile(profileUrl) {
  const normalizedUrl = normalizeCreatorProfileUrl(profileUrl);
  const response = await fetchSourceDataFromTab("creatorProfileLookup", {
    routeUrl: normalizedUrl,
  });
  const creatorProfile = normalizeCreatorProfiles([
    {
      permalink: normalizedUrl,
      ...(response && response.profile && typeof response.profile === "object" ? response.profile : {}),
    },
  ])[0];

  if (!creatorProfile) {
    throw new Error("Could not read that creator profile from Sora.");
  }

  if (!isCanonicalCreatorUserId(creatorProfile.userId)) {
    throw new Error(
      `Could not resolve a canonical creator user_id for ${creatorProfile.username || "that creator"}.`,
    );
  }

  return enrichCreatorProfile(creatorProfile);
}

async function addCreatorProfile(profileUrl) {
  const result = await addCreatorProfiles([profileUrl]);
  const [creatorProfile] = Array.isArray(result.creatorProfiles) ? result.creatorProfiles : [];
  if (!creatorProfile) {
    throw new Error("Could not add that creator profile.");
  }

  return creatorProfile;
}

async function addCreatorProfiles(profileUrls) {
  if (activeRun) {
    throw new Error("Wait until the current fetch or download run finishes.");
  }

  const creatorMap = new Map(
    normalizeResolvedCreatorProfiles(currentState.creatorProfiles).map((profile) => [profile.profileId, profile]),
  );
  const selectedSet = new Set(
    normalizeSelectedCreatorProfileIds(
      [...creatorMap.values()],
      currentState.selectedCreatorProfileIds,
      [],
      { allowEmpty: true },
    ),
  );
  const creatorProfiles = [];
  const failures = [];
  const uniqueUrls = [...new Set(
    (Array.isArray(profileUrls) ? profileUrls : [])
      .filter((profileUrl) => typeof profileUrl === "string" && profileUrl.trim())
      .map((profileUrl) => profileUrl.trim()),
  )];

  for (const profileUrl of uniqueUrls) {
    try {
      const resolvedProfile = await resolveCreatorProfile(profileUrl);
      if (!isCanonicalCreatorUserId(resolvedProfile.userId)) {
        throw new Error(
          `Could not resolve a canonical creator user_id for ${resolvedProfile.username || "that creator"}.`,
        );
      }
      const existingKey = findMatchingCreatorProfileKey(creatorMap, resolvedProfile);
      const creatorProfileId = existingKey || resolvedProfile.profileId;
      creatorMap.set(creatorProfileId, {
        ...(creatorMap.get(creatorProfileId) || {}),
        ...resolvedProfile,
        profileId: creatorProfileId,
      });
      selectedSet.add(creatorProfileId);
      creatorProfiles.push(creatorMap.get(creatorProfileId));
    } catch (error) {
      failures.push({
        profileUrl,
        error: getErrorMessage(error),
      });
    }
  }

  if (creatorProfiles.length === 0 && failures.length > 0) {
    throw new Error(failures[0].error);
  }

  const nextCreatorProfiles = [...creatorMap.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }),
  );
  const selectedCreatorProfileIds = nextCreatorProfiles
    .map((profile) => profile.profileId)
    .filter((profileId) => selectedSet.has(profileId));

  await setState({
    creatorProfiles: nextCreatorProfiles,
    selectedCreatorProfileIds,
    hasExplicitCreatorProfileSelection: true,
  });

  return {
    creatorProfiles,
    failures,
  };
}

async function removeCreatorProfile(creatorProfileId) {
  if (activeRun) {
    throw new Error("Wait until the current fetch or download run finishes.");
  }

  const creatorProfiles = normalizeCreatorProfiles(currentState.creatorProfiles).filter(
    (profile) => profile.profileId !== creatorProfileId,
  );

  if (creatorProfiles.length === normalizeCreatorProfiles(currentState.creatorProfiles).length) {
    throw new Error("That creator is no longer in your saved list.");
  }

  const selectedCreatorProfileIds = normalizeSelectedCreatorProfileIds(
    creatorProfiles,
    (Array.isArray(currentState.selectedCreatorProfileIds) ? currentState.selectedCreatorProfileIds : [])
      .filter((profileId) => profileId !== creatorProfileId),
    [],
    {
      allowEmpty: true,
    },
  );
  const nextItems = normalizeCatalogItems(currentState.items).filter(
    (item) => item.creatorProfileId !== creatorProfileId,
  );
  const nextSelectedKeys = normalizeSelectedKeys(nextItems, currentState.selectedKeys);
  const sourceIds = deriveSourceIdsFromItems(nextItems);
  const nextCatalogItems = normalizeCatalogItems(currentCatalog.items).filter(
    (item) => item.creatorProfileId !== creatorProfileId,
  );

  await setCatalogState({
    items: nextCatalogItems,
  });
  await setState({
    creatorProfiles,
    selectedCreatorProfileIds,
    hasExplicitCreatorProfileSelection: true,
    items: nextItems,
    selectedKeys: nextSelectedKeys,
    titleOverrides: pruneLegacyTitleOverrides(nextItems, currentState.titleOverrides),
    profileIds: sourceIds.profileIds,
    draftIds: sourceIds.draftIds,
    likesIds: sourceIds.likesIds,
    cameoIds: sourceIds.cameoIds,
    characterIds: sourceIds.characterIds,
    creatorIds: sourceIds.creatorIds,
    fetchedCount: nextItems.length,
    queued: nextSelectedKeys.length,
    failedItems: (currentState.failedItems || []).filter((item) => item.creatorProfileId !== creatorProfileId),
    pendingItems: (currentState.pendingItems || []).filter((item) => item.creatorProfileId !== creatorProfileId),
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
    creatorIds: sourceIds.creatorIds,
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

  await applyCatalogItemMutation([itemKey], (item) => ({
    ...item,
    isRemoved: Boolean(removed),
  }));
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
    currentState.phase === "fetch-paused" ||
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

  await applyCatalogItemMutation([itemKey], (item) => ({
    ...item,
    isDownloaded: Boolean(downloaded),
  }));
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

  if (
    nextSettings &&
    Object.prototype.hasOwnProperty.call(nextSettings, "automaticUpdatesEnabled")
  ) {
    settings.automaticUpdatesEnabled = normalizeAutomaticUpdatesEnabled(
      nextSettings.automaticUpdatesEnabled,
    );
  } else {
    settings.automaticUpdatesEnabled = normalizeAutomaticUpdatesEnabled(
      settings.automaticUpdatesEnabled,
    );
  }

  await setState({
    settings,
  });
  await setUpdateState({
    automaticUpdatesEnabled: settings.automaticUpdatesEnabled,
  });
  if (settings.automaticUpdatesEnabled === true) {
    maybeResumeDeferredUpdate();
  }
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

  setKeepAwakeEnabled(true);
  activeRun = (async () => {
    try {
      await performArchiveDownloadRun(selectedItems, {
        mode: "archive-selected",
        startingCompleted: 0,
        startingFailedItems: [],
        totalTarget: selectedItems.length,
        introMessage: `Building a ZIP archive for ${selectedItems.length} selected item(s)...`,
        completionMessage: (completed, failed) =>
          failed === 0
            ? `Saved a ZIP archive with ${completed} item(s).`
            : `Saved a ZIP archive with ${completed} item(s) and ${failed} skipped item(s).`,
      });
    } finally {
      try {
        await cleanupHiddenTab();
      } finally {
        setKeepAwakeEnabled(false);
      }
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
    runMode: "archive-selected",
    runTotal: selectedItems.length,
    lastError: "",
    finishedAt: null,
    message: `Building a ZIP archive for ${selectedItems.length} selected item(s)...`,
  });

  setKeepAwakeEnabled(true);
  activeRun = (async () => {
    try {
      await performArchiveDownloadRun(selectedItems, {
        mode: "archive-selected",
        startingCompleted: 0,
        startingFailedItems: [],
        totalTarget: selectedItems.length,
        initialStateApplied: true,
        introMessage: `Building a ZIP archive for ${selectedItems.length} selected item(s)...`,
        completionMessage: (completed, failed) =>
          failed === 0
            ? `Saved a ZIP archive with ${completed} item(s).`
            : `Saved a ZIP archive with ${completed} item(s) and ${failed} skipped item(s).`,
      });
    } finally {
      try {
        await cleanupHiddenTab();
      } finally {
        setKeepAwakeEnabled(false);
      }
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

  setKeepAwakeEnabled(true);
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
      try {
        await cleanupHiddenTab();
      } finally {
        setKeepAwakeEnabled(false);
      }
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

  setKeepAwakeEnabled(true);
  activeRun = (async () => {
    try {
      await performArchiveDownloadRun(retryItems, {
        mode: "archive-retry",
        startingCompleted: Number(currentState.completed) || 0,
        startingFailedItems: [],
        totalTarget: retryItems.length,
        introMessage: `Rebuilding a ZIP archive for ${retryItems.length} failed item(s)...`,
        completionMessage: (_completed, failed) =>
          failed === 0
            ? "Saved a recovery ZIP archive for all failed items."
            : `Saved a recovery ZIP archive with ${failed} remaining failure(s).`,
      });
    } finally {
      try {
        await cleanupHiddenTab();
      } finally {
        setKeepAwakeEnabled(false);
      }
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
        : currentState.runMode === "archive-selected" || currentState.runMode === "archive-retry"
          ? "Stopping the active ZIP archive..."
          : "Aborting the active download...",
  }, { persist: false });

  if (action === "abort" && activeArchiveJob && typeof activeArchiveJob.jobId === "string") {
    await requestArchiveAbort(activeArchiveJob.jobId);
  }

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

async function performArchiveDownloadRun(downloadItems, options) {
  const archiveJob = createArchiveJobContext(downloadItems, options);
  const total = archiveJob.total;

  requestedControlAction = null;

  if (!(options && options.initialStateApplied)) {
    await setState({
      phase: "downloading",
      currentSource: null,
      queued: archiveJob.pendingItems.length,
      completed: 0,
      failed: 0,
      failedItems: [],
      pendingItems: createQueueSnapshots(archiveJob.pendingItems),
      runMode: (options && options.mode) || "archive-selected",
      runTotal: total,
      lastError: "",
      finishedAt: null,
      message:
        (options && options.introMessage) || `Building a ZIP archive for ${total} item(s)...`,
    });
  }

  activeArchiveJob = archiveJob;

  try {
    const archiveResult = await startOffscreenArchiveBuild(archiveJob);
    if (!archiveResult || typeof archiveResult.objectUrl !== "string" || !archiveResult.objectUrl) {
      throw new Error("The ZIP archive worker did not return a downloadable file.");
    }

    await setState({
      currentSource: null,
      queued: 0,
      pendingItems: [],
      message: `Saving ${archiveJob.archiveFilename}...`,
    }, { persist: false });

    try {
      await startDownloadAndWait({
        downloadUrl: archiveResult.objectUrl,
        filename: archiveJob.archiveFilename,
      });
    } finally {
      await releaseOffscreenArchiveObjectUrl(archiveResult.objectUrl);
    }

    const successfulKeys = archiveJob.successfulItems.map((item) => item.key || getItemKey(item));
    let nextItems = currentState.items;
    let nextSelectedKeys = currentState.selectedKeys;

    if (successfulKeys.length > 0) {
      const downloadedState = applyDownloadedState(
        currentState.items,
        currentState.selectedKeys,
        successfulKeys,
        true,
      );
      nextItems = downloadedState.nextItems;
      nextSelectedKeys = downloadedState.nextSelectedKeys;

      await applyCatalogItemMutation(
        successfulKeys,
        (catalogItem) => ({
          ...catalogItem,
          isDownloaded: true,
        }),
      );
    }

    const completed = archiveJob.successfulItems.length;
    const failureCount = archiveJob.failedItems.length;
    const summary =
      options && typeof options.completionMessage === "function"
        ? options.completionMessage(completed, failureCount)
        : failureCount === 0
          ? `Saved a ZIP archive with ${completed} item(s).`
          : `Saved a ZIP archive with ${completed} item(s) and ${failureCount} skipped item(s).`;

    await setState({
      phase: "complete",
      items: nextItems,
      selectedKeys: nextSelectedKeys,
      message: summary,
      currentSource: null,
      queued: 0,
      completed,
      failed: failureCount,
      failedItems: [...archiveJob.failedItems],
      pendingItems: [],
      runMode: (options && options.mode) || "archive-selected",
      runTotal: 0,
      finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isControlError(error, "abort")) {
      requestedControlAction = null;
      const selectedCount = normalizeSelectedKeys(currentState.items, currentState.selectedKeys).length;
      await setState({
        phase: currentState.items.length ? "ready" : "complete",
        currentSource: null,
        queued: selectedCount,
        completed: 0,
        failed: archiveJob.failedItems.length,
        failedItems: [...archiveJob.failedItems],
        pendingItems: [],
        runMode: (options && options.mode) || "archive-selected",
        runTotal: 0,
        message: "The ZIP archive was aborted.",
        finishedAt: new Date().toISOString(),
      });
      return;
    }

    const message = getErrorMessage(error);
    const selectedCount = normalizeSelectedKeys(currentState.items, currentState.selectedKeys).length;

    await setState({
      phase: currentState.items.length ? "ready" : "error",
      currentSource: null,
      queued: selectedCount,
      completed: 0,
      failed: archiveJob.failedItems.length,
      failedItems: [...archiveJob.failedItems],
      pendingItems: [],
      runMode: (options && options.mode) || "archive-selected",
      runTotal: 0,
      lastError: message,
      message,
      finishedAt: new Date().toISOString(),
    });
    return;
  } finally {
    activeArchiveJob = null;
    await closeOffscreenDocumentIfPresent();
  }
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
      const shouldPersistProgress = shouldPersistDownloadProgress(
        completed,
        failedItems.length,
        pendingItems.length,
      );
      await applyCatalogItemMutation(
        [item.key || getItemKey(item)],
        (catalogItem) => ({
          ...catalogItem,
          isDownloaded: true,
        }),
        { persist: shouldPersistProgress },
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
        persist: shouldPersistProgress,
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

async function collectItems(sources, maxVideos, options = {}) {
  const itemMap = new Map();
  const profileIds = new Set();
  const draftIds = new Set();
  const likesIds = new Set();
  const cameoIds = new Set();
  const characterIds = new Set();
  const creatorIds = new Set();
  const sourceResults = [];
  const catalogItems = normalizeCatalogItems(options.catalogItems);
  const selectedCharacterAccountIds = Array.isArray(options.selectedCharacterAccountIds)
    ? options.selectedCharacterAccountIds
    : currentState.selectedCharacterAccountIds;
  const selectedCreatorProfileIds = Array.isArray(options.selectedCreatorProfileIds)
    ? options.selectedCreatorProfileIds
    : currentState.selectedCreatorProfileIds;
  const enableVolatileBackup = options.enableVolatileBackup === true;
  let partialWarning = "";
  let backedUpItemCount = 0;

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    throwIfFetchAbortRequested();
    const source = sources[sourceIndex];
    const maxRemaining = getRemainingFetchCapacity(itemMap.size, maxVideos);
    if (maxRemaining === 0) {
      break;
    }

    const sourceLabel = getFetchSourceLabel(source);
    const syncMode = shouldRunFullSourceRefresh(source, {
      catalogItems,
      selectedCharacterAccountIds,
      selectedCreatorProfileIds,
      creatorProfiles: currentState.creatorProfiles,
      maxVideos,
    })
      ? "full"
      : "incremental";
    const knownItemKeys =
      syncMode === "incremental"
        ? getKnownItemKeysForSource(
          source,
          catalogItems,
          selectedCharacterAccountIds,
          selectedCreatorProfileIds,
        )
        : null;
    await setState({
      phase: "fetching",
      currentSource: source,
      message:
        syncMode === "incremental"
          ? source === "profile"
            ? "Checking for new published videos..."
            : source === "drafts"
              ? "Checking for new drafts..."
              : source === "likes"
                ? "Checking for new liked videos..."
                : source === "characters"
                  ? "Checking for new cameo videos..."
                  : source === "characterAccounts"
                    ? "Checking for new character videos..."
                    : "Checking for new creator videos..."
          : source === "profile"
            ? "Fetching published videos..."
            : source === "drafts"
              ? "Fetching drafts..."
              : source === "likes"
                ? "Fetching liked videos..."
                : source === "characters"
                  ? "Fetching cameo videos..."
                  : source === "characterAccounts"
                    ? "Fetching character videos..."
                    : "Fetching creator videos...",
      fetchProgress: getNextFetchProgress({
        stage: "fetching-source",
        stageLabel: syncMode === "incremental" ? `Checking ${sourceLabel}` : `Loading ${sourceLabel}`,
        detail:
          syncMode === "incremental"
            ? `Comparing source ${sourceIndex + 1} of ${sources.length} against cached results.`
            : `Source ${sourceIndex + 1} of ${sources.length}`,
        progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, 0),
        currentSource: source,
        currentSourceLabel: sourceLabel,
        currentSourceIndex: sourceIndex + 1,
        totalSources: sources.length,
        itemsFound: itemMap.size,
        processedCount: 0,
        totalCount: 0,
      }),
    }, { persist: false });

    const sourceResult =
      source === "profile"
        ? await fetchAllProfileItems({
          maxItems: maxRemaining,
          knownItemKeys,
          baseCount: itemMap.size,
          onProgress: async ({ count, pageNumber, message }) => {
            await setState({
              fetchedCount: itemMap.size + count,
              message: message || `Fetching published videos... ${itemMap.size + count} found so far.`,
              fetchProgress: getNextFetchProgress({
                stage: "fetching-source",
                stageLabel: `Loading ${sourceLabel}`,
                detail: message || `Fetching ${sourceLabel}...`,
                progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                currentSource: source,
                currentSourceLabel: sourceLabel,
                currentSourceIndex: sourceIndex + 1,
                totalSources: sources.length,
                itemsFound: itemMap.size + count,
                processedCount: pageNumber,
                totalCount: 0,
              }),
            }, { persist: false });
          },
        })
        : source === "drafts"
          ? await fetchAllDraftItems({
            maxItems: maxRemaining,
            knownItemKeys,
            baseCount: itemMap.size,
            onProgress: async ({ count, pageNumber, message }) => {
              await setState({
                fetchedCount: itemMap.size + count,
                message: message || `Fetching drafts... ${itemMap.size + count} found so far.`,
                fetchProgress: getNextFetchProgress({
                  stage: "fetching-source",
                  stageLabel: `Loading ${sourceLabel}`,
                  detail: message || `Fetching ${sourceLabel}...`,
                  progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                  currentSource: source,
                  currentSourceLabel: sourceLabel,
                  currentSourceIndex: sourceIndex + 1,
                  totalSources: sources.length,
                  itemsFound: itemMap.size + count,
                  processedCount: pageNumber,
                  totalCount: 0,
                }),
              }, { persist: false });
            },
          })
          : source === "likes"
            ? await fetchAllLikesItems({
              maxItems: maxRemaining,
              knownItemKeys,
              baseCount: itemMap.size,
              onProgress: async ({ count, pageNumber, message }) => {
                await setState({
                  fetchedCount: itemMap.size + count,
                  message: message || `Fetching liked videos... ${itemMap.size + count} found so far.`,
                  fetchProgress: getNextFetchProgress({
                    stage: "fetching-source",
                    stageLabel: `Loading ${sourceLabel}`,
                    detail: message || `Fetching ${sourceLabel}...`,
                    progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                    currentSource: source,
                    currentSourceLabel: sourceLabel,
                    currentSourceIndex: sourceIndex + 1,
                    totalSources: sources.length,
                    itemsFound: itemMap.size + count,
                    processedCount: pageNumber,
                    totalCount: 0,
                  }),
                }, { persist: false });
              },
            })
            : source === "characters"
              ? await fetchAllCameoItems({
                maxItems: maxRemaining,
                knownItemKeys,
                baseCount: itemMap.size,
                onProgress: async ({ count, pageNumber, message }) => {
                  await setState({
                    fetchedCount: itemMap.size + count,
                    message: message || `Fetching cameo videos... ${itemMap.size + count} found so far.`,
                    fetchProgress: getNextFetchProgress({
                      stage: "fetching-source",
                      stageLabel: `Loading ${sourceLabel}`,
                      detail: message || `Fetching ${sourceLabel}...`,
                      progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                      currentSource: source,
                      currentSourceLabel: sourceLabel,
                      currentSourceIndex: sourceIndex + 1,
                      totalSources: sources.length,
                      itemsFound: itemMap.size + count,
                      processedCount: pageNumber,
                      totalCount: 0,
                    }),
                  }, { persist: false });
                },
              })
              : source === "characterAccounts"
                ? await fetchAllCharacterItems({
                maxItems: maxRemaining,
                characterAccounts: currentState.characterAccounts,
                selectedCharacterAccountIds,
                knownItemKeys,
                baseCount: itemMap.size,
                onProgress: async ({ count, pageNumber, message }) => {
                  await setState({
                    fetchedCount: itemMap.size + count,
                    message: message || `Fetching character videos... ${itemMap.size + count} found so far.`,
                    fetchProgress: getNextFetchProgress({
                      stage: "fetching-source",
                      stageLabel: `Loading ${sourceLabel}`,
                      detail: message || `Fetching ${sourceLabel}...`,
                      progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                      currentSource: source,
                      currentSourceLabel: sourceLabel,
                      currentSourceIndex: sourceIndex + 1,
                      totalSources: sources.length,
                      itemsFound: itemMap.size + count,
                      processedCount: pageNumber,
                      totalCount: 0,
                    }),
                  }, { persist: false });
                },
                })
                : await fetchAllCreatorItems({
                  maxItems: maxRemaining,
                  creatorProfiles: currentState.creatorProfiles,
                  selectedCreatorProfileIds,
                  knownItemKeys,
                  enableVolatileBackup,
                  volatileBackupResumeMeta:
                    enableVolatileBackup === true ? activeVolatileBackupResumeMeta : null,
                  onProgress: async ({ count, pageNumber, message, previewItems, backedUpItemCount: previewBackedUpItemCount }) => {
                    if (Array.isArray(previewItems) && previewItems.length > 0) {
                      const previewItemMap = new Map(
                        [...itemMap.values()].map((item) => [item.key || getItemKey(item), item]),
                      );
                      for (const previewItem of previewItems) {
                        const previewKey = previewItem.key || getItemKey(previewItem);
                        if (!previewItemMap.has(previewKey)) {
                          previewItemMap.set(previewKey, {
                            ...previewItem,
                            key: previewKey,
                          });
                        }
                      }

                      const previewStateItems = sortItemsByNewest([...previewItemMap.values()]);
                      const previewSelectedKeys = normalizeSelectedKeys(
                        previewStateItems,
                        [
                          ...new Set([
                            ...(Array.isArray(currentState.selectedKeys) ? currentState.selectedKeys : []),
                            ...previewStateItems.map((item) => item.key || getItemKey(item)),
                          ]),
                        ],
                      );
                      const previewSourceIds = deriveSourceIdsFromItems(previewStateItems);
                      await setState({
                        items: previewStateItems,
                        profileIds: previewSourceIds.profileIds,
                        draftIds: previewSourceIds.draftIds,
                        likesIds: previewSourceIds.likesIds,
                        cameoIds: previewSourceIds.cameoIds,
                        characterIds: previewSourceIds.characterIds,
                        creatorIds: previewSourceIds.creatorIds,
                        selectedKeys: previewSelectedKeys,
                        queued: previewSelectedKeys.length,
                        fetchedCount:
                          itemMap.size +
                          count +
                          (Number.isFinite(Number(previewBackedUpItemCount))
                            ? Math.max(0, Number(previewBackedUpItemCount))
                            : backedUpItemCount),
                        backedUpItemCount:
                          Number.isFinite(Number(previewBackedUpItemCount))
                            ? Math.max(0, Number(previewBackedUpItemCount))
                            : backedUpItemCount,
                      }, { persist: false });
                    }

                    await setState({
                      fetchedCount:
                        itemMap.size +
                        count +
                        (Number.isFinite(Number(previewBackedUpItemCount))
                          ? Math.max(0, Number(previewBackedUpItemCount))
                          : backedUpItemCount),
                      backedUpItemCount:
                        Number.isFinite(Number(previewBackedUpItemCount))
                          ? Math.max(0, Number(previewBackedUpItemCount))
                          : backedUpItemCount,
                      message: message || `Fetching creator videos... ${itemMap.size + count} found so far.`,
                      fetchProgress: getNextFetchProgress({
                        stage: "fetching-source",
                        stageLabel: `Loading ${sourceLabel}`,
                        detail: message || `Fetching ${sourceLabel}...`,
                        progressRatio: getFetchSourceProgressRatio(sourceIndex, sources.length, pageNumber),
                        currentSource: source,
                        currentSourceLabel: sourceLabel,
                        currentSourceIndex: sourceIndex + 1,
                        totalSources: sources.length,
                        itemsFound:
                          itemMap.size +
                          count +
                          (Number.isFinite(Number(previewBackedUpItemCount))
                            ? Math.max(0, Number(previewBackedUpItemCount))
                            : backedUpItemCount),
                        processedCount: pageNumber,
                        totalCount: 0,
                      }),
                    }, { persist: false });
                  },
                });

    throwIfFetchAbortRequested();
    sourceResults.push({
      source,
      ids: sourceResult.ids,
      items: sourceResult.items,
      syncMode,
      isExhaustive: sourceResult.isExhaustive === true,
      backupItemCount: Number.isFinite(Number(sourceResult.backedUpItemCount))
        ? Math.max(0, Number(sourceResult.backedUpItemCount))
        : 0,
      usesVolatileBackup: sourceResult.usesVolatileBackup === true,
      selectionSignature:
        getSourceSelectionSignature(source, {
          creatorProfiles: currentState.creatorProfiles,
          selectedCharacterAccountIds,
          selectedCreatorProfileIds,
        }),
    });
    backedUpItemCount += Number.isFinite(Number(sourceResult.backedUpItemCount))
      ? Math.max(0, Number(sourceResult.backedUpItemCount))
      : 0;

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
      } else if (source === "characterAccounts") {
        characterIds.add(id);
      } else {
        creatorIds.add(id);
      }
    }

    if (sourceResult.partialWarning) {
      partialWarning = sourceResult.partialWarning;
    }

    await setState({
      fetchedCount: itemMap.size + backedUpItemCount,
      backedUpItemCount,
      fetchProgress: getNextFetchProgress({
        stage: "fetching-source",
        stageLabel: `Loaded ${sourceLabel}`,
        detail: `${(itemMap.size + backedUpItemCount).toLocaleString()} item(s) found so far.`,
        progressRatio: getFetchSourceCompleteRatio(sourceIndex, sources.length),
        currentSource: source,
        currentSourceLabel: sourceLabel,
        currentSourceIndex: sourceIndex + 1,
        totalSources: sources.length,
        itemsFound: itemMap.size + backedUpItemCount,
        processedCount: sourceIndex + 1,
        totalCount: sources.length,
      }),
    }, { persist: false });
    await yieldForUi();
  }

  return {
    items: [...itemMap.values()],
    profileIds: [...profileIds],
    draftIds: [...draftIds],
    likesIds: [...likesIds],
    cameoIds: [...cameoIds],
    characterIds: [...characterIds],
    creatorIds: [...creatorIds],
    partialWarning,
    sourceResults,
    backedUpItemCount,
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
  const value = item && (item.createdAt ?? item.postedAt);
  if (value == null || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : 0;
  }

  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) {
    return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  }

  const timestamp = new Date(value).getTime();
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

function didPageContainOnlyKnownItems(items, knownItemKeys) {
  const knownKeys = knownItemKeys instanceof Set ? knownItemKeys : null;
  if (!knownKeys || knownKeys.size === 0) {
    return false;
  }

  const pageItems = Array.isArray(items) ? items : [];
  if (pageItems.length === 0) {
    return false;
  }

  return pageItems.every((item) => knownKeys.has(item.key || getItemKey(item)));
}

function buildCreatedAtCursorFromItems(items, cursorKind = "sv2_created_at") {
  const pageItems = Array.isArray(items) ? items : [];
  for (let index = pageItems.length - 1; index >= 0; index -= 1) {
    const item = pageItems[index];
    const timestampMs = getComparableItemTimestamp(item);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
      continue;
    }

    try {
      return btoa(JSON.stringify({
        kind: cursorKind,
        created_at: timestampMs / 1000,
      }));
    } catch (_error) {
      return "";
    }
  }

  return "";
}

function resolveNextProfileFeedCursor(page, items, cursor, previousCursor, cursorKind = "sv2_created_at") {
  const explicitCursor =
    page && typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : "";
  if (explicitCursor && explicitCursor !== cursor && explicitCursor !== previousCursor) {
    return explicitCursor;
  }

  const derivedCursor = buildCreatedAtCursorFromItems(items, cursorKind);
  if (derivedCursor && derivedCursor !== cursor && derivedCursor !== previousCursor) {
    return derivedCursor;
  }

  return "";
}

async function fetchAllProfileItems(options = {}) {
  const ids = new Set();
  const items = [];
  const cut = "nf2";
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, page.items, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllDraftItems(options = {}) {
  const ids = new Set();
  const itemMap = new Map();
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let cursor = null;
  let previousCursor = null;
  let offset = 0;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      return {
        ids: [...ids],
        items,
        partialWarning: "",
        isExhaustive: false,
      };
    }

    const madeProgress = itemMap.size > beforeSize;
    if (maxItems && items.length >= maxItems) {
      return {
        ids: [...ids],
        items,
        partialWarning: "",
        isExhaustive: false,
      };
    }

    if (page.rowCount === 0) {
      return {
        ids: [...ids],
        items,
        partialWarning: "",
        isExhaustive: true,
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
        isExhaustive: true,
      };
    }

    offset += DRAFT_BATCH_LIMIT;
  }

  return {
    ids: [...ids],
    items: [...itemMap.values()].slice(0, maxItems || undefined),
    partialWarning: "Stopped fetching drafts after many batches to avoid an infinite loop.",
    isExhaustive: false,
  };
}

async function fetchAllLikesItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, page.items, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCharacterAppearanceItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const maxPageCount = CREATOR_PROFILE_FEED_MAX_PAGE_CAP;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < maxPageCount; pageNumber += 1) {
    throwIfFetchAbortRequested();
    const page = await fetchSourceDataFromTab("characters", {
      limit: CREATOR_PROFILE_FEED_LIMIT,
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, page.items, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCharacterDraftItems(options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    if (page.rowCount === 0 || !page.nextCursor || page.nextCursor === previousCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
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
    characterAccountProfilePictureUrl:
      typeof characterAccount.profilePictureUrl === "string" ? characterAccount.profilePictureUrl : null,
    metadataEntries,
  };
}

function appendCreatorProfileContext(item, creatorProfile, options = {}) {
  if (!item || !creatorProfile) {
    return item;
  }

  const metadataEntries = Array.isArray(item.metadataEntries)
    ? [...item.metadataEntries]
    : [];

  if (typeof options.categoryLabel === "string" && options.categoryLabel) {
    metadataEntries.push({
      label: "Creator Bucket",
      value: options.categoryLabel,
      type: "text",
    });
  }

  if (creatorProfile.displayName) {
    metadataEntries.push({
      label: "Saved Creator",
      value: creatorProfile.displayName,
      type: "text",
    });
  }

  if (creatorProfile.username) {
    metadataEntries.push({
      label: "Saved Creator Username",
      value: `@${creatorProfile.username}`,
      type: "text",
    });
  }

  if (creatorProfile.permalink) {
    metadataEntries.push({
      label: "Saved Creator Profile",
      value: creatorProfile.permalink,
      type: "link",
    });
  }

  return {
    ...item,
    sourcePage:
      typeof options.sourcePage === "string" && options.sourcePage ? options.sourcePage : item.sourcePage,
    creatorProfileId: creatorProfile.profileId,
    creatorProfileUserId: creatorProfile.userId,
    creatorProfileUsername: creatorProfile.username,
    creatorProfileDisplayName: creatorProfile.displayName,
    creatorProfilePictureUrl:
      typeof creatorProfile.profilePictureUrl === "string" ? creatorProfile.profilePictureUrl : null,
    creatorProfilePermalink:
      typeof creatorProfile.permalink === "string" ? creatorProfile.permalink : null,
    metadataEntries,
  };
}

function getCreatorRouteUrl(creatorProfile) {
  return creatorProfile && typeof creatorProfile.permalink === "string" && creatorProfile.permalink
    ? creatorProfile.permalink
    : SOURCE_ROUTES.creators;
}

function isCanonicalCreatorUserId(value) {
  return typeof value === "string" && /^user-[A-Za-z0-9_-]+$/.test(value);
}

function isCharacterAccountUserId(value) {
  return typeof value === "string" && /^ch_[A-Za-z0-9_-]+$/.test(value);
}

function getCreatorProfileCharacterUserId(profile) {
  if (!profile || typeof profile !== "object") {
    return "";
  }

  if (isCharacterAccountUserId(profile.characterUserId)) {
    return profile.characterUserId;
  }

  const profileData =
    profile.profileData && typeof profile.profileData === "object" ? profile.profileData : null;
  const candidate = profileData
    ? typeof profileData.user_id === "string"
      ? profileData.user_id
      : typeof profileData.userId === "string"
        ? profileData.userId
        : ""
    : "";

  return isCharacterAccountUserId(candidate) ? candidate : "";
}

function isCharacterCreatorProfile(profile) {
  return Boolean(getCreatorProfileCharacterUserId(profile));
}

function getCreatorLookupId(creatorProfile) {
  if (!creatorProfile || typeof creatorProfile !== "object") {
    return "";
  }

  if (typeof creatorProfile.userId === "string" && creatorProfile.userId) {
    return creatorProfile.userId;
  }

  if (typeof creatorProfile.username === "string" && creatorProfile.username) {
    return creatorProfile.username;
  }

  if (typeof creatorProfile.permalink === "string" && creatorProfile.permalink) {
    return getCreatorUsernameFromUrl(creatorProfile.permalink);
  }

  if (typeof creatorProfile.profileId === "string" && creatorProfile.profileId) {
    return /[/:@]/.test(creatorProfile.profileId)
      ? getCreatorUsernameFromUrl(creatorProfile.profileId)
      : creatorProfile.profileId;
  }

  return "";
}

function getCreatorProfileExpectedCameoCount(profile) {
  const profileData =
    profile && profile.profileData && typeof profile.profileData === "object"
      ? profile.profileData
      : null;
  const candidates = [
    profileData && profileData.cameo_count,
    profileData && profileData.cameoCount,
    profileData && profileData.appearance_count,
    profileData && profileData.appearanceCount,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return Math.floor(candidate);
    }
  }

  return 0;
}

function shouldFetchCreatorOfficialPosts(profile) {
  return normalizeCreatorFetchPreferences(profile).includeOfficialPosts === true;
}

function shouldFetchCreatorCommunityPosts(profile) {
  return normalizeCreatorFetchPreferences(profile).includeCommunityPosts === true;
}

function getCreatorProfileExpectedItemCount(profile) {
  let expectedCount = 0;

  if (shouldFetchCreatorOfficialPosts(profile)) {
    expectedCount += getCreatorProfileExpectedPostCount(profile);
  }

  if (shouldFetchCreatorCommunityPosts(profile)) {
    expectedCount += getCreatorProfileExpectedCameoCount(profile);
  }

  return expectedCount;
}

function createCharacterAccountFromCreatorProfile(profile) {
  const characterUserId = getCreatorProfileCharacterUserId(profile);
  if (!characterUserId) {
    return null;
  }

  return normalizeCharacterAccounts([
    {
      userId: characterUserId,
      username: typeof profile.username === "string" ? profile.username : "",
      displayName: typeof profile.displayName === "string" ? profile.displayName : "",
      postCount: getCreatorProfileExpectedPostCount(profile),
      cameoCount: getCreatorProfileExpectedCameoCount(profile),
      permalink: typeof profile.permalink === "string" ? profile.permalink : null,
      profilePictureUrl:
        typeof profile.profilePictureUrl === "string" ? profile.profilePictureUrl : null,
    },
  ])[0] || null;
}

async function ensureCreatorProfileReadyForFetch(creatorProfile) {
  const normalizedProfile = normalizeCreatorProfiles([creatorProfile])[0];
  if (!normalizedProfile) {
    return creatorProfile;
  }

  if (normalizedProfile.userId || !normalizedProfile.permalink) {
    return normalizedProfile;
  }

  try {
    const refreshedProfile = await resolveCreatorProfile(normalizedProfile.permalink);
    const mergedProfile = normalizeCreatorProfiles([
      {
        ...normalizedProfile,
        ...refreshedProfile,
        profileId: normalizedProfile.profileId,
      },
    ])[0];

    if (!mergedProfile) {
      return normalizedProfile;
    }

    const nextCreatorProfiles = normalizeCreatorProfiles(currentState.creatorProfiles).map((profile) =>
      profile.profileId === normalizedProfile.profileId ? mergedProfile : profile,
    );

    await setState({
      creatorProfiles: nextCreatorProfiles,
      selectedCreatorProfileIds: normalizeSelectedCreatorProfileIds(
        nextCreatorProfiles,
        currentState.selectedCreatorProfileIds,
        [],
        { allowEmpty: true },
      ),
    });

    return mergedProfile;
  } catch (_error) {
    return normalizedProfile;
  }
}

async function fetchAllCreatorFeedItems(creatorProfile, options = {}) {
  const ids = new Set();
  const itemMap = new Map();
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const maxPageCount = getCreatorFeedPageCap(creatorProfile);
  const includeCommunityRows = options.includeCommunityRows === true;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  const getCreatorFeedItemKey = (item) =>
    [
      item && typeof item.id === "string" ? item.id : "",
      item && typeof item.downloadUrl === "string" && item.downloadUrl
        ? item.downloadUrl
        : item && typeof item.detailUrl === "string" && item.detailUrl
          ? item.detailUrl
          : `attachment:${Number.isInteger(item && item.attachmentIndex) ? item.attachmentIndex : 0}`,
    ].join("|");

  for (let pageNumber = 0; pageNumber < maxPageCount; pageNumber += 1) {
    throwIfFetchAbortRequested();
    const page = await fetchSourceDataFromTab("creatorPublished", {
      routeUrl: getCreatorRouteUrl(creatorProfile),
      creatorId: creatorProfile.userId,
      creatorUserId: creatorProfile.userId,
      creatorUsername: creatorProfile.username,
      limit: CREATOR_PROFILE_FEED_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }

    const allPageItems = [];
    const pageItems = [];
    for (const item of page.items) {
      const mappedItem = appendCreatorProfileContext(item, creatorProfile, {
        categoryLabel:
          item && item.sourcePage === "creatorCameos"
            ? "Creator Cast In"
            : "Creator Posts",
      });
      allPageItems.push(mappedItem);

      if (!includeCommunityRows && mappedItem.sourcePage === "creatorCameos") {
        continue;
      }

      pageItems.push(mappedItem);

      const itemKey = getCreatorFeedItemKey(mappedItem);
      const existingItem = itemMap.get(itemKey);
      if (
        !existingItem ||
        (existingItem.sourcePage !== "creatorPublished" && mappedItem.sourcePage === "creatorPublished")
      ) {
        itemMap.set(itemKey, mappedItem);
      }
    }

    if (maxItems && itemMap.size > maxItems) {
      const nextEntries = [...itemMap.entries()].slice(0, maxItems);
      itemMap.clear();
      for (const [key, value] of nextEntries) {
        itemMap.set(key, value);
      }
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: itemMap.size,
        pageNumber: pageNumber + 1,
      });
    }

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(pageItems, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, allPageItems, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && itemMap.size >= maxItems);
      break;
    }

    if (maxItems && itemMap.size >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items: [...itemMap.values()],
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCreatorCameoItems(creatorProfile, options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const maxPageCount = getProfileFeedPageCap(getCreatorProfileExpectedCameoCount(creatorProfile));
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < maxPageCount; pageNumber += 1) {
    throwIfFetchAbortRequested();
    const page = await fetchSourceDataFromTab("creatorCameos", {
      routeUrl: getCreatorRouteUrl(creatorProfile),
      creatorId: getCreatorLookupId(creatorProfile),
      limit: CREATOR_PROFILE_FEED_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }

    const pageItems = [];
    for (const item of page.items) {
      const mappedItem = appendCreatorProfileContext(item, creatorProfile, {
        sourcePage: "creatorCameos",
        categoryLabel: "Creator Cast In",
      });
      pageItems.push(mappedItem);
      items.push(mappedItem);
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(pageItems, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, pageItems, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCreatorCharacterPublishedItems(creatorProfile, options = {}) {
  const characterAccount = createCharacterAccountFromCreatorProfile(creatorProfile);
  if (!characterAccount || characterAccount.postCount <= 0) {
    return {
      ids: [],
      items: [],
      partialWarning: "",
      isExhaustive: true,
    };
  }

  const result = await fetchAllCharacterAccountPublishedItems(characterAccount, {
    ...options,
    knownItemKeys: null,
  });

  return {
    ...result,
    items: result.items.map((item) =>
      appendCreatorProfileContext(
        {
          ...item,
          sourcePage: "creatorCharacters",
          sourceLabel: "Creator Character",
        },
        creatorProfile,
        {
          sourcePage: "creatorCharacters",
          categoryLabel: "Character Posts",
        },
      ),
    ),
  };
}

async function fetchAllCreatorCharacterCameoItems(creatorProfile, options = {}) {
  const characterAccount = createCharacterAccountFromCreatorProfile(creatorProfile);
  if (!characterAccount) {
    return {
      ids: [],
      items: [],
      partialWarning: "",
      isExhaustive: true,
    };
  }

  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const previewLimit = Math.max(
    1,
    maxItems ? Math.min(maxItems, VOLATILE_SOURCE_PREVIEW_LIMIT) : VOLATILE_SOURCE_PREVIEW_LIMIT,
  );
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const maxPageCount = getProfileFeedPageCap(characterAccount.cameoCount);
  const backupSessionKey =
    typeof options.volatileBackupSessionKey === "string" ? options.volatileBackupSessionKey : "";
  const shouldBackupVolatileItems = Boolean(backupSessionKey);
  const progressKey = getVolatileBackupProgressKey(
    "creatorCharacterCameos",
    creatorProfile.profileId,
  );
  const resumeState =
    options && options.resumeState && typeof options.resumeState === "object"
      ? options.resumeState
      : null;
  let isExhaustive = false;
  let cursor =
    resumeState && typeof resumeState.cursor === "string" && resumeState.cursor
      ? resumeState.cursor
      : null;
  let previousCursor =
    resumeState && typeof resumeState.previousCursor === "string" && resumeState.previousCursor
      ? resumeState.previousCursor
      : null;
  let totalItemCount = Number.isFinite(Number(resumeState && resumeState.totalItemCount))
    ? Math.max(0, Number(resumeState.totalItemCount))
    : 0;
  let backedUpItemCount = Number.isFinite(Number(resumeState && resumeState.backedUpItemCount))
    ? Math.max(0, Number(resumeState.backedUpItemCount))
    : 0;
  let usesVolatileBackup =
    shouldBackupVolatileItems &&
    (totalItemCount > 0 ||
      Number.isFinite(Number(resumeState && resumeState.previewCount)) ||
      (resumeState && resumeState.isComplete === true));

  if (shouldBackupVolatileItems && resumeState && totalItemCount > 0) {
    try {
      const previewItems = await loadVolatileBackupItemsByProgressKey(
        backupSessionKey,
        progressKey,
        previewLimit,
      );
      if (previewItems.length) {
        items.push(...previewItems);
      }
    } catch (error) {
      console.warn("Failed to load creator-character cameo preview items from the volatile backup.", error);
    }
  }

  for (let pageNumber = 0; pageNumber < maxPageCount; pageNumber += 1) {
    throwIfFetchAbortRequested();
    const page = await fetchSourceDataFromTab("characterAccountAppearances", {
      routeUrl: getCreatorRouteUrl(creatorProfile),
      characterId: characterAccount.userId,
      limit: CREATOR_PROFILE_FEED_LIMIT,
      cursor,
    });

    for (const id of page.ids) {
      ids.add(id);
    }

    const pageItems = [];
    for (const item of page.items) {
      const mappedItem = appendCreatorProfileContext(
        {
          ...item,
          sourcePage: "creatorCharacterCameos",
          sourceLabel: "Character Cameo",
        },
        creatorProfile,
        {
          sourcePage: "creatorCharacterCameos",
          categoryLabel: "Character Cameos",
        },
      );
      pageItems.push(mappedItem);
      totalItemCount += 1;
      if (items.length < previewLimit) {
        items.push(mappedItem);
      } else if (shouldBackupVolatileItems) {
        backedUpItemCount += 1;
      }
    }

    if (shouldBackupVolatileItems && pageItems.length > 0) {
      try {
        const storedCount = await appendVolatileBackupItems(
          backupSessionKey,
          pageItems,
          {
            source: "creators",
            sourcePage: "creatorCharacterCameos",
            progressKey,
            selectionSignature:
              typeof options.selectionSignature === "string" ? options.selectionSignature : "",
            creatorProfileId: creatorProfile.profileId,
            creatorProfileUsername: creatorProfile.username,
            characterAccountId: characterAccount.userId,
            characterAccountUsername: characterAccount.username,
          },
        );
        if (storedCount > 0) {
          usesVolatileBackup = true;
        }
      } catch (error) {
        console.warn("Failed to persist creator-character cameo backup items.", error);
      }
    }

    if (maxItems && totalItemCount > maxItems) {
      totalItemCount = maxItems;
      if (items.length > maxItems) {
        items.length = maxItems;
      }
    }

    if (typeof options.onProgress === "function") {
      await options.onProgress({
        count: totalItemCount,
        pageNumber: pageNumber + 1,
        previewItems: [...items],
        backedUpItemCount,
      });
    }

    throwIfFetchAbortRequested();

    const didReachKnownItems = didPageContainOnlyKnownItems(pageItems, knownItemKeys);
    if (didReachKnownItems) {
      if (shouldBackupVolatileItems) {
        try {
          await updateVolatileBackupProgress(backupSessionKey, progressKey, {
            sourcePage: "creatorCharacterCameos",
            creatorProfileId: creatorProfile.profileId,
            creatorProfileUsername: creatorProfile.username,
            characterAccountId: characterAccount.userId,
            characterAccountUsername: characterAccount.username,
            cursor: cursor || "",
            previousCursor: previousCursor || "",
            totalItemCount,
            backedUpItemCount,
            previewCount: items.length,
            isComplete: true,
          });
        } catch (error) {
          console.warn("Failed to mark creator-character cameo progress as complete.", error);
        }
      }
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, pageItems, cursor, previousCursor);
    const didReachTerminalPage =
      page.rowCount === 0 || !nextCursor || Boolean(maxItems && totalItemCount >= maxItems);

    if (shouldBackupVolatileItems) {
      try {
        await updateVolatileBackupProgress(backupSessionKey, progressKey, {
          sourcePage: "creatorCharacterCameos",
          creatorProfileId: creatorProfile.profileId,
          creatorProfileUsername: creatorProfile.username,
          characterAccountId: characterAccount.userId,
          characterAccountUsername: characterAccount.username,
          cursor: nextCursor || "",
          previousCursor: cursor || "",
          totalItemCount,
          backedUpItemCount,
          previewCount: items.length,
          isComplete: didReachTerminalPage,
        });
      } catch (error) {
        console.warn("Failed to checkpoint creator-character cameo progress.", error);
      }
    }

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && totalItemCount >= maxItems);
      break;
    }

    if (maxItems && totalItemCount >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning:
      usesVolatileBackup && backedUpItemCount > 0
        ? `Saved ${backedUpItemCount.toLocaleString()} additional creator-character cameo items to the local backup so the crawl can continue without exhausting Chrome memory. The popup shows a preview.`
        : "",
    isExhaustive,
    totalItemCount,
    backedUpItemCount,
    usesVolatileBackup,
  };
}

async function fetchAllCharacterAccountPublishedItems(characterAccount, options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    const nextCursor = resolveNextProfileFeedCursor(page, page.items, cursor, previousCursor);

    if (page.rowCount === 0 || !nextCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCharacterAccountDraftItems(characterAccount, options = {}) {
  const ids = new Set();
  const items = [];
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  let isExhaustive = false;
  let cursor = null;
  let previousCursor = null;

  for (let pageNumber = 0; pageNumber < 250; pageNumber += 1) {
    throwIfFetchAbortRequested();
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

    throwIfFetchAbortRequested();

    if (didPageContainOnlyKnownItems(page.items, knownItemKeys)) {
      break;
    }

    if (page.rowCount === 0 || !page.nextCursor || page.nextCursor === previousCursor) {
      isExhaustive = !(maxItems && items.length >= maxItems);
      break;
    }

    if (maxItems && items.length >= maxItems) {
      break;
    }

    previousCursor = cursor;
    cursor = page.nextCursor;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: "",
    isExhaustive,
  };
}

async function fetchAllCharacterItems(options = {}) {
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const normalizedCharacterAccounts = normalizeCharacterAccounts(options.characterAccounts);
  const selectedCharacterAccountIds = normalizeSelectedCharacterAccountIds(
    normalizedCharacterAccounts,
    options.selectedCharacterAccountIds,
    [],
    {
      allowEmpty: true,
    },
  );
  const selectedCharacterAccounts = normalizedCharacterAccounts.filter((account) =>
    selectedCharacterAccountIds.includes(account.userId),
  );
  const ids = new Set();
  const itemMap = new Map();
  const partialWarnings = [];
  let totalCount = 0;
  let isExhaustive = true;
  let backedUpItemCount = 0;
  let usesVolatileBackup = false;

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

    backedUpItemCount += Number.isFinite(Number(result.backedUpItemCount))
      ? Math.max(0, Number(result.backedUpItemCount))
      : 0;
    usesVolatileBackup = usesVolatileBackup || result.usesVolatileBackup === true;
  };

  const reportProgress = async (messagePrefix, extra = {}) => {
    if (typeof options.onProgress !== "function") {
      return;
    }

    await options.onProgress({
      count: totalCount,
      pageNumber: 1,
      message: messagePrefix,
      ...extra,
    });
  };

  for (const characterAccount of selectedCharacterAccounts) {
    throwIfFetchAbortRequested();
    const maxRemaining = getRemainingFetchCapacity(itemMap.size, maxItems);
    if (maxRemaining === 0) {
      isExhaustive = false;
      break;
    }

    const characterPublishedResult = await fetchAllCharacterAccountPublishedItems(
      characterAccount,
      {
        maxItems: maxRemaining,
        knownItemKeys,
        onProgress: async ({ count }) => {
          totalCount = maxItems
            ? Math.min(maxItems, itemMap.size + count)
            : itemMap.size + count;
          await reportProgress(`Fetching ${characterAccount.displayName} posts...`);
        },
      },
    );
    mergeResult(characterPublishedResult);
    isExhaustive = isExhaustive && characterPublishedResult.isExhaustive === true;

    const nextMaxRemaining = getRemainingFetchCapacity(itemMap.size, maxItems);
    if (nextMaxRemaining === 0) {
      isExhaustive = false;
      break;
    }

    const characterDraftResult = await fetchAllCharacterAccountDraftItems(
      characterAccount,
      {
        maxItems: nextMaxRemaining,
        knownItemKeys,
        onProgress: async ({ count }) => {
          totalCount = maxItems
            ? Math.min(maxItems, itemMap.size + count)
            : itemMap.size + count;
          await reportProgress(`Fetching ${characterAccount.displayName} drafts...`);
        },
      },
    );
    mergeResult(characterDraftResult);
    isExhaustive = isExhaustive && characterDraftResult.isExhaustive === true;
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
    isExhaustive,
  };
}

async function fetchAllCreatorItems(options = {}) {
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
  const normalizedCreatorProfiles = normalizeCreatorProfiles(options.creatorProfiles);
  const selectedCreatorProfileIds = normalizeSelectedCreatorProfileIds(
    normalizedCreatorProfiles,
    options.selectedCreatorProfileIds,
    [],
    {
      allowEmpty: true,
    },
  );
  const selectedCreatorProfiles = normalizedCreatorProfiles.filter((profile) =>
    selectedCreatorProfileIds.includes(profile.profileId),
  );
  const ids = new Set();
  const itemMap = new Map();
  const partialWarnings = [];
  let totalCount = 0;
  let isExhaustive = true;
  let backedUpItemCount = 0;
  let usesVolatileBackup = false;
  const volatileBackupResumeMeta =
    options && options.volatileBackupResumeMeta && typeof options.volatileBackupResumeMeta === "object"
      ? options.volatileBackupResumeMeta
      : null;
  const volatileBackupProgressByKey =
    volatileBackupResumeMeta &&
    volatileBackupResumeMeta.progressByKey &&
    typeof volatileBackupResumeMeta.progressByKey === "object"
      ? volatileBackupResumeMeta.progressByKey
      : {};

  const mergeResult = (result) => {
    if (!result || typeof result !== "object") {
      return;
    }

    for (const id of result.ids) {
      ids.add(id);
    }

    for (const item of result.items) {
      const key = getItemKey(item);
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
      }
    }

    if (typeof result.partialWarning === "string" && result.partialWarning) {
      partialWarnings.push(result.partialWarning);
    }

    backedUpItemCount += Number.isFinite(Number(result.backedUpItemCount))
      ? Math.max(0, Number(result.backedUpItemCount))
      : 0;
    usesVolatileBackup = usesVolatileBackup || result.usesVolatileBackup === true;
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

  for (const creatorProfile of selectedCreatorProfiles) {
    throwIfFetchAbortRequested();
    const creatorProfileForFetch = await ensureCreatorProfileReadyForFetch(creatorProfile);
    const characterAccount = createCharacterAccountFromCreatorProfile(creatorProfileForFetch);
    const includeOfficialPosts = shouldFetchCreatorOfficialPosts(creatorProfileForFetch);
    const includeCommunityPosts = shouldFetchCreatorCommunityPosts(creatorProfileForFetch);
    const creatorEffectiveBaseCount = itemMap.size + backedUpItemCount;

    if (!includeOfficialPosts && !includeCommunityPosts) {
      continue;
    }

    if (characterAccount) {
      try {
        if (includeOfficialPosts) {
          const characterBaseCount = creatorEffectiveBaseCount;
          const characterPublishedMaxRemaining = getRemainingFetchCapacity(characterBaseCount, maxItems);
          if (characterPublishedMaxRemaining === 0) {
            isExhaustive = false;
            break;
          }

          const creatorCharacterResult = await fetchAllCreatorCharacterPublishedItems(
            creatorProfileForFetch,
            {
              maxItems: characterPublishedMaxRemaining,
              knownItemKeys,
              onProgress: async ({ count }) => {
                totalCount = maxItems
                  ? Math.min(maxItems, characterBaseCount + count)
                  : characterBaseCount + count;
                await reportProgress(`Fetching ${creatorProfileForFetch.displayName} official character posts...`);
              },
            },
          );
          mergeResult(creatorCharacterResult);
          isExhaustive = isExhaustive && creatorCharacterResult.isExhaustive === true;
        }

        if (includeCommunityPosts) {
          const characterCameoBaseCount = itemMap.size + backedUpItemCount;
          const characterCameoMaxRemaining = getRemainingFetchCapacity(characterCameoBaseCount, maxItems);
          if (characterCameoMaxRemaining === 0) {
            isExhaustive = false;
            break;
          }

          const creatorCharacterCameoResult = await fetchAllCreatorCharacterCameoItems(
            creatorProfileForFetch,
            {
              maxItems: characterCameoMaxRemaining,
              knownItemKeys,
              volatileBackupSessionKey:
                options.enableVolatileBackup === true ? activeVolatileBackupSessionKey : "",
              resumeState:
                volatileBackupProgressByKey[
                  getVolatileBackupProgressKey(
                    "creatorCharacterCameos",
                    creatorProfileForFetch.profileId,
                  )
                ] || null,
              onProgress: async ({ count }) => {
                totalCount = maxItems
                  ? Math.min(maxItems, characterCameoBaseCount + count)
                  : characterCameoBaseCount + count;
                await reportProgress(
                  `Fetching ${creatorProfileForFetch.displayName} community character cameos...`,
                  {
                    previewItems,
                    backedUpItemCount,
                  },
                );
              },
            },
          );
          mergeResult(creatorCharacterCameoResult);
          isExhaustive = isExhaustive && creatorCharacterCameoResult.isExhaustive === true;
        }
        continue;
      } catch (error) {
        if (isControlError(error, "abort")) {
          throw error;
        }

        partialWarnings.push(
          `${creatorProfileForFetch.displayName}: ${getErrorMessage(error)}`,
        );
        continue;
      }
    }

    const creatorLookupId = isCanonicalCreatorUserId(creatorProfileForFetch.userId)
      ? creatorProfileForFetch.userId
      : "";

    if (!creatorLookupId) {
      partialWarnings.push(
        `Could not resolve a canonical creator user_id for ${creatorProfileForFetch.displayName}.`,
      );
      continue;
    }

    try {
      if (includeOfficialPosts) {
        const publishedBaseCount = itemMap.size + backedUpItemCount;
        const maxRemaining = getRemainingFetchCapacity(publishedBaseCount, maxItems);
        if (maxRemaining === 0) {
          isExhaustive = false;
          break;
        }

        const creatorFeedResult = await fetchAllCreatorFeedItems(
          creatorProfileForFetch,
          {
            maxItems: maxRemaining,
            knownItemKeys,
            includeCommunityRows: false,
            onProgress: async ({ count }) => {
              totalCount = maxItems
                ? Math.min(maxItems, publishedBaseCount + count)
                : publishedBaseCount + count;
              await reportProgress(`Fetching ${creatorProfileForFetch.displayName} official posts...`);
            },
          },
        );
        mergeResult(creatorFeedResult);
        isExhaustive = isExhaustive && creatorFeedResult.isExhaustive === true;
      }

      if (includeCommunityPosts) {
        const cameoBaseCount = itemMap.size + backedUpItemCount;
        const cameoMaxRemaining = getRemainingFetchCapacity(cameoBaseCount, maxItems);
        if (cameoMaxRemaining === 0) {
          isExhaustive = false;
          break;
        }

        const creatorCameoResult = await fetchAllCreatorCameoItems(
          creatorProfileForFetch,
          {
            maxItems: cameoMaxRemaining,
            knownItemKeys,
            onProgress: async ({ count }) => {
              totalCount = maxItems
                ? Math.min(maxItems, cameoBaseCount + count)
                : cameoBaseCount + count;
              await reportProgress(`Fetching ${creatorProfileForFetch.displayName} community cameo posts...`);
            },
          },
        );
        mergeResult(creatorCameoResult);
        isExhaustive = isExhaustive && creatorCameoResult.isExhaustive === true;
      }
    } catch (error) {
      if (isControlError(error, "abort")) {
        throw error;
      }

      partialWarnings.push(
        `${creatorProfileForFetch.displayName}: ${getErrorMessage(error)}`,
      );
    }
  }

  const items = sortItemsByNewest([...itemMap.values()]);
  if (maxItems && items.length > maxItems) {
    items.length = maxItems;
  }

  return {
    ids: [...ids],
    items,
    partialWarning: joinPartialWarnings(partialWarnings),
    isExhaustive,
    backedUpItemCount,
    usesVolatileBackup,
  };
}

async function fetchAllCameoItems(options = {}) {
  const maxItems = getMaxVideosSetting({ maxVideos: options.maxItems });
  const knownItemKeys = options.knownItemKeys instanceof Set ? options.knownItemKeys : null;
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
    knownItemKeys,
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
      knownItemKeys,
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
      isExhaustive:
        publishedResult.isExhaustive === true && draftResult.isExhaustive === true,
    };
  }

  return {
    ids: [...ids],
    items: sortItemsByNewest([...itemMap.values()]).slice(0, maxItems || undefined),
    partialWarning: joinPartialWarnings([publishedResult.partialWarning]),
    isExhaustive: publishedResult.isExhaustive === true && nextMaxRemaining !== 0,
  };
}

async function executeSourceFetchInTab(tabId, source, options) {
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
}

function isHiddenTabFrameResetError(error) {
  const message = getErrorMessage(error);
  return /Frame with ID \d+ was removed/i.test(message) || /No frame with id \d+/i.test(message);
}

async function fetchSourceDataFromTab(source, options) {
  throwIfFetchAbortRequested();
  const routeUrl =
    options && typeof options.routeUrl === "string" && options.routeUrl
      ? options.routeUrl
      : SOURCE_ROUTES[source];

  try {
    const runFetch = async () => {
      const tabId = await ensureHiddenTab(routeUrl);
      return executeSourceFetchInTab(tabId, source, options);
    };

    try {
      return await runFetch();
    } catch (error) {
      if (isHiddenTabFrameResetError(error)) {
        return await runFetch();
      }
      throw error;
    }
  } catch (error) {
    if (isFetchAbortRequested()) {
      throw createControlError("abort", "Fetch aborted.");
    }

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
                : source === "characterAccountAppearances"
                  ? "character account appearances"
                : source === "creatorPublished"
                  ? "creator posts"
                  : source === "creatorCameos"
                    ? "creator cast-in appearances"
                    : source === "creatorCharacters"
                      ? "creator characters"
                      : source === "characterDrafts"
                        ? "cameo drafts"
                        : source === "characterAccountDrafts"
                          ? "character account drafts"
                          : source === "creatorProfileLookup"
                            ? "creator profile"
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

  if (
    item.sourcePage === "creatorPublished" ||
    item.sourcePage === "creatorCameos" ||
    item.sourcePage === "creatorCharacters" ||
    item.sourcePage === "creatorCharacterCameos"
  ) {
    const refreshed = await fetchAllCreatorItems({
      creatorProfiles: currentState.creatorProfiles,
      selectedCreatorProfileIds: item.creatorProfileId
        ? [item.creatorProfileId]
        : currentState.selectedCreatorProfileIds,
    });
    const match = refreshed.items.find((candidate) => matchesRefreshTarget(candidate, item));

    if (!match) {
      throw new Error(`Could not refresh creator video ${item.id}.`);
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

    function normalizeAbsoluteUrl(value) {
      if (typeof value !== "string" || !value) {
        return null;
      }

      try {
        return new URL(value, window.location.origin).toString();
      } catch (_error) {
        return null;
      }
    }

    function normalizePathname(value) {
      const absoluteUrl = normalizeAbsoluteUrl(value);
      if (!absoluteUrl) {
        return "";
      }

      try {
        const pathname = new URL(absoluteUrl).pathname.replace(/\/+$/, "");
        return pathname || "/";
      } catch (_error) {
        return "";
      }
    }

    function decodeCreatorPathSegment(value) {
      if (typeof value !== "string" || !value) {
        return "";
      }

      try {
        return decodeURIComponent(value);
      } catch (_error) {
        return value;
      }
    }

    function normalizeCreatorUsername(value) {
      if (typeof value !== "string") {
        return "";
      }

      const cleaned = decodeCreatorPathSegment(value)
        .trim()
        .replace(/^@+/, "")
        .replace(/\/+$/, "");

      if (!cleaned) {
        return "";
      }

      const reservedSegments = new Set(["profile", "profiles", "drafts", "characters", "likes"]);
      return reservedSegments.has(cleaned.toLowerCase()) ? "" : cleaned;
    }

    function getCreatorUsernameFromPathname(pathname) {
      if (typeof pathname !== "string" || !pathname) {
        return "";
      }

      const rawSegments = pathname.split("/").filter(Boolean);
      if (!rawSegments.length) {
        return "";
      }

      const atSegment = rawSegments.find((segment) => segment.trim().startsWith("@"));
      if (atSegment) {
        return normalizeCreatorUsername(atSegment);
      }

      if (rawSegments[0].toLowerCase() === "profile") {
        return normalizeCreatorUsername(rawSegments[1] || "");
      }

      return normalizeCreatorUsername(rawSegments[0]);
    }

    function getCreatorUsernameFromUrl(value) {
      const pathname = normalizePathname(value);
      return pathname ? getCreatorUsernameFromPathname(pathname) : "";
    }

    function isGenericCreatorDisplayName(value) {
      if (typeof value !== "string") {
        return false;
      }

      const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
      if (!normalized) {
        return false;
      }

      return (
        normalized === "sora" ||
        normalized === "chatgpt" ||
        normalized === "openai" ||
        /^sora\s*[-|:]/.test(normalized) ||
        /^chatgpt\s*[-|:]/.test(normalized) ||
        /^openai\s*[-|:]/.test(normalized) ||
        normalized.includes("guardrails around content") ||
        normalized.startsWith("http://") ||
        normalized.startsWith("https://")
      );
    }

    function normalizeCreatorDisplayName(value, fallbackUsername = "") {
      if (typeof value === "string" && value.trim() && !isGenericCreatorDisplayName(value)) {
        return value.trim().replace(/\s+/g, " ");
      }

      return normalizeCreatorUsername(fallbackUsername);
    }

    function isLikelyProfileUrl(value) {
      const pathname = normalizePathname(value);
      if (!pathname) {
        return false;
      }

      return !/^\/(?:p|d)\//.test(pathname);
    }

    function collectProfileCandidates(payload, matches = [], depth = 0) {
      if (depth > 6 || payload == null) {
        return matches;
      }

      if (Array.isArray(payload)) {
        for (const entry of payload) {
          collectProfileCandidates(entry, matches, depth + 1);
        }
        return matches;
      }

      if (typeof payload !== "object") {
        return matches;
      }

      const userId = pickFirstString([
        payload.user_id,
        payload.userId,
        payload.chatgpt_user_id,
        payload.chatgptUserId,
      ]);
      const username = normalizeCreatorUsername(
        pickFirstString([
          payload.username,
          payload.user_name,
          payload.userName,
          payload.handle,
        ]),
      );
      const displayName = normalizeCreatorDisplayName(
        pickFirstString([
          payload.display_name,
          payload.displayName,
          payload.full_name,
          payload.fullName,
          payload.name,
        ]),
        username,
      );
      const permalinkCandidate = pickFirstString([
        payload.permalink,
        payload.url,
        payload.profile_url,
        payload.profileUrl,
        payload.public_url,
        payload.publicUrl,
      ]);
      const permalink = isLikelyProfileUrl(permalinkCandidate)
        ? normalizeAbsoluteUrl(permalinkCandidate)
        : null;
      const profilePictureUrl = getProfilePictureUrl(payload);

      if (userId || username || displayName || permalink || profilePictureUrl) {
        matches.push({
          userId: userId || "",
          username: username || "",
          displayName: displayName || "",
          permalink,
          profilePictureUrl: profilePictureUrl || null,
        });
      }

      for (const value of Object.values(payload)) {
        collectProfileCandidates(value, matches, depth + 1);
      }

      return matches;
    }

    function scoreProfileCandidate(candidate, currentPathname, currentUsername = "") {
      let score = 0;
      const candidatePathname = normalizePathname(candidate && candidate.permalink);

      if (candidatePathname && candidatePathname === currentPathname) {
        score += 120;
      }

      if (
        candidate &&
        typeof candidate.username === "string" &&
        candidate.username &&
        currentPathname.toLowerCase().includes(candidate.username.toLowerCase())
      ) {
        score += 60;
      }

      if (
        candidate &&
        typeof candidate.username === "string" &&
        candidate.username &&
        currentUsername &&
        candidate.username.toLowerCase() === currentUsername.toLowerCase()
      ) {
        score += 90;
      }

      if (candidate && typeof candidate.userId === "string" && candidate.userId) {
        score += 20;
      }

      if (candidate && typeof candidate.displayName === "string" && candidate.displayName) {
        score += 10;
      }

      if (candidate && typeof candidate.profilePictureUrl === "string" && candidate.profilePictureUrl) {
        score += 5;
      }

      if (
        candidate &&
        isGenericCreatorDisplayName(candidate.displayName) &&
        !(candidate.username || candidate.userId)
      ) {
        score -= 120;
      }

      return score;
    }

    function findProfileAvatarFromDom(username = "", displayName = "") {
      const heading = document.querySelector("main h1, h1");
      const headingRect = heading instanceof HTMLElement ? heading.getBoundingClientRect() : null;
      const images = document.querySelectorAll("main img[src], [role='main'] img[src], img[src]");
      let bestUrl = null;
      let bestScore = -Infinity;

      for (const image of images) {
        if (!(image instanceof HTMLImageElement)) {
          continue;
        }

        const src = normalizeAbsoluteUrl(image.currentSrc || image.src);
        if (!src) {
          continue;
        }

        const rect = image.getBoundingClientRect();
        const width = rect.width || image.naturalWidth || 0;
        const height = rect.height || image.naturalHeight || 0;
        if (!width || !height) {
          continue;
        }

        const ratio = width / height;
        const minDimension = Math.min(width, height);
        const altText = `${image.alt || ""} ${image.getAttribute("aria-label") || ""}`.toLowerCase();
        const srcLower = src.toLowerCase();
        let score = 0;

        if (ratio >= 0.82 && ratio <= 1.18) {
          score += 45;
        } else if (ratio >= 0.7 && ratio <= 1.35) {
          score += 20;
        } else {
          score -= 90;
        }

        if (minDimension >= 48 && minDimension <= 220) {
          score += 25;
        } else if (minDimension > 260 || minDimension < 24) {
          score -= 20;
        }

        if (/avatar|profile|creator/.test(altText)) {
          score += 35;
        }

        if (username && altText.includes(username.toLowerCase())) {
          score += 20;
        }

        if (displayName && altText.includes(displayName.toLowerCase())) {
          score += 20;
        }

        if (headingRect) {
          const imageCenter = rect.top + rect.height / 2;
          const headingCenter = headingRect.top + headingRect.height / 2;
          const distance = Math.abs(imageCenter - headingCenter);
          if (distance <= 220) {
            score += 30;
          } else if (distance <= 420) {
            score += 10;
          }
        }

        const parent = image.closest("header, [class*='profile'], [data-testid*='profile']");
        if (parent) {
          score += 18;
        }

        const borderRadius = Number.parseFloat(globalThis.getComputedStyle(image).borderRadius) || 0;
        if (borderRadius >= minDimension / 3) {
          score += 15;
        }

        if (/logo|wordmark|favicon|opengraph|og-image|social-preview/.test(srcLower)) {
          score -= 80;
        }

        if (score > bestScore) {
          bestScore = score;
          bestUrl = src;
        }
      }

      return bestScore >= 35 ? bestUrl : null;
    }

    function resolveCurrentProfileFromPage() {
      const currentUrl = normalizeAbsoluteUrl(window.location.href);
      const currentPathname = normalizePathname(currentUrl);
      const currentUsername = getCreatorUsernameFromPathname(currentPathname);
      const candidates = collectProfileCandidates(globalThis.__NEXT_DATA__)
        .concat(collectProfileCandidates(globalThis.__NEXT_ROUTER_DATA__));

      let bestCandidate = null;
      let bestScore = -1;
      for (const candidate of candidates) {
        const score = scoreProfileCandidate(candidate, currentPathname, currentUsername);
        if (score > bestScore) {
          bestCandidate = candidate;
          bestScore = score;
        }
      }

      const metaTitle = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
      const heading = document.querySelector("main h1, h1");
      const pathUserIdMatch = currentPathname.match(/\/(user-[A-Za-z0-9_-]+)/);

      const userId =
        (bestCandidate && typeof bestCandidate.userId === "string" ? bestCandidate.userId : "") ||
        (pathUserIdMatch ? pathUserIdMatch[1] : "");
      const username =
        (bestCandidate && typeof bestCandidate.username === "string" ? bestCandidate.username : "") ||
        currentUsername ||
        "";
      const headingText =
        heading && typeof heading.textContent === "string" && heading.textContent.trim()
          ? heading.textContent.trim()
          : "";
      const metaTitleText =
        metaTitle && metaTitle.getAttribute("content") ? metaTitle.getAttribute("content").trim() : "";
      const displayName =
        normalizeCreatorDisplayName(
          bestCandidate && typeof bestCandidate.displayName === "string" && bestCandidate.displayName
            ? bestCandidate.displayName
            : headingText || metaTitleText,
          username,
        ) ||
        username ||
        userId ||
        "";
      const permalink =
        (bestCandidate && typeof bestCandidate.permalink === "string" && bestCandidate.permalink
          ? bestCandidate.permalink
          : currentUrl) || null;
      const profilePictureUrl =
        (bestCandidate && typeof bestCandidate.profilePictureUrl === "string" && bestCandidate.profilePictureUrl
          ? bestCandidate.profilePictureUrl
          : findProfileAvatarFromDom(username, displayName));

      const profileId = userId || username || permalink || currentPathname || "";
      if (!profileId) {
        return null;
      }

      return {
        profileId,
        userId,
        username,
        displayName,
        permalink,
        profilePictureUrl,
      };
    }

    function isCompleteCreatorProfile(profile) {
      return Boolean(
        profile &&
        typeof profile === "object" &&
        (profile.userId || profile.username) &&
        profile.displayName &&
        profile.profilePictureUrl,
      );
    }

    async function waitForCreatorProfileSnapshot() {
      const maxAttempts = 12;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const profile = resolveCurrentProfileFromPage();
        if (isCompleteCreatorProfile(profile)) {
          return profile;
        }

        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 180));
        } else {
          return profile;
        }
      }

      return resolveCurrentProfileFromPage();
    }

    function isCanonicalCreatorUserId(value) {
      return typeof value === "string" && /^user-[A-Za-z0-9_-]+$/.test(value);
    }

    function isCharacterAccountUserId(value) {
      return typeof value === "string" && /^ch_[A-Za-z0-9_-]+$/.test(value);
    }

    function normalizeCreatorProfilePayload(payload, fallbackUsername = "", fallbackPermalink = null) {
      if (!payload || typeof payload !== "object") {
        return null;
      }

      const ownerProfile =
        payload.owner_profile && typeof payload.owner_profile === "object"
          ? payload.owner_profile
          : payload.ownerProfile && typeof payload.ownerProfile === "object"
            ? payload.ownerProfile
            : null;
      const ownerUserId = pickFirstString([
        ownerProfile && ownerProfile.user_id,
        ownerProfile && ownerProfile.userId,
      ]);
      const topLevelUserId = pickFirstString([
        payload.user_id,
        payload.userId,
      ]);
      const canonicalUserId = pickFirstString([
        ownerProfile && isCanonicalCreatorUserId(ownerUserId) ? ownerUserId : "",
        isCanonicalCreatorUserId(topLevelUserId) ? topLevelUserId : "",
      ]);
      const characterUserId = isCharacterAccountUserId(topLevelUserId) ? topLevelUserId : "";
      const visibleProfile = payload;
      const canonicalProfile =
        ownerProfile && isCanonicalCreatorUserId(ownerUserId) ? ownerProfile : payload;
      const userId = pickFirstString([
        canonicalUserId,
        canonicalProfile && canonicalProfile.user_id,
        canonicalProfile && canonicalProfile.userId,
      ]);
      const ownerUsername = normalizeCreatorUsername(
        pickFirstString([
          ownerProfile && ownerProfile.username,
          ownerProfile && ownerProfile.user_name,
          ownerProfile && ownerProfile.userName,
          ownerProfile && ownerProfile.handle,
        ]),
      );
      const username =
        normalizeCreatorUsername(
          pickFirstString([
            visibleProfile && visibleProfile.username,
            visibleProfile && visibleProfile.user_name,
            visibleProfile && visibleProfile.userName,
            visibleProfile && visibleProfile.handle,
            canonicalProfile && canonicalProfile.username,
            canonicalProfile && canonicalProfile.user_name,
            canonicalProfile && canonicalProfile.userName,
            canonicalProfile && canonicalProfile.handle,
            payload.username,
            payload.user_name,
            payload.userName,
            payload.handle,
            fallbackUsername,
          ]),
        ) || "";
      const permalink =
        normalizeAbsoluteUrl(
          pickFirstString([
            visibleProfile && visibleProfile.permalink,
            visibleProfile && visibleProfile.url,
            visibleProfile && visibleProfile.profile_url,
            visibleProfile && visibleProfile.profileUrl,
            canonicalProfile && canonicalProfile.permalink,
            canonicalProfile && canonicalProfile.url,
            canonicalProfile && canonicalProfile.profile_url,
            canonicalProfile && canonicalProfile.profileUrl,
            payload.permalink,
            payload.url,
            payload.profile_url,
            payload.profileUrl,
            fallbackPermalink,
          ]),
        ) || (username ? `${window.location.origin}/profile/${encodeURIComponent(username)}` : null);
      const displayName =
        normalizeCreatorDisplayName(
          pickFirstString([
            visibleProfile && visibleProfile.display_name,
            visibleProfile && visibleProfile.displayName,
            visibleProfile && visibleProfile.public_figure_name,
            visibleProfile && visibleProfile.full_name,
            visibleProfile && visibleProfile.fullName,
            visibleProfile && visibleProfile.name,
            canonicalProfile && canonicalProfile.display_name,
            canonicalProfile && canonicalProfile.displayName,
            canonicalProfile && canonicalProfile.public_figure_name,
            canonicalProfile && canonicalProfile.full_name,
            canonicalProfile && canonicalProfile.fullName,
            canonicalProfile && canonicalProfile.name,
            payload.display_name,
            payload.displayName,
            payload.public_figure_name,
            payload.full_name,
            payload.fullName,
            payload.name,
          ]),
          username,
        ) ||
        username ||
        userId ||
        "";
      const profilePictureUrl =
        getProfilePictureUrl(visibleProfile) ||
        getProfilePictureUrl(canonicalProfile) ||
        getProfilePictureUrl(payload);
      const profileId = characterUserId || userId || username || permalink || "";

      if (!profileId) {
        return null;
      }

      return {
        profileId,
        userId: userId || "",
        ownerUserId: userId || "",
        ownerUsername: ownerUsername || "",
        characterUserId,
        username,
        displayName,
        permalink,
        profilePictureUrl: profilePictureUrl || null,
        profileFetchedAt: new Date().toISOString(),
        profileData: payload,
      };
    }

    async function fetchCreatorProfileByUsername(username) {
      const normalizedUsername = normalizeCreatorUsername(username);
      if (!normalizedUsername) {
        return null;
      }

      const url = new URL(
        `/backend/project_y/profile/username/${encodeURIComponent(normalizedUsername)}`,
        window.location.origin,
      );
      const payload = await fetchJson(url.toString());
      return normalizeCreatorProfilePayload(
        payload,
        normalizedUsername,
        `${window.location.origin}/profile/${encodeURIComponent(normalizedUsername)}`,
      );
    }

    async function deriveProfileUserId(options = {}) {
      const explicitCreatorId =
        typeof options.creatorId === "string" && options.creatorId ? options.creatorId.trim() : "";
      if (isCanonicalCreatorUserId(explicitCreatorId)) {
        return explicitCreatorId;
      }

      const currentProfile = await waitForCreatorProfileSnapshot();
      if (currentProfile && isCanonicalCreatorUserId(currentProfile.userId)) {
        return currentProfile.userId;
      }

      const explicitUsername = normalizeCreatorUsername(explicitCreatorId);
      let routeUsername = "";
      if (typeof options.routeUrl === "string" && options.routeUrl) {
        routeUsername = getCreatorUsernameFromUrl(options.routeUrl);
      }

      const lookupUsername =
        (currentProfile && normalizeCreatorUsername(currentProfile.username)) ||
        explicitUsername ||
        routeUsername;

      if (lookupUsername) {
        try {
          const resolvedProfile = await fetchCreatorProfileByUsername(lookupUsername);
          if (resolvedProfile && isCanonicalCreatorUserId(resolvedProfile.userId)) {
            return resolvedProfile.userId;
          }
        } catch (_error) {
          // Fall back to the best available page-derived identifier below.
        }
      }

      if (currentProfile && currentProfile.userId) {
        return currentProfile.userId;
      }

      if (explicitCreatorId) {
        return explicitCreatorId;
      }

      if (lookupUsername) {
        return lookupUsername;
      }

      if (normalizePathname(window.location.href) === "/profile") {
        return deriveViewerUserId(await deriveAuthContext());
      }

      throw new Error("Could not determine the creator profile id from the current Sora page.");
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

    let sessionUserProfilePromise = null;

    async function getSessionUserProfile() {
      if (!sessionUserProfilePromise) {
        sessionUserProfilePromise = (async () => {
          const sessionUrls = ["/api/auth/session", "/auth/session"];

          for (const url of sessionUrls) {
            try {
              const response = await fetch(url, {
                credentials: "include",
                headers: {
                  accept: "application/json, text/plain, */*",
                },
              });

              if (!response.ok) {
                continue;
              }

              const payload = await response.json();
              const user =
                payload && payload.user && typeof payload.user === "object"
                  ? payload.user
                  : payload && typeof payload === "object"
                    ? payload
                    : null;

              if (!user) {
                continue;
              }

              const profile = {
                displayName: pickFirstString([
                  user.display_name,
                  user.displayName,
                  user.name,
                  user.full_name,
                  user.fullName,
                ]),
                username: pickFirstString([
                  user.username,
                  user.user_name,
                  user.userName,
                  user.handle,
                ]),
                profilePictureUrl: pickFirstString([
                  user.image,
                  user.picture,
                  user.profile_picture_url,
                  user.profilePictureUrl,
                  user.avatar_url,
                  user.avatarUrl,
                ]),
              };

              if (profile.displayName || profile.username || profile.profilePictureUrl) {
                return profile;
              }
            } catch (_error) {
              // Ignore transient session endpoint failures and keep looking.
            }
          }

          return null;
        })();
      }

      return sessionUserProfilePromise;
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

    function getCreatorCandidates(value) {
      if (!value || typeof value !== "object") {
        return [];
      }

      const candidates = [];

      function appendCandidate(candidate) {
        if (candidate && typeof candidate === "object") {
          candidates.push(candidate);
        }
      }

      function appendNestedCandidates(source) {
        if (!source || typeof source !== "object") {
          return;
        }

        appendCandidate(source.user);
        appendCandidate(source.owner);
        appendCandidate(source.author);
        appendCandidate(source.creator);
        appendCandidate(source.account);
        appendCandidate(source.profile);
        appendCandidate(source.owner_profile);
        appendCandidate(source.ownerProfile);
        appendCandidate(source.profile_owner);
        appendCandidate(source.profileOwner);
        appendCandidate(source.actor);
      }

      appendNestedCandidates(value);
      appendNestedCandidates(value.post);
      appendNestedCandidates(value.draft);
      appendNestedCandidates(value.item);
      appendNestedCandidates(value.data);
      appendNestedCandidates(value.output);

      return candidates;
    }

    function getProfilePictureUrl(value) {
      if (!value || typeof value !== "object") {
        return null;
      }

      return pickFirstString([
        value.profile_picture_url,
        value.profilePictureUrl,
        value.profile_image_url,
        value.profileImageUrl,
        value.avatar_url,
        value.avatarUrl,
        value.picture,
        value.image,
        value.profile_picture && pickFirstString([value.profile_picture.url, value.profile_picture.src]),
        value.profilePicture && pickFirstString([value.profilePicture.url, value.profilePicture.src]),
        value.avatar && pickFirstString([value.avatar.url, value.avatar.src]),
        value.photo && pickFirstString([value.photo.url, value.photo.src]),
        value.image && typeof value.image === "object"
          ? pickFirstString([value.image.url, value.image.src])
          : null,
      ]);
    }

    function getCreatorDisplayName(value) {
      for (const candidate of getCreatorCandidates(value)) {
        const displayName = pickFirstString([
          candidate.display_name,
          candidate.displayName,
          candidate.full_name,
          candidate.fullName,
          candidate.name,
          candidate.username,
        ]);
        if (displayName) {
          return displayName;
        }
      }

      return null;
    }

    function getCreatorUsername(value) {
      for (const candidate of getCreatorCandidates(value)) {
        const username = pickFirstString([
          candidate.username,
          candidate.user_name,
          candidate.userName,
          candidate.handle,
        ]);
        if (username) {
          return username;
        }
      }

      return null;
    }

    function getCreatorUserId(value) {
      for (const candidate of getCreatorCandidates(value)) {
        const userId = pickFirstString([
          candidate.user_id,
          candidate.userId,
        ]);
        if (userId) {
          return userId;
        }
      }

      return null;
    }

    function getCreatorProfilePictureUrl(value) {
      for (const candidate of getCreatorCandidates(value)) {
        const profilePictureUrl = getProfilePictureUrl(candidate);
        if (profilePictureUrl) {
          return profilePictureUrl;
        }
      }

      return null;
    }

    function applySessionProfileFallback(result, sessionProfile) {
      if (!result || !sessionProfile) {
        return result;
      }

      return {
        ...result,
        items: (Array.isArray(result.items) ? result.items : []).map((item) => ({
          ...item,
          creatorDisplayName:
            item && typeof item.creatorDisplayName === "string" && item.creatorDisplayName
              ? item.creatorDisplayName
              : sessionProfile.displayName || null,
          creatorUsername:
            item && typeof item.creatorUsername === "string" && item.creatorUsername
              ? item.creatorUsername
              : sessionProfile.username || null,
          creatorProfilePictureUrl:
            item && typeof item.creatorProfilePictureUrl === "string" && item.creatorProfilePictureUrl
              ? item.creatorProfilePictureUrl
              : sessionProfile.profilePictureUrl || null,
        })),
      };
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
        value.raw_url,
        value.rawUrl,
        value.signed_url,
        value.signedUrl,
        value.media_url,
        value.mediaUrl,
        value.video_url,
        value.videoUrl,
        value.asset_url,
        value.assetUrl,
        value.source_url,
        value.sourceUrl,
        value.src,
        value.download_urls && value.download_urls.no_watermark,
        value.download_urls && value.download_urls.watermark,
        value.download_urls && value.download_urls.endcard_watermark,
        ...attachments.flatMap((attachment) => [
          attachment && attachment.downloadable_url,
          attachment && attachment.downloadUrl,
          attachment && attachment.raw_url,
          attachment && attachment.rawUrl,
          attachment && attachment.signed_url,
          attachment && attachment.signedUrl,
          attachment && attachment.media_url,
          attachment && attachment.mediaUrl,
          attachment && attachment.video_url,
          attachment && attachment.videoUrl,
          attachment && attachment.asset_url,
          attachment && attachment.assetUrl,
          attachment && attachment.source_url,
          attachment && attachment.sourceUrl,
          attachment && attachment.src,
          attachment && attachment.download_urls && attachment.download_urls.no_watermark,
          attachment && attachment.download_urls && attachment.download_urls.watermark,
        ]),
        ...nested.flatMap((candidate) => [
          candidate && candidate.downloadable_url,
          candidate && candidate.downloadUrl,
          candidate && candidate.raw_url,
          candidate && candidate.rawUrl,
          candidate && candidate.signed_url,
          candidate && candidate.signedUrl,
          candidate && candidate.media_url,
          candidate && candidate.mediaUrl,
          candidate && candidate.video_url,
          candidate && candidate.videoUrl,
          candidate && candidate.asset_url,
          candidate && candidate.assetUrl,
          candidate && candidate.source_url,
          candidate && candidate.sourceUrl,
          candidate && candidate.src,
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
        value.raw_url,
        value.rawUrl,
        value.signed_url,
        value.signedUrl,
        value.media_url,
        value.mediaUrl,
        value.video_url,
        value.videoUrl,
        value.asset_url,
        value.assetUrl,
        value.source_url,
        value.sourceUrl,
        value.src,
        value.encodings && value.encodings.md && value.encodings.md.path,
        value.encodings && value.encodings.source && value.encodings.source.path,
        value.encodings && value.encodings.ld && value.encodings.ld.path,
        ...nested.flatMap((candidate) => [
          candidate && candidate.url,
          candidate && candidate.raw_url,
          candidate && candidate.rawUrl,
          candidate && candidate.signed_url,
          candidate && candidate.signedUrl,
          candidate && candidate.media_url,
          candidate && candidate.mediaUrl,
          candidate && candidate.video_url,
          candidate && candidate.videoUrl,
          candidate && candidate.asset_url,
          candidate && candidate.assetUrl,
          candidate && candidate.source_url,
          candidate && candidate.sourceUrl,
          candidate && candidate.src,
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

    function getPostListingRows(payload) {
      if (Array.isArray(payload)) {
        return payload;
      }

      return pickFirstArray([
        payload && payload.items,
        payload && payload.data,
        payload && payload.results,
        payload && payload.posts,
        payload && payload.entries,
        payload && payload.feed,
        payload && payload.nodes,
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

    function classifyCreatorFeedItem(row, post, config = {}) {
      const targetUserId =
        config && typeof config.creatorUserId === "string" && config.creatorUserId
          ? config.creatorUserId
          : "";
      const targetUsername = normalizeCreatorUsername(
        config && typeof config.creatorUsername === "string" ? config.creatorUsername : "",
      );
      const ownerUserId = pickFirstString([
        row && row.user_id,
        row && row.userId,
        row && row.owner_profile && row.owner_profile.user_id,
        row && row.ownerProfile && row.ownerProfile.userId,
        row && row.owner && row.owner.user_id,
        row && row.owner && row.owner.userId,
        row && row.user && row.user.user_id,
        row && row.user && row.user.userId,
        post && post.user_id,
        post && post.userId,
        post && post.owner_profile && post.owner_profile.user_id,
        post && post.ownerProfile && post.ownerProfile.userId,
        post && post.owner && post.owner.user_id,
        post && post.owner && post.owner.userId,
        post && post.user && post.user.user_id,
        post && post.user && post.user.userId,
      ]);
      const ownerUsername = normalizeCreatorUsername(
        pickFirstString([
          row && row.username,
          row && row.user_name,
          row && row.userName,
          row && row.owner_profile && row.owner_profile.username,
          row && row.ownerProfile && row.ownerProfile.username,
          row && row.owner && row.owner.username,
          row && row.user && row.user.username,
          post && post.username,
          post && post.user_name,
          post && post.userName,
          post && post.owner_profile && post.owner_profile.username,
          post && post.ownerProfile && post.ownerProfile.username,
          post && post.owner && post.owner.username,
          post && post.user && post.user.username,
        ]),
      );

      if (
        (targetUserId && ownerUserId === targetUserId) ||
        (targetUsername && ownerUsername && ownerUsername === targetUsername)
      ) {
        return {
          sourcePage: "creatorPublished",
          sourceLabel: "Creator Post",
        };
      }

      const hintValues = [
        row && row.kind,
        row && row.feed_kind,
        row && row.feedKind,
        row && row.feed_type,
        row && row.feedType,
        row && row.relationship,
        row && row.relationship_type,
        row && row.relationshipType,
        row && row.source_type,
        row && row.sourceType,
        row && row.surface,
        row && row.section,
        row && row.tab,
        row && row.cut,
        post && post.kind,
        post && post.feed_kind,
        post && post.feedKind,
        post && post.feed_type,
        post && post.feedType,
        post && post.relationship,
        post && post.relationship_type,
        post && post.relationshipType,
        post && post.source_type,
        post && post.sourceType,
        post && post.surface,
        post && post.section,
        post && post.tab,
        post && post.cut,
      ]
        .filter((value) => typeof value === "string" && value)
        .map((value) => value.toLowerCase());

      if (hintValues.some((value) => /cast|appearance|cameo/.test(value))) {
        return {
          sourcePage: "creatorCameos",
          sourceLabel: "Creator Cast In",
        };
      }

      return {
        sourcePage: "creatorPublished",
        sourceLabel: "Creator Post",
      };
    }

    function getNextCursorFromPayload(payload) {
      return (
        pickFirstString([
          payload && payload.next_cursor,
          payload && payload.nextCursor,
          payload && payload.pagination && payload.pagination.next_cursor,
          payload && payload.pagination && payload.pagination.nextCursor,
          payload && payload.cursor,
          payload && payload.pagination && payload.pagination.cursor,
        ]) || null
      );
    }

    function isLikelyCursorKey(value) {
      return typeof value === "string" && /(?:^|_|[A-Z])cursor|page.*token|continuation/i.test(value);
    }

    function findNestedCursorToken(payload, requestCursor = "", keyName = "", depth = 0) {
      if (depth > 6 || payload == null) {
        return null;
      }

      if (typeof payload === "string") {
        if (
          isLikelyCursorKey(keyName) &&
          payload &&
          payload !== requestCursor &&
          payload.length < 2048
        ) {
          return payload;
        }
        return null;
      }

      if (Array.isArray(payload)) {
        for (const entry of payload) {
          const match = findNestedCursorToken(entry, requestCursor, keyName, depth + 1);
          if (match) {
            return match;
          }
        }
        return null;
      }

      if (typeof payload !== "object") {
        return null;
      }

      const priorityKeys = [
        "next_cursor",
        "nextCursor",
        "end_cursor",
        "endCursor",
        "cursor",
        "page_cursor",
        "pageCursor",
      ];

      for (const candidateKey of priorityKeys) {
        if (!(candidateKey in payload)) {
          continue;
        }

        const match = findNestedCursorToken(payload[candidateKey], requestCursor, candidateKey, depth + 1);
        if (match) {
          return match;
        }
      }

      for (const [entryKey, entryValue] of Object.entries(payload)) {
        if (priorityKeys.includes(entryKey) || (!isLikelyCursorKey(entryKey) && depth > 2)) {
          continue;
        }

        const match = findNestedCursorToken(entryValue, requestCursor, entryKey, depth + 1);
        if (match) {
          return match;
        }
      }

      return null;
    }

    function normalizeCursorToken(value) {
      return typeof value === "string" && value ? value : "";
    }

    function normalizeCursorTimestamp(value) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim()) {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
          return numericValue;
        }

        const parsedDateValue = Date.parse(value);
        if (Number.isFinite(parsedDateValue)) {
          return parsedDateValue / 1000;
        }
      }

      return null;
    }

    function encodeCursorPayload(payload) {
      if (!payload || typeof payload !== "object") {
        return null;
      }

      try {
        return btoa(JSON.stringify(payload));
      } catch (_error) {
        return null;
      }
    }

    function buildCreatedAtCursorFromRows(rows, config = {}) {
      const cursorKind =
        config && typeof config.cursorKind === "string" && config.cursorKind
          ? config.cursorKind
          : "";
      if (!cursorKind) {
        return null;
      }

      const sourceRows = Array.isArray(rows) ? rows : [];
      for (let index = sourceRows.length - 1; index >= 0; index -= 1) {
        const row = sourceRows[index];
        const post = row && row.post && typeof row.post === "object" ? row.post : null;
        const candidates = [
          row && row.created_at,
          row && row.createdAt,
          post && post.created_at,
          post && post.createdAt,
          post && post.posted_at,
          post && post.postedAt,
          post && post.updated_at,
          post && post.updatedAt,
        ];

        for (const candidate of candidates) {
          const createdAt = normalizeCursorTimestamp(candidate);
          if (createdAt == null) {
            continue;
          }

          return encodeCursorPayload({
            kind: cursorKind,
            created_at: createdAt,
          });
        }
      }

      return null;
    }

    function getNextCursorForRows(payload, rows, config = {}) {
      const requestCursor =
        config && typeof config.requestCursor === "string" && config.requestCursor
          ? config.requestCursor
          : "";
      const explicitCursor = normalizeCursorToken(getNextCursorFromPayload(payload));
      const nestedCursor = normalizeCursorToken(findNestedCursorToken(payload, requestCursor));

      if (explicitCursor && explicitCursor !== requestCursor) {
        return explicitCursor;
      }

      if (nestedCursor && nestedCursor !== requestCursor) {
        return nestedCursor;
      }

      const derivedCursor = normalizeCursorToken(buildCreatedAtCursorFromRows(rows, config));
      if (derivedCursor && derivedCursor !== requestCursor) {
        return derivedCursor;
      }

      return explicitCursor && explicitCursor !== requestCursor ? explicitCursor : null;
    }

    function decodeEmbeddedText(value) {
      if (typeof value !== "string" || !value) {
        return "";
      }

      return value
        .replace(/\\u002F/gi, "/")
        .replace(/\\\//g, "/")
        .replace(/&quot;/gi, "\"")
        .replace(/&#x27;|&#39;/gi, "'")
        .replace(/&amp;/gi, "&");
    }

    function extractPostMediaCandidatesFromHtml(html) {
      const decodedHtml = decodeEmbeddedText(html);
      if (!decodedHtml) {
        return {
          mediaUrls: [],
          thumbnailUrl: null,
        };
      }

      const matchedUrls = decodedHtml.match(/https:\/\/videos\.openai\.com\/[^"'`\s<\\)]+/gi) || [];
      const uniqueUrls = [...new Set(matchedUrls)];
      const mediaUrls = uniqueUrls.filter(
        (url) =>
          !/thumbnail/i.test(url) &&
          (/(?:\/drvs\/(?:md|hd|ld|source)\/raw)/i.test(url) ||
            /(?:\/raw(?:[?#]|$))/i.test(url) ||
            /\.mp4(?:[?#]|$)/i.test(url)),
      );
      const thumbnailUrl =
        uniqueUrls.find((url) => /thumbnail/i.test(url)) ||
        uniqueUrls.find((url) => /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)) ||
        null;

      return {
        mediaUrls,
        thumbnailUrl,
      };
    }

    async function fetchPostDetailHtml(detailUrl) {
      if (typeof detailUrl !== "string" || !detailUrl) {
        return "";
      }

      const response = await fetch(detailUrl, {
        credentials: "include",
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`Could not load post details (${response.status}).`);
      }

      return await response.text();
    }

    async function resolveMissingPostItemsFromDetails(unresolvedPosts) {
      const pending = Array.isArray(unresolvedPosts) ? unresolvedPosts : [];
      if (!pending.length) {
        return [];
      }

      const results = [];
      const detailCache = new Map();
      const concurrency = 4;
      let currentIndex = 0;

      async function resolveOne(entry) {
        if (!entry || typeof entry !== "object") {
          return;
        }

        const detailUrl =
          typeof entry.detailUrl === "string" && entry.detailUrl
            ? entry.detailUrl
            : typeof entry.id === "string" && entry.id
              ? `https://sora.chatgpt.com/p/${entry.id}`
              : "";
        if (!detailUrl) {
          return;
        }

        let detailResult = detailCache.get(detailUrl);
        if (!detailResult) {
          try {
            const html = await fetchPostDetailHtml(detailUrl);
            detailResult = extractPostMediaCandidatesFromHtml(html);
          } catch (_error) {
            detailResult = {
              mediaUrls: [],
              thumbnailUrl: null,
            };
          }
          detailCache.set(detailUrl, detailResult);
        }

        const mediaUrls =
          detailResult && Array.isArray(detailResult.mediaUrls) ? detailResult.mediaUrls : [];
        if (!mediaUrls.length) {
          return;
        }

        const thumbnailUrl =
          detailResult && typeof detailResult.thumbnailUrl === "string" && detailResult.thumbnailUrl
            ? detailResult.thumbnailUrl
            : typeof entry.thumbnailUrl === "string" && entry.thumbnailUrl
              ? entry.thumbnailUrl
              : null;

        mediaUrls.forEach((downloadUrl, attachmentIndex) => {
          results.push({
            id: entry.id,
            sourcePage: entry.sourcePage,
            sourceLabel: entry.sourceLabel,
            sourceType: "post",
            detailUrl,
            downloadUrl,
            filename: buildFilename(entry.preferredTitle, attachmentIndex, mediaUrls.length),
            thumbnailUrl,
            creatorDisplayName: entry.creatorDisplayName,
            creatorUsername: entry.creatorUsername,
            creatorProfilePictureUrl: entry.creatorProfilePictureUrl,
            prompt: entry.prompt,
            discoveryPhrase: entry.discoveryPhrase,
            createdAt: entry.createdAt,
            postedAt: entry.postedAt,
            likeCount: entry.likeCount,
            viewCount: entry.viewCount,
            shareCount: entry.shareCount,
            repostCount: entry.repostCount,
            remixCount: entry.remixCount,
            attachmentIndex,
            attachmentCount: mediaUrls.length,
            metadataEntries: compactMetadataEntries([
              { label: "Source", value: entry.sourceLabel },
              { label: "Source Type", value: "post" },
              { label: "Post ID", value: entry.id },
              { label: "Recovered From", value: "Post detail page" },
              { label: "Discovery Phrase", value: entry.discoveryPhrase },
              { label: "Posted At", value: entry.postedAt ?? null },
              { label: "Created At", value: entry.createdAt ?? null },
              { label: "Likes", value: entry.likeCount },
              { label: "Views", value: entry.viewCount },
              { label: "Shares", value: entry.shareCount },
              { label: "Reposts", value: entry.repostCount },
              { label: "Remixes", value: entry.remixCount },
              { label: "Creator", value: entry.creatorDisplayName },
              { label: "Creator Username", value: entry.creatorUsername },
              { label: "Detail URL", value: detailUrl, type: "link" },
              { label: "Download URL", value: downloadUrl, type: "link" },
              { label: "Thumbnail URL", value: thumbnailUrl, type: "link" },
            ]),
          });
        });
      }

      async function worker() {
        while (currentIndex < pending.length) {
          const entry = pending[currentIndex];
          currentIndex += 1;
          await resolveOne(entry);
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()),
      );

      return results;
    }

    function getPostCandidates(row) {
      if (!row || typeof row !== "object") {
        return [];
      }

      return [
        row.post,
        row.item,
        row.data,
        row.output,
        row.result,
        row.generation,
        row.asset,
        row.entry,
        row.content,
        row.payload,
        row.object,
        row.target,
        row.entity,
        row.node,
        row.card,
        row,
      ].filter((candidate) => candidate && typeof candidate === "object");
    }

    function extractPostIdFromUrl(value) {
      if (typeof value !== "string" || !value) {
        return "";
      }

      const patterns = [
        /\/p\/([^/?#]+)/i,
        /\/d\/([^/?#]+)/i,
      ];

      for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match && typeof match[1] === "string" && match[1]) {
          return match[1];
        }
      }

      return "";
    }

    function getPostId(value) {
      return (
        pickFirstString([
        value && value.post_id,
        value && value.postId,
        value && value.public_id,
        value && value.publicId,
        value && value.share_id,
        value && value.shareId,
        extractPostIdFromUrl(value && value.permalink),
        extractPostIdFromUrl(value && value.detail_url),
        extractPostIdFromUrl(value && value.public_url),
        extractPostIdFromUrl(value && value.publicUrl),
        extractPostIdFromUrl(value && value.detailUrl),
        extractPostIdFromUrl(value && value.url),
        value && value.id,
        value && value.generation_id,
        value && value.generationId,
        value && value.task_id,
        value && value.taskId,
        value && value.asset_id,
        value && value.assetId,
        value && value.item_id,
        value && value.itemId,
      ]) ||
        ""
      );
    }

    function getPostAttachments(value) {
      if (!value || typeof value !== "object") {
        return [];
      }

      const attachments = [];

      function appendEntries(source) {
        if (!source || typeof source !== "object") {
          return;
        }

        const attachmentArrays = [
          source.attachments,
          source.outputs,
          source.media,
          source.assets,
          source.files,
          source.videos,
          source.entries,
          source.nodes,
          source.clips,
          source.results,
        ];

        for (const array of attachmentArrays) {
          if (!Array.isArray(array)) {
            continue;
          }

          for (const entry of array) {
            if (entry && typeof entry === "object") {
              attachments.push(entry);
            }
          }
        }

        const singularCandidates = [
          source.attachment,
          source.output,
          source.result,
          source.generation,
          source.asset,
          source.file,
          source.video,
          source.entry,
          source.content,
          source.payload,
          source.object,
          source.target,
          source.entity,
          source.node,
          source.card,
        ];

        for (const entry of singularCandidates) {
          if (entry && typeof entry === "object") {
            attachments.push(entry);
          }
        }
      }

      appendEntries(value);
      for (const candidate of getPostCandidates(value)) {
        appendEntries(candidate);
      }

      const dedupedAttachments = [];
      const seenAttachmentKeys = new Set();

      for (const attachment of attachments) {
        const attachmentKey =
          pickFirstString([
            attachment && attachment.id,
            attachment && attachment.generation_id,
            attachment && attachment.generationId,
            attachment && attachment.task_id,
            attachment && attachment.taskId,
            getDownloadUrl(attachment),
            getDirectMediaUrl(attachment),
            attachment && attachment.url,
            attachment && attachment.path,
          ]) || null;

        if (attachmentKey) {
          if (seenAttachmentKeys.has(attachmentKey)) {
            continue;
          }

          seenAttachmentKeys.add(attachmentKey);
        }

        dedupedAttachments.push(attachment);
      }

      return dedupedAttachments;
    }

    function normalizePostListingResponse(payload, config = {}) {
      const rows = getPostListingRows(payload);
      const ids = [];
      const items = [];
      const unresolvedPosts = [];
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
        const post = getPostCandidates(row).find((candidate) => {
          const postId = getPostId(candidate);
          return Boolean(postId && (!requireOwner || candidate.is_owner));
        });
        const postId = getPostId(post);
        if (!post || typeof postId !== "string" || (requireOwner && !post.is_owner)) {
          continue;
        }

        const creatorClassification =
          config && config.separateCreatorBuckets === true
            ? classifyCreatorFeedItem(row, post, config)
            : {
              sourcePage,
              sourceLabel,
            };
        const itemSourcePage =
          creatorClassification && typeof creatorClassification.sourcePage === "string"
            ? creatorClassification.sourcePage
            : sourcePage;
        const itemSourceLabel =
          creatorClassification && typeof creatorClassification.sourceLabel === "string"
            ? creatorClassification.sourceLabel
            : sourceLabel;
        const discoveryPhrase = pickFirstString([
          post.discovery_phrase,
          post.discoveryPhrase,
        ]);
        const detailUrl =
          typeof post.permalink === "string" && post.permalink
            ? post.permalink
            : `https://sora.chatgpt.com/p/${postId}`;
        const creatorDisplayName = getCreatorDisplayName(row) || getCreatorDisplayName(post) || null;
        const creatorUsername = getCreatorUsername(row) || getCreatorUsername(post) || null;
        const creatorProfilePictureUrl =
          getCreatorProfilePictureUrl(row) || getCreatorProfilePictureUrl(post) || null;
        const prompt =
          (typeof post.text === "string" && post.text) ||
          null;
        const preferredTitle = pickFirstString([
          discoveryPhrase,
          prompt,
          postId,
        ]);
        const createdAt = post.posted_at ?? post.updated_at ?? null;
        const postedAt = post.posted_at ?? null;

        let attachments = getPostAttachments(row).filter(
          (attachment) =>
            attachment &&
            (getDownloadUrl(attachment) || getDirectMediaUrl(attachment)),
        );

        if (
          attachments.length === 0 &&
          (getDownloadUrl(row) || getDirectMediaUrl(row) || getDownloadUrl(post) || getDirectMediaUrl(post))
        ) {
          attachments = [row];
        }

        if (!attachments.length) {
          if (config && config.collectUnresolvedPosts === true) {
            unresolvedPosts.push({
              id: postId,
              sourcePage: itemSourcePage,
              sourceLabel: itemSourceLabel,
              detailUrl,
              creatorDisplayName,
              creatorUsername,
              creatorProfilePictureUrl,
              prompt,
              discoveryPhrase,
              preferredTitle,
              createdAt,
              postedAt,
              likeCount: post.like_count ?? null,
              viewCount: post.view_count ?? null,
              shareCount: post.share_count ?? null,
              repostCount: post.repost_count ?? null,
              remixCount: post.remix_count ?? null,
              thumbnailUrl: getThumbnailUrl(post) || null,
            });
          }
          continue;
        }

        ids.push(postId);

        attachments.forEach((attachment, attachmentIndex) => {
          const durationSeconds = getDurationSeconds(attachment) || null;
          const fileSizeBytes = getFileSizeBytes(attachment) || null;
          const downloadUrl =
            getDownloadUrl(attachment) ||
            getDirectMediaUrl(attachment) ||
            getDownloadUrl(row) ||
            getDirectMediaUrl(row) ||
            getDownloadUrl(post) ||
            getDirectMediaUrl(post);
          const preferredAttachmentTitle = pickFirstString([
            discoveryPhrase,
            prompt,
            attachment.prompt,
            postId,
          ]);
          items.push({
            id: postId,
            sourcePage: itemSourcePage,
            sourceLabel: itemSourceLabel,
            sourceType: "post",
            detailUrl,
            downloadUrl,
            filename: buildFilename(preferredAttachmentTitle, attachmentIndex, attachments.length),
            thumbnailUrl:
              getThumbnailUrl(attachment) ||
              getThumbnailUrl(post) ||
              null,
            creatorDisplayName,
            creatorUsername,
            creatorProfilePictureUrl,
            prompt:
              prompt ||
              (typeof attachment.prompt === "string" && attachment.prompt) ||
              null,
            discoveryPhrase,
            createdAt,
            postedAt,
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
              { label: "Source", value: itemSourceLabel },
              { label: "Source Type", value: "post" },
              { label: "Post ID", value: postId },
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
                label: "Creator",
                value: creatorDisplayName,
              },
              {
                label: "Creator Username",
                value: creatorUsername,
              },
              {
                label: "Share Setting",
                value: post.permissions && typeof post.permissions.share_setting === "string"
                  ? post.permissions.share_setting
                  : null,
              },
              { label: "Detail URL", value: post.permalink, type: "link" },
              { label: "Download URL", value: downloadUrl, type: "link" },
              { label: "Thumbnail URL", value: getThumbnailUrl(attachment) || getThumbnailUrl(post), type: "link" },
              {
                label: "Creator Profile Image",
                value: creatorProfilePictureUrl,
                type: "link",
              },
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
        nextCursor: getNextCursorForRows(payload, rows, config),
        partialWarning: "",
        unresolvedPosts,
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
        nextCursor: getNextCursorFromPayload(payload),
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

    async function fetchPreferredNormalizedResult(urls, normalizePayload) {
      let firstSuccessfulResult = null;
      let bestResult = null;
      let bestScore = -1;
      let bestPaginatedResult = null;
      let bestPaginatedScore = -1;
      let lastError = null;

      for (const url of urls) {
        try {
          const payload = await fetchJson(url);
          const normalizedResult =
            typeof normalizePayload === "function" ? normalizePayload(payload) : payload;

          if (!firstSuccessfulResult) {
            firstSuccessfulResult = normalizedResult;
          }

          const itemCount = Array.isArray(normalizedResult && normalizedResult.items)
            ? normalizedResult.items.length
            : 0;
          const rowCount = Number.isFinite(Number(normalizedResult && normalizedResult.rowCount))
            ? Number(normalizedResult.rowCount)
            : 0;
          const score = Math.max(itemCount, rowCount);
          const hasNextCursor = Boolean(
            normalizedResult &&
              typeof normalizedResult.nextCursor === "string" &&
              normalizedResult.nextCursor,
          );

          if (score > bestScore) {
            bestScore = score;
            bestResult = normalizedResult;
          }

          if (hasNextCursor && score > 0 && score > bestPaginatedScore) {
            bestPaginatedScore = score;
            bestPaginatedResult = normalizedResult;
          }
        } catch (error) {
          lastError = error;
        }
      }

      if (bestPaginatedResult) {
        return bestPaginatedResult;
      }

      if (bestResult) {
        return bestResult;
      }

      if (firstSuccessfulResult) {
        return firstSuccessfulResult;
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
          sourceLabel,
          sourceType: "draft",
          detailUrl,
          downloadUrl,
          filename: buildFilename(preferredTitle, 0, 1),
          thumbnailUrl,
          creatorDisplayName: getCreatorDisplayName(row) || null,
          creatorUsername: getCreatorUsername(row) || null,
          creatorProfilePictureUrl: getCreatorProfilePictureUrl(row) || null,
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
            { label: "Creator", value: getCreatorDisplayName(row) },
            { label: "Creator Username", value: getCreatorUsername(row) },
            { label: "Detail URL", value: detailUrl, type: "link" },
            { label: "Download URL", value: downloadUrl, type: "link" },
            { label: "Thumbnail URL", value: thumbnailUrl, type: "link" },
            {
              label: "Creator Profile Image",
              value: getCreatorProfilePictureUrl(row),
              type: "link",
            },
          ]),
        });
    }

      return {
        ids: [...new Set(ids)],
        items,
        rowCount: rows.length,
        nextCursor: getNextCursorFromPayload(payload),
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
        return applySessionProfileFallback(
          normalizeProfileResponse(payload),
          await getSessionUserProfile(),
        );
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
        return applySessionProfileFallback(
          normalizeDraftResponse(payload, {
            sourcePage: "drafts",
            sourceLabel: "Draft",
          }),
          await getSessionUserProfile(),
        );
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

      if (source === "creatorProfileLookup") {
        const snapshotProfile = await waitForCreatorProfileSnapshot();
        let profile = snapshotProfile;

        const lookupUsername =
          (snapshotProfile && normalizeCreatorUsername(snapshotProfile.username)) ||
          (typeof options.routeUrl === "string" ? getCreatorUsernameFromUrl(options.routeUrl) : "");

        if ((!snapshotProfile || !isCanonicalCreatorUserId(snapshotProfile.userId)) && lookupUsername) {
          try {
            const resolvedProfile = await fetchCreatorProfileByUsername(lookupUsername);
            if (resolvedProfile) {
              profile = {
                ...(snapshotProfile && typeof snapshotProfile === "object" ? snapshotProfile : {}),
                ...resolvedProfile,
                profileId:
                  resolvedProfile.profileId ||
                  (snapshotProfile && snapshotProfile.profileId) ||
                  lookupUsername,
              };
            }
          } catch (_error) {
            profile = snapshotProfile;
          }
        }

        if (!profile) {
          throw new Error("Could not read a creator profile from that Sora page.");
        }

        return {
          profile,
        };
      }

      if (source === "creatorPublished") {
        const creatorId = await deriveProfileUserId(options);
        const limit = Number(options.limit) || 100;
        const candidateUrls = [];
        const listingCandidates = ["posts", "profile", "public", "published"];

        for (const listingName of listingCandidates) {
          const url = new URL(
            `/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/${listingName}`,
            window.location.origin,
          );
          url.searchParams.set("limit", String(limit));
          if (typeof options.cursor === "string" && options.cursor) {
            url.searchParams.set("cursor", options.cursor);
          }
          candidateUrls.push(url.toString());
        }

        const feedUrl = new URL(
          `/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`,
          window.location.origin,
        );
        feedUrl.searchParams.set("limit", String(limit));
        feedUrl.searchParams.set("cut", "nf2");
        if (typeof options.cursor === "string" && options.cursor) {
          feedUrl.searchParams.set("cursor", options.cursor);
        }
        candidateUrls.push(feedUrl.toString());

        const payload = await fetchFirstSuccessfulJson(candidateUrls);
        const normalized = normalizePostListingResponse(payload, {
          requireOwner: false,
          separateCreatorBuckets: true,
          collectUnresolvedPosts: true,
          cursorKind: "sv2_created_at",
          requestCursor: typeof options.cursor === "string" ? options.cursor : "",
          creatorUserId:
            typeof options.creatorUserId === "string" ? options.creatorUserId : "",
          creatorUsername:
            typeof options.creatorUsername === "string" ? options.creatorUsername : "",
        });
        if (Array.isArray(normalized.unresolvedPosts) && normalized.unresolvedPosts.length) {
          const recoveredItems = await resolveMissingPostItemsFromDetails(normalized.unresolvedPosts);
          if (recoveredItems.length) {
            const recoveredKeys = new Set(
              normalized.items.map((item) =>
                `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`,
              ),
            );
            for (const item of recoveredItems) {
              const itemKey = `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`;
              if (recoveredKeys.has(itemKey)) {
                continue;
              }
              recoveredKeys.add(itemKey);
              normalized.items.push(item);
            }
            normalized.ids = [...new Set([...normalized.ids, ...recoveredItems.map((item) => item.id)])];
          }
        }
        delete normalized.unresolvedPosts;
        return normalized;
      }

      if (source === "creatorCameos") {
        const creatorId = await deriveProfileUserId(options);
        const limit = Number(options.limit) || 100;
        const url = new URL(
          `/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`,
          window.location.origin,
        );
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("cut", "appearances");
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        const normalized = normalizePostListingResponse(payload, {
          sourcePage: "creatorCameos",
          sourceLabel: "Creator Cast In",
          requireOwner: false,
          collectUnresolvedPosts: true,
          cursorKind: "sv2_created_at",
          requestCursor: typeof options.cursor === "string" ? options.cursor : "",
        });
        if (Array.isArray(normalized.unresolvedPosts) && normalized.unresolvedPosts.length) {
          const recoveredItems = await resolveMissingPostItemsFromDetails(normalized.unresolvedPosts);
          if (recoveredItems.length) {
            const recoveredKeys = new Set(
              normalized.items.map((item) =>
                `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`,
              ),
            );
            for (const item of recoveredItems) {
              const itemKey = `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`;
              if (recoveredKeys.has(itemKey)) {
                continue;
              }
              recoveredKeys.add(itemKey);
              normalized.items.push(item);
            }
            normalized.ids = [...new Set([...normalized.ids, ...recoveredItems.map((item) => item.id)])];
          }
        }
        delete normalized.unresolvedPosts;
        return normalized;
      }

      if (source === "creatorCharacters") {
        const creatorId = await deriveProfileUserId(options);
        const limit = Number(options.limit) || 100;
        const url = new URL(
          `/backend/project_y/profile/${encodeURIComponent(creatorId)}/characters`,
          window.location.origin,
        );
        url.searchParams.set("limit", String(limit));
        if (typeof options.cursor === "string" && options.cursor) {
          url.searchParams.set("cursor", options.cursor);
        }
        const payload = await fetchJson(url.toString());
        return normalizeCharacterAccountsIndexResponse(payload);
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

        const normalized = await fetchPreferredNormalizedResult(candidateUrls, (payload) =>
          normalizePostListingResponse(payload, {
            sourcePage: "characters",
            sourceLabel: "Character",
            requireOwner: false,
            collectUnresolvedPosts: true,
            cursorKind: "sv2_created_at",
            requestCursor: typeof options.cursor === "string" ? options.cursor : "",
          }),
        );
        if (Array.isArray(normalized.unresolvedPosts) && normalized.unresolvedPosts.length) {
          const recoveredItems = await resolveMissingPostItemsFromDetails(normalized.unresolvedPosts);
          if (recoveredItems.length) {
            const recoveredKeys = new Set(
              normalized.items.map((item) =>
                `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`,
              ),
            );
            for (const item of recoveredItems) {
              const itemKey = `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`;
              if (recoveredKeys.has(itemKey)) {
                continue;
              }
              recoveredKeys.add(itemKey);
              normalized.items.push(item);
            }
            normalized.ids = [...new Set([...normalized.ids, ...recoveredItems.map((item) => item.id)])];
          }
        }
        delete normalized.unresolvedPosts;
        return normalized;
      }

      if (source === "characterAccountAppearances") {
        const characterId =
          typeof options.characterId === "string" && options.characterId ? options.characterId : "";
        if (!characterId) {
          throw new Error("A character account id is required to fetch proxy-account appearances.");
        }

        const limit = Number(options.limit) || 100;
        const candidateUrls = [];
        for (const cut of ["appearances", "nf2"]) {
          const url = new URL(
            `/backend/project_y/profile_feed/${encodeURIComponent(characterId)}`,
            window.location.origin,
          );
          url.searchParams.set("limit", String(limit));
          url.searchParams.set("cut", cut);
          if (typeof options.cursor === "string" && options.cursor) {
            url.searchParams.set("cursor", options.cursor);
          }
          candidateUrls.push(url.toString());
        }

        const normalized = await fetchPreferredNormalizedResult(candidateUrls, (payload) =>
          normalizePostListingResponse(payload, {
            sourcePage: "creatorCharacterCameos",
            sourceLabel: "Character Cameo",
            requireOwner: false,
            collectUnresolvedPosts: true,
            cursorKind: "sv2_created_at",
            requestCursor: typeof options.cursor === "string" ? options.cursor : "",
          }),
        );
        if (Array.isArray(normalized.unresolvedPosts) && normalized.unresolvedPosts.length) {
          const recoveredItems = await resolveMissingPostItemsFromDetails(normalized.unresolvedPosts);
          if (recoveredItems.length) {
            const recoveredKeys = new Set(
              normalized.items.map((item) =>
                `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`,
              ),
            );
            for (const item of recoveredItems) {
              const itemKey = `${item.id}:${item.downloadUrl || item.detailUrl || item.attachmentIndex}`;
              if (recoveredKeys.has(itemKey)) {
                continue;
              }
              recoveredKeys.add(itemKey);
              normalized.items.push(item);
            }
            normalized.ids = [...new Set([...normalized.ids, ...recoveredItems.map((item) => item.id)])];
          }
        }
        delete normalized.unresolvedPosts;
        return normalized;
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
