import { dom } from "../dom.js";
import { setActiveTab, updateBackToTopVisibility } from "../ui/layout.js";
import {
  handleFetchProgressActionClick,
  handleFetchProgressPauseActionClick,
  handleClearSelectionClick,
  handleDownloadButtonClick,
  handleDownloadOverlayCancel,
  handleExportButtonClick,
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
  handleClearStorageClick,
  handleClearVolatileBackupsClick,
  handleCreatorResultsTabClick,
  handleMaxVideosInput,
  handleSearchInput,
  handleSettingsBlur,
  handleSettingsChange,
  handleSortChange,
  handleThemeToggleChange,
} from "./settings.js";
import {
  handleUpdateGateContinueClick,
  handleUpdateGateInstallClick,
  handleUpdateGateLinkClick,
  handleUpdateGateRetryClick,
  handleUpdateGateSkipClick,
  handleUpdaterCheckNowClick,
  handleUpdaterRelinkClick,
} from "./updater.js";
import {
  handleCharacterMenuChange,
  handleCharacterSelectionClick,
  handleCreatorDialogCancelClick,
  handleCreatorDialogCancelEvent,
  handleCreatorDetailsChange,
  handleCreatorDetailsCancelEvent,
  handleCreatorDetailsCloseClick,
  handleCreatorDialogSubmit,
  handleExportMenuButtonClick,
  handleExportMenuClick,
  handleCharacterMenuTriggerClick,
  handleOverviewSourceMenuChange,
  handleOverviewSourceTriggerClick,
  handleSettingsSourceMenuChange,
  handleSettingsSourceTriggerClick,
  handleSourceMenuDocumentClick,
  handleSourceMenuDocumentKeydown,
  syncExportMenu,
  syncSourceMenuLabels,
} from "./source-menus.js";

/**
 * Attaches every popup event listener.
 *
 * Keeping listener registration in one small module makes the popup easier to
 * scan when contributors need to answer "where does this interaction start?"
 */
export function initializeEventHandlers() {
  dom.runForm?.addEventListener("submit", handleRunFormSubmit);
  dom.downloadButton?.addEventListener("click", handleDownloadButtonClick);
  dom.exportButton?.addEventListener("click", handleExportButtonClick);
  dom.exportMenuButton?.addEventListener("click", handleExportMenuButtonClick);
  dom.exportMenu?.addEventListener("click", handleExportMenuClick);
  dom.fetchProgressPauseAction?.addEventListener("click", handleFetchProgressPauseActionClick);
  dom.fetchProgressAction?.addEventListener("click", handleFetchProgressActionClick);
  dom.downloadOverlayCancel?.addEventListener("click", handleDownloadOverlayCancel);
  dom.selectAllButton?.addEventListener("click", handleSelectAllClick);
  dom.clearSelectionButton?.addEventListener("click", handleClearSelectionClick);
  dom.itemsList?.addEventListener("click", handleItemsListClick);
  dom.itemsList?.addEventListener("change", handleItemsListChange);
  dom.itemsList?.addEventListener("input", handleItemsListInput);
  dom.itemsList?.addEventListener("focusin", handleItemsListFocusIn);
  dom.itemsList?.addEventListener("focusout", handleItemsListFocusOut);
  dom.searchInput?.addEventListener("input", handleSearchInput);
  dom.creatorResultsTabs?.addEventListener("click", handleCreatorResultsTabClick);
  dom.sortSelect?.addEventListener("change", handleSortChange);
  dom.themeToggle?.addEventListener("change", handleThemeToggleChange);
  dom.sourceSelectButton?.addEventListener("click", handleOverviewSourceTriggerClick);
  dom.sourceSelectMenu?.addEventListener("change", handleOverviewSourceMenuChange);
  dom.characterSelectButton?.addEventListener("click", handleCharacterMenuTriggerClick);
  dom.characterSelectMenu?.addEventListener("change", handleCharacterMenuChange);
  dom.characterSelectionGrid?.addEventListener("click", handleCharacterSelectionClick);
  dom.creatorDialogForm?.addEventListener("submit", handleCreatorDialogSubmit);
  dom.creatorDialogCancel?.addEventListener("click", handleCreatorDialogCancelClick);
  dom.creatorDialog?.addEventListener("cancel", handleCreatorDialogCancelEvent);
  dom.creatorDetailsClose?.addEventListener("click", handleCreatorDetailsCloseClick);
  dom.creatorDetailsDialog?.addEventListener("cancel", handleCreatorDetailsCancelEvent);
  dom.creatorDetailsDialog?.addEventListener("change", handleCreatorDetailsChange);
  dom.maxVideosInput?.addEventListener("input", handleMaxVideosInput);
  dom.maxVideosInput?.addEventListener("blur", handleSettingsBlur);
  dom.defaultSourceButton?.addEventListener("click", handleSettingsSourceTriggerClick);
  dom.defaultSourceMenu?.addEventListener("change", handleSettingsSourceMenuChange);
  dom.defaultSortInput?.addEventListener("change", handleSettingsChange);
  dom.defaultThemeInput?.addEventListener("change", handleSettingsChange);
  dom.automaticUpdatesInput?.addEventListener("change", handleSettingsChange);
  dom.clearStorageButton?.addEventListener("click", handleClearStorageClick);
  dom.clearVolatileBackupsButton?.addEventListener("click", handleClearVolatileBackupsClick);
  dom.updateGateLinkButton?.addEventListener("click", handleUpdateGateLinkClick);
  dom.updateGateInstallButton?.addEventListener("click", handleUpdateGateInstallClick);
  dom.updateGateRetryButton?.addEventListener("click", handleUpdateGateRetryClick);
  dom.updateGateSkipButton?.addEventListener("click", handleUpdateGateSkipClick);
  dom.updateGateContinueButton?.addEventListener("click", handleUpdateGateContinueClick);
  dom.updaterCheckNowButton?.addEventListener("click", handleUpdaterCheckNowClick);
  dom.updaterRelinkButton?.addEventListener("click", handleUpdaterRelinkClick);

  for (const button of dom.tabButtons) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab || "overview");
    });
  }

  document.addEventListener("visibilitychange", handleVisibilityChange);
  document.addEventListener("click", handleSourceMenuDocumentClick);
  document.addEventListener("keydown", handleSourceMenuDocumentKeydown);
  dom.pickerScrollRegion?.addEventListener("scroll", updateBackToTopVisibility);
  dom.backToTopButton?.addEventListener("click", handleBackToTopClick);

  syncSourceMenuLabels();
  syncExportMenu();
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
  if (!(dom.pickerScrollRegion instanceof HTMLElement)) {
    return;
  }

  dom.pickerScrollRegion.scrollTo({ top: 0, behavior: "smooth" });
}
