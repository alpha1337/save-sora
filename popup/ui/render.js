import { dom } from "../dom.js";
import { popupState } from "../state.js";
import { getFetchUiState } from "../utils/runtime-state.js";
import { buildRenderCountSnapshot } from "../utils/counts.js";
import {
  normalizeResultsViewMode,
  normalizeSortValue,
  normalizeSourceValues,
} from "../utils/settings.js";
import { getImplicitSelectedKeys } from "../utils/items.js";
import {
  applyTheme,
  hideNotice,
  showNotice,
  updateAppScrollLock,
  updateBackToTopVisibility,
} from "./layout.js";
import { updateDownloadOverlay } from "./overlay.js";
import { renderItemsList, resetResultsPresentation } from "./list/index.js";
import { startFetchStatusRotation, stopFetchStatusRotation } from "./render/fetch-status.js";
import { syncFetchProgressPanel } from "./render/fetch-progress.js";
import { syncPrimaryControls } from "./render/primary-controls.js";
import { syncSettingsInputs } from "./render/settings-sync.js";
import { syncUpdateSurfaces } from "./render/update-gate.js";
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
  const fetchUiState = getFetchUiState(
    popupState.latestRuntimeState,
    popupState.latestRenderState,
  );
  const { phase } = fetchUiState;
  if (
    syncSourceSelectionScreen(
      phase,
      popupState.latestRenderState.items,
    )
  ) {
    resetResultsPresentation();
    if (dom.creatorResultsTabs instanceof HTMLElement) {
      dom.creatorResultsTabs.replaceChildren();
      dom.creatorResultsTabs.classList.add("hidden");
    }
    syncPrimaryControls();
    return;
  }

  renderItemsList(
    popupState.latestRenderState.items,
    popupState.latestRenderState.selectedKeys,
    popupState.latestRenderState.titleOverrides,
    popupState.latestRenderState.disableInputs,
    phase,
  );
  syncPrimaryControls();
}

/**
 * Applies a fresh state payload from the background worker to the popup UI.
 *
 * @param {object} state
 */
export function renderState(state) {
  const previousPhase = popupState.latestRenderState.phase;
  const phase = state && state.phase ? state.phase : "idle";
  const items = Array.isArray(state && state.items) ? state.items : [];
  const selectedKeys = getImplicitSelectedKeys(items);
  const titleOverrides =
    state && state.titleOverrides && typeof state.titleOverrides === "object"
      ? state.titleOverrides
      : {};
  const settings =
    state && state.settings && typeof state.settings === "object" ? state.settings : {};
  const updateStatus =
    state && state.updateStatus && typeof state.updateStatus === "object" ? state.updateStatus : {};
  const theme = settings && settings.theme === "light" ? "light" : "dark";
  const defaultSource = normalizeSourceValues(settings.defaultSource);
  const defaultSort = normalizeSortValue(settings.defaultSort);
  const resultsViewMode = normalizeResultsViewMode(settings.resultsViewMode);
  const preferredViewMode =
    settings && settings.preferredViewMode === "windowed" ? "windowed" : "fullscreen";
  const downloadMode = settings && settings.downloadMode === "direct" ? "direct" : "archive";
  const automaticUpdatesEnabled = settings && settings.automaticUpdatesEnabled !== false;
  const popupTotalItemCount = Number.isFinite(Number(state && state.popupTotalItemCount))
    ? Math.max(0, Number(state.popupTotalItemCount))
    : items.length;
  const countSnapshot = buildRenderCountSnapshot(state, items);
  const foundVideos = Math.max(popupTotalItemCount, countSnapshot.fetchedCount);
  const totalVideos = foundVideos;
  const selectedCountTotal = countSnapshot.downloadableCount;

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
    fetchedCount: countSnapshot.fetchedCount,
    downloadableCount: countSnapshot.downloadableCount,
    downloadedCount: countSnapshot.downloadedCount,
    archivedCount: countSnapshot.archivedCount,
    phase,
  };

  applyTheme(theme);
  if (phase === "fetching") {
    startFetchStatusRotation();
  } else {
    stopFetchStatusRotation();
  }

  popupState.currentPhase = phase;
  popupState.latestRuntimeState = state && typeof state === "object" ? state : null;

  syncSettingsInputs(settings, {
    theme,
    defaultSource,
    defaultSort,
    preferredViewMode,
    downloadMode,
    resultsViewMode,
    automaticUpdatesEnabled,
  });
  syncUpdateSurfaces(updateStatus);

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

  const fetchUiState = getFetchUiState(state, {
    ...popupState.latestRenderState,
    items,
    phase,
  });
  const {
    isBusy,
    isPaused,
    isAnyPaused,
  } = fetchUiState;

  if (phase === "fetch-paused" && previousPhase !== "fetch-paused" && !popupState.fetchDrawerUserToggled) {
    popupState.fetchDrawerExpanded = false;
  } else if (phase === "fetching" && previousPhase !== "fetching") {
    popupState.fetchDrawerExpanded = false;
    popupState.fetchDrawerHoverExpanded = false;
    popupState.fetchDrawerUserToggled = false;
  } else if (phase !== "fetching" && phase !== "fetch-paused") {
    popupState.fetchDrawerExpanded = false;
    popupState.fetchDrawerHoverExpanded = false;
    popupState.fetchDrawerUserToggled = false;
  }

  popupState.latestBusy = isBusy;
  popupState.latestPaused = isAnyPaused;
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
    counts: countSnapshot,
    disableInputs: isBusy || isPaused,
    phase,
  };
  popupState.browseState.viewMode = resultsViewMode;

  syncFetchProgressPanel(state);
  updateDownloadOverlay(state);

  renderCurrentItems();

  updateAppScrollLock();
  updateBackToTopVisibility();
}
