import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import {
  formatSourceSelectionLabel,
  getSelectedSourceValues,
  serializeSourceValues,
  setSelectedSourceValues,
} from "../../utils/settings.js";

/**
 * Synchronizes the settings UI without overwriting a currently focused input.
 *
 * @param {object} settings
 * @param {{theme: string, defaultSource: string[], defaultSort: string, automaticUpdatesEnabled: boolean}} defaults
 */
export function syncSettingsInputs(settings, { theme, defaultSource, defaultSort, automaticUpdatesEnabled }) {
  if (dom.maxVideosInput && !isFocusedElement(dom.maxVideosInput)) {
    dom.maxVideosInput.value =
      typeof settings.maxVideos === "number" && Number.isFinite(settings.maxVideos)
        ? String(settings.maxVideos)
        : "";
  }

  const sourceSignature = serializeSourceValues(defaultSource);
  const defaultsChanged =
    popupState.appliedSettingsDefaults.source !== sourceSignature ||
    popupState.appliedSettingsDefaults.sort !== defaultSort;

  if (
    dom.defaultSourceLabel instanceof HTMLElement &&
    !isFocusedSourceGroup(dom.defaultSourceButton, dom.defaultSourceInputs)
  ) {
    setSelectedSourceValues(dom.defaultSourceInputs, defaultSource);
    dom.defaultSourceLabel.textContent = formatSourceSelectionLabel(defaultSource);
  }

  if (dom.defaultSortInput && !isFocusedElement(dom.defaultSortInput)) {
    dom.defaultSortInput.value = defaultSort;
  }

  if (dom.defaultThemeInput && !isFocusedElement(dom.defaultThemeInput)) {
    dom.defaultThemeInput.value = theme;
  }

  if (dom.automaticUpdatesInput && !isFocusedElement(dom.automaticUpdatesInput)) {
    dom.automaticUpdatesInput.checked = automaticUpdatesEnabled;
  }

  if (dom.sourceSelectLabel instanceof HTMLElement) {
    if (
      !popupState.hasCustomOverviewSourceSelection &&
      !isFocusedSourceGroup(dom.sourceSelectButton, dom.sourceSelectInputs)
    ) {
      setSelectedSourceValues(dom.sourceSelectInputs, defaultSource);
    }

    dom.sourceSelectLabel.textContent = formatSourceSelectionLabel(
      getSelectedSourceValues(dom.sourceSelectInputs),
    );
  }

  if (dom.sortSelect && (defaultsChanged || !dom.sortSelect.value) && !isFocusedElement(dom.sortSelect)) {
    dom.sortSelect.value = defaultSort;
    popupState.browseState.sort = defaultSort;
  }

  popupState.appliedSettingsDefaults = {
    source: sourceSignature,
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

/**
 * Returns whether the user is actively interacting with a source multi-select.
 *
 * @param {HTMLElement|null|undefined} button
 * @param {Element[]|null|undefined} inputs
 * @returns {boolean}
 */
function isFocusedSourceGroup(button, inputs) {
  if (isFocusedElement(button)) {
    return true;
  }

  return Array.from(inputs || []).some((input) => isFocusedElement(input));
}
