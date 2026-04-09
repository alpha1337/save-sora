import { dom } from "../dom.js";
import {
  requestAbortScan,
  requestPauseScan,
  requestResumeScan,
  requestAbortDownloads,
  requestDownloadSelected,
  requestResetState,
  requestScan,
  saveCharacterSelection,
  saveCreatorSelection,
} from "../runtime.js";
import { popupState } from "../state.js";
import { getFetchUiState } from "../utils/runtime-state.js";
import {
  buildSelectedPromptsCsv,
  buildSelectedPromptsFilename,
  buildSelectedUrlsCsv,
  buildSelectedUrlsFilename,
  downloadCsvText,
} from "../utils/export.js";
import { hideNotice, setControlsDisabled, showNotice } from "../ui/layout.js";
import { updateDownloadOverlay } from "../ui/overlay.js";
import { syncFetchProgressPanel } from "../ui/render/fetch-progress.js";
import {
  getSelectedKeysFromDom,
  getVisibleActiveKeysFromDom,
  getVisibleArchivedKeysFromDom,
} from "../ui/selection.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import { refreshStatus } from "./polling.js";
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

  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const isResetMode = fetchUiState.primaryActionMode === "reset";
  const isResumeMode = fetchUiState.primaryActionMode === "resume";
  const sources = getSelectedSourceValues(dom.sourceSelectInputs);

  closeAllSourceMenus();

  if (!isResetMode && !isResumeMode && sources.length === 0) {
    showNotice(dom.errorBox, "Select at least one source to fetch.");
    return;
  }

  setControlsDisabled(true);
  hideNotice(dom.errorBox);

  if (!isResetMode && !isResumeMode) {
    preparePendingFetchUi();
  }

  try {
    if (isResetMode) {
      await requestResetState();
    } else if (isResumeMode) {
      await requestResumeScan();
    } else {
      await persistScopedSelectionBeforeScan(sources);
      await requestScan(sources, popupState.browseState.query);
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
    await requestDownloadSelected();
  } catch (error) {
    popupState.pendingDownloadStart = false;
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

/**
 * Exports a CSV containing the Sora URLs for the current selection.
 */
export async function handleExportUrlsButtonClick() {
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);

  const selectedKeys = getSelectedKeysFromDom();
  const { csvText, exportedCount, skippedCount } = buildSelectedUrlsCsv(
    popupState.latestRenderState.items,
    selectedKeys,
  );

  if (!csvText || exportedCount === 0) {
    showNotice(dom.errorBox, "The current selection does not include any exportable Sora URLs.");
    return;
  }

  try {
    await downloadCsvText(csvText, buildSelectedUrlsFilename());
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    return;
  }

  if (skippedCount > 0) {
    showNotice(
      dom.warningBox,
      `Downloaded a CSV with ${exportedCount} URL(s). ${skippedCount} selected item(s) were skipped because a Sora page URL was not available.`,
    );
  }
}

/**
 * Exports using the popup's currently selected export type.
 */
export async function handleExportButtonClick() {
  if (popupState.preferredExportType === "urls") {
    await handleExportUrlsButtonClick();
    return;
  }

  await handleExportPromptsButtonClick();
}

/**
 * Exports a single-column CSV containing prompt text for the current selection.
 */
export async function handleExportPromptsButtonClick() {
  hideNotice(dom.warningBox);
  hideNotice(dom.errorBox);

  const selectedKeys = getSelectedKeysFromDom();
  const { csvText, exportedCount, skippedCount } = buildSelectedPromptsCsv(
    popupState.latestRenderState.items,
    selectedKeys,
  );

  if (!csvText || exportedCount === 0) {
    showNotice(dom.errorBox, "The current selection does not include any exportable prompts.");
    return;
  }

  try {
    await downloadCsvText(csvText, buildSelectedPromptsFilename());
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    return;
  }

  showNotice(
    dom.warningBox,
    skippedCount > 0
      ? `Downloaded a CSV with ${exportedCount} prompt(s). ${skippedCount} selected item(s) were skipped because prompt text was not available.`
      : `Downloaded a CSV with ${exportedCount} prompt(s).`,
  );
}

/**
 * Handles cancel/return actions from the download overlay.
 */
export async function handleDownloadOverlayCancel() {
  const action = dom.downloadOverlayCancel?.dataset.action || "cancel";
  if (action === "return") {
    await refreshStatus();
    popupState.downloadOverlaySessionActive = false;
    popupState.pendingDownloadStart = false;
    updateDownloadOverlay({
      phase: popupState.latestRenderState.phase || "idle",
      runTotal: popupState.latestSummaryContext.totalCount,
      completed: 0,
      failed: 0,
    });
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
      await requestResumeScan();
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
 * Selects every visible, enabled item.
 */
export async function handleSelectAllClick() {
  if (isSourceSelectionScreenVisible()) {
    await selectAllVisibleSourceScopes();
    return;
  }

  const archivedKeys = getVisibleArchivedKeysFromDom();
  if (archivedKeys.length === 0) {
    return;
  }

  await handleBatchArchiveStateChange(archivedKeys, false);
}

/**
 * Clears every visible selection.
 */
export async function handleClearSelectionClick() {
  if (isSourceSelectionScreenVisible()) {
    await clearVisibleSourceScopes();
    return;
  }

  const activeKeys = getVisibleActiveKeysFromDom();
  if (activeKeys.length === 0) {
    return;
  }

  await handleBatchArchiveStateChange(activeKeys, true);
}

/**
 * Puts the popup into a temporary "fetch in progress" presentation.
 */
function preparePendingFetchUi() {
  dom.itemsList?.classList.add("hidden");
  dom.characterSelectionGrid?.classList.add("hidden");
  dom.emptyState?.classList.add("hidden");

  if (dom.emptyStateText instanceof HTMLElement) {
    dom.emptyStateText.classList.add("hidden");
    dom.emptyStateText.textContent = "";
  }

  if (dom.emptyStateImage instanceof HTMLElement) {
    dom.emptyStateImage.classList.remove("hidden");
  }

  if (dom.selectionSummary instanceof HTMLElement) {
    dom.selectionSummary.textContent = popupState.activeFetchStatusMessage || "Finding videos...";
  }
}
