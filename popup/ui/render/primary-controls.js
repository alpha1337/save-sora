import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { getFetchUiState } from "../../utils/runtime-state.js";
import { getSelectedSourceValues } from "../../utils/settings.js";
import { applyCurrentSelectionUi } from "../selection.js";
import {
  getSelectionScreenActionState,
  isSourceSelectionScreenVisible,
} from "../character-selection.js";

/**
 * Updates the primary button states after a render using the latest derived fetch UI state.
 */
export function syncPrimaryControls() {
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const {
    isBusy,
    isFetching,
    isFetchPaused,
    isAnyPaused,
    hasResults,
  } = fetchUiState;
  const hasSelectedSources = getSelectedSourceValues(dom.sourceSelectInputs).length > 0;
  const selectionScreenState = getSelectionScreenActionState();
  const isSourceSelectionVisible = isSourceSelectionScreenVisible();
  const hasRequiredScopedSelection =
    !isSourceSelectionVisible ||
    selectionScreenState.totalCount === 0 ||
    selectionScreenState.selectedCount > 0;
  const isResetMode = fetchUiState.primaryActionMode === "reset";
  const isResumeMode = fetchUiState.primaryActionMode === "resume";
  const isRefreshMode = fetchUiState.primaryActionMode === "refresh";
  const effectivePrimaryMode = isSourceSelectionVisible
    ? "scan"
    : isResumeMode
      ? "resume"
      : isResetMode
        ? "reset"
        : isRefreshMode || hasResults
          ? "refresh"
          : "scan";
  const effectiveIsResetMode = effectivePrimaryMode === "reset";
  const effectiveIsResumeMode = effectivePrimaryMode === "resume";
  const effectiveIsRefreshMode = effectivePrimaryMode === "refresh";

  if (dom.fetchButton) {
    dom.fetchButton.disabled =
      isBusy ||
      (!effectiveIsResetMode &&
        !effectiveIsResumeMode &&
        (!hasSelectedSources || !hasRequiredScopedSelection));
    dom.fetchButton.dataset.mode = effectiveIsResetMode
      ? "reset"
      : effectiveIsResumeMode
        ? "resume"
        : effectiveIsRefreshMode
          ? "refresh"
          : "scan";
    dom.fetchButton.dataset.loading = String(isFetching);
    dom.fetchButton.classList.toggle("is-danger", effectiveIsResetMode);
  }

  if (dom.fetchButtonLabel) {
    dom.fetchButtonLabel.textContent = isFetching
      ? "Fetching Videos"
      : effectiveIsResumeMode
        ? "Resume Fetch"
        : effectiveIsRefreshMode
          ? "Find Updates"
        : hasResults
          ? "Start Over"
          : "Fetch Videos";
  }

  if (dom.goBackButton instanceof HTMLButtonElement) {
    const shouldShowGoBack =
      !isSourceSelectionVisible &&
      (hasResults || isFetching || isFetchPaused);
    dom.goBackButton.classList.toggle("hidden", !shouldShowGoBack);
    dom.goBackButton.disabled = !shouldShowGoBack || isBusy;
  }

  setSourceControlDisabled(dom.sourceSelectButton, dom.sourceSelectInputs, isBusy || isAnyPaused);
  if (dom.maxVideosInput) {
    dom.maxVideosInput.disabled = isBusy || isAnyPaused;
  }
  setSourceControlDisabled(dom.defaultSourceButton, dom.defaultSourceInputs, isBusy || isAnyPaused);
  if (dom.defaultSortInput) {
    dom.defaultSortInput.disabled = isBusy || isAnyPaused;
  }

  applyCurrentSelectionUi();

  if (dom.selectAllButton && isSourceSelectionVisible) {
    dom.selectAllButton.disabled =
      isBusy ||
      isAnyPaused ||
      selectionScreenState.visibleCount === 0 ||
      selectionScreenState.visibleSelectedCount === selectionScreenState.visibleCount;
  }

  if (dom.clearSelectionButton && isSourceSelectionVisible) {
    dom.clearSelectionButton.disabled =
      isBusy || isAnyPaused || selectionScreenState.visibleSelectedCount === 0;
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
