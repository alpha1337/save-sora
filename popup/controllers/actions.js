import { dom } from "../dom.js";
import {
  requestAbortScan,
  requestPauseScan,
  requestResumeScan,
  requestAbortDownloads,
  requestDownloadSelected,
  requestResetWorkingSession,
  requestScan,
  requestScanWithMode,
  saveCharacterSelection,
  saveCreatorSelection,
} from "../runtime.js";
import { popupState } from "../state.js";
import { getFetchUiState } from "../utils/runtime-state.js";
import {
  buildSelectedMetadataFilename,
  buildSelectedMetadataText,
  downloadTextFile,
} from "../utils/export.js";
import { hideNotice, setControlsDisabled, showNotice } from "../ui/layout.js";
import { updateDownloadOverlay } from "../ui/overlay.js";
import { renderState } from "../ui/render.js";
import { syncFetchProgressPanel } from "../ui/render/fetch-progress.js";
import {
  applyCurrentSelectionUi,
  getBulkArchiveCandidateKeys,
  getBulkArchiveSelectedKeys,
  getSelectedKeysFromDom,
} from "../ui/selection.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import { refreshStatus, syncPollingForState } from "./polling.js";
import {
  clearVisibleSourceScopes,
  closeAllSourceMenus,
  selectAllVisibleSourceScopes,
} from "./source-menus.js";
import { flushPendingTitleSaves } from "./title-edits.js";
import { isSourceSelectionScreenVisible } from "../ui/character-selection.js";
import { handleBatchArchiveStateChange } from "./item-mutations.js";

/**
 * Handles the main fetch/reset form submission.
 *
 * @param {SubmitEvent} event
 */
export async function handleRunFormSubmit(event) {
  event.preventDefault();

  const baseFetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const isSourceSelectionVisible = isSourceSelectionScreenVisible();
  const isResetPrimaryMode = baseFetchUiState.primaryActionMode === "reset";
  const isResumePrimaryMode = baseFetchUiState.primaryActionMode === "resume";
  const isRefreshPrimaryMode = baseFetchUiState.primaryActionMode === "refresh";
  const fetchUiState = {
    ...baseFetchUiState,
    primaryActionMode: isSourceSelectionVisible
      ? "scan"
      : isResumePrimaryMode
        ? "resume"
        : isResetPrimaryMode
          ? "reset"
          : isRefreshPrimaryMode || baseFetchUiState.hasResults
          ? "refresh"
          : "scan",
  };
  const isResetMode = fetchUiState.primaryActionMode === "reset";
  const isResumeMode = fetchUiState.primaryActionMode === "resume";
  const isRefreshMode = fetchUiState.primaryActionMode === "refresh";
  const sources = getSelectedSourceValues(dom.sourceSelectInputs);

  closeAllSourceMenus();

  if (!isResetMode && !isResumeMode && sources.length === 0) {
    showNotice(dom.errorBox, "Select at least one source to fetch.");
    return;
  }

  setControlsDisabled(true);
  hideNotice(dom.errorBox);

  try {
    let immediateState = null;
    if (isResetMode) {
      immediateState = await requestResetWorkingSession();
    } else if (isResumeMode) {
      immediateState = await requestResumeScan();
    } else {
      await persistScopedSelectionBeforeScan(sources);
      if (isRefreshMode) {
        immediateState = await requestScanWithMode(
          sources,
          popupState.browseState.query,
          "head_match",
        );
      } else {
        immediateState = await requestScan(sources, popupState.browseState.query);
      }
    }

    if (immediateState && typeof immediateState === "object") {
      renderState(immediateState);
      syncPollingForState(immediateState);
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

async function persistScopedSelectionBeforeScan(sources) {
  if (popupState.pendingScopedSelectionSave) {
    await popupState.pendingScopedSelectionSave;
  }

  if (!isSourceSelectionScreenVisible()) {
    return;
  }

  const tasks = [];
  if (Array.isArray(sources) && sources.includes("characterAccounts")) {
    tasks.push(saveCharacterSelection(popupState.selectedCharacterAccountIds));
  }

  if (Array.isArray(sources) && sources.includes("creators")) {
    tasks.push(saveCreatorSelection(popupState.selectedCreatorProfileIds));
  }

  if (tasks.length === 0) {
    return;
  }

  await Promise.all(tasks);
}

/**
 * Starts downloading the current selection.
 */
export async function handleDownloadButtonClick() {
  setControlsDisabled(true);
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);
  popupState.pendingDownloadStart = true;
  popupState.downloadOverlaySessionActive = true;
  popupState.downloadOverlayHasStarted = false;

  const selectedCount = getSelectedKeysFromDom().length;
  const runtimeSettings =
    popupState.latestRuntimeState &&
    popupState.latestRuntimeState.settings &&
    typeof popupState.latestRuntimeState.settings === "object"
      ? popupState.latestRuntimeState.settings
      : {};
  const downloadMode = runtimeSettings.downloadMode === "direct" ? "direct" : "archive";
  const isArchiveMode = downloadMode !== "direct";
  updateDownloadOverlay({
    phase: "preparing-download",
    runMode: isArchiveMode ? "archive-selected" : "selected",
    message: isArchiveMode
      ? "Saving your latest titles and preparing the ZIP archive..."
      : "Saving your latest titles and preparing the download queue...",
    runTotal: selectedCount,
    completed: 0,
    failed: 0,
  });

  try {
    await flushPendingTitleSaves();
    const immediateState = await requestDownloadSelected();
    if (immediateState && typeof immediateState === "object") {
      renderState(immediateState);
      syncPollingForState(immediateState);
    }
  } catch (error) {
    popupState.pendingDownloadStart = false;
    popupState.downloadOverlaySessionActive = false;
    popupState.downloadOverlayHasStarted = false;
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

/**
 * Downloads the current selection's metadata as plain text.
 */
export async function handleExportButtonClick() {
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);

  const selectedKeys = getSelectedKeysFromDom();
  const { textContent, exportedCount, skippedCount } = buildSelectedMetadataText(
    popupState.latestRenderState.items,
    selectedKeys,
  );

  if (!textContent || exportedCount === 0) {
    showNotice(dom.errorBox, "The current selection does not include any exportable metadata.");
    return;
  }

  try {
    await downloadTextFile(textContent, buildSelectedMetadataFilename());
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    return;
  }

  showNotice(
    dom.warningBox,
    skippedCount > 0
      ? `Downloaded metadata for ${exportedCount} video(s). ${skippedCount} selected item(s) were skipped because no prompt or fallback text was available.`
      : `Downloaded metadata for ${exportedCount} video(s).`,
  );
}

/**
 * Handles cancel/return actions from the download overlay.
 */
export async function handleDownloadOverlayCancel() {
  const action = dom.downloadOverlayCancel?.dataset.action || "cancel";
  if (action === "return") {
    popupState.downloadOverlaySessionActive = false;
    popupState.pendingDownloadStart = false;
    popupState.downloadOverlayHasStarted = false;
    popupState.bulkArchiveSelectionKeys = [];
    popupState.activeCreatorResultsTab = "all";
    popupState.browseState.query = "";
    if (dom.searchInput instanceof HTMLInputElement) {
      dom.searchInput.value = "";
    }
    const immediateState = await requestResetWorkingSession();
    if (immediateState && typeof immediateState === "object") {
      renderState(immediateState);
      syncPollingForState(immediateState);
    }
    updateDownloadOverlay({
      phase: popupState.latestRenderState.phase || "idle",
      runTotal: popupState.latestSummaryContext.downloadableCount,
      completed: 0,
      failed: 0,
    });
    await refreshStatus();
    return;
  }

  if (dom.downloadOverlayCancel) {
    dom.downloadOverlayCancel.disabled = true;
  }

  try {
    await requestAbortDownloads();
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    popupState.pendingDownloadStart = false;
    popupState.downloadOverlaySessionActive = false;
    popupState.downloadOverlayHasStarted = false;
    await refreshStatus();
  }
}

/**
 * Cancels the active fetch and returns the popup to a restartable state.
 */
export async function handleFetchProgressActionClick() {
  hideNotice(dom.errorBox);

  if (dom.fetchProgressAction instanceof HTMLButtonElement) {
    dom.fetchProgressAction.disabled = true;
  }

  try {
    await requestAbortScan();
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

/**
 * Expands or collapses the fixed fetch-status drawer without interrupting the run.
 */
export function handleFetchProgressToggleClick() {
  const isExpanded = popupState.fetchDrawerExpanded || popupState.fetchDrawerHoverExpanded;
  if (isExpanded) {
    popupState.fetchDrawerExpanded = false;
    popupState.fetchDrawerHoverExpanded = false;
  } else {
    popupState.fetchDrawerExpanded = true;
  }
  popupState.fetchDrawerUserToggled = true;
  syncFetchProgressDrawer();
}

/**
 * Expands the fixed fetch-status drawer whenever the pointer moves over the
 * visible drawer surface.
 */
export function handleFetchProgressPanelMouseEnter() {
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const isVisible = fetchUiState.isFetching || fetchUiState.isFetchPaused;
  if (!isVisible || popupState.fetchDrawerHoverExpanded) {
    return;
  }

  popupState.fetchDrawerHoverExpanded = true;
  syncFetchProgressDrawer(fetchUiState);
}

/**
 * Collapses the auto-expanded fetch drawer once the pointer leaves the drawer.
 */
export function handleFetchProgressPanelMouseLeave() {
  if (!popupState.fetchDrawerHoverExpanded) {
    return;
  }

  popupState.fetchDrawerHoverExpanded = false;
  syncFetchProgressDrawer();
}

function syncFetchProgressDrawer(existingFetchUiState = null) {
  const fetchUiState =
    existingFetchUiState ||
    getFetchUiState(
      popupState.latestRuntimeState,
      popupState.latestRenderState,
    );
  const isVisible = fetchUiState.isFetching || fetchUiState.isFetchPaused;
  if (!isVisible) {
    popupState.fetchDrawerExpanded = false;
    popupState.fetchDrawerHoverExpanded = false;
  }
  syncFetchProgressPanel(
    popupState.latestRuntimeState || { phase: fetchUiState.phase || "idle" },
  );
}

/**
 * Pauses or resumes the active fetch without discarding the current preview.
 */
export async function handleFetchProgressPauseActionClick() {
  hideNotice(dom.errorBox);

  if (dom.fetchProgressPauseAction instanceof HTMLButtonElement) {
    dom.fetchProgressPauseAction.disabled = true;
  }

  try {
    const fetchUiState = getFetchUiState(
      popupState.latestRuntimeState,
      popupState.latestRenderState,
    );
    if (fetchUiState.isFetchPaused) {
      const resumedState = await requestResumeScan();
      if (resumedState && typeof resumedState === "object") {
        renderState(resumedState);
        syncPollingForState(resumedState);
      }
    } else if (fetchUiState.isFetching) {
      await requestPauseScan();
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

/**
 * Selects every visible source scope, or queues the entire filtered result set
 * for a bulk archive action without visually toggling cards.
 */
export async function handleSelectAllClick() {
  if (isSourceSelectionScreenVisible()) {
    await selectAllVisibleSourceScopes();
    return;
  }

  popupState.bulkArchiveSelectionKeys = getBulkArchiveCandidateKeys();
  applyCurrentSelectionUi();
}

/**
 * Clears the current source-scope selection or bulk archive target list.
 */
export async function handleClearSelectionClick() {
  if (isSourceSelectionScreenVisible()) {
    await clearVisibleSourceScopes();
    return;
  }

  if (!Array.isArray(popupState.bulkArchiveSelectionKeys) || popupState.bulkArchiveSelectionKeys.length === 0) {
    return;
  }

  popupState.bulkArchiveSelectionKeys = [];
  applyCurrentSelectionUi();
}

/**
 * Archives the current bulk-archive target list without altering the download
 * selection model or visually toggling every card in the grid/list.
 */
export async function handleArchiveSelectedClick() {
  const itemKeys = getBulkArchiveSelectedKeys();
  if (itemKeys.length === 0) {
    return;
  }

  const didArchive = await handleBatchArchiveStateChange(itemKeys, true);
  if (!didArchive) {
    return;
  }

  popupState.bulkArchiveSelectionKeys = [];
  applyCurrentSelectionUi();
}

/**
 * Resets the current overview session while preserving saved sources and settings.
 */
export async function handleGoBackClick() {
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);
  closeAllSourceMenus();
  setControlsDisabled(true);

  popupState.pendingDownloadStart = false;
  popupState.downloadOverlaySessionActive = false;
  popupState.downloadOverlayHasStarted = false;
  popupState.bulkArchiveSelectionKeys = [];
  popupState.activeCreatorResultsTab = "all";
  popupState.browseState.query = "";
  if (dom.searchInput instanceof HTMLInputElement) {
    dom.searchInput.value = "";
  }

  try {
    const immediateState = await requestResetWorkingSession();
    if (immediateState && typeof immediateState === "object") {
      renderState(immediateState);
      syncPollingForState(immediateState);
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}
