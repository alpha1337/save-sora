import { dom } from "../dom.js";
import { setActiveTab, updateBackToTopVisibility } from "../ui/layout.js";
import {
  handleClearSelectionClick,
  handleDownloadButtonClick,
  handleDownloadOverlayCancel,
  handleExportUrlsButtonClick,
  handleRunFormSubmit,
  handleSelectAllClick,
} from "./actions.js";
import {
  handleItemsListChange,
  handleItemsListClick,
  handleItemsListFocusIn,
  handleItemsListFocusOut,
  handleItemsListInput,
} from "./item-events.js";
import { startPolling, stopPolling } from "./polling.js";
import {
  handleMaxVideosInput,
  handleSearchInput,
  handleSettingsBlur,
  handleSettingsChange,
  handleSortChange,
  handleThemeToggleChange,
} from "./settings.js";

/**
 * Attaches every popup event listener.
 *
 * Keeping listener registration in one small module makes the popup easier to
 * scan when contributors need to answer "where does this interaction start?"
 */
export function initializeEventHandlers() {
  dom.runForm?.addEventListener("submit", handleRunFormSubmit);
  dom.downloadButton?.addEventListener("click", handleDownloadButtonClick);
  dom.exportUrlsButton?.addEventListener("click", handleExportUrlsButtonClick);
  dom.downloadOverlayCancel?.addEventListener("click", handleDownloadOverlayCancel);
  dom.selectAllButton?.addEventListener("click", handleSelectAllClick);
  dom.clearSelectionButton?.addEventListener("click", handleClearSelectionClick);
  dom.itemsList?.addEventListener("click", handleItemsListClick);
  dom.itemsList?.addEventListener("change", handleItemsListChange);
  dom.itemsList?.addEventListener("input", handleItemsListInput);
  dom.itemsList?.addEventListener("focusin", handleItemsListFocusIn);
  dom.itemsList?.addEventListener("focusout", handleItemsListFocusOut);
  dom.searchInput?.addEventListener("input", handleSearchInput);
  dom.sortSelect?.addEventListener("change", handleSortChange);
  dom.themeToggle?.addEventListener("change", handleThemeToggleChange);
  dom.maxVideosInput?.addEventListener("input", handleMaxVideosInput);
  dom.maxVideosInput?.addEventListener("blur", handleSettingsBlur);
  dom.defaultSourceInput?.addEventListener("change", handleSettingsChange);
  dom.defaultSortInput?.addEventListener("change", handleSettingsChange);
  dom.defaultThemeInput?.addEventListener("change", handleSettingsChange);

  for (const button of dom.tabButtons) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab || "overview");
    });
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  dom.appShell?.addEventListener("scroll", updateBackToTopVisibility);
  dom.backToTopButton?.addEventListener("click", handleBackToTopClick);
}

/**
 * Pauses polling while the popup is hidden to avoid unnecessary work.
 */
function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
    return;
  }

  startPolling();
}

/**
 * Smoothly returns the popup shell to the top of the list.
 */
function handleBackToTopClick() {
  if (!(dom.appShell instanceof HTMLElement)) {
    return;
  }

  dom.appShell.scrollTo({ top: 0, behavior: "smooth" });
}
