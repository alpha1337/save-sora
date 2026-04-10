import { dom } from "../dom.js";
import { setActiveTab } from "../ui/layout.js";
import {
  handleFetchProgressActionClick,
  handleFetchProgressPanelMouseEnter,
  handleFetchProgressPanelMouseLeave,
  handleFetchProgressPauseActionClick,
  handleFetchProgressToggleClick,
  handleArchiveSelectedClick,
  handleClearSelectionClick,
  handleDownloadButtonClick,
  handleDownloadOverlayCancel,
  handleExportButtonClick,
  handleGoBackClick,
  handleRunFormSubmit,
  handleSelectAllClick,
} from "./actions.js";
import {
  handleItemsListFocusIn,
  handleItemsListFocusOut,
  handleItemsListChange,
  handleItemsListClick,
  handleItemsListKeydown,
  handleItemsListPointerOut,
  handleItemsListPointerOver,
  handleSharedGridTooltipPointerEnter,
  handleSharedGridTooltipPointerLeave,
  scheduleVisibleItemsWindowRender,
} from "./item-events.js";
import { refreshStatus, stopPolling } from "./polling.js";
import {
  handleClearStorageClick,
  handleClearVolatileBackupsClick,
  handleCreatorResultsTabClick,
  handleMaxVideosInput,
  handlePickerScroll,
  handleResultsViewToggleClick,
  handleSearchInput,
  handleSettingsBlur,
  handleSettingsChange,
  handleSortChange,
  handleThemeToggleChange,
  handleViewFullscreenClick,
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
import {
  handleTitleDialogCancelClick,
  handleTitleDialogCancelEvent,
  handleTitleDialogClick,
  handleTitleDialogSubmit,
} from "./title-edits.js";

/**
 * Attaches every popup event listener.
 *
 * Keeping listener registration in one small module makes the popup easier to
 * scan when contributors need to answer "where does this interaction start?"
 */
export function initializeEventHandlers() {
  dom.runForm?.addEventListener("submit", handleRunFormSubmit);
  dom.goBackButton?.addEventListener("click", handleGoBackClick);
  dom.downloadButton?.addEventListener("click", handleDownloadButtonClick);
  dom.exportButton?.addEventListener("click", handleExportButtonClick);
  dom.fetchProgressPanel?.addEventListener("mouseenter", handleFetchProgressPanelMouseEnter);
  dom.fetchProgressPanel?.addEventListener("mouseleave", handleFetchProgressPanelMouseLeave);
  dom.fetchProgressToggle?.addEventListener("click", handleFetchProgressToggleClick);
  dom.fetchProgressPauseAction?.addEventListener("click", handleFetchProgressPauseActionClick);
  dom.fetchProgressAction?.addEventListener("click", handleFetchProgressActionClick);
  dom.downloadOverlayCancel?.addEventListener("click", handleDownloadOverlayCancel);
  dom.selectAllButton?.addEventListener("click", handleSelectAllClick);
  dom.archiveSelectedButton?.addEventListener("click", handleArchiveSelectedClick);
  dom.clearSelectionButton?.addEventListener("click", handleClearSelectionClick);
  dom.resultsViewToggle?.addEventListener("click", handleResultsViewToggleClick);
  dom.itemsList?.addEventListener("click", handleItemsListClick);
  dom.itemsList?.addEventListener("change", handleItemsListChange);
  dom.itemsList?.addEventListener("keydown", handleItemsListKeydown);
  dom.itemsList?.addEventListener("mouseover", handleItemsListPointerOver);
  dom.itemsList?.addEventListener("mouseout", handleItemsListPointerOut);
  dom.itemsList?.addEventListener("focusin", handleItemsListFocusIn);
  dom.itemsList?.addEventListener("focusout", handleItemsListFocusOut);
  dom.sharedGridTooltip?.addEventListener("click", handleItemsListClick);
  dom.sharedGridTooltip?.addEventListener("keydown", handleItemsListKeydown);
  dom.sharedGridTooltip?.addEventListener("mouseenter", handleSharedGridTooltipPointerEnter);
  dom.sharedGridTooltip?.addEventListener("mouseleave", handleSharedGridTooltipPointerLeave);
  dom.searchInput?.addEventListener("input", handleSearchInput);
  dom.creatorResultsTabs?.addEventListener("click", handleCreatorResultsTabClick);
  dom.sortSelect?.addEventListener("change", handleSortChange);
  dom.themeToggle?.addEventListener("change", handleThemeToggleChange);
  dom.viewFullscreenButton?.addEventListener("click", handleViewFullscreenClick);
  dom.sourceSelectButton?.addEventListener("click", handleOverviewSourceTriggerClick);
  dom.sourceSelectMenu?.addEventListener("change", handleOverviewSourceMenuChange);
  dom.characterSelectButton?.addEventListener("click", handleCharacterMenuTriggerClick);
  dom.characterSelectMenu?.addEventListener("change", handleCharacterMenuChange);
  dom.characterSelectionGrid?.addEventListener("click", handleCharacterSelectionClick);
  dom.creatorDialogForm?.addEventListener("submit", handleCreatorDialogSubmit);
  dom.creatorDialogCancel?.addEventListener("click", handleCreatorDialogCancelClick);
  dom.creatorDialog?.addEventListener("cancel", handleCreatorDialogCancelEvent);
  dom.titleDialogForm?.addEventListener("submit", handleTitleDialogSubmit);
  dom.titleDialogCancel?.addEventListener("click", handleTitleDialogCancelClick);
  dom.titleDialog?.addEventListener("cancel", handleTitleDialogCancelEvent);
  dom.titleDialog?.addEventListener("click", handleTitleDialogClick);
  dom.creatorDetailsClose?.addEventListener("click", handleCreatorDetailsCloseClick);
  dom.creatorDetailsDialog?.addEventListener("cancel", handleCreatorDetailsCancelEvent);
  dom.creatorDetailsDialog?.addEventListener("change", handleCreatorDetailsChange);
  dom.maxVideosInput?.addEventListener("input", handleMaxVideosInput);
  dom.maxVideosInput?.addEventListener("blur", handleSettingsBlur);
  dom.defaultSourceButton?.addEventListener("click", handleSettingsSourceTriggerClick);
  dom.defaultSourceMenu?.addEventListener("change", handleSettingsSourceMenuChange);
  dom.defaultSortInput?.addEventListener("change", handleSettingsChange);
  dom.defaultResultsLayoutInput?.addEventListener("change", handleSettingsChange);
  dom.defaultThemeInput?.addEventListener("change", handleSettingsChange);
  dom.downloadModeInput?.addEventListener("change", handleSettingsChange);
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
  window.addEventListener("resize", handleWindowResize);
  dom.pickerScrollRegion?.addEventListener("scroll", handlePickerScroll);
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

  void refreshStatus();
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

function handleWindowResize() {
  scheduleVisibleItemsWindowRender(true);
}
