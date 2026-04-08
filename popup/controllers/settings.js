import { SETTINGS_SAVE_DEBOUNCE_MS } from "../config.js";
import { dom } from "../dom.js";
import {
  openRuntimeShell,
  requestClearLocalStorage,
  requestClearVolatileBackups,
  saveRuntimeSettings,
} from "../runtime.js";
import { popupState } from "../state.js";
import {
  formatSourceSelectionLabel,
  getSelectedSourceValues,
  normalizeResultsViewMode,
  normalizeSortValue,
  serializeSourceValues,
} from "../utils/settings.js";
import { applyTheme, showNotice, updateBackToTopVisibility } from "../ui/layout.js";
import { renderCurrentItems } from "../ui/render.js";
import { refreshStatus } from "./polling.js";

/**
 * Applies local search filtering as the user types.
 */
export function handleSearchInput() {
  popupState.browseState.query = dom.searchInput?.value || "";
  rerenderBrowseResults();
}

/**
 * Applies local sorting when the sort dropdown changes.
 */
export function handleSortChange() {
  popupState.browseState.sort = dom.sortSelect?.value || "newest";
  rerenderBrowseResults();
}

/**
 * Switches the current results presentation between list and grid modes.
 *
 * @param {MouseEvent} event
 */
export async function handleResultsViewToggleClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest("[data-results-view]")
    : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const nextViewMode = normalizeResultsViewMode(button.dataset.resultsView);
  if (nextViewMode === popupState.browseState.viewMode) {
    return;
  }

  popupState.browseState.viewMode = nextViewMode;
  if (dom.defaultResultsLayoutInput instanceof HTMLSelectElement) {
    dom.defaultResultsLayoutInput.value = nextViewMode;
  }
  renderCurrentItems();

  if (dom.settingsStatus instanceof HTMLElement) {
    dom.settingsStatus.textContent = "Saving...";
  }

  try {
    await saveRuntimeSettings({ resultsViewMode: nextViewMode });
    if (dom.settingsStatus instanceof HTMLElement) {
      dom.settingsStatus.textContent = "Saved automatically.";
    }
  } catch (error) {
    if (dom.settingsStatus instanceof HTMLElement) {
      dom.settingsStatus.textContent = "Could not save.";
    }
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Switches the visible creator-only results tab.
 *
 * @param {MouseEvent} event
 */
export function handleCreatorResultsTabClick(event) {
  const button = event.target instanceof Element
    ? event.target.closest("[data-creator-results-tab]")
    : null;
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }

  const nextTab = button.dataset.creatorResultsTab || "all";
  if (nextTab === popupState.activeCreatorResultsTab) {
    return;
  }

  popupState.activeCreatorResultsTab = nextTab;
  rerenderBrowseResults();
}

export function handlePickerScroll() {
  updateBackToTopVisibility();
}

/**
 * Saves the theme toggle immediately.
 */
export async function handleThemeToggleChange() {
  if (!(dom.themeToggle instanceof HTMLInputElement)) {
    return;
  }

  const nextTheme = dom.themeToggle.checked ? "light" : "dark";
  applyTheme(nextTheme);

  try {
    await saveRuntimeSettings({ theme: nextTheme });
    if (dom.defaultThemeInput) {
      dom.defaultThemeInput.value = nextTheme;
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    await refreshStatus();
  }
}

export async function handleViewFullscreenClick() {
  const nextViewMode = popupState.isFullscreenView ? "windowed" : "fullscreen";

  try {
    await saveRuntimeSettings({
      preferredViewMode: nextViewMode,
      hasExplicitPreferredViewModeChoice: true,
    });
    await openRuntimeShell({
      viewMode: nextViewMode,
      tab: popupState.activeTab,
    });

    window.setTimeout(() => {
      try {
        window.close();
      } catch (_error) {
        // The alternate shell has already opened, so a close failure is harmless.
      }
    }, 40);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Debounces the numeric max-videos setting while the user types.
 */
export function handleMaxVideosInput() {
  if (dom.settingsStatus) {
    dom.settingsStatus.textContent = "Saving...";
  }

  if (popupState.settingsSaveTimer) {
    window.clearTimeout(popupState.settingsSaveTimer);
  }

  popupState.settingsSaveTimer = window.setTimeout(() => {
    void saveSettingsFromForm().catch((error) => {
      showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    });
  }, SETTINGS_SAVE_DEBOUNCE_MS);
}

/**
 * Saves settings immediately when a settings input blurs.
 */
export function handleSettingsBlur() {
  void saveSettingsFromForm().catch((error) => {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  });
}

/**
 * Saves settings immediately when a settings select changes.
 */
export function handleSettingsChange() {
  if (dom.settingsStatus) {
    dom.settingsStatus.textContent = "Saving...";
  }

  void saveSettingsFromForm().catch((error) => {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  });
}

/**
 * Clears the extension's saved local storage after user confirmation.
 *
 * @returns {Promise<void>}
 */
export async function handleClearStorageClick() {
  if (!(dom.settingsStatus instanceof HTMLElement)) {
    return;
  }

  const confirmed = window.confirm(
    "Clear all saved Save Sora local data? This removes saved settings, renamed titles, selection state, and the current working set. Your updater folder link and resumable updater data will stay intact.",
  );
  if (!confirmed) {
    return;
  }

  dom.settingsStatus.textContent = "Clearing local storage...";

  try {
    await requestClearLocalStorage();
    dom.settingsStatus.textContent = "Local storage cleared.";
    await refreshStatus();
  } catch (error) {
    dom.settingsStatus.textContent = "Could not clear local storage.";
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Clears resumable creator/fetch backup data stored in IndexedDB.
 *
 * @returns {Promise<void>}
 */
export async function handleClearVolatileBackupsClick() {
  if (!(dom.settingsStatus instanceof HTMLElement)) {
    return;
  }

  const confirmed = window.confirm(
    "Clear resumable fetch backup data? This removes saved crawl checkpoints and preview backups for large fetches, but keeps your updater folder link, updater history, and normal settings.",
  );
  if (!confirmed) {
    return;
  }

  dom.settingsStatus.textContent = "Clearing resumable fetch backups...";

  try {
    await requestClearVolatileBackups();
    dom.settingsStatus.textContent = "Resumable fetch backups cleared.";
    await refreshStatus();
  } catch (error) {
    dom.settingsStatus.textContent = "Could not clear resumable fetch backups.";
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Re-renders the list after a local browse-state change without asking the
 * background worker for a fresh snapshot.
 */
function rerenderBrowseResults() {
  if (dom.pickerScrollRegion instanceof HTMLElement) {
    dom.pickerScrollRegion.scrollTop = 0;
  }

  renderCurrentItems();
  updateBackToTopVisibility();
}

/**
 * Persists the settings form to the background worker.
 *
 * @returns {Promise<void>}
 */
async function saveSettingsFromForm() {
  if (
    !(dom.maxVideosInput instanceof HTMLInputElement) ||
    !(dom.defaultSortInput instanceof HTMLSelectElement) ||
    !(dom.defaultResultsLayoutInput instanceof HTMLSelectElement) ||
    !(dom.defaultThemeInput instanceof HTMLSelectElement) ||
    !(dom.defaultShellInput instanceof HTMLSelectElement) ||
    !(dom.downloadModeInput instanceof HTMLSelectElement) ||
    !(dom.automaticUpdatesInput instanceof HTMLInputElement) ||
    !(dom.defaultSourceLabel instanceof HTMLElement) ||
    !(dom.settingsStatus instanceof HTMLElement)
  ) {
    return;
  }

  const rawValue = dom.maxVideosInput.value.trim();
  const normalizedValue = rawValue ? Number(rawValue) : null;
  const maxVideos =
    Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.floor(normalizedValue) : null;
  const defaultSource = getSelectedSourceValues(dom.defaultSourceInputs);
  const defaultSort = normalizeSortValue(dom.defaultSortInput.value);
  const resultsViewMode = normalizeResultsViewMode(dom.defaultResultsLayoutInput.value);
  const theme = dom.defaultThemeInput.value === "light" ? "light" : "dark";
  const preferredViewMode =
    dom.defaultShellInput.value === "windowed" ? "windowed" : "fullscreen";
  const downloadMode = dom.downloadModeInput.value === "direct" ? "direct" : "archive";
  const automaticUpdatesEnabled = dom.automaticUpdatesInput.checked;

  try {
    await saveRuntimeSettings({
      maxVideos,
      defaultSource,
      defaultSort,
      resultsViewMode,
      theme,
      preferredViewMode,
      hasExplicitPreferredViewModeChoice: true,
      downloadMode,
      hasExplicitDownloadModeChoice: true,
      automaticUpdatesEnabled,
    });
  } catch (error) {
    dom.settingsStatus.textContent = "Could not save.";
    throw error;
  }

  popupState.appliedSettingsDefaults = {
    source: serializeSourceValues(defaultSource),
    sort: defaultSort,
    viewMode: resultsViewMode,
  };

  if (dom.defaultSourceLabel instanceof HTMLElement) {
    dom.defaultSourceLabel.textContent = formatSourceSelectionLabel(defaultSource);
  }

  if (dom.sortSelect) {
    dom.sortSelect.value = defaultSort;
    popupState.browseState.sort = defaultSort;
  }

  popupState.browseState.viewMode = resultsViewMode;
  rerenderBrowseResults();

  if (dom.themeToggle) {
    dom.themeToggle.checked = theme === "light";
  }

  applyTheme(theme);
  dom.settingsStatus.textContent = "Saved automatically.";
}
