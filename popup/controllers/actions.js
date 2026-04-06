import { dom } from "../dom.js";
import {
  requestAbortScan,
  requestAbortDownloads,
  requestDownloadSelected,
  requestResetState,
  requestScan,
  saveSelection,
} from "../runtime.js";
import { popupState } from "../state.js";
import {
  buildSelectedPromptsCsv,
  buildSelectedPromptsFilename,
  buildSelectedUrlsCsv,
  buildSelectedUrlsFilename,
  downloadCsvText,
} from "../utils/export.js";
import { hideNotice, setControlsDisabled, showNotice } from "../ui/layout.js";
import { updateDownloadOverlay } from "../ui/overlay.js";
import { getItemCheckboxesWithOptions, getSelectedKeysFromDom } from "../ui/selection.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import { refreshStatus } from "./polling.js";
import {
  clearVisibleSourceScopes,
  closeAllSourceMenus,
  selectAllVisibleSourceScopes,
} from "./source-menus.js";
import { updateSelectionFromDom } from "./selection-sync.js";
import { flushPendingTitleSaves } from "./title-edits.js";
import { isSourceSelectionScreenVisible } from "../ui/character-selection.js";

/**
 * Handles the main fetch/reset form submission.
 *
 * @param {SubmitEvent} event
 */
export async function handleRunFormSubmit(event) {
  event.preventDefault();

  const isResetMode = dom.fetchButton?.dataset.mode === "reset";
  const sources = getSelectedSourceValues(dom.sourceSelectInputs);

  closeAllSourceMenus();

  if (!isResetMode && sources.length === 0) {
    showNotice(dom.errorBox, "Select at least one source to fetch.");
    return;
  }

  setControlsDisabled(true);
  hideNotice(dom.errorBox);

  if (!isResetMode) {
    preparePendingFetchUi();
  }

  try {
    if (isResetMode) {
      await requestResetState();
    } else {
      await requestScan(sources, popupState.browseState.query);
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
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
  updateDownloadOverlay({
    phase: "preparing-download",
    runMode: "archive-selected",
    message: "Saving your latest titles and preparing the ZIP archive...",
    runTotal: selectedCount,
    completed: 0,
    failed: 0,
  });

  try {
    await flushPendingTitleSaves();
    await saveSelection(getSelectedKeysFromDom());
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
 * Selects every visible, enabled item.
 */
export async function handleSelectAllClick() {
  if (isSourceSelectionScreenVisible()) {
    await selectAllVisibleSourceScopes();
    return;
  }

  const checkboxes = getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true });
  for (const checkbox of checkboxes) {
    checkbox.checked = true;
  }

  await updateSelectionFromDom();
}

/**
 * Clears every visible selection.
 */
export async function handleClearSelectionClick() {
  if (isSourceSelectionScreenVisible()) {
    await clearVisibleSourceScopes();
    return;
  }

  const checkboxes = getItemCheckboxesWithOptions({ visibleOnly: true });
  for (const checkbox of checkboxes) {
    checkbox.checked = false;
  }

  await updateSelectionFromDom();
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
