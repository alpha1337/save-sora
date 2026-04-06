import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { normalizeSortValue, normalizeSourceValues } from "../utils/settings.js";
import {
  applyTheme,
  hideNotice,
  showNotice,
  updateAppScrollLock,
  updateBackToTopVisibility,
} from "./layout.js";
import { updateDownloadOverlay } from "./overlay.js";
import { renderItemsList } from "./list/index.js";
import { startFetchStatusRotation, stopFetchStatusRotation } from "./render/fetch-status.js";
import { syncFetchProgressPanel } from "./render/fetch-progress.js";
import { syncPrimaryControls } from "./render/primary-controls.js";
import { syncSettingsInputs } from "./render/settings-sync.js";
import { syncCharacterMenu } from "../controllers/source-menus.js";
import { syncSourceSelectionScreen } from "./character-selection.js";

/**
 * Top-level renderer that maps background state onto popup UI.
 */

/**
 * Re-renders the list using the current cached popup state.
 */
export function renderCurrentItems() {
  syncCharacterMenu();
  if (
    syncSourceSelectionScreen(
      popupState.latestRenderState.phase,
      popupState.latestRenderState.items,
    )
  ) {
    if (dom.creatorResultsTabs instanceof HTMLElement) {
      dom.creatorResultsTabs.replaceChildren();
      dom.creatorResultsTabs.classList.add("hidden");
    }
    return;
  }

  renderItemsList(
    popupState.latestRenderState.items,
    popupState.latestRenderState.selectedKeys,
    popupState.latestRenderState.titleOverrides,
    popupState.latestRenderState.disableInputs,
    popupState.latestRenderState.phase,
  );
}

/**
 * Applies a fresh state payload from the background worker to the popup UI.
 *
 * @param {object} state
 */
export function renderState(state) {
  const phase = state && state.phase ? state.phase : "idle";
  const fetchedCount = Number(state && state.fetchedCount) || 0;
  const items = Array.isArray(state && state.items) ? state.items : [];
  const selectedKeys = Array.isArray(state && state.selectedKeys) ? state.selectedKeys : [];
  const popupTotalItemCount = Number(state && state.popupTotalItemCount);
  const popupSelectedCountTotal = Number(state && state.popupSelectedCountTotal);
  const titleOverrides =
    state && state.titleOverrides && typeof state.titleOverrides === "object"
      ? state.titleOverrides
      : {};
  const settings =
    state && state.settings && typeof state.settings === "object" ? state.settings : {};
  const theme = settings && settings.theme === "light" ? "light" : "dark";
  const defaultSource = normalizeSourceValues(settings.defaultSource);
  const defaultSort = normalizeSortValue(settings.defaultSort);
  const totalVideos =
    Number.isFinite(popupTotalItemCount) && popupTotalItemCount >= 0
      ? phase === "fetching"
        ? Math.max(popupTotalItemCount, fetchedCount, items.length)
        : popupTotalItemCount
      : phase === "fetching"
        ? Math.max(items.length, fetchedCount)
        : items.length;
  const selectedCountTotal =
    Number.isFinite(popupSelectedCountTotal) && popupSelectedCountTotal >= 0
      ? popupSelectedCountTotal
      : selectedKeys.length;

  if (
    popupState.pendingDownloadStart &&
    (phase === "downloading" ||
      phase === "complete" ||
      phase === "ready" ||
      phase === "paused" ||
      Boolean(state && state.lastError))
  ) {
    popupState.pendingDownloadStart = false;
  }

  popupState.latestSummaryContext = {
    totalCount: totalVideos,
    selectedCount: selectedCountTotal,
    phase,
  };

  applyTheme(theme);
  if (phase === "fetching") {
    startFetchStatusRotation();
  } else {
    stopFetchStatusRotation();
  }

  syncSettingsInputs(settings, {
    theme,
    defaultSource,
    defaultSort,
  });

  if (dom.settingsStatus && dom.settingsStatus.textContent === "Saving...") {
    dom.settingsStatus.textContent = "Saved automatically.";
  }

  if (state && state.partialWarning) {
    showNotice(dom.warningBox, state.partialWarning);
  } else {
    hideNotice(dom.warningBox);
  }

  if (state && state.lastError) {
    showNotice(dom.errorBox, state.lastError);
  } else {
    hideNotice(dom.errorBox);
  }

  const isFetchPaused = phase === "fetch-paused";
  const isBusy = phase === "fetching" || phase === "downloading";
  const isPaused = phase === "paused";
  const isFetching = phase === "fetching";
  const hasResults = items.length > 0;

  popupState.latestBusy = isBusy;
  popupState.latestPaused = isPaused;
  popupState.characterAccounts = Array.isArray(state && state.characterAccounts)
    ? state.characterAccounts
    : [];
  popupState.selectedCharacterAccountIds = Array.isArray(state && state.selectedCharacterAccountIds)
    ? state.selectedCharacterAccountIds
    : [];
  popupState.creatorProfiles = Array.isArray(state && state.creatorProfiles)
    ? state.creatorProfiles
    : [];
  popupState.selectedCreatorProfileIds = Array.isArray(state && state.selectedCreatorProfileIds)
    ? state.selectedCreatorProfileIds
    : [];
  popupState.latestRenderState = {
    items,
    selectedKeys,
    titleOverrides,
    totalCount: totalVideos,
    selectedCountTotal,
    disableInputs: isBusy || isPaused,
    phase,
  };

  syncFetchProgressPanel(state);
  updateDownloadOverlay(state);

  if (!isEditingTitleInput()) {
    renderCurrentItems();
  }

  updateAppScrollLock();
  updateBackToTopVisibility();
  syncPrimaryControls({ isBusy, isPaused, isFetching, isFetchPaused, hasResults });
}

/**
 * Returns whether a title input is currently focused.
 *
 * @returns {boolean}
 */
function isEditingTitleInput() {
  return (
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.classList.contains("item-title-input")
  );
}
