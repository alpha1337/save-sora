import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { getSelectedSourceValues } from "../../utils/settings.js";
import {
  applyCurrentSelectionUi,
  getItemCheckboxesWithOptions,
  getSelectedKeysFromDom,
} from "../selection.js";
import {
  getSelectionScreenActionState,
  isSourceSelectionScreenVisible,
} from "../character-selection.js";

/**
 * Updates the primary button states after a render.
 *
 * @param {{isBusy:boolean,isPaused:boolean,isFetching:boolean,isFetchPaused:boolean,hasResults:boolean}} context
 */
export function syncPrimaryControls({ isBusy, isPaused, isFetching, isFetchPaused, hasResults }) {
  const hasSelectedSources = getSelectedSourceValues(dom.sourceSelectInputs).length > 0;
  const isResetMode = hasResults && !isFetching;

  if (dom.fetchButton) {
    dom.fetchButton.disabled = isBusy || isFetchPaused || (!isResetMode && !hasSelectedSources);
    dom.fetchButton.dataset.mode = isResetMode ? "reset" : "scan";
    dom.fetchButton.dataset.loading = String(isFetching);
    dom.fetchButton.classList.toggle("is-danger", isResetMode);
  }

  if (dom.fetchButtonLabel) {
    dom.fetchButtonLabel.textContent = isFetching
      ? "Fetching Videos"
      : hasResults
        ? "Start Over"
        : "Fetch Videos";
  }

  setSourceControlDisabled(dom.sourceSelectButton, dom.sourceSelectInputs, isBusy || isPaused || isFetchPaused);
  if (dom.maxVideosInput) {
    dom.maxVideosInput.disabled = isBusy || isPaused || isFetchPaused;
  }
  setSourceControlDisabled(dom.defaultSourceButton, dom.defaultSourceInputs, isBusy || isPaused || isFetchPaused);
  if (dom.defaultSortInput) {
    dom.defaultSortInput.disabled = isBusy || isPaused || isFetchPaused;
  }

  applyCurrentSelectionUi();

  const selectionScreenState = getSelectionScreenActionState();
  const isSourceSelectionVisible = isSourceSelectionScreenVisible();

  if (dom.selectAllButton) {
    dom.selectAllButton.disabled =
      isBusy || isPaused || isFetchPaused || (
        isSourceSelectionVisible
          ? selectionScreenState.visibleCount === 0 ||
            selectionScreenState.visibleSelectedCount === selectionScreenState.visibleCount
          : getItemCheckboxesWithOptions({ visibleOnly: true, enabledOnly: true }).length === 0
      );
  }

  if (dom.clearSelectionButton) {
    dom.clearSelectionButton.disabled =
      isBusy || isPaused || isFetchPaused || (
        isSourceSelectionVisible
          ? selectionScreenState.visibleSelectedCount === 0
          : getSelectedKeysFromDom({ visibleOnly: true }).length === 0
      );
  }
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
