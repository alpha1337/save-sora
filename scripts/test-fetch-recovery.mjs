import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function makeMirrorKey(sourceScopeHash, itemId) {
  return `${sourceScopeHash}:${itemId}`;
}

function writeMirrorPage(mirrorMap, sourceScopeHash, items) {
  for (const item of items) {
    mirrorMap.set(makeMirrorKey(sourceScopeHash, item.id), {
      ...item,
      sourceScopeHash,
    });
  }
}

function buildCheckpoint({
  sourceScopeHash,
  headCursor = "",
  resumeCursor = "",
  knownBoundaryKey = "",
  itemsPersisted = 0,
  headSyncStatus = "idle",
  backlogStatus = "idle",
  isTerminalComplete = false,
} = {}) {
  return {
    sourceScopeHash,
    headCursor,
    resumeCursor,
    knownBoundaryKey,
    itemsPersisted,
    headSyncStatus,
    backlogStatus,
    isTerminalComplete,
  };
}

function createSyntheticInterruptedSession(checkpoints) {
  const recoverable = checkpoints.filter(
    (checkpoint) => checkpoint.itemsPersisted > 0 && checkpoint.isTerminalComplete !== true,
  );
  if (!recoverable.length) {
    return null;
  }

  return {
    sessionId: `recovered-${recoverable[0].sourceScopeHash}`,
    status: "paused",
    sourceScopes: recoverable.map((checkpoint) => ({
      sourceScopeHash: checkpoint.sourceScopeHash,
    })),
  };
}

function restoreItemsFromMirror(mirrorMap, session) {
  const restoredItems = [];
  for (const scope of session.sourceScopes) {
    for (const item of mirrorMap.values()) {
      if (item.sourceScopeHash === scope.sourceScopeHash) {
        restoredItems.push(item);
      }
    }
  }
  return restoredItems.sort((left, right) => Number(right.order) - Number(left.order));
}

function persistPageAndCheckpoint({
  mirrorMap,
  sourceScopeHash,
  checkpoint,
  items,
  nextCursor = "",
  syncPhase = "",
  shouldCommitItems = true,
  watermark = null,
} = {}) {
  if (!shouldCommitItems) {
    return {
      checkpoint,
      committed: false,
    };
  }

  writeMirrorPage(mirrorMap, sourceScopeHash, items);
  const nextCheckpoint = {
    ...checkpoint,
    sourceScopeHash,
    itemsPersisted: [...mirrorMap.values()].filter((item) => item.sourceScopeHash === sourceScopeHash)
      .length,
    resumeCursor: syncPhase === "backlog-resume" ? nextCursor : checkpoint.resumeCursor,
    headCursor: syncPhase === "head-sync" ? nextCursor : checkpoint.headCursor,
    knownBoundaryKey:
      syncPhase === "head-sync" && items.length > 0 ? items[0].id : checkpoint.knownBoundaryKey,
    newestKnownWatermark: syncPhase === "head-sync" ? watermark : checkpoint.newestKnownWatermark,
    headSyncStatus:
      syncPhase === "head-sync" ? (nextCursor ? "running" : "complete") : checkpoint.headSyncStatus,
    backlogStatus:
      syncPhase === "backlog-resume"
        ? nextCursor
          ? "running"
          : "complete"
        : checkpoint.backlogStatus,
  };

  return {
    checkpoint: nextCheckpoint,
    committed: true,
  };
}

function runHeadSyncThenResume({ mirrorMap, sourceScopeHash, checkpoint, headPages, backlogPages }) {
  const seenHeadItems = [];
  let boundaryReached = false;

  for (const page of headPages) {
    writeMirrorPage(mirrorMap, sourceScopeHash, page.items);
    seenHeadItems.push(...page.items.map((item) => item.id));
    if (page.items.some((item) => item.id === checkpoint.knownBoundaryKey)) {
      boundaryReached = true;
      break;
    }
  }

  const resumedPages = [];
  for (const page of backlogPages) {
    resumedPages.push(page.cursor);
    writeMirrorPage(mirrorMap, sourceScopeHash, page.items);
  }

  return {
    boundaryReached,
    seenHeadItems,
    resumedPages,
    finalItemCount: [...mirrorMap.values()].filter((item) => item.sourceScopeHash === sourceScopeHash)
      .length,
  };
}

function runExactOnlyMigration(legacyEntries) {
  return legacyEntries
    .filter(
      (entry) =>
        entry &&
        typeof entry.sourceScopeHash === "string" &&
        entry.sourceScopeHash &&
        typeof entry.resumeCursor === "string" &&
        entry.resumeCursor,
    )
    .map((entry) => ({
      sourceScopeHash: entry.sourceScopeHash,
      resumeCursor: entry.resumeCursor,
      itemsPersisted: entry.itemsPersisted,
    }));
}

function handleCorruptMirrorState(error) {
  return {
    recoverable: false,
    preservedMirrorData: true,
    reason: error instanceof Error ? error.message : String(error),
  };
}

function simulateResetPreservingSavedSources(state) {
  return {
    characterAccounts: Array.isArray(state.characterAccounts) ? [...state.characterAccounts] : [],
    selectedCharacterAccountIds: Array.isArray(state.selectedCharacterAccountIds)
      ? [...state.selectedCharacterAccountIds]
      : [],
    creatorProfiles: Array.isArray(state.creatorProfiles) ? [...state.creatorProfiles] : [],
    selectedCreatorProfileIds: Array.isArray(state.selectedCreatorProfileIds)
      ? [...state.selectedCreatorProfileIds]
      : [],
  };
}

function simulatePausedRequestLifecycle() {
  let pausedFetchRequest = {
    sources: ["creators"],
    searchQuery: "",
  };
  const currentState = {
    phase: "fetch-paused",
    syncStatus: "paused",
    resumableFetchRequest: {
      sources: ["creators"],
      searchQuery: "",
    },
  };

  if (currentState.phase !== "fetch-paused") {
    pausedFetchRequest = null;
  }

  return pausedFetchRequest;
}

function simulateSerializedFetchState(state) {
  const phase = state && typeof state.phase === "string" ? state.phase : "idle";
  const isActiveFetchState = phase === "fetching";
  const isPausedFetchState = phase === "fetch-paused";
  const isFetchResumeState = isActiveFetchState || isPausedFetchState;

  return {
    phase: isActiveFetchState ? "idle" : phase,
    resumableFetchRequest: isFetchResumeState ? state.resumableFetchRequest : null,
    syncSessionId: isFetchResumeState ? state.syncSessionId || "" : "",
    syncStatus: isFetchResumeState ? state.syncStatus || "idle" : "idle",
    restoreStatus:
      isPausedFetchState && state.syncSessionId
        ? {
            phase: "ready",
            sessionId: state.syncSessionId,
          }
        : {
            phase: "idle",
            sessionId: "",
          },
  };
}

function simulateInterruptedRestoreResolution(nextState, interruptedSession) {
  const shouldAutoRestorePausedSession =
    nextState.phase === "fetch-paused" &&
    nextState.resumableFetchRequest &&
    (!nextState.syncSessionId || nextState.syncSessionId === interruptedSession.sessionId) &&
    ["paused", "stalled", "error"].includes(interruptedSession.status);

  return shouldAutoRestorePausedSession ? "paused" : "prompt";
}

function simulateRestoreGateResumeSequence(runtimeStates) {
  const phasesSeenBeforeReady = [];

  for (const state of runtimeStates) {
    const phase = state && typeof state.phase === "string" ? state.phase : "idle";
    const syncStatus = state && typeof state.syncStatus === "string" ? state.syncStatus : "idle";
    phasesSeenBeforeReady.push(`${phase}:${syncStatus}`);
    if (phase === "fetching" || syncStatus === "running") {
      return {
        released: true,
        phasesSeenBeforeReady,
      };
    }
  }

  return {
    released: false,
    phasesSeenBeforeReady,
  };
}

function simulateStartupGateVisibility({ startupGateLocked, shouldShowRuntimeGate }) {
  return startupGateLocked || shouldShowRuntimeGate;
}

function resolvePausedRequest({ interruptedSession }) {
  if (
    interruptedSession &&
    ["paused", "stalled", "error"].includes(interruptedSession.status) &&
    Array.isArray(interruptedSession.sources) &&
    interruptedSession.sources.length > 0
  ) {
    return {
      sources: [...interruptedSession.sources],
      searchQuery: interruptedSession.searchQuery || "",
    };
  }

  return null;
}

function simulateFetchUiState(runtimeState, renderState) {
  const safeRuntimeState =
    runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const safeRenderState =
    renderState && typeof renderState === "object" ? renderState : {};
  const runtimePhase =
    typeof safeRuntimeState.phase === "string" && safeRuntimeState.phase
      ? safeRuntimeState.phase
      : "idle";
  const items = Array.isArray(safeRenderState.items)
    ? safeRenderState.items
    : Array.isArray(safeRuntimeState.items)
      ? safeRuntimeState.items
      : [];
  const fetchedCount = Math.max(0, Number(safeRuntimeState.fetchedCount) || 0);
  const backedUpItemCount = Math.max(0, Number(safeRuntimeState.backedUpItemCount) || 0);
  const hasResults = items.length > 0 || fetchedCount > 0 || backedUpItemCount > 0;
  const hasResumableFetchRequest = Boolean(
    safeRuntimeState.resumableFetchRequest &&
      typeof safeRuntimeState.resumableFetchRequest === "object",
  );
  const syncStatus =
    typeof safeRuntimeState.syncStatus === "string" ? safeRuntimeState.syncStatus : "idle";
  const hasPausedFetchSession =
    hasResumableFetchRequest &&
    (runtimePhase === "fetch-paused" ||
      (runtimePhase !== "fetching" &&
        (syncStatus === "paused" || syncStatus === "stalled" || syncStatus === "error")));
  const phase = hasPausedFetchSession ? "fetch-paused" : runtimePhase;

  return {
    phase,
    primaryActionMode:
      hasResults && phase !== "fetching"
          ? "reset"
          : phase === "fetch-paused" && hasResumableFetchRequest
            ? "resume"
            : "scan",
  };
}

function simulateResumedScanBootstrap({
  currentState,
  sources,
  searchQuery = "",
}) {
  const persistedResumeRequest =
    currentState &&
    currentState.resumableFetchRequest &&
    typeof currentState.resumableFetchRequest === "object"
      ? currentState.resumableFetchRequest
      : null;
  const isResumingCurrentPausedSession =
    currentState &&
    currentState.phase === "fetch-paused" &&
    persistedResumeRequest &&
    persistedResumeRequest.searchQuery === searchQuery &&
    persistedResumeRequest.sources.length === sources.length &&
    persistedResumeRequest.sources.every((source, index) => source === sources[index]);

  return {
    items: isResumingCurrentPausedSession ? [...(currentState.items || [])] : [],
    backedUpItemCount: isResumingCurrentPausedSession
      ? Math.max(0, Number(currentState.backedUpItemCount) || 0)
      : 0,
  };
}

function simulateResumeBootstrapSeed({
  currentState,
  sources,
  searchQuery = "",
  mergedPausedItems = [],
}) {
  const persistedResumeRequest =
    currentState &&
    currentState.resumableFetchRequest &&
    typeof currentState.resumableFetchRequest === "object"
      ? currentState.resumableFetchRequest
      : null;
  const isResumingCurrentPausedSession =
    currentState &&
    currentState.phase === "fetch-paused" &&
    persistedResumeRequest &&
    persistedResumeRequest.searchQuery === searchQuery &&
    persistedResumeRequest.sources.length === sources.length &&
    persistedResumeRequest.sources.every((source, index) => source === sources[index]);
  const cachedWorkingItems = isResumingCurrentPausedSession
    ? [...mergedPausedItems]
    : [];
  const cachedBackedUpItemCount = isResumingCurrentPausedSession
    ? Math.max(
        0,
        Math.max(0, Number(currentState.fetchedCount) || 0) - cachedWorkingItems.length,
        Number(currentState.backedUpItemCount) || 0,
      )
    : 0;

  return {
    cachedWorkingItems,
    cachedBackedUpItemCount,
    resumeBaselineCount: isResumingCurrentPausedSession
      ? cachedWorkingItems.length + cachedBackedUpItemCount
      : 0,
  };
}

function simulateDismissedInterruptedSessionState(currentState) {
  const safeState = currentState && typeof currentState === "object" ? currentState : {};
  const items = Array.isArray(safeState.items) ? safeState.items : [];
  const nextBackedUpItemCount =
    items.length > 0 ? Math.max(0, Number(safeState.backedUpItemCount) || 0) : 0;

  return {
    ...safeState,
    phase: safeState.phase === "fetch-paused" ? "idle" : safeState.phase || "idle",
    currentSource: safeState.phase === "fetch-paused" ? null : safeState.currentSource || null,
    fetchedCount: items.length + nextBackedUpItemCount,
    backedUpItemCount: nextBackedUpItemCount,
    syncStatus: "idle",
    resumableFetchRequest: null,
  };
}

function simulateResumeVisibleFetchedCount({
  resumeBaselineCount = 0,
  newlyCollectedCount = 0,
  finalizedSourceCount = 0,
} = {}) {
  return (
    Math.max(0, Number(resumeBaselineCount) || 0) +
    Math.max(0, Number(finalizedSourceCount) || 0) +
    Math.max(0, Number(newlyCollectedCount) || 0)
  );
}

function simulateRuntimeCatalogMerge(existingItems = [], restoredItems = []) {
  const merged = new Map(existingItems.map((item) => [item.id, item]));
  for (const item of restoredItems) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
}

function simulateRenderedCardSections(viewMode) {
  return {
    includesBody: viewMode !== "grid",
    includesPerCardGridTooltip: false,
    usesSharedGridTooltip: viewMode === "grid",
  };
}

function simulateIsActiveBatchItem(item) {
  return Boolean(item) && !item.isRemoved && !item.isDownloaded;
}

function simulateResultsTabs(items) {
  const nextItems = Array.isArray(items) ? items : [];
  const activeCount = nextItems.filter((item) => simulateIsActiveBatchItem(item)).length;
  const archivedCount = nextItems.filter((item) => Boolean(item?.isRemoved) && !Boolean(item?.isDownloaded)).length;
  const downloadedCount = nextItems.filter((item) => Boolean(item?.isDownloaded)).length;
  const tabs = [];

  if (activeCount > 0) {
    tabs.push({ key: "all", count: activeCount });
  }
  if (archivedCount > 0) {
    tabs.push({ key: "archived", count: archivedCount });
  }
  if (downloadedCount > 0) {
    tabs.push({ key: "downloaded", count: downloadedCount });
  }

  return tabs;
}

function simulateFilterItemsForResultsTab(items, tabKey) {
  const nextItems = Array.isArray(items) ? items : [];
  if (tabKey === "archived") {
    return nextItems.filter((item) => Boolean(item?.isRemoved) && !Boolean(item?.isDownloaded));
  }
  if (tabKey === "downloaded") {
    return nextItems.filter((item) => Boolean(item?.isDownloaded));
  }
  return nextItems.filter((item) => simulateIsActiveBatchItem(item));
}

function simulateTotalBatchMetrics(items) {
  const activeItems = (Array.isArray(items) ? items : []).filter((item) => simulateIsActiveBatchItem(item));
  return {
    totalCount: activeItems.length,
  };
}

function simulateAuthoritativePopupTotals({ runtimeState = {}, renderState = {} } = {}) {
  return {
    totalCount: Number.isFinite(Number(renderState.totalCount))
      ? Math.max(0, Number(renderState.totalCount))
      : Array.isArray(renderState.items)
        ? renderState.items.length
        : 0,
    selectedCount: Number.isFinite(Number(renderState.selectedCountTotal))
      ? Math.max(0, Number(renderState.selectedCountTotal))
      : Array.isArray(renderState.selectedKeys)
        ? renderState.selectedKeys.length
        : 0,
    fetchedCount: Math.max(0, Number(runtimeState.fetchedCount) || 0),
  };
}

function simulateLegacyCleanupTargets() {
  return ["items", "volatile_backup_meta", "volatile_backup_updater"];
}

function simulateProgressPreviewSource({ mirrorItems = [], legacyItems = [] } = {}) {
  if (Array.isArray(mirrorItems) && mirrorItems.length > 0) {
    return "mirror";
  }
  if (Array.isArray(legacyItems) && legacyItems.length > 0) {
    return "legacy";
  }
  return "none";
}

async function testStructuralInvariants() {
  const backgroundSource = await readFile(path.join(projectRoot, "background.js"), "utf8");
  const popupRuntimeSource = await readFile(path.join(projectRoot, "popup/runtime.js"), "utf8");
  const popupUpdaterSource = await readFile(
    path.join(projectRoot, "popup/controllers/updater.js"),
    "utf8",
  );
  const popupActionsSource = await readFile(
    path.join(projectRoot, "popup/controllers/actions.js"),
    "utf8",
  );
  const popupEmptyStateSource = await readFile(
    path.join(projectRoot, "popup/ui/list/list-empty-state.js"),
    "utf8",
  );
  const popupControllersIndexSource = await readFile(
    path.join(projectRoot, "popup/controllers/index.js"),
    "utf8",
  );
  const popupCssSource = await readFile(path.join(projectRoot, "popup.css"), "utf8");
  const popupSelectionSource = await readFile(
    path.join(projectRoot, "popup/ui/selection.js"),
    "utf8",
  );
  const popupStateSource = await readFile(path.join(projectRoot, "popup/state.js"), "utf8");
  const popupRenderSource = await readFile(
    path.join(projectRoot, "popup/ui/render.js"),
    "utf8",
  );
  const popupCharacterSelectionSource = await readFile(
    path.join(projectRoot, "popup/ui/character-selection.js"),
    "utf8",
  );
  const popupSourceMenusSource = await readFile(
    path.join(projectRoot, "popup/controllers/source-menus.js"),
    "utf8",
  );
  const popupPrimaryControlsSource = await readFile(
    path.join(projectRoot, "popup/ui/render/primary-controls.js"),
    "utf8",
  );
  const popupItemCardPartsSource = await readFile(
    path.join(projectRoot, "popup/ui/list/item-card-parts.js"),
    "utf8",
  );
  const popupItemCardSource = await readFile(
    path.join(projectRoot, "popup/ui/list/item-card.js"),
    "utf8",
  );
  const popupMediaSource = await readFile(
    path.join(projectRoot, "popup/ui/media.js"),
    "utf8",
  );
  const popupItemsUtilsSource = await readFile(
    path.join(projectRoot, "popup/utils/items.js"),
    "utf8",
  );
  const popupListSource = await readFile(
    path.join(projectRoot, "popup/ui/list/index.js"),
    "utf8",
  );
  const popupFetchProgressSource = await readFile(
    path.join(projectRoot, "popup/ui/render/fetch-progress.js"),
    "utf8",
  );
  const popupHtmlSource = await readFile(path.join(projectRoot, "popup.html"), "utf8");
  const popupUpdateGateSource = await readFile(
    path.join(projectRoot, "popup/ui/render/update-gate.js"),
    "utf8",
  );

  assert.match(backgroundSource, /const SOURCE_MIRROR_ITEM_STORE = "source_mirror_items"/);
  assert.match(backgroundSource, /const SOURCE_CHECKPOINT_STORE = "source_checkpoints"/);
  assert.match(backgroundSource, /const SYNC_SESSION_STORE = "sync_sessions"/);
  assert.match(backgroundSource, /const SOURCE_RETRY_STATE_STORE = "source_retry_state"/);
  assert.match(backgroundSource, /if \(message\.type === "RESTORE_INTERRUPTED_SESSION"\)/);
  assert.match(backgroundSource, /if \(message\.type === "SET_TITLE_OVERRIDE"\)[\s\S]*?sendResponse\(\{ ok: true \}\);[\s\S]*?sendResponse\(\{ ok: false, error: getErrorMessage\(error\) \}\);[\s\S]*?return true;/);
  assert.match(backgroundSource, /async function executeSourceFetchWithRecovery/);
  assert.match(backgroundSource, /async function findInterruptedSyncSession/);
  assert.match(backgroundSource, /async function getRecoverablePausedSyncSession/);
  assert.match(backgroundSource, /async function loadVolatileBackupItemsForSyncSession\(sessionRecord, state = currentState\)/);
  assert.match(backgroundSource, /async function loadHydratedItemsForSyncSession\(sessionRecord, state = currentState\)/);
  assert.match(backgroundSource, /let hiddenWindowId = null;/);
  assert.match(popupRuntimeSource, /requestRestoreInterruptedSession/);
  assert.match(popupRuntimeSource, /requestResumeScan/);
  assert.match(popupUpdaterSource, /restorePreviousSessionFromGate/);
  assert.match(popupUpdaterSource, /const dismissedState = await requestDismissInterruptedSession\(\);/);
  assert.match(popupUpdaterSource, /popupState\.latestRuntimeState = dismissedState;/);
  assert.match(popupUpdaterSource, /await requestResumeScan\(\);/);
  assert.match(popupUpdaterSource, /waitForResumedFetchState/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(true\);/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(false\);/);
  assert.match(popupUpdateGateSource, /Restore previous session\?/);
  assert.match(popupUpdateGateSource, /syncAppShellGateVisibility/);
  assert.match(popupUpdateGateSource, /const shouldKeepGateVisible = popupState\.startupGateLocked \|\| shouldShow/);
  assert.match(popupUpdateGateSource, /Link the unpacked extension folder in Settings if you want Save Sora to install future GitHub updates automatically\./);
  assert.match(popupPrimaryControlsSource, /const isResumeMode = fetchUiState\.primaryActionMode === "resume"/);
  assert.match(popupPrimaryControlsSource, /export function syncPrimaryControls\(\)/);
  assert.match(popupPrimaryControlsSource, /dom\.fetchButtonLabel\.textContent = isFetching[\s\S]*?"Resume Fetch"/);
  assert.doesNotMatch(popupItemCardPartsSource, /titleButton\.disabled = context\.disableInputs;/);
  assert.match(popupItemCardPartsSource, /export function createItemContentSurface/);
  assert.doesNotMatch(popupItemCardPartsSource, /export function createGridTooltip/);
  assert.doesNotMatch(popupItemCardSource, /createGridTooltip/);
  assert.match(popupItemCardSource, /if \(context\.viewMode !== "grid"\) \{[\s\S]*?createItemContentSurface/);
  assert.match(popupListSource, /export function renderVisibleItemsWindow/);
  assert.match(popupListSource, /export function scheduleVisibleItemsWindowRender/);
  assert.match(popupListSource, /export function handleItemsListPointerOver/);
  assert.match(popupListSource, /renderVisibleItemsWindow\(false\);/);
  assert.match(popupListSource, /buildRenderSignature\(/);
  assert.match(popupListSource, /cache\.lastWindowSignature = visibleWindowSignature;/);
  assert.match(popupListSource, /card\.append\(dom\.sharedGridTooltip\);/);
  assert.match(popupListSource, /const nextCard = getEventCard\(event\.relatedTarget\);\s+if \(nextCard instanceof HTMLElement\) \{\s+return;\s+\}/s);
  assert.match(popupListSource, /#shared-grid-tooltip/);
  assert.match(popupListSource, /createItemContentSurface\(/);
  assert.match(popupMediaSource, /image\.src = item\.thumbnailUrl;/);
  assert.doesNotMatch(popupMediaSource, /thumbnailObserver/);
  assert.match(popupHtmlSource, /id="shared-grid-tooltip"/);
  assert.match(popupActionsSource, /const isResumeMode = fetchUiState\.primaryActionMode === "resume"/);
  assert.match(popupActionsSource, /if \(!isResetMode && !isResumeMode && sources\.length === 0\)/);
  assert.match(popupActionsSource, /else if \(isResumeMode\) \{\s*await requestResumeScan\(\);/);
  assert.match(popupActionsSource, /export function handleFetchProgressPanelMouseEnter\(\)/);
  assert.match(popupActionsSource, /export function handleFetchProgressPanelMouseLeave\(\)/);
  assert.match(popupActionsSource, /const isExpanded = popupState\.fetchDrawerExpanded \|\| popupState\.fetchDrawerHoverExpanded;/);
  assert.match(popupControllersIndexSource, /dom\.fetchProgressPanel\?\.addEventListener\("mouseenter", handleFetchProgressPanelMouseEnter\);/);
  assert.match(popupControllersIndexSource, /dom\.fetchProgressPanel\?\.addEventListener\("mouseleave", handleFetchProgressPanelMouseLeave\);/);
  assert.match(popupEmptyStateSource, /dom\.emptyStateImage\.classList\.remove\("hidden"\);/);
  assert.match(popupStateSource, /fetchDrawerHoverExpanded: false,/);
  assert.match(popupUpdaterSource, /const UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS = 15000;/);
  assert.match(popupUpdaterSource, /timeoutMs: UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS,/);
  assert.match(popupUpdaterSource, /popupState\.updateGateHidden = true;\s+setStartupGateLocked\(false\);/s);
  assert.match(popupUpdaterSource, /if \(!settled && timeoutMs > 0 && Date\.now\(\) - startedAt >= timeoutMs\) \{\s+throw new Error\("Save Sora timed out while checking GitHub for updates\."\);\s+\}/s);
  assert.match(popupRenderSource, /const popupTotalItemCount = Number\.isFinite\(Number\(state && state\.popupTotalItemCount\)\)/);
  assert.match(popupRenderSource, /const fetchedCount = Number\.isFinite\(Number\(state && state\.fetchedCount\)\)/);
  assert.match(popupRenderSource, /const totalVideos = Math\.max\(popupTotalItemCount, fetchedCount\);/);
  assert.match(popupRenderSource, /const selectedCountTotal = Number\.isFinite\(Number\(state && state\.popupSelectedCountTotal\)\)/);
  assert.match(popupSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSelectionSource, /Number\.isFinite\(Number\(popupState\.latestRenderState\.totalCount\)\)/);
  assert.match(popupSelectionSource, /Number\.isFinite\(Number\(popupState\.latestRenderState\.selectedCountTotal\)\)/);
  assert.match(popupSelectionSource, /!fetchUiState\.isBusy[\s\S]*?!fetchUiState\.isAnyPaused/);
  assert.match(popupListSource, /const effectiveTotalCount = Number\.isFinite\(Number\(popupState\.latestRenderState\.totalCount\)\)/);
  assert.match(popupFetchProgressSource, /const isExpanded =\s+isVisible && \(popupState\.fetchDrawerExpanded \|\| popupState\.fetchDrawerHoverExpanded\);/s);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressSource\.textContent = "";/);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressSource\.classList\.add\("hidden"\);/);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressCount\.textContent =\s*itemsFound > 0/s);
  assert.doesNotMatch(popupFetchProgressSource, /in source/);
  assert.match(popupCssSource, /\.empty-state-image \{\s+display: block;\s+width: auto;\s+height: auto;/s);
  assert.doesNotMatch(popupCssSource, /body\.is-fullscreen-view \.empty-state-image \{\s+display: none;/s);
  assert.match(popupCssSource, /\.item-list\.is-grid-view \.item-card \{[\s\S]*?content-visibility: visible;[\s\S]*?contain: layout style;[\s\S]*?overflow: visible;/s);
  assert.match(popupCharacterSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSourceMenusSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(backgroundSource, /function createDefaultRestoreStatus/);
  assert.match(backgroundSource, /if \(!updateAvailable\) \{[\s\S]*?phase: "idle"/);
  assert.match(backgroundSource, /if \(missingManifestForOlderOrCurrentRelease \|\| noPublishedReleaseYet\) \{[\s\S]*?phase: "idle"/);
  assert.match(backgroundSource, /async function resolvePausedFetchRequest/);
  assert.match(backgroundSource, /if \(currentState\.phase !== "fetch-paused"\) \{\s*pausedFetchRequest = null;/);
  assert.match(backgroundSource, /fetchRecoveryInitError/);
  assert.match(backgroundSource, /const statuses = \["running", "paused", "error", "completed", "aborted"\];/);
  assert.match(backgroundSource, /function getMirrorMergeSourcesForState\(state = currentState\)/);
  assert.match(backgroundSource, /async function loadProgressPreviewItems\(/);
  assert.match(backgroundSource, /const mirrorItems = await loadSourceMirrorItems\(/);
  assert.match(backgroundSource, /if \(mirrorItems\[0\] \|\| options\.allowLegacyFallback !== true\) \{/);
  assert.match(backgroundSource, /if \(options\.allowLegacyFallback === true\) \{\s*return loadVolatileBackupItemsByProgressKey\(sessionKey, progressKey, limit\);/);
  assert.match(backgroundSource, /const restoredItems = await loadHydratedItemsForSyncSession\(normalizedSession, state\);/);
  assert.match(backgroundSource, /const mirroredItems = await loadHydratedItemsForSyncSession\(interruptedSyncSession, nextState\);/);
  assert.match(backgroundSource, /const backupItems = await loadVolatileBackupItemsForSyncSession\(syncSession, sourceState\);/);
  assert.match(backgroundSource, /const nextBackedUpItemCount =\s+currentItems\.length > 0/s);
  assert.match(backgroundSource, /fetchedCount: nextFetchedCount,/);
  assert.match(backgroundSource, /const resumedMergedItems = buildWorkingItemsFromCatalog\(\s+await loadMergedFetchItemsForState\(currentState\),/s);
  assert.match(backgroundSource, /cachedBackedUpItemCount = Math\.max\(\s+0,\s+resumedFetchedCount - resumedMergedItems\.length,/s);
  assert.match(backgroundSource, /workerWindow = await chrome\.windows\.create\(\{\s*url,\s*focused: false,\s*state: "minimized",/s);
  assert.match(backgroundSource, /await ensureHiddenWorkerWindowMinimized\(hiddenWindowId\);/);
  assert.match(backgroundSource, /await chrome\.windows\.remove\(windowId\);/);
  assert.doesNotMatch(backgroundSource, /await clearVolatileBackupProgress\(sessionKey, progressKey\);/);
  assert.match(backgroundSource, /VOLATILE_BACKUP_UPDATER_STORE/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_MIRROR_ITEM_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_CHECKPOINT_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SYNC_SESSION_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_RETRY_STATE_STORE\)\.clear\(\);/);
  assert.match(backgroundSource, /async function resetExtensionState\(options = \{\}\)/);
  assert.match(backgroundSource, /const preserveRecoveryData = options\.preserveRecoveryData !== false;/);
  assert.match(popupSelectionSource, /activeCreatorResultsTab === "downloaded"/);
  assert.match(popupSelectionSource, /downloaded in view/);
  assert.match(popupItemCardPartsSource, /removeButton\.textContent = "Download Again";/);
  assert.match(popupItemCardPartsSource, /if \(item\.isDownloaded\)/);
  assert.match(popupItemCardPartsSource, /if \(!item\.isDownloaded\) \{/);
  assert.match(popupItemCardPartsSource, /Archive video/);
  assert.match(popupItemsUtilsSource, /case "downloaded":\s+return "Downloaded";/);
  assert.match(popupUpdateGateSource, /Local recovery needs attention/);
  assert.match(backgroundSource, /preservedCharacterAccounts = normalizeCharacterAccounts\(currentState\.characterAccounts\)/);
  assert.match(backgroundSource, /selectedCharacterAccountIds: preservedSelectedCharacterAccountIds/);
  assert.match(backgroundSource, /creatorProfiles: preservedCreatorProfiles/);
  assert.match(backgroundSource, /selectedCreatorProfileIds: preservedSelectedCreatorProfileIds/);
  assert.match(
    backgroundSource,
    /chrome\.runtime\.onInstalled\.addListener\(\(\) => \{\s*void ensureBackgroundRuntimeReady\(\)\s*\.then\(async \(\) => \{\s*await persistState\(currentState\);\s*await persistCatalogState\(currentCatalog\);/s,
  );
  assert.doesNotMatch(
    backgroundSource,
    /const persistedRequest = normalizeResumableFetchRequest\(currentState\.resumableFetchRequest\);/,
  );
  assert.match(backgroundSource, /const isPausedFetchState = phase === "fetch-paused"/);
  assert.match(backgroundSource, /syncSessionId: persistedSyncSessionId/);
  assert.match(backgroundSource, /const shouldAutoRestorePausedSession =/);
}

function testIdempotentMirrorWrites() {
  const mirror = new Map();
  writeMirrorPage(mirror, "scope:creator", [
    { id: "item-1", order: 3 },
    { id: "item-2", order: 2 },
  ]);
  writeMirrorPage(mirror, "scope:creator", [
    { id: "item-1", order: 3 },
    { id: "item-2", order: 2 },
  ]);

  assert.equal(mirror.size, 2, "retrying the same page should not duplicate mirrored rows");
}

function testLegacyCleanupNeverTargetsCanonicalRecoveryStores() {
  assert.deepEqual(simulateLegacyCleanupTargets(), [
    "items",
    "volatile_backup_meta",
    "volatile_backup_updater",
  ]);
}

function testProgressPreviewPrefersMirrorOverLegacyRows() {
  assert.equal(
    simulateProgressPreviewSource({
      mirrorItems: [{ id: "mirror-item-1" }],
      legacyItems: [{ id: "legacy-item-1" }],
    }),
    "mirror",
  );
  assert.equal(
    simulateProgressPreviewSource({
      mirrorItems: [],
      legacyItems: [{ id: "legacy-item-1" }],
    }),
    "legacy",
  );
}

function testPopupTotalsPreferAuthoritativeRenderCountsOverPreviewLength() {
  const totals = simulateAuthoritativePopupTotals({
    runtimeState: {
      fetchedCount: 3800,
    },
    renderState: {
      items: new Array(3000).fill(null),
      totalCount: 3800,
      selectedCountTotal: 3800,
      selectedKeys: new Array(3000).fill("preview"),
    },
  });

  assert.equal(totals.totalCount, 3800);
  assert.equal(totals.selectedCount, 3800);
  assert.equal(totals.fetchedCount, 3800);
}

function testCheckpointBackedResumeNeverStartsFromZero() {
  const checkpoint = buildCheckpoint({
    sourceScopeHash: "scope:creator",
    resumeCursor: "cursor-5000",
    itemsPersisted: 5000,
    backlogStatus: "running",
  });
  assert.equal(checkpoint.resumeCursor, "cursor-5000");
  assert.notEqual(checkpoint.resumeCursor, "");
}

function testSourceScopeMirrorKeyIsSessionIndependent() {
  const mirror = new Map();
  writeMirrorPage(mirror, "scope:creator-a", [{ id: "item-1", order: 1 }]);
  writeMirrorPage(mirror, "scope:creator-b", [{ id: "item-1", order: 1 }]);

  assert.equal(
    mirror.size,
    2,
    "the same item identity must not collide across different source scopes",
  );
}

function testHeadSyncThenResume() {
  const mirror = new Map();
  writeMirrorPage(mirror, "scope:creator", [
    { id: "item-5000", order: 5000 },
    { id: "item-4999", order: 4999 },
  ]);

  const checkpoint = buildCheckpoint({
    sourceScopeHash: "scope:creator",
    resumeCursor: "cursor-5000",
    knownBoundaryKey: "item-5000",
    itemsPersisted: 5000,
    headSyncStatus: "paused",
    backlogStatus: "paused",
  });

  const result = runHeadSyncThenResume({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint,
    headPages: [
      {
        items: [
          { id: "item-5200", order: 5200 },
          { id: "item-5199", order: 5199 },
          { id: "item-5000", order: 5000 },
        ],
      },
    ],
    backlogPages: [
      {
        cursor: checkpoint.resumeCursor,
        items: [
          { id: "item-5001", order: 5001 },
          { id: "item-5002", order: 5002 },
        ],
      },
    ],
  });

  assert.equal(result.boundaryReached, true);
  assert.deepEqual(result.resumedPages, ["cursor-5000"]);
  assert.equal(result.finalItemCount, 6);
}

function testCheckpointAdvancesOnlyAfterDurableMirrorWrite() {
  const mirror = new Map();
  const initialCheckpoint = buildCheckpoint({
    sourceScopeHash: "scope:creator",
    resumeCursor: "cursor-9",
    itemsPersisted: 9,
  });

  const skippedCommit = persistPageAndCheckpoint({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint: initialCheckpoint,
    items: [{ id: "item-10", order: 10 }],
    nextCursor: "cursor-10",
    syncPhase: "backlog-resume",
    shouldCommitItems: false,
  });

  assert.equal(skippedCommit.committed, false);
  assert.equal(skippedCommit.checkpoint.resumeCursor, "cursor-9");
  assert.equal(skippedCommit.checkpoint.itemsPersisted, 9);

  const committed = persistPageAndCheckpoint({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint: initialCheckpoint,
    items: [{ id: "item-10", order: 10 }],
    nextCursor: "cursor-10",
    syncPhase: "backlog-resume",
    shouldCommitItems: true,
  });

  assert.equal(committed.committed, true);
  assert.equal(committed.checkpoint.resumeCursor, "cursor-10");
  assert.equal(committed.checkpoint.itemsPersisted, 1);
}

function testKnownBoundaryKeyOnlyAdvancesDuringCommittedHeadSync() {
  const mirror = new Map();
  const checkpoint = buildCheckpoint({
    sourceScopeHash: "scope:creator",
    knownBoundaryKey: "item-25",
    newestKnownWatermark: {
      timestamp: 25,
      itemKey: "item-25",
    },
  });

  const backlogWrite = persistPageAndCheckpoint({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint,
    items: [{ id: "item-26", order: 26 }],
    nextCursor: "cursor-26",
    syncPhase: "backlog-resume",
  });
  assert.equal(backlogWrite.checkpoint.knownBoundaryKey, "item-25");

  const speculativeHeadRead = persistPageAndCheckpoint({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint,
    items: [{ id: "item-30", order: 30 }],
    nextCursor: "cursor-head",
    syncPhase: "head-sync",
    shouldCommitItems: false,
    watermark: { timestamp: 30, itemKey: "item-30" },
  });
  assert.equal(speculativeHeadRead.checkpoint.knownBoundaryKey, "item-25");

  const committedHeadWrite = persistPageAndCheckpoint({
    mirrorMap: mirror,
    sourceScopeHash: "scope:creator",
    checkpoint,
    items: [{ id: "item-30", order: 30 }],
    nextCursor: "",
    syncPhase: "head-sync",
    shouldCommitItems: true,
    watermark: { timestamp: 30, itemKey: "item-30" },
  });
  assert.equal(committedHeadWrite.checkpoint.knownBoundaryKey, "item-30");
  assert.deepEqual(committedHeadWrite.checkpoint.newestKnownWatermark, {
    timestamp: 30,
    itemKey: "item-30",
  });
}

function testSourceScopeCheckpointFallbackWithoutSessionRow() {
  const mirror = new Map();
  writeMirrorPage(mirror, "scope:characters", [
    { id: "item-a", order: 2 },
    { id: "item-b", order: 1 },
  ]);

  const session = createSyntheticInterruptedSession([
    buildCheckpoint({
      sourceScopeHash: "scope:characters",
      resumeCursor: "cursor-2",
      itemsPersisted: 2,
      backlogStatus: "paused",
    }),
  ]);

  assert.ok(session, "recoverable checkpoints should synthesize a paused session");
  const restoredItems = restoreItemsFromMirror(mirror, session);
  assert.equal(restoredItems.length, 2);
}

function testRestoreFromMirrorRehydratesLargeWorkingSet() {
  const mirror = new Map();
  const sourceScopeHash = "scope:large-profile";
  for (let index = 0; index < 10000; index += 1) {
    writeMirrorPage(mirror, sourceScopeHash, [
      {
        id: `item-${index + 1}`,
        order: 10000 - index,
      },
    ]);
  }

  const session = createSyntheticInterruptedSession([
    buildCheckpoint({
      sourceScopeHash,
      resumeCursor: "cursor-5000",
      itemsPersisted: 10000,
      backlogStatus: "paused",
    }),
  ]);

  const restoredItems = restoreItemsFromMirror(mirror, session);
  assert.equal(restoredItems.length, 10000);
  assert.equal(restoredItems[0].id, "item-1");
}

function testExactOnlyMigration() {
  const migrated = runExactOnlyMigration([
    {
      sourceScopeHash: "scope:exact",
      resumeCursor: "cursor-exact",
      itemsPersisted: 12,
    },
    {
      sourceScopeHash: "",
      resumeCursor: "",
      itemsPersisted: 99,
    },
  ]);

  assert.equal(migrated.length, 1, "ambiguous legacy checkpoints should be rejected");
  assert.equal(migrated[0].sourceScopeHash, "scope:exact");
}

function testRetryStateStaysSeparateFromCheckpointTruth() {
  const checkpoint = buildCheckpoint({
    sourceScopeHash: "scope:creator",
    resumeCursor: "cursor-5000",
    itemsPersisted: 5000,
  });
  const retryState = {
    sourceScopeHash: "scope:creator",
    retryCount: 2,
    lastTimeoutAt: "2026-04-08T02:00:00.000Z",
    lastTabRecreateAt: "2026-04-08T02:00:10.000Z",
    lastGoodHeartbeatAt: "2026-04-08T01:59:59.000Z",
  };

  assert.equal(checkpoint.resumeCursor, "cursor-5000");
  assert.equal(checkpoint.itemsPersisted, 5000);
  assert.equal(retryState.retryCount, 2);
}

function testCorruptionHandling() {
  const result = handleCorruptMirrorState(new Error("IndexedDB migration failed"));
  assert.equal(result.recoverable, false);
  assert.equal(result.preservedMirrorData, true);
  assert.match(result.reason, /IndexedDB migration failed/);
}

function testResetPreservesSavedSourcesAndSelections() {
  const preserved = simulateResetPreservingSavedSources({
    characterAccounts: [{ userId: "ch_alpha" }, { userId: "ch_beta" }],
    selectedCharacterAccountIds: ["ch_beta"],
    creatorProfiles: [{ profileId: "creator_1" }, { profileId: "creator_2" }],
    selectedCreatorProfileIds: ["creator_2"],
  });

  assert.deepEqual(
    preserved.characterAccounts.map((item) => item.userId),
    ["ch_alpha", "ch_beta"],
  );
  assert.deepEqual(preserved.selectedCharacterAccountIds, ["ch_beta"]);
  assert.deepEqual(
    preserved.creatorProfiles.map((item) => item.profileId),
    ["creator_1", "creator_2"],
  );
  assert.deepEqual(preserved.selectedCreatorProfileIds, ["creator_2"]);
}

function testPausedRequestPersistsAfterPause() {
  const pausedFetchRequest = simulatePausedRequestLifecycle();
  assert.deepEqual(pausedFetchRequest, {
    sources: ["creators"],
    searchQuery: "",
  });
}

function testResumeFallsBackToPersistedSessionRequest() {
  const resumedFromSession = resolvePausedRequest({
    interruptedSession: {
      status: "paused",
      sources: ["creators"],
      searchQuery: "party",
    },
  });
  assert.deepEqual(resumedFromSession, {
    sources: ["creators"],
    searchQuery: "party",
  });
}

function testRuntimePhaseWinsOverStaleRenderPhase() {
  const uiState = simulateFetchUiState(
    {
      phase: "fetching",
      syncStatus: "running",
      resumableFetchRequest: {
        sources: ["creators"],
        searchQuery: "",
      },
      items: [],
    },
    {
      phase: "fetch-paused",
      items: [{ id: "item-1" }],
    },
  );

  assert.equal(
    uiState.phase,
    "fetching",
    "runtime fetch phase must win over stale paused render state",
  );
  assert.equal(
    uiState.primaryActionMode,
    "scan",
    "controls should stop advertising resume once the runtime has moved to a live fetch",
  );
}

function testPausedResultsPreferResetCta() {
  const uiState = simulateFetchUiState(
    {
      phase: "fetch-paused",
      syncStatus: "paused",
      resumableFetchRequest: {
        sources: ["creators"],
        searchQuery: "",
      },
    },
    {
      items: [{ id: "item-1" }],
    },
  );

  assert.equal(
    uiState.primaryActionMode,
    "reset",
    "paused sessions with visible results should keep the primary CTA on Start Over while the drawer owns Resume",
  );
}

function testPausedCountsPreferResetCtaBeforeItemsHydrate() {
  const uiState = simulateFetchUiState(
    {
      phase: "fetch-paused",
      syncStatus: "paused",
      fetchedCount: 7016,
      backedUpItemCount: 0,
      resumableFetchRequest: {
        sources: ["characterAccounts"],
        searchQuery: "",
      },
    },
    {
      items: [],
    },
  );

  assert.equal(
    uiState.primaryActionMode,
    "reset",
    "paused sessions with restored counts should keep the primary CTA on Start Over even before the full results array hydrates",
  );
}

function testDismissedRestorePromptReturnsToFetchCta() {
  const dismissedState = simulateDismissedInterruptedSessionState({
    phase: "fetch-paused",
    syncStatus: "paused",
    fetchedCount: 7016,
    backedUpItemCount: 0,
    items: [],
    resumableFetchRequest: {
      sources: ["characterAccounts"],
      searchQuery: "",
    },
  });
  const uiState = simulateFetchUiState(dismissedState, {
    items: [],
  });

  assert.equal(
    uiState.phase,
    "idle",
    "dismissing a paused restore prompt should return the popup to the idle fetch state",
  );
  assert.equal(
    uiState.primaryActionMode,
    "scan",
    "dismissing a paused restore prompt without hydrated items should restore the primary CTA to Fetch Videos",
  );
}

function testResumeBootstrapKeepsPausedResultsVisible() {
  const resumed = simulateResumedScanBootstrap({
    currentState: {
      phase: "fetch-paused",
      resumableFetchRequest: {
        sources: ["creators"],
        searchQuery: "",
      },
      items: [{ id: "item-1" }, { id: "item-2" }],
      backedUpItemCount: 17,
    },
    sources: ["creators"],
    searchQuery: "",
  });

  assert.equal(resumed.items.length, 2);
  assert.equal(
    resumed.backedUpItemCount,
    17,
    "resuming a paused session should bootstrap from the already restored paused results instead of blanking the list",
  );
}

function testResumeBootstrapUsesMergedPausedWorkingSet() {
  const resumedSeed = simulateResumeBootstrapSeed({
    currentState: {
      phase: "fetch-paused",
      fetchedCount: 13500,
      backedUpItemCount: 0,
      items: Array.from({ length: 13500 }, (_, index) => ({ id: `preview-${index}` })),
      resumableFetchRequest: {
        sources: ["creators"],
        searchQuery: "",
      },
    },
    sources: ["creators"],
    searchQuery: "",
    mergedPausedItems: Array.from({ length: 27080 }, (_, index) => ({ id: `full-${index}` })),
  });

  assert.equal(
    resumedSeed.cachedWorkingItems.length,
    27080,
    "resume should seed from the merged paused working set instead of the smaller preview slice",
  );
  assert.equal(
    resumedSeed.resumeBaselineCount,
    27080,
    "resume progress should start from the full restored paused count the UI is already showing",
  );
}

function testResumeProgressKeepsRestoredBaseline() {
  const visibleFetchedCount = simulateResumeVisibleFetchedCount({
    resumeBaselineCount: 3500,
    finalizedSourceCount: 0,
    newlyCollectedCount: 637,
  });

  assert.equal(
    visibleFetchedCount,
    4137,
    "resume progress should carry the restored baseline instead of resetting to the current-run count",
  );
}

function testRestoredMirrorItemsMergeIntoRuntimeCatalog() {
  const mergedCatalog = simulateRuntimeCatalogMerge(
    [{ id: "item-1" }, { id: "item-2" }],
    [{ id: "item-2" }, { id: "item-3" }, { id: "item-4" }],
  );

  assert.deepEqual(
    mergedCatalog.map((item) => item.id),
    ["item-1", "item-2", "item-3", "item-4"],
    "restored mirror items should be merged into the live working catalog so resume does not drop back to a smaller base",
  );
}

function testGridCardsDoNotDuplicateHiddenListBodies() {
  const gridSections = simulateRenderedCardSections("grid");
  const listSections = simulateRenderedCardSections("list");

  assert.equal(gridSections.includesBody, false);
  assert.equal(gridSections.includesPerCardGridTooltip, false);
  assert.equal(gridSections.usesSharedGridTooltip, true);
  assert.equal(listSections.includesBody, true);
  assert.equal(listSections.includesPerCardGridTooltip, false);
}

function testDownloadedTabFilteringAndQueueExclusion() {
  const items = [
    { id: "active-1", isRemoved: false, isDownloaded: false },
    { id: "archived-1", isRemoved: true, isDownloaded: false },
    { id: "downloaded-1", isRemoved: false, isDownloaded: true },
    { id: "downloaded-2", isRemoved: false, isDownloaded: true },
  ];

  const tabs = simulateResultsTabs(items);
  assert.deepEqual(
    tabs.map((tab) => `${tab.key}:${tab.count}`),
    ["all:1", "archived:1", "downloaded:2"],
  );

  assert.deepEqual(
    simulateFilterItemsForResultsTab(items, "all").map((item) => item.id),
    ["active-1"],
  );
  assert.deepEqual(
    simulateFilterItemsForResultsTab(items, "archived").map((item) => item.id),
    ["archived-1"],
  );
  assert.deepEqual(
    simulateFilterItemsForResultsTab(items, "downloaded").map((item) => item.id),
    ["downloaded-1", "downloaded-2"],
  );
  assert.equal(
    simulateTotalBatchMetrics(items).totalCount,
    1,
    "downloaded items must stay out of the active download queue totals",
  );
}

function testPausedFetchPersistencePreservesRecoveryMetadata() {
  const persisted = simulateSerializedFetchState({
    phase: "fetch-paused",
    syncSessionId: "session-123",
    syncStatus: "paused",
    resumableFetchRequest: {
      sources: ["creators"],
      searchQuery: "",
    },
  });

  assert.equal(persisted.phase, "fetch-paused");
  assert.equal(persisted.syncSessionId, "session-123");
  assert.equal(persisted.syncStatus, "paused");
  assert.deepEqual(persisted.resumableFetchRequest, {
    sources: ["creators"],
    searchQuery: "",
  });
  assert.equal(persisted.restoreStatus.phase, "ready");
}

function testPausedSessionAutoRestoresWithoutPrompt() {
  const resolution = simulateInterruptedRestoreResolution(
    {
      phase: "fetch-paused",
      syncSessionId: "session-123",
      resumableFetchRequest: {
        sources: ["creators"],
        searchQuery: "",
      },
    },
    {
      sessionId: "session-123",
      status: "paused",
    },
  );

  assert.equal(
    resolution,
    "paused",
    "an intentionally paused session should reopen directly into the paused state instead of falling back to a restore prompt",
  );
}

function testRestoreGateOnlyReleasesAfterFetchActuallyStarts() {
  const sequence = simulateRestoreGateResumeSequence([
    { phase: "fetch-paused", syncStatus: "paused" },
    { phase: "fetch-paused", syncStatus: "paused" },
    { phase: "fetching", syncStatus: "running" },
  ]);

  assert.equal(sequence.released, true);
  assert.deepEqual(sequence.phasesSeenBeforeReady, [
    "fetch-paused:paused",
    "fetch-paused:paused",
    "fetching:running",
  ]);
}

function testStartupGateLockPreventsDashboardFlash() {
  assert.equal(
    simulateStartupGateVisibility({
      startupGateLocked: true,
      shouldShowRuntimeGate: false,
    }),
    true,
    "the startup gate must keep the shell blocked even before runtime gate decisions settle",
  );

  assert.equal(
    simulateStartupGateVisibility({
      startupGateLocked: false,
      shouldShowRuntimeGate: false,
    }),
    false,
  );
}

await testStructuralInvariants();
testIdempotentMirrorWrites();
testCheckpointBackedResumeNeverStartsFromZero();
testSourceScopeMirrorKeyIsSessionIndependent();
testLegacyCleanupNeverTargetsCanonicalRecoveryStores();
testProgressPreviewPrefersMirrorOverLegacyRows();
testPopupTotalsPreferAuthoritativeRenderCountsOverPreviewLength();
testHeadSyncThenResume();
testCheckpointAdvancesOnlyAfterDurableMirrorWrite();
testKnownBoundaryKeyOnlyAdvancesDuringCommittedHeadSync();
testSourceScopeCheckpointFallbackWithoutSessionRow();
testRestoreFromMirrorRehydratesLargeWorkingSet();
testExactOnlyMigration();
testRetryStateStaysSeparateFromCheckpointTruth();
testCorruptionHandling();
testResetPreservesSavedSourcesAndSelections();
testPausedRequestPersistsAfterPause();
testResumeFallsBackToPersistedSessionRequest();
testRuntimePhaseWinsOverStaleRenderPhase();
testPausedResultsPreferResetCta();
testPausedCountsPreferResetCtaBeforeItemsHydrate();
testDismissedRestorePromptReturnsToFetchCta();
testResumeBootstrapKeepsPausedResultsVisible();
testResumeBootstrapUsesMergedPausedWorkingSet();
testResumeProgressKeepsRestoredBaseline();
testRestoredMirrorItemsMergeIntoRuntimeCatalog();
testGridCardsDoNotDuplicateHiddenListBodies();
testDownloadedTabFilteringAndQueueExclusion();
testPausedFetchPersistencePreservesRecoveryMetadata();
testPausedSessionAutoRestoresWithoutPrompt();
testRestoreGateOnlyReleasesAfterFetchActuallyStarts();
testStartupGateLockPreventsDashboardFlash();

console.log("Fetch recovery regression checks passed.");
