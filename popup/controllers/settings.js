import { SETTINGS_SAVE_DEBOUNCE_MS } from "../config.js";
import { dom } from "../dom.js";
import { saveRuntimeSettings } from "../runtime.js";
import { popupState } from "../state.js";
import { normalizeSortValue, normalizeSourceValue } from "../utils/settings.js";
import { applyTheme, showNotice, updateBackToTopVisibility } from "../ui/layout.js";
import { renderCurrentItems } from "../ui/render.js";
import { applyCurrentSelectionUi } from "../ui/selection.js";
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
 * Re-renders the list after a local browse-state change.
 */
function rerenderBrowseResults() {
  renderCurrentItems();
  applyCurrentSelectionUi();
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
    !(dom.defaultSourceInput instanceof HTMLSelectElement) ||
    !(dom.defaultSortInput instanceof HTMLSelectElement) ||
    !(dom.defaultThemeInput instanceof HTMLSelectElement) ||
    !(dom.settingsStatus instanceof HTMLElement)
  ) {
    return;
  }

  const rawValue = dom.maxVideosInput.value.trim();
  const normalizedValue = rawValue ? Number(rawValue) : null;
  const maxVideos =
    Number.isFinite(normalizedValue) && normalizedValue > 0 ? Math.floor(normalizedValue) : null;
  const defaultSource = normalizeSourceValue(dom.defaultSourceInput.value);
  const defaultSort = normalizeSortValue(dom.defaultSortInput.value);
  const theme = dom.defaultThemeInput.value === "light" ? "light" : "dark";

  try {
    await saveRuntimeSettings({
      maxVideos,
      defaultSource,
      defaultSort,
      theme,
    });
  } catch (error) {
    dom.settingsStatus.textContent = "Could not save.";
    throw error;
  }

  popupState.appliedSettingsDefaults = {
    source: defaultSource,
    sort: defaultSort,
  };

  if (dom.sourceSelect) {
    dom.sourceSelect.value = defaultSource;
  }

  if (dom.sortSelect) {
    dom.sortSelect.value = defaultSort;
    popupState.browseState.sort = defaultSort;
    rerenderBrowseResults();
  }

  if (dom.themeToggle) {
    dom.themeToggle.checked = theme === "light";
  }

  applyTheme(theme);
  dom.settingsStatus.textContent = "Saved automatically.";
}
