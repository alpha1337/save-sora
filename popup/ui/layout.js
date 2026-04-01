import { dom } from "../dom.js";
import { popupState } from "../state.js";

/**
 * Generic layout and notice helpers shared across the popup.
 */

/**
 * Switches the visible top-level tab panel.
 *
 * @param {string} nextTab
 */
export function setActiveTab(nextTab) {
  popupState.activeTab = nextTab;

  for (const button of dom.tabButtons) {
    button.classList.toggle("is-active", button.dataset.tab === nextTab);
  }

  for (const panel of dom.tabPanels) {
    const isActive = panel.dataset.panel === nextTab;
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  }

  updateAppScrollLock();
  updateBackToTopVisibility();
}

/**
 * Locks overview scrolling while the popup is still in its empty pre-fetch state.
 */
export function updateAppScrollLock() {
  if (!(dom.appShell instanceof HTMLElement) || !(dom.pickerScrollRegion instanceof HTMLElement)) {
    return;
  }

  const isOverview = popupState.activeTab === "overview";
  const shouldLockApp = isOverview;
  const shouldEnablePickerScroll = isOverview;

  dom.appShell.classList.toggle("is-scroll-locked", shouldLockApp);
  dom.appShell.classList.toggle("is-scrollable", !shouldLockApp);
  dom.pickerScrollRegion.classList.toggle("is-scroll-locked", !shouldEnablePickerScroll);
  dom.pickerScrollRegion.classList.toggle("is-scrollable", shouldEnablePickerScroll);
}

/**
 * Applies the requested theme to the popup root.
 *
 * @param {"light"|"dark"|string} theme
 */
export function applyTheme(theme) {
  document.body.dataset.theme = theme === "light" ? "light" : "dark";
}

/**
 * Toggles the floating "back to top" button.
 */
export function updateBackToTopVisibility() {
  if (
    !(dom.backToTopButton instanceof HTMLButtonElement) ||
    !(dom.pickerScrollRegion instanceof HTMLElement)
  ) {
    return;
  }

  const shouldShow =
    popupState.activeTab === "overview" && dom.pickerScrollRegion.scrollTop > 240;
  dom.backToTopButton.classList.toggle("hidden", !shouldShow);
}

/**
 * Disables or enables the interactive controls while an async action is starting.
 *
 * @param {boolean} disabled
 */
export function setControlsDisabled(disabled) {
  if (dom.fetchButton) {
    dom.fetchButton.disabled = disabled;
  }
  if (dom.downloadButton) {
    dom.downloadButton.disabled = disabled;
  }
  if (dom.selectAllButton) {
    dom.selectAllButton.disabled = disabled;
  }
  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.disabled = disabled;
  }
  if (dom.sourceSelect) {
    dom.sourceSelect.disabled = disabled;
  }
  if (dom.maxVideosInput) {
    dom.maxVideosInput.disabled = disabled;
  }
  if (dom.defaultSourceInput) {
    dom.defaultSourceInput.disabled = disabled;
  }
  if (dom.defaultSortInput) {
    dom.defaultSortInput.disabled = disabled;
  }
  if (dom.defaultThemeInput) {
    dom.defaultThemeInput.disabled = disabled;
  }
}

/**
 * Displays a notice message in a shared alert box.
 *
 * @param {HTMLElement|null} element
 * @param {string} text
 */
export function showNotice(element, text) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.textContent = text;
  element.classList.remove("hidden");
}

/**
 * Hides a shared alert box.
 *
 * @param {HTMLElement|null} element
 */
export function hideNotice(element) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.textContent = "";
  element.classList.add("hidden");
}
