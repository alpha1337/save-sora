import { dom } from "../dom.js";
import {
  requestAbortDownloads,
  requestDownloadSelected,
  requestResetState,
  requestScan,
  saveSelection,
} from "../runtime.js";
import { popupState } from "../state.js";
import {
  buildSelectedUrlsCsv,
  buildSelectedUrlsFilename,
  downloadCsvText,
} from "../utils/export.js";
import { hideNotice, setControlsDisabled, showNotice } from "../ui/layout.js";
import { updateDownloadOverlay } from "../ui/overlay.js";
import { getItemCheckboxesWithOptions, getSelectedKeysFromDom } from "../ui/selection.js";
import { getSelectedSourceValues } from "../utils/settings.js";
import { refreshStatus } from "./polling.js";
import { closeAllSourceMenus } from "./source-menus.js";
import { updateSelectionFromDom } from "./selection-sync.js";
import { flushPendingTitleSaves } from "./title-edits.js";

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
    message: "Saving your latest titles and preparing the download queue...",
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
 * Selects every visible, enabled item.
 */
export async function handleSelectAllClick() {
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
