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

  if (nextTab === "donate") {
    ensureDonateEmbedLoaded();
  }

  updateAppScrollLock();
  updateBackToTopVisibility();
}

export function initializeShellViewMode() {
  const viewContext = readShellViewContext();
  applyShellViewMode(viewContext.viewMode);
  syncViewModeButtonLabel();
  return viewContext;
}

/**
 * Locks overview scrolling while the popup is still in its empty pre-fetch state.
 */
export function updateAppScrollLock() {
  if (!(dom.appShell instanceof HTMLElement) || !(dom.pickerScrollRegion instanceof HTMLElement)) {
    return;
  }

  const isOverview = popupState.activeTab === "overview";
  const hasModalTakeover = isModalTakeoverOpen();
  const shouldLockApp = isOverview || hasModalTakeover;
  const shouldEnablePickerScroll = isOverview && !hasModalTakeover;

  dom.appShell.classList.toggle("is-scroll-locked", shouldLockApp);
  dom.appShell.classList.toggle("is-scrollable", !shouldLockApp);
  dom.pickerScrollRegion.classList.toggle("is-scroll-locked", !shouldEnablePickerScroll);
  dom.pickerScrollRegion.classList.toggle("is-scrollable", shouldEnablePickerScroll);
  document.documentElement.classList.toggle("is-modal-takeover-open", hasModalTakeover);
  document.body.classList.toggle("is-modal-takeover-open", hasModalTakeover);
}

export function isModalTakeoverOpen() {
  return (
    (dom.creatorDialog instanceof HTMLDialogElement && dom.creatorDialog.open) ||
    (dom.creatorDetailsDialog instanceof HTMLDialogElement && dom.creatorDetailsDialog.open)
  );
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
  setSourceControlDisabled(dom.sourceSelectButton, dom.sourceSelectInputs, disabled);
  setSourceControlDisabled(dom.characterSelectButton, dom.characterSelectInputs, disabled);
  if (dom.maxVideosInput) {
    dom.maxVideosInput.disabled = disabled;
  }
  setSourceControlDisabled(dom.defaultSourceButton, dom.defaultSourceInputs, disabled);
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

function readShellViewContext() {
  let requestedTab = "overview";
  let requestedViewMode = "windowed";

  try {
    const url = new URL(window.location.href);
    requestedViewMode = url.searchParams.get("view") === "fullscreen" ? "fullscreen" : "windowed";
    const tabParam = url.searchParams.get("tab");
    if (isKnownTopLevelTab(tabParam)) {
      requestedTab = tabParam;
    }
  } catch (_error) {
    // Fall back to the compact popup shell if the URL cannot be parsed.
  }

  return {
    initialTab: requestedTab,
    viewMode: requestedViewMode,
  };
}

function applyShellViewMode(viewMode) {
  popupState.isFullscreenView = viewMode === "fullscreen";
  document.documentElement.classList.toggle("is-fullscreen-view", popupState.isFullscreenView);
  document.body.classList.toggle("is-fullscreen-view", popupState.isFullscreenView);
}

function syncViewModeButtonLabel() {
  if (!(dom.viewFullscreenButton instanceof HTMLButtonElement)) {
    return;
  }

  const label = popupState.isFullscreenView ? "Open Windowed" : "View Fullscreen";
  dom.viewFullscreenButton.dataset.viewAction = popupState.isFullscreenView ? "windowed" : "fullscreen";
  const labelElement = dom.viewFullscreenButton.querySelector(".visually-hidden");
  if (labelElement instanceof HTMLElement) {
    labelElement.textContent = label;
  }
  dom.viewFullscreenButton.setAttribute("aria-label", label);
  dom.viewFullscreenButton.title = label;
}

function isKnownTopLevelTab(tabName) {
  return Array.from(dom.tabButtons || []).some((button) => button.dataset.tab === tabName);
}

function setSourceControlDisabled(button, inputs, disabled) {
  if (button instanceof HTMLButtonElement) {
    button.disabled = disabled;

    if (disabled) {
      button.setAttribute("aria-expanded", "false");
      const control = button.closest(".multi-select");
      control?.classList.remove("is-open");
      const menuId = button.getAttribute("aria-controls");
      const menu = menuId ? document.getElementById(menuId) : null;
      menu?.classList.add("hidden");
    }
  }

  for (const input of Array.from(inputs || [])) {
    if (input instanceof HTMLInputElement) {
      input.disabled = disabled;
    }
  }
}

function ensureDonateEmbedLoaded() {
  if (!(dom.kofiFrame instanceof HTMLIFrameElement)) {
    return;
  }

  const src = dom.kofiFrame.dataset.src;
  if (!src || dom.kofiFrame.src === src) {
    return;
  }

  dom.kofiFrame.src = src;
}
