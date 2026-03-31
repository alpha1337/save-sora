// Save Sora popup controller.
// The popup is intentionally "thin": it renders state, captures user intent, and sends
// messages to the background service worker. Anything that needs privileged Chrome APIs
// or access to the user's signed-in Sora session stays in background.js.
const totalCount = document.getElementById("total-count");
const warningBox = document.getElementById("warning-box");
const errorBox = document.getElementById("error-box");
const fetchButton = document.getElementById("fetch-button");
const fetchButtonLabel = fetchButton.querySelector(".button-label");
const downloadButton = document.getElementById("download-button");
const selectAllButton = document.getElementById("select-all-button");
const clearSelectionButton = document.getElementById("clear-selection-button");
const summaryPanel = document.querySelector(".summary-panel");
const selectionSummary = document.getElementById("selection-summary");
const emptyState = document.getElementById("empty-state");
const emptyStateImage = document.querySelector(".empty-state-image");
const emptyStateText = document.getElementById("empty-state-text");
const itemsList = document.getElementById("items-list");
const pickerToolbar = document.querySelector(".picker-toolbar");
const controlsPanel = document.querySelector(".controls-panel");
const searchInput = document.getElementById("search-input");
const sourceSelectField = document.querySelector(".source-select-field");
const sourceSelect = document.getElementById("source-select");
const sortSelect = document.getElementById("sort-select");
const runForm = document.getElementById("run-form");
const appShell = document.querySelector(".app");
const backToTopButton = document.getElementById("back-to-top-button");
const downloadOverlay = document.getElementById("download-overlay");
const downloadOverlayTitle = document.getElementById("download-overlay-title");
const downloadOverlayStatus = document.getElementById("download-overlay-status");
const downloadOverlayCount = document.getElementById("download-overlay-count");
const downloadOverlayPercent = document.getElementById("download-overlay-percent");
const downloadOverlayFill = document.getElementById("download-overlay-fill");
const downloadOverlayThanks = document.getElementById("download-overlay-thanks");
const downloadOverlayCancel = document.getElementById("download-overlay-cancel");
const tabButtons = [...document.querySelectorAll(".tab-button")];
const tabPanels = [...document.querySelectorAll(".tab-panel")];
const maxVideosInput = document.getElementById("max-videos-input");
const defaultSourceInput = document.getElementById("default-source-input");
const defaultSortInput = document.getElementById("default-sort-input");
const defaultThemeInput = document.getElementById("default-theme-input");
const settingsStatus = document.getElementById("settings-status");
const themeToggle = document.getElementById("theme-toggle");

const titleSaveTimers = new Map();
const FETCH_STATUS_MESSAGES = [
  "Finding videos in the latent fog...",
  "Convincing pixels to reveal themselves...",
  "Dusting off the render queue...",
  "Looking behind the glossy Sora curtain...",
  "Checking if the cloud remembers this one...",
  "Waking up the storyboard goblins...",
  "Reassembling your cinematic universe...",
  "Following suspiciously cinematic breadcrumbs...",
  "Locating drafts in the multiverse...",
  "Sweeping the timeline for hidden bangers...",
  "Searching for posts with main-character energy...",
  "Interrogating the preview thumbnails...",
  "Coaxing the archive into cooperation...",
  "Scanning the dream machine for artifacts...",
  "Patching into the vibe stream...",
  "Counting lions, castles, and VHS tapes...",
  "Looking for uploads with dramatic lighting...",
  "Synchronizing with the chaos engine...",
  "Checking the vault for forbidden masterpieces...",
  "Appealing content violation verdicts...",
  "Bypassing content violations... allegedly...",
  "Rewinding public posts frame by frame...",
  "Dusting glitter off the generation logs...",
  "Peeking inside the render nebula...",
  "Asking the drafts nicely to come out...",
  "Recovering clips from the imagination layer...",
  "Searching for videos with suspiciously good prompts...",
  "Inspecting every portal to /drafts...",
  "Untangling the generated timeline...",
  "Polishing the metadata for dramatic effect...",
  "Summoning thumbnails from the void...",
  "Following the trail of downloadable URLs...",
  "Listening for distant render fanfare...",
  "Assembling the director's cut of your feed...",
  "Mapping the kingdom of published posts...",
  "Checking which realities made it to export...",
  "Making friends with the batch processor...",
  "Consulting the oracle of attachments...",
  "Converting latent dreams into a checklist...",
  "Sorting chaos into a respectable library...",
  "Peeking behind every cinematic trap door...",
  "Looking for the draft that got away...",
  "Shuffling through alternate endings...",
  "Checking for surprise sequels...",
  "Reading the ancient scroll of generation IDs...",
  "Translating thumbnails from cloud to card...",
  "Tracking down every glorious remix-adjacent artifact...",
  "Searching the horizon for unfinished epics...",
  "Turning your Sora orbit into a catalog...",
  "Gently bullying the API into being helpful...",
];

let pollTimer = null;
let lastRenderedSignature = "";
let activeTab = "overview";
let latestBusy = false;
let latestPaused = false;
let settingsSaveTimer = null;
let fetchStatusTimer = null;
let activeFetchStatusMessage = "";
let appliedSettingsDefaults = {
  source: "",
  sort: "",
};
let latestRenderState = {
  items: [],
  selectedKeys: [],
  titleOverrides: {},
  disableInputs: false,
  phase: "idle",
};
const browseState = {
  query: "",
  sort: "newest",
};
let latestSummaryContext = {
  totalCount: 0,
  selectedCount: 0,
  visibleCount: 0,
  visibleSelectedCount: 0,
  phase: "idle",
};
let pendingDownloadStart = false;
let downloadOverlaySessionActive = false;

runForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const isResetMode = fetchButton.dataset.mode === "reset";
  const selected = getSelectedSource();
  const sources = selected === "both" ? ["profile", "drafts"] : [selected];

  setControlsDisabled(true);
  hideNotice(errorBox);

  if (!isResetMode) {
    itemsList.classList.add("hidden");
    emptyState.classList.add("hidden");
    if (emptyStateText instanceof HTMLElement) {
      emptyStateText.classList.add("hidden");
      emptyStateText.textContent = "";
    }
    if (emptyStateImage instanceof HTMLElement) {
      emptyStateImage.classList.remove("hidden");
    }
    selectionSummary.textContent = activeFetchStatusMessage || "Finding videos...";
  }

  try {
    const response = isResetMode
      ? await chrome.runtime.sendMessage({
          type: "RESET_STATE",
        })
      : await chrome.runtime.sendMessage({
          type: "START_SCAN",
          sources,
          searchQuery: browseState.query,
        });

    if (!response || !response.ok) {
      throw new Error(
        (response && response.error) ||
          (isResetMode ? "Could not reset the current video list." : "Could not fetch the video list."),
      );
    }

  } catch (error) {
    showNotice(errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
});

downloadButton.addEventListener("click", async () => {
  setControlsDisabled(true);
  hideNotice(errorBox);
  pendingDownloadStart = true;
  downloadOverlaySessionActive = true;
  updateDownloadOverlay({
    phase: "preparing-download",
    message: "Saving your latest titles and preparing the download queue...",
    runTotal: getSelectedKeysFromDom().length,
    completed: 0,
    failed: 0,
  });

  try {
    await flushPendingTitleSaves();
    const selectedKeys = getSelectedKeysFromDom();
    await persistSelection(selectedKeys);

    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_SELECTED" });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || "Could not start the selected downloads.");
    }
    if (response.state) {
      renderState(response.state);
    }
  } catch (error) {
    pendingDownloadStart = false;
    showNotice(errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
});

if (downloadOverlayCancel) {
  downloadOverlayCancel.addEventListener("click", async () => {
    const action = downloadOverlayCancel.dataset.action || "cancel";
    if (action === "return") {
      await refreshStatus();
      downloadOverlaySessionActive = false;
      pendingDownloadStart = false;
      updateDownloadOverlay({
        phase: latestRenderState.phase || "idle",
        runTotal: latestSummaryContext.totalCount,
        completed: 0,
        failed: 0,
      });
      return;
    }

    downloadOverlayCancel.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({ type: "ABORT_DOWNLOADS" });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Could not cancel the active download.");
      }
    } catch (error) {
      showNotice(errorBox, error instanceof Error ? error.message : String(error));
    } finally {
      pendingDownloadStart = false;
      await refreshStatus();
    }
  });
}

selectAllButton.addEventListener("click", async () => {
  const checkboxes = getItemCheckboxes({ visibleOnly: true, enabledOnly: true });
  for (const checkbox of checkboxes) {
    checkbox.checked = true;
  }

  const selectedKeys = getSelectedKeysFromDom();
  latestRenderState.selectedKeys = selectedKeys;
  renderCurrentItems();
  applyCurrentSelectionUi();

  await persistSelection(selectedKeys);
});

clearSelectionButton.addEventListener("click", async () => {
  const checkboxes = getItemCheckboxes({ visibleOnly: true });
  for (const checkbox of checkboxes) {
    checkbox.checked = false;
  }

  const selectedKeys = getSelectedKeysFromDom();
  latestRenderState.selectedKeys = selectedKeys;
  renderCurrentItems();
  applyCurrentSelectionUi();

  await persistSelection(selectedKeys);
});

itemsList.addEventListener("click", async (event) => {
  const target = event.target;
  const targetElement =
    target instanceof Element
      ? target
      : target instanceof Node && target.parentElement instanceof Element
        ? target.parentElement
        : null;

  if (!(targetElement instanceof Element)) {
    return;
  }

  const removeButton = targetElement.closest(".item-remove-button");
  if (removeButton instanceof HTMLButtonElement) {
    event.preventDefault();
    event.stopPropagation();
    hideNotice(errorBox);
    stopPolling();

    const itemKey = removeButton.dataset.itemKey;
    const currentItem = latestRenderState.items.find((item) => getItemKey(item) === itemKey);
    const isDownloaded = Boolean(currentItem && currentItem.isDownloaded);
    const nextRemoved = !Boolean(currentItem && currentItem.isRemoved);
    const didOptimisticallyUpdate = isDownloaded
      ? applyOptimisticDownloadedState(itemKey, false)
      : applyOptimisticRemovedState(itemKey, nextRemoved);

    try {
      await flushPendingTitleSaves();
      const response = await chrome.runtime.sendMessage({
        type: isDownloaded ? "SET_ITEM_DOWNLOADED" : "REMOVE_ITEM",
        itemKey,
        removed: nextRemoved,
        downloaded: false,
      });

      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Could not remove the video.");
      }
      if (response.state) {
        renderState(response.state);
      } else {
        await refreshStatus();
      }
    } catch (error) {
      if (didOptimisticallyUpdate) {
        await refreshStatus();
      }
      showNotice(errorBox, error instanceof Error ? error.message : String(error));
      startPolling();
      return;
    }
    startPolling();
    return;
  }

  if (
    targetElement.closest(".item-title-input") ||
    targetElement.closest(".item-link") ||
    targetElement.closest(".item-metadata-link") ||
    targetElement.closest(".item-media") ||
    targetElement.closest(".item-play-button") ||
    targetElement.closest(".item-video") ||
    targetElement.closest(".item-replay-button")
  ) {
    return;
  }

  const card = targetElement.closest(".item-card");
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const checkbox = card.querySelector(".item-checkbox");
  if (!(checkbox instanceof HTMLInputElement) || checkbox.disabled) {
    return;
  }

  checkbox.checked = !checkbox.checked;
  await updateSelectionFromDom();
});

itemsList.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.type === "checkbox") {
    await updateSelectionFromDom();
  }
});

if (maxVideosInput) {
  maxVideosInput.addEventListener("input", () => {
    settingsStatus.textContent = "Saving...";
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer);
    }

    settingsSaveTimer = window.setTimeout(() => {
      void saveSettingsFromForm();
    }, 250);
  });

  maxVideosInput.addEventListener("blur", () => {
    void saveSettingsFromForm();
  });
}

if (defaultSourceInput) {
  defaultSourceInput.addEventListener("change", () => {
    settingsStatus.textContent = "Saving...";
    void saveSettingsFromForm();
  });
}

if (defaultSortInput) {
  defaultSortInput.addEventListener("change", () => {
    settingsStatus.textContent = "Saving...";
    void saveSettingsFromForm();
  });
}

if (defaultThemeInput) {
  defaultThemeInput.addEventListener("change", () => {
    settingsStatus.textContent = "Saving...";
    void saveSettingsFromForm();
  });
}

if (themeToggle) {
  themeToggle.addEventListener("change", async () => {
    const nextTheme = themeToggle.checked ? "light" : "dark";
    applyTheme(nextTheme);

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SET_SETTINGS",
        settings: {
          theme: nextTheme,
        },
      });

      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Could not save the theme.");
      }

      if (defaultThemeInput) {
        defaultThemeInput.value = nextTheme;
      }
    } catch (error) {
      showNotice(errorBox, error instanceof Error ? error.message : String(error));
      await refreshStatus();
    }
  });
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    browseState.query = searchInput.value || "";
    renderCurrentItems();
    applyCurrentSelectionUi();
    updateBackToTopVisibility();
  });
}

if (sortSelect) {
  sortSelect.addEventListener("change", () => {
    browseState.sort = sortSelect.value || "newest";
    renderCurrentItems();
    applyCurrentSelectionUi();
    updateBackToTopVisibility();
  });
}

itemsList.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("item-title-input")) {
    return;
  }

  queueTitleSave(target.dataset.itemKey, target.value);
});

itemsList.addEventListener("focusin", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.classList.contains("item-title-input")) {
    stopPolling();
  }
});

itemsList.addEventListener("focusout", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.classList.contains("item-title-input")) {
    return;
  }

  const itemKey = target.dataset.itemKey;
  void saveTitleOverride(itemKey, target.value).catch((error) => {
    showNotice(errorBox, error instanceof Error ? error.message : String(error));
  });

  window.setTimeout(() => {
    const activeElement = document.activeElement;
    if (
      !(activeElement instanceof HTMLInputElement) ||
      !activeElement.classList.contains("item-title-input")
    ) {
      startPolling();
      void refreshStatus();
    }
  }, 0);
});

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    const nextTab = button.dataset.tab || "overview";
    setActiveTab(nextTab);
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
  }
});

if (appShell instanceof HTMLElement) {
  appShell.addEventListener("scroll", () => {
    updateBackToTopVisibility();
  });
}

if (backToTopButton) {
  backToTopButton.addEventListener("click", () => {
    if (!(appShell instanceof HTMLElement)) {
      return;
    }

    appShell.scrollTo({ top: 0, behavior: "smooth" });
  });
}

void refreshStatus();
startPolling();
setActiveTab("overview");

function getSelectedSource() {
  const formData = new FormData(runForm);
  return formData.get("source") || "both";
}

function setActiveTab(nextTab) {
  activeTab = nextTab;

  for (const button of tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === nextTab);
  }

  for (const panel of tabPanels) {
    const isActive = panel.dataset.panel === nextTab;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  }

  updateAppScrollLock();
  updateBackToTopVisibility();
}

function updateAppScrollLock() {
  if (!(appShell instanceof HTMLElement)) {
    return;
  }

  const shouldLock =
    activeTab === "overview" &&
    latestRenderState.items.length === 0 &&
    latestRenderState.phase !== "fetching" &&
    latestRenderState.phase !== "downloading" &&
    latestRenderState.phase !== "paused";

  appShell.classList.toggle("is-scroll-locked", shouldLock);
  appShell.classList.toggle("is-scrollable", !shouldLock);
}

function getItemKey(item) {
  return item && typeof item.key === "string"
    ? item.key
    : `${item.sourcePage}:${item.id}:${item.attachmentIndex}`;
}

function getDefaultItemTitle(item) {
  if (item && typeof item.filename === "string" && item.filename) {
    return item.filename.replace(/\.mp4$/i, "");
  }

  return item && typeof item.id === "string" ? item.id : "video";
}

function resolveItemTitle(item, titleOverrides) {
  const key = getItemKey(item);
  const override =
    titleOverrides && typeof titleOverrides[key] === "string" ? titleOverrides[key] : "";
  return override || getDefaultItemTitle(item);
}

function getItemCheckboxes() {
  return getItemCheckboxesWithOptions();
}

function getItemCheckboxesWithOptions(options = {}) {
  const visibleOnly = Boolean(options.visibleOnly);
  const enabledOnly = Boolean(options.enabledOnly);
  return [...itemsList.querySelectorAll('input[type="checkbox"][data-item-key]')].filter((input) => {
    if (enabledOnly && input.disabled) {
      return false;
    }

    if (!visibleOnly) {
      return true;
    }

    const card = input.closest(".item-card");
    return !(card instanceof HTMLElement) || !card.classList.contains("hidden");
  });
}

function getSelectedKeysFromDom(options = {}) {
  return getItemCheckboxesWithOptions(options)
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function applySelectionUi(totalCount, selectedCount, visibleCount, visibleSelectedCount, phase) {
  updateTotalSummary(latestRenderState.items, latestRenderState.selectedKeys);
  updateSelectionSummary({
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
    query: browseState.query,
  });
  syncSelectionControls(totalCount, selectedCount, visibleCount);
}

function applyCurrentSelectionUi() {
  const totalCount = getActiveSelectableCount(latestRenderState.items);
  const selectedCount = getSelectedKeysFromDom().length;
  const visibleCount = getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true }).length;
  const visibleSelectedCount = getSelectedKeysFromDom({ visibleOnly: true }).length;
  applySelectionUi(
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    latestBusy ? "fetching" : latestRenderState.phase || "ready",
  );
}

function applyOptimisticRemovedState(itemKey, removed) {
  if (typeof itemKey !== "string" || !itemKey) {
    return false;
  }

  let didUpdate = false;
  const nextItems = latestRenderState.items.map((item) => {
    const key = getItemKey(item);
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
    return false;
  }

  const nextSelectedKeySet = new Set(latestRenderState.selectedKeys);
  if (removed) {
    nextSelectedKeySet.delete(itemKey);
  } else {
    nextSelectedKeySet.add(itemKey);
  }
  const nextSelectedKeys = [...nextSelectedKeySet];
  latestRenderState = {
    ...latestRenderState,
    items: nextItems,
    selectedKeys: nextSelectedKeys,
  };

  renderCurrentItems();
  applyCurrentSelectionUi();
  updateBackToTopVisibility();
  return true;
}

function applyOptimisticDownloadedState(itemKey, downloaded) {
  if (typeof itemKey !== "string" || !itemKey) {
    return false;
  }

  let didUpdate = false;
  const nextItems = latestRenderState.items.map((item) => {
    const key = getItemKey(item);
    if (key !== itemKey || Boolean(item.isDownloaded) === Boolean(downloaded)) {
      return item;
    }

    didUpdate = true;
    return {
      ...item,
      isDownloaded: Boolean(downloaded),
    };
  });

  if (!didUpdate) {
    return false;
  }

  const nextSelectedKeySet = new Set(latestRenderState.selectedKeys);
  if (downloaded) {
    nextSelectedKeySet.delete(itemKey);
  } else {
    nextSelectedKeySet.add(itemKey);
  }

  latestRenderState = {
    ...latestRenderState,
    items: nextItems,
    selectedKeys: [...nextSelectedKeySet],
  };

  renderCurrentItems();
  applyCurrentSelectionUi();
  updateBackToTopVisibility();
  return true;
}

async function updateSelectionFromDom() {
  const selectedKeys = getSelectedKeysFromDom();
  latestRenderState.selectedKeys = selectedKeys;
  renderCurrentItems();
  applyCurrentSelectionUi();
  await persistSelection(selectedKeys);
}

function startPolling() {
  // Poll background state so long-running scans/downloads stay visible even if the popup
  // is closed and reopened while the service worker keeps running.
  stopPolling();
  pollTimer = window.setInterval(() => {
    void refreshStatus();
  }, 1200);
}

function stopPolling() {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function queueTitleSave(itemKey, value) {
  if (typeof itemKey !== "string" || !itemKey) {
    return;
  }

  const existingTimer = titleSaveTimers.get(itemKey);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    void saveTitleOverride(itemKey, value);
  }, 250);

  titleSaveTimers.set(itemKey, timer);
}

async function flushPendingTitleSaves() {
  const pendingKeys = new Set(titleSaveTimers.keys());
  const activeInput =
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.classList.contains("item-title-input")
      ? document.activeElement
      : null;

  if (activeInput && activeInput.dataset.itemKey) {
    pendingKeys.add(activeInput.dataset.itemKey);
  }

  for (const itemKey of pendingKeys) {
    if (typeof itemKey !== "string" || !itemKey) {
      continue;
    }

    const input = itemsList.querySelector(`input.item-title-input[data-item-key="${CSS.escape(itemKey)}"]`);
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }

    await saveTitleOverride(itemKey, input.value);
  }
}

async function saveTitleOverride(itemKey, value) {
  if (typeof itemKey !== "string" || !itemKey) {
    return;
  }

  const existingTimer = titleSaveTimers.get(itemKey);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
    titleSaveTimers.delete(itemKey);
  }

  const response = await chrome.runtime.sendMessage({
    type: "SET_TITLE_OVERRIDE",
    itemKey,
    title: value,
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Could not save the custom title.");
  }
}

async function persistSelection(selectedKeys) {
  const response = await chrome.runtime.sendMessage({
    type: "SET_SELECTION",
    selectedKeys,
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || "Could not save the current selection.");
  }
}

async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (!response || !response.ok) {
      throw new Error("Could not load the current extension status.");
    }
    renderState(response.state);
  } catch (error) {
    showNotice(errorBox, error instanceof Error ? error.message : String(error));
    setControlsDisabled(false);
  }
}

function renderState(state) {
  const phase = state && state.phase ? state.phase : "idle";
  const fetchedCount = Number(state && state.fetchedCount) || 0;
  const items = Array.isArray(state && state.items) ? state.items : [];
  const selectedKeys = Array.isArray(state && state.selectedKeys) ? state.selectedKeys : [];
  const titleOverrides =
    state && state.titleOverrides && typeof state.titleOverrides === "object"
      ? state.titleOverrides
      : {};
  const settings =
    state && state.settings && typeof state.settings === "object" ? state.settings : {};
  const theme = settings && settings.theme === "light" ? "light" : "dark";
  const defaultSource = normalizeSourceValue(settings.defaultSource);
  const defaultSort = normalizeSortValue(settings.defaultSort);
  const totalVideos = phase === "fetching" ? Math.max(items.length, fetchedCount) : items.length;
  if (
    pendingDownloadStart &&
    (phase === "downloading" ||
      phase === "complete" ||
      phase === "ready" ||
      phase === "paused" ||
      Boolean(state && state.lastError))
  ) {
    pendingDownloadStart = false;
  }
  latestSummaryContext = {
    totalCount: totalVideos,
    selectedCount: selectedKeys.length,
    phase,
  };

  applyTheme(theme);
  if (phase === "fetching") {
    startFetchStatusRotation();
  } else {
    stopFetchStatusRotation();
  }

  if (
    maxVideosInput &&
    !(document.activeElement instanceof HTMLInputElement && document.activeElement === maxVideosInput)
  ) {
    maxVideosInput.value =
      typeof settings.maxVideos === "number" && Number.isFinite(settings.maxVideos)
        ? String(settings.maxVideos)
        : "";
  }

  const defaultsChanged =
    appliedSettingsDefaults.source !== defaultSource || appliedSettingsDefaults.sort !== defaultSort;

  if (
    defaultSourceInput &&
    !(document.activeElement instanceof HTMLSelectElement && document.activeElement === defaultSourceInput)
  ) {
    defaultSourceInput.value = defaultSource;
  }

  if (
    defaultSortInput &&
    !(document.activeElement instanceof HTMLSelectElement && document.activeElement === defaultSortInput)
  ) {
    defaultSortInput.value = defaultSort;
  }

  if (
    defaultThemeInput &&
    !(document.activeElement instanceof HTMLSelectElement && document.activeElement === defaultThemeInput)
  ) {
    defaultThemeInput.value = theme;
  }

  if (
    sourceSelect &&
    defaultsChanged &&
    !(document.activeElement instanceof HTMLSelectElement && document.activeElement === sourceSelect)
  ) {
    sourceSelect.value = defaultSource;
  }

  if (
    sortSelect &&
    (defaultsChanged || !sortSelect.value) &&
    !(document.activeElement instanceof HTMLSelectElement && document.activeElement === sortSelect)
  ) {
    sortSelect.value = defaultSort;
    browseState.sort = defaultSort;
  }

  appliedSettingsDefaults = {
    source: defaultSource,
    sort: defaultSort,
  };

  if (
    themeToggle &&
    !(document.activeElement instanceof HTMLInputElement && document.activeElement === themeToggle)
  ) {
    themeToggle.checked = theme === "light";
  }

  if (settingsStatus && settingsStatus.textContent === "Saving...") {
    settingsStatus.textContent = "Saved automatically.";
  }

  if (state && state.partialWarning) {
    showNotice(warningBox, state.partialWarning);
  } else {
    hideNotice(warningBox);
  }

  if (state && state.lastError) {
    showNotice(errorBox, state.lastError);
  } else {
    hideNotice(errorBox);
  }

  const isBusy = phase === "fetching" || phase === "downloading";
  const isPaused = phase === "paused";
  const isFetching = phase === "fetching";
  const hasResults = items.length > 0;
  latestBusy = isBusy;
  latestPaused = isPaused;
  latestRenderState = {
    items,
    selectedKeys,
    titleOverrides,
    disableInputs: isBusy || isPaused,
    phase,
  };

  updateDownloadOverlay(state);

  if (!isEditingTitleInput()) {
    renderCurrentItems();
  }

  updateAppScrollLock();
  updateBackToTopVisibility();

  fetchButton.disabled = isBusy;
  fetchButton.dataset.mode = hasResults && !isFetching ? "reset" : "scan";
  if (sourceSelect) {
    sourceSelect.disabled = isBusy || isPaused;
  }
  if (maxVideosInput) {
    maxVideosInput.disabled = isBusy || isPaused;
  }
  if (defaultSourceInput) {
    defaultSourceInput.disabled = isBusy || isPaused;
  }
  if (defaultSortInput) {
    defaultSortInput.disabled = isBusy || isPaused;
  }
  fetchButton.dataset.loading = String(isFetching);
  fetchButton.classList.toggle("is-danger", hasResults && !isFetching);
  fetchButtonLabel.textContent = isFetching
    ? "Fetching Videos"
    : hasResults
      ? "Start Over"
      : "Fetch Videos";
  applyCurrentSelectionUi();
  selectAllButton.disabled =
    isBusy ||
    isPaused ||
    getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true }).length === 0;
  clearSelectionButton.disabled =
    isBusy || isPaused || getSelectedKeysFromDom({ visibleOnly: true }).length === 0;
}

function renderCurrentItems() {
  renderItems(
    latestRenderState.items,
    latestRenderState.selectedKeys,
    latestRenderState.titleOverrides,
    latestRenderState.disableInputs,
    latestRenderState.phase,
  );
}

function renderItems(items, selectedKeys, titleOverrides, disableInputs, phase) {
  const sortedItems = getSortedItems(items, browseState.sort);
  // Rendering every poll tick would be noisy and can disrupt typing in title inputs.
  // This signature lets the popup skip DOM work when the visible payload is unchanged.
  const renderSignature = JSON.stringify({
    phase,
    sort: browseState.sort,
    query: normalizeSearchText(browseState.query),
    items: sortedItems.map((item) => ({
      key: getItemKey(item),
      selected: selectedKeys.includes(getItemKey(item)),
      title: resolveItemTitle(item, titleOverrides),
      disabled: disableInputs,
      thumb: item.thumbnailUrl || "",
      date: item.postedAt || item.createdAt || "",
      duration: item.durationSeconds || null,
      likes: item.likeCount ?? null,
      views: item.viewCount ?? null,
      remixes: item.remixCount ?? null,
      shares: item.shareCount ?? null,
      reposts: item.repostCount ?? null,
      fileSizeBytes: item.fileSizeBytes ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      prompt: item.prompt || "",
      removed: Boolean(item.isRemoved),
      downloaded: Boolean(item.isDownloaded),
    })),
  });

  if (renderSignature === lastRenderedSignature) {
    return;
  }

  lastRenderedSignature = renderSignature;
  itemsList.replaceChildren();

  if (!items.length) {
    itemsList.classList.add("hidden");
    if (phase === "fetching") {
      emptyState.classList.add("hidden");
    } else {
      emptyState.classList.remove("hidden");
      if (emptyStateImage instanceof HTMLElement) {
        emptyStateImage.classList.remove("hidden");
      }
      if (emptyStateText instanceof HTMLElement) {
        emptyStateText.classList.add("hidden");
        emptyStateText.textContent = "";
      }
    }
    updateSelectionSummary(0, 0, phase);
    return;
  }

  itemsList.classList.remove("hidden");
  emptyState.classList.add("hidden");

  const selectedSet = new Set(selectedKeys);
  let visibleCount = 0;
  let visibleSelectedCount = 0;

  for (const item of sortedItems) {
    const key = getItemKey(item);
    const matchesQuery = matchesSmartSearch(item, titleOverrides, browseState.query);
    const card = document.createElement("article");
    card.className = "item-card";
    card.classList.toggle("is-selected", selectedSet.has(key));
    card.classList.toggle("is-removed", Boolean(item.isRemoved));
    card.classList.toggle("is-downloaded", Boolean(item.isDownloaded));
    card.classList.toggle("hidden", !matchesQuery);
    card.dataset.itemKey = key;

    if (matchesQuery) {
      visibleCount += 1;
      if (selectedSet.has(key)) {
        visibleSelectedCount += 1;
      }
    }

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-checkbox";
    checkbox.value = key;
    checkbox.checked = selectedSet.has(key);
    checkbox.disabled = disableInputs || Boolean(item.isRemoved) || Boolean(item.isDownloaded);
    checkbox.dataset.itemKey = key;

    const media = document.createElement("div");
    media.className = "item-media";
    media.dataset.itemKey = key;
    renderMediaPreview(media, item);

    const body = document.createElement("div");
    body.className = "item-body";

    const titleRow = document.createElement("div");
    titleRow.className = "item-title-row";

    const titleEditor = document.createElement("div");
    titleEditor.className = "item-title-editor";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "item-title-input";
    titleInput.value = resolveItemTitle(item, titleOverrides);
    titleInput.dataset.itemKey = key;
    titleInput.disabled = disableInputs;
    titleInput.spellcheck = false;
    titleInput.title = "Click to rename this video";

    const editIcon = document.createElement("span");
    editIcon.className = "item-title-icon";
    editIcon.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M11.9 1.6a1.6 1.6 0 0 1 2.3 2.3l-8 8-3.2.9.9-3.2 8-8Zm-7.1 9.3 1.1 1.1 6.9-6.9-1.1-1.1-6.9 6.9Zm-0.5 0.6-0.4 1.3 1.3-0.4-0.9-0.9Z" fill="currentColor"/></svg>';

    titleEditor.append(titleInput, editIcon);
    titleRow.append(titleEditor);

    const metaRow = document.createElement("div");
    metaRow.className = "item-meta-row";

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = formatCreatedAt(item.postedAt || item.createdAt) || "No timestamp";

    const aspectBadge = createAspectBadge(item);
    if (aspectBadge) {
      metaRow.append(aspectBadge);
    }
    metaRow.append(meta);

    const prompt = document.createElement("p");
    prompt.className = "item-prompt";
    prompt.textContent = truncatePrompt(item.prompt);

    const detailsRow = document.createElement("div");
    detailsRow.className = "item-details-row";

    const detailPills = [];
    const repostPill = createCountPill("Reposts", item.repostCount);
    if (repostPill) {
      detailPills.push(repostPill);
    }

    if (detailPills.length) {
      detailsRow.append(...detailPills);
    }

    const footer = document.createElement("div");
    footer.className = "item-footer";

    const fileSize = document.createElement("span");
    fileSize.className = "item-file-size";
    fileSize.textContent = formatFileSize(item.fileSizeBytes) || "";
    fileSize.classList.toggle("hidden", !fileSize.textContent);
    footer.append(fileSize);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "item-remove-button";
    removeButton.classList.toggle("is-restore", Boolean(item.isRemoved));
    removeButton.classList.toggle("is-redownload", Boolean(item.isDownloaded));
    removeButton.dataset.itemKey = key;
    removeButton.disabled = disableInputs;
    removeButton.textContent = item.isDownloaded
      ? "Download Again"
      : item.isRemoved
        ? "Restore"
        : "Remove from set";
    footer.append(removeButton);

    const bodyChildren = [titleRow, metaRow, prompt];
    if (detailsRow.childElementCount > 0) {
      bodyChildren.push(detailsRow);
    }
    bodyChildren.push(footer);

    body.append(...bodyChildren);
    card.append(checkbox, media, body);
    itemsList.append(card);
  }

  if (visibleCount === 0) {
    itemsList.classList.add("hidden");
    emptyState.classList.remove("hidden");
    if (emptyStateImage instanceof HTMLElement) {
      emptyStateImage.classList.add("hidden");
    }
    if (emptyStateText instanceof HTMLElement) {
      emptyStateText.classList.remove("hidden");
      emptyStateText.textContent = browseState.query.trim()
        ? `No videos match “${browseState.query.trim()}”.`
        : "No videos loaded.";
    }
  } else {
    itemsList.classList.remove("hidden");
    emptyState.classList.add("hidden");
    if (emptyStateImage instanceof HTMLElement) {
      emptyStateImage.classList.remove("hidden");
    }
    if (emptyStateText instanceof HTMLElement) {
      emptyStateText.classList.add("hidden");
      emptyStateText.textContent = "";
    }
  }

  applySelectionUi(
    items.length,
    selectedKeys.length,
    visibleCount,
    visibleSelectedCount,
    phase,
  );
}

function renderMediaPreview(media, item) {
  if (!media || !(media instanceof HTMLElement) || !item) {
    return;
  }

  media.onclick = null;
  media.onkeydown = null;
  media.classList.toggle("is-playable", Boolean(item.downloadUrl));
  media.classList.remove("is-inline-video");
  media.removeAttribute("role");
  media.removeAttribute("tabindex");
  media.removeAttribute("aria-label");
  media.replaceChildren();

  const fallback = createThumbnailFallback(item);
  media.append(fallback);

  if (item.thumbnailUrl) {
    const image = document.createElement("img");
    image.className = "item-thumbnail";
    image.src = item.thumbnailUrl;
    image.alt = `${item.id} thumbnail`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";

    image.addEventListener(
      "error",
      () => {
        image.remove();
      },
      { once: true },
    );

    media.append(image);
  }

  const overlay = document.createElement("div");
  overlay.className = "item-media-overlay";

  const topRow = document.createElement("div");
  topRow.className = "item-media-top";

  if (item.durationSeconds) {
    const duration = document.createElement("span");
    duration.className = "item-duration";
    duration.textContent = formatDuration(item.durationSeconds);
    topRow.append(duration);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "item-media-spacer";
    topRow.append(spacer);
  }

  overlay.append(topRow);

  const bottomRow = document.createElement("div");
  bottomRow.className = "item-media-bottom";

  const engagement = document.createElement("div");
  engagement.className = "item-engagement";

  const likeBadge = createOverlayStat("heart", item.likeCount);
  if (likeBadge) {
    engagement.append(likeBadge);
  }

  const viewBadge = createOverlayStat("view", item.viewCount);
  if (viewBadge) {
    engagement.append(viewBadge);
  }

  const remixBadge = createOverlayStat("remix", item.remixCount);
  if (remixBadge) {
    engagement.append(remixBadge);
  }

  if (engagement.childElementCount > 0) {
    bottomRow.append(engagement);
  }

  overlay.append(bottomRow);

  if (item.downloadUrl) {
    const playLabel = `Preview ${resolveItemTitle(item, {})}`;
    media.setAttribute("role", "button");
    media.setAttribute("tabindex", "0");
    media.setAttribute("aria-label", playLabel);
    media.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item);
    };
    media.onkeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item);
    };

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "item-play-button";
    playButton.setAttribute("aria-label", playLabel);
    playButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor"/></svg>';
    playButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      activateInlineVideo(media, item);
    });
    overlay.append(playButton);
  }

  media.append(overlay);
}

function activateInlineVideo(media, item) {
  if (!media || !(media instanceof HTMLElement) || !item || !item.downloadUrl) {
    return;
  }

  media.onclick = null;
  media.onkeydown = null;
  media.classList.remove("is-playable");
  media.classList.add("is-inline-video");
  media.removeAttribute("role");
  media.removeAttribute("tabindex");
  media.removeAttribute("aria-label");
  media.replaceChildren();

  const video = document.createElement("video");
  video.className = "item-video";
  video.src = item.downloadUrl;
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.muted = true;
  media.append(video);

  const replayButton = document.createElement("button");
  replayButton.type = "button";
  replayButton.className = "item-replay-button";
  replayButton.textContent = "Back to thumbnail";
  replayButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    renderMediaPreview(media, item);
  });
  media.append(replayButton);

  void video.play().catch(() => {});
}

function createThumbnailFallback(item) {
  const fallback = document.createElement("div");
  fallback.className = "item-thumbnail-fallback";
  fallback.textContent = item.sourcePage === "drafts" ? "Draft" : "Published";
  return fallback;
}

function getMetadataEntries(item) {
  return Array.isArray(item && item.metadataEntries) ? item.metadataEntries : [];
}

function createOverlayStat(kind, value) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) {
    return null;
  }

  const numeric = Number(value);
  if (kind === "remix" && numeric <= 0) {
    return null;
  }

  const stat = document.createElement("span");
  stat.className = "item-engagement-pill";

  const icon = document.createElement("span");
  icon.className = "item-engagement-icon";
  icon.innerHTML = getOverlayIconSvg(kind);

  const text = document.createElement("span");
  text.className = "item-engagement-text";
  text.textContent = formatCompactCount(numeric);

  stat.append(icon, text);
  return stat;
}

function getOverlayIconSvg(kind) {
  if (kind === "heart") {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 13.2 2.6 8A3.4 3.4 0 0 1 7.4 3.2L8 3.8l.6-.6A3.4 3.4 0 1 1 13.4 8L8 13.2Z" fill="currentColor"/></svg>';
  }

  if (kind === "remix") {
    return '<svg viewBox="0 0 19 18" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="6.75" stroke="currentColor" stroke-width="2" fill="none"></circle><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M11.25 9a4.5 4.5 0 0 0-9 0M15.75 9a4.5 4.5 0 1 1-9 0"></path></svg>';
  }

  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 3c3.8 0 6.8 3.6 7.4 4.4a1 1 0 0 1 0 1.2C14.8 9.4 11.8 13 8 13S1.2 9.4.6 8.6a1 1 0 0 1 0-1.2C1.2 6.6 4.2 3 8 3Zm0 2.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2Zm0 1.4A1.4 1.4 0 1 1 8 9.4 1.4 1.4 0 0 1 8 6.6Z" fill="currentColor"/></svg>';
}

function createCountPill(label, value) {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const pill = document.createElement("span");
  pill.className = "item-count-pill";
  pill.textContent = `${label} ${formatCompactCount(numeric)}`;
  return pill;
}

function createStatusPill(label, tone = "default") {
  const pill = document.createElement("span");
  pill.className = "item-count-pill item-status-pill";
  if (tone === "downloaded") {
    pill.classList.add("is-success");
  }
  pill.textContent = label;
  return pill;
}

function createAspectBadge(item) {
  const aspectLabel = getAspectRatioLabel(item);
  if (!aspectLabel) {
    return null;
  }

  const badge = document.createElement("span");
  badge.className = "item-aspect-badge";
  badge.textContent = aspectLabel;
  return badge;
}

function getAspectRatioLabel(item) {
  const width = Number(item && item.width);
  const height = Number(item && item.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.04) {
    return "Square";
  }

  return ratio > 1 ? "Landscape" : "Portrait";
}

function isEditingTitleInput() {
  return (
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.classList.contains("item-title-input")
  );
}

function updateSelectionSummary({
  totalCount,
  selectedCount,
  visibleCount = totalCount,
  visibleSelectedCount = selectedCount,
  phase,
  query = "",
}) {
  const downloadedCount = getDownloadedCount(latestRenderState.items);
  latestSummaryContext = {
    totalCount,
    selectedCount,
    visibleCount,
    visibleSelectedCount,
    phase,
  };

  if (phase === "fetching") {
    const flavor = activeFetchStatusMessage || "Finding videos...";
    selectionSummary.textContent =
      totalCount > 0 ? `${flavor} ${totalCount} found so far.` : flavor;
    return;
  }

  if (totalCount === 0) {
    selectionSummary.textContent =
      phase === "fetching" ? "Finding videos..." : "No videos loaded.";
    return;
  }

  if (query.trim()) {
    selectionSummary.textContent =
      visibleCount > 0
        ? `${visibleCount} matches • ${visibleSelectedCount} selected in view • ${selectedCount} selected overall${downloadedCount > 0 ? ` • ${downloadedCount} downloaded` : ""}`
        : `No matches for “${query.trim()}”`;
    return;
  }

  selectionSummary.textContent = `${selectedCount} of ${totalCount} selected${downloadedCount > 0 ? ` • ${downloadedCount} downloaded` : ""}`;
}

function syncSelectionControls(totalCount, selectedCount, visibleCount = totalCount) {
  const phase = latestRenderState.phase || "idle";
  const hasLoadedResults = latestRenderState.items.length > 0;
  const isFetching = phase === "fetching";
  const showDownloadButton =
    hasLoadedResults && selectedCount > 0 && !latestBusy && !latestPaused && !isFetching;
  const showBatchActions = hasLoadedResults && visibleCount > 0 && !isFetching;
  const showBrowseTools = hasLoadedResults;
  const showSummaryPanel = visibleCount > 0 || isFetching;

  downloadButton.classList.toggle("hidden", !showDownloadButton);
  downloadButton.disabled = !showDownloadButton;
  selectAllButton.classList.toggle("hidden", !showBatchActions);
  clearSelectionButton.classList.toggle("hidden", !showBatchActions);
  if (summaryPanel instanceof HTMLElement) {
    summaryPanel.classList.toggle("hidden", !showSummaryPanel);
  }
  if (pickerToolbar instanceof HTMLElement) {
    pickerToolbar.classList.toggle("hidden", !showBrowseTools);
  }
  if (sourceSelectField instanceof HTMLElement) {
    sourceSelectField.classList.toggle("hidden", showBrowseTools);
  }
  if (controlsPanel instanceof HTMLElement) {
    controlsPanel.dataset.hasResults = showBrowseTools ? "true" : "false";
  }
}

async function saveSettingsFromForm() {
  if (
    !maxVideosInput ||
    !settingsStatus ||
    !defaultSourceInput ||
    !defaultSortInput ||
    !defaultThemeInput
  ) {
    return;
  }

  const rawValue = maxVideosInput.value.trim();
  const normalizedValue = rawValue ? Number(rawValue) : null;
  const maxVideos =
    Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.floor(normalizedValue) : null;
  const defaultSource = normalizeSourceValue(defaultSourceInput.value);
  const defaultSort = normalizeSortValue(defaultSortInput.value);
  const theme = defaultThemeInput.value === "light" ? "light" : "dark";

  const response = await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    settings: {
      maxVideos,
      defaultSource,
      defaultSort,
      theme,
    },
  });

  if (!response || !response.ok) {
    settingsStatus.textContent = "Could not save.";
    throw new Error((response && response.error) || "Could not save the settings.");
  }

  appliedSettingsDefaults = {
    source: defaultSource,
    sort: defaultSort,
  };

  if (sourceSelect) {
    sourceSelect.value = defaultSource;
  }

  if (sortSelect) {
    sortSelect.value = defaultSort;
    browseState.sort = defaultSort;
    renderCurrentItems();
    applyCurrentSelectionUi();
  }

  if (themeToggle) {
    themeToggle.checked = theme === "light";
  }
  applyTheme(theme);

  settingsStatus.textContent = "Saved automatically.";
}

function formatCreatedAt(value) {
  if (value == null || value === "") {
    return "";
  }

  let date;
  if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCompactCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (numeric < 1000) {
    return String(Math.max(0, Math.round(numeric)));
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function formatFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
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

function isActiveBatchItem(item) {
  return Boolean(item) && !item.isRemoved && !item.isDownloaded;
}

function getActiveSelectableCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => isActiveBatchItem(item)).length;
}

function getDownloadedCount(items) {
  return (Array.isArray(items) ? items : []).filter((item) => Boolean(item && item.isDownloaded))
    .length;
}

function getSelectedBatchMetrics(items, selectedKeys) {
  const selectedKeySet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  let selectedCount = 0;
  let totalBytes = 0;
  let hasKnownSize = false;

  for (const item of Array.isArray(items) ? items : []) {
    if (!isActiveBatchItem(item)) {
      continue;
    }

    const itemKey = getItemKey(item);
    if (!selectedKeySet.has(itemKey)) {
      continue;
    }

    selectedCount += 1;
    const fileSizeBytes = Number(item && item.fileSizeBytes);
    if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
      totalBytes += fileSizeBytes;
      hasKnownSize = true;
    }
  }

  return {
    selectedCount,
    totalBytes: hasKnownSize ? totalBytes : null,
  };
}

function updateTotalSummary(items, selectedKeys) {
  if (!(totalCount instanceof HTMLElement)) {
    return;
  }

  const { selectedCount, totalBytes } = getSelectedBatchMetrics(items, selectedKeys);
  const formattedSize = formatFileSize(totalBytes);
  totalCount.textContent = formattedSize ? `${selectedCount} / ${formattedSize}` : String(selectedCount);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
}

function updateBackToTopVisibility() {
  if (!(backToTopButton instanceof HTMLButtonElement) || !(appShell instanceof HTMLElement)) {
    return;
  }

  const shouldShow = activeTab === "overview" && appShell.scrollTop > 240;
  backToTopButton.classList.toggle("hidden", !shouldShow);
}

function updateDownloadOverlay(state) {
  if (
    !(downloadOverlay instanceof HTMLElement) ||
    !(downloadOverlayTitle instanceof HTMLElement) ||
    !(downloadOverlayStatus instanceof HTMLElement) ||
    !(downloadOverlayCount instanceof HTMLElement) ||
    !(downloadOverlayPercent instanceof HTMLElement) ||
    !(downloadOverlayFill instanceof HTMLElement) ||
    !(downloadOverlayThanks instanceof HTMLElement) ||
    !(downloadOverlayCancel instanceof HTMLButtonElement)
  ) {
    return;
  }

  const phase = state && state.phase ? state.phase : "idle";
  const runTotal = Math.max(0, Number(state && state.runTotal) || 0);
  const completed = Math.max(0, Number(state && state.completed) || 0);
  const failed = Math.max(0, Number(state && state.failed) || 0);
  const processed = Math.min(runTotal || completed + failed, completed + failed);
  const percent = runTotal > 0 ? Math.max(0, Math.min(100, Math.round((processed / runTotal) * 100))) : 0;
  const hasSettledDownloadState =
    downloadOverlaySessionActive &&
    (phase === "complete" || phase === "ready" || phase === "paused" || phase === "error");
  // Keep the overlay around for the terminal state so the user sees a clear outcome before
  // jumping back to the library view.
  const isVisible = phase === "downloading" || pendingDownloadStart || hasSettledDownloadState;

  downloadOverlay.classList.toggle("hidden", !isVisible);
  downloadOverlay.setAttribute("aria-hidden", String(!isVisible));

  if (!isVisible) {
    downloadOverlayThanks.classList.add("hidden");
    downloadOverlayCancel.dataset.action = "cancel";
    downloadOverlayCancel.textContent = "Cancel";
    downloadOverlayCancel.classList.remove("is-return");
    downloadOverlayCancel.disabled = false;
    downloadOverlayFill.style.width = "0%";
    return;
  }

  if (pendingDownloadStart && phase !== "downloading") {
    downloadOverlayThanks.classList.add("hidden");
    downloadOverlayTitle.textContent = "Preparing downloads...";
    downloadOverlayStatus.textContent =
      (state && state.message) || "Saving your latest changes and building the queue.";
    downloadOverlayCount.textContent = runTotal > 0 ? `0 / ${runTotal}` : "Preparing";
    downloadOverlayPercent.textContent = "0%";
    downloadOverlayFill.style.width = "0%";
    downloadOverlayCancel.dataset.action = "cancel";
    downloadOverlayCancel.textContent = "Cancel";
    downloadOverlayCancel.classList.remove("is-return");
    downloadOverlayCancel.disabled = false;
    return;
  }

  if (phase === "downloading") {
    downloadOverlayThanks.classList.add("hidden");
    downloadOverlayTitle.textContent = "Downloading videos";
    downloadOverlayStatus.textContent =
      (state && state.message) || "Working through your selected videos...";
    downloadOverlayCount.textContent = `${processed} / ${runTotal || processed}`;
    downloadOverlayPercent.textContent = `${percent}%`;
    downloadOverlayFill.style.width = `${percent}%`;
    downloadOverlayCancel.dataset.action = "cancel";
    downloadOverlayCancel.textContent = "Cancel";
    downloadOverlayCancel.classList.remove("is-return");
    downloadOverlayCancel.disabled = false;
    return;
  }

  const settledPercent = phase === "complete" || phase === "ready" ? 100 : percent;
  const settledProcessed = runTotal || processed;
  downloadOverlayThanks.classList.toggle(
    "hidden",
    !(phase === "complete" || phase === "ready"),
  );
  downloadOverlayTitle.textContent = phase === "paused" ? "Downloads paused" : "Downloads finished";
  downloadOverlayStatus.textContent =
    (state && state.message) || "Your library has been updated.";
  downloadOverlayCount.textContent = `${settledProcessed} / ${runTotal || settledProcessed}`;
  downloadOverlayPercent.textContent = `${settledPercent}%`;
  downloadOverlayFill.style.width = `${settledPercent}%`;
  downloadOverlayCancel.dataset.action = "return";
  downloadOverlayCancel.textContent = "Return to library";
  downloadOverlayCancel.classList.add("is-return");
  downloadOverlayCancel.disabled = false;
}

function truncatePrompt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "No prompt text available.";
  }

  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesSmartSearch(item, titleOverrides, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const haystack = normalizeSearchText(getItemSearchText(item, titleOverrides));
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

function getItemSearchText(item, titleOverrides) {
  return [
    resolveItemTitle(item, titleOverrides),
    item && item.id,
    item && item.prompt,
    item && item.description,
    item && item.caption,
    item && item.discoveryPhrase,
  ]
    .filter(Boolean)
    .join(" ");
}

function getSearchTokens(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean);
}

function getComparableTimestamp(value) {
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


function getSortedItems(items, sortKey) {
  const nextItems = [...items];
  nextItems.sort((left, right) => compareItems(left, right, sortKey));
  return nextItems;
}

function compareItems(left, right, sortKey) {
  const leftRemoved = Boolean(left && left.isRemoved);
  const rightRemoved = Boolean(right && right.isRemoved);
  if (leftRemoved !== rightRemoved) {
    return leftRemoved ? 1 : -1;
  }

  const leftDownloaded = Boolean(left && left.isDownloaded);
  const rightDownloaded = Boolean(right && right.isDownloaded);
  if (leftDownloaded !== rightDownloaded) {
    return leftDownloaded ? 1 : -1;
  }

  const primaryLeft = getItemSortValue(left, sortKey);
  const primaryRight = getItemSortValue(right, sortKey);
  if (primaryLeft !== primaryRight) {
    return primaryRight - primaryLeft;
  }

  const fallbackLeft = getItemSortValue(left, "newest");
  const fallbackRight = getItemSortValue(right, "newest");
  if (fallbackLeft !== fallbackRight) {
    return fallbackRight - fallbackLeft;
  }

  return String(left && left.id || "").localeCompare(String(right && right.id || ""));
}

function getItemSortValue(item, sortKey) {
  if (sortKey === "likes") {
    return Number(item && item.likeCount) || 0;
  }

  if (sortKey === "views") {
    return Number(item && item.viewCount) || 0;
  }

  if (sortKey === "remixes") {
    return Number(item && item.remixCount) || 0;
  }

  return getComparableTimestamp(item && (item.createdAt || item.postedAt));
}

function setControlsDisabled(disabled) {
  fetchButton.disabled = disabled;
  downloadButton.disabled = disabled;
  selectAllButton.disabled = disabled;
  clearSelectionButton.disabled = disabled;
  if (sourceSelect) {
    sourceSelect.disabled = disabled;
  }
  if (maxVideosInput) {
    maxVideosInput.disabled = disabled;
  }
  if (defaultSourceInput) {
    defaultSourceInput.disabled = disabled;
  }
  if (defaultSortInput) {
    defaultSortInput.disabled = disabled;
  }
  if (defaultThemeInput) {
    defaultThemeInput.disabled = disabled;
  }
}

function normalizeSourceValue(value) {
  return value === "profile" || value === "drafts" ? value : "both";
}

function normalizeSortValue(value) {
  return value === "likes" || value === "views" || value === "remixes" ? value : "newest";
}

function showNotice(element, text) {
  element.textContent = text;
  element.classList.remove("hidden");
}

function hideNotice(element) {
  element.textContent = "";
  element.classList.add("hidden");
}

function startFetchStatusRotation() {
  if (!activeFetchStatusMessage) {
    activeFetchStatusMessage = getRandomFetchStatusMessage();
    applyFetchStatusMessage();
  }

  if (fetchStatusTimer !== null) {
    return;
  }

  fetchStatusTimer = window.setInterval(() => {
    activeFetchStatusMessage = getRandomFetchStatusMessage(activeFetchStatusMessage);
    applyFetchStatusMessage();
  }, 5000);
}

function stopFetchStatusRotation() {
  if (fetchStatusTimer !== null) {
    window.clearInterval(fetchStatusTimer);
    fetchStatusTimer = null;
  }

  activeFetchStatusMessage = "";
}

function applyFetchStatusMessage() {
  if (latestSummaryContext.phase !== "fetching") {
    return;
  }

  const flavor = activeFetchStatusMessage || "Finding videos...";
  selectionSummary.textContent =
    latestSummaryContext.totalCount > 0
      ? `${flavor} ${latestSummaryContext.totalCount} found so far.`
      : flavor;
}

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
