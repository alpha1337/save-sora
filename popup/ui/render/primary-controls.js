import { dom } from "../../dom.js";
import {
  applyCurrentSelectionUi,
  getItemCheckboxesWithOptions,
  getSelectedKeysFromDom,
} from "../selection.js";

/**
 * Updates the primary button states after a render.
 *
 * @param {{isBusy:boolean,isPaused:boolean,isFetching:boolean,hasResults:boolean}} context
 */
export function syncPrimaryControls({ isBusy, isPaused, isFetching, hasResults }) {
  if (dom.fetchButton) {
    dom.fetchButton.disabled = isBusy;
    dom.fetchButton.dataset.mode = hasResults && !isFetching ? "reset" : "scan";
    dom.fetchButton.dataset.loading = String(isFetching);
    dom.fetchButton.classList.toggle("is-danger", hasResults && !isFetching);
  }

  if (dom.fetchButtonLabel) {
    dom.fetchButtonLabel.textContent = isFetching
      ? "Fetching Videos"
      : hasResults
        ? "Start Over"
        : "Fetch Videos";
  }

  if (dom.sourceSelect) {
    dom.sourceSelect.disabled = isBusy || isPaused;
  }
  if (dom.maxVideosInput) {
    dom.maxVideosInput.disabled = isBusy || isPaused;
  }
  if (dom.defaultSourceInput) {
    dom.defaultSourceInput.disabled = isBusy || isPaused;
  }
  if (dom.defaultSortInput) {
    dom.defaultSortInput.disabled = isBusy || isPaused;
  }

  applyCurrentSelectionUi();

  if (dom.selectAllButton) {
    dom.selectAllButton.disabled =
      isBusy ||
      isPaused ||
      getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true }).length === 0;
  }

  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.disabled =
      isBusy || isPaused || getSelectedKeysFromDom({ visibleOnly: true }).length === 0;
  }
}
