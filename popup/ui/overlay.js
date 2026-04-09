import { dom } from "../dom.js";
import { popupState } from "../state.js";

/**
 * Download-overlay rendering helpers.
 */

/**
 * Renders the modal-like download progress overlay.
 *
 * @param {object} state
 */
export function updateDownloadOverlay(state) {
  if (
    !(dom.downloadOverlay instanceof HTMLElement) ||
    !(dom.downloadOverlayTitle instanceof HTMLElement) ||
    !(dom.downloadOverlayStatus instanceof HTMLElement) ||
    !(dom.downloadOverlayCount instanceof HTMLElement) ||
    !(dom.downloadOverlayPercent instanceof HTMLElement) ||
    !(dom.downloadOverlayFill instanceof HTMLElement) ||
    !(dom.downloadOverlayThanks instanceof HTMLElement) ||
    !(dom.downloadOverlayCancel instanceof HTMLButtonElement)
  ) {
    return;
  }

  const phase = state && state.phase ? state.phase : "idle";
  const runMode = state && typeof state.runMode === "string" ? state.runMode : "";
  const isArchiveRun = runMode.startsWith("archive");
  const runTotal = Math.max(0, Number(state && state.runTotal) || 0);
  const completed = Math.max(0, Number(state && state.completed) || 0);
  const failed = Math.max(0, Number(state && state.failed) || 0);
  const processed = Math.min(runTotal || completed + failed, completed + failed);
  const percent = runTotal > 0
    ? Math.max(0, Math.min(100, Math.round((processed / runTotal) * 100)))
    : 0;
  const hasSettledDownloadState =
    popupState.downloadOverlaySessionActive &&
    (phase === "complete" || phase === "ready" || phase === "paused" || phase === "error");
  const isVisible = phase === "downloading" || popupState.pendingDownloadStart || hasSettledDownloadState;

  dom.downloadOverlay.classList.toggle("hidden", !isVisible);
  dom.downloadOverlay.setAttribute("aria-hidden", String(!isVisible));

  if (!isVisible) {
    dom.downloadOverlayThanks.classList.add("hidden");
    dom.downloadOverlayCancel.dataset.action = "cancel";
    dom.downloadOverlayCancel.textContent = "Cancel";
    dom.downloadOverlayCancel.classList.remove("is-return");
    dom.downloadOverlayCancel.disabled = false;
    dom.downloadOverlayFill.style.width = "0%";
    return;
  }

  if (popupState.pendingDownloadStart && phase !== "downloading") {
    dom.downloadOverlayThanks.classList.add("hidden");
    dom.downloadOverlayTitle.textContent = isArchiveRun ? "Preparing archive download..." : "Preparing downloads...";
    dom.downloadOverlayStatus.textContent =
      (state && state.message) ||
      (isArchiveRun
        ? "Saving your latest changes and preparing the archive download."
        : "Saving your latest changes and building the queue.");
    dom.downloadOverlayCount.textContent = runTotal > 0 ? `0 / ${runTotal}` : "Preparing";
    dom.downloadOverlayPercent.textContent = "0%";
    dom.downloadOverlayFill.style.width = "0%";
    dom.downloadOverlayCancel.dataset.action = "cancel";
    dom.downloadOverlayCancel.textContent = "Cancel";
    dom.downloadOverlayCancel.classList.remove("is-return");
    dom.downloadOverlayCancel.disabled = false;
    return;
  }

  if (phase === "downloading") {
    dom.downloadOverlayThanks.classList.add("hidden");
    dom.downloadOverlayTitle.textContent = isArchiveRun ? "Downloading and packaging videos" : "Downloading videos";
    dom.downloadOverlayStatus.textContent =
      (state && state.message) || "Working through your selected videos...";
    dom.downloadOverlayCount.textContent = `${processed} / ${runTotal || processed}`;
    dom.downloadOverlayPercent.textContent = `${percent}%`;
    dom.downloadOverlayFill.style.width = `${percent}%`;
    dom.downloadOverlayCancel.dataset.action = "cancel";
    dom.downloadOverlayCancel.textContent = "Cancel";
    dom.downloadOverlayCancel.classList.remove("is-return");
    dom.downloadOverlayCancel.disabled = false;
    return;
  }

  const settledPercent = phase === "complete" || phase === "ready" ? 100 : percent;
  const settledProcessed = runTotal || processed;
  const settledMessage = (state && state.message) || "Your library has been updated.";
  const wasCanceled = /abort|cancel/i.test(settledMessage);
  dom.downloadOverlayThanks.classList.toggle(
    "hidden",
    !(phase === "complete" || phase === "ready"),
  );
  dom.downloadOverlayTitle.textContent =
    phase === "paused"
      ? "Downloads paused"
      : wasCanceled
        ? isArchiveRun
          ? "Archive download canceled"
          : "Downloads canceled"
      : isArchiveRun
        ? "Archive download finished"
        : "Downloads finished";
  dom.downloadOverlayStatus.textContent = settledMessage;
  dom.downloadOverlayCount.textContent = `${settledProcessed} / ${runTotal || settledProcessed}`;
  dom.downloadOverlayPercent.textContent = `${settledPercent}%`;
  dom.downloadOverlayFill.style.width = `${settledPercent}%`;
  dom.downloadOverlayCancel.dataset.action = "return";
  dom.downloadOverlayCancel.textContent = "Return to library";
  dom.downloadOverlayCancel.classList.add("is-return");
  dom.downloadOverlayCancel.disabled = false;
}
