import { dom } from "../../dom.js";
import { popupState } from "../../state.js";

/**
 * Synchronizes the settings UI without overwriting a currently focused input.
 *
 * @param {object} settings
 * @param {{theme: string, defaultSource: string, defaultSort: string}} defaults
 */
export function syncSettingsInputs(settings, { theme, defaultSource, defaultSort }) {
  if (dom.maxVideosInput && !isFocusedElement(dom.maxVideosInput)) {
    dom.maxVideosInput.value =
      typeof settings.maxVideos === "number" && Number.isFinite(settings.maxVideos)
        ? String(settings.maxVideos)
        : "";
  }

  const defaultsChanged =
    popupState.appliedSettingsDefaults.source !== defaultSource ||
    popupState.appliedSettingsDefaults.sort !== defaultSort;

  if (dom.defaultSourceInput && !isFocusedElement(dom.defaultSourceInput)) {
    dom.defaultSourceInput.value = defaultSource;
  }

  if (dom.defaultSortInput && !isFocusedElement(dom.defaultSortInput)) {
    dom.defaultSortInput.value = defaultSort;
  }

  if (dom.defaultThemeInput && !isFocusedElement(dom.defaultThemeInput)) {
    dom.defaultThemeInput.value = theme;
  }

  if (dom.sourceSelect && defaultsChanged && !isFocusedElement(dom.sourceSelect)) {
    dom.sourceSelect.value = defaultSource;
  }

  if (dom.sortSelect && (defaultsChanged || !dom.sortSelect.value) && !isFocusedElement(dom.sortSelect)) {
    dom.sortSelect.value = defaultSort;
    popupState.browseState.sort = defaultSort;
  }

  popupState.appliedSettingsDefaults = {
    source: defaultSource,
    sort: defaultSort,
  };

  if (dom.themeToggle && !isFocusedElement(dom.themeToggle)) {
    dom.themeToggle.checked = theme === "light";
  }
}

/**
 * Returns whether the given element is the active focused element.
 *
 * @param {Element|null|undefined} element
 * @returns {boolean}
 */
function isFocusedElement(element) {
  return element instanceof Element && document.activeElement === element;
}
