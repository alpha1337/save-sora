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
  const popupSelectionSource = await readFile(
    path.join(projectRoot, "popup/ui/selection.js"),
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
  const popupListSource = await readFile(
    path.join(projectRoot, "popup/ui/list/index.js"),
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
  assert.match(popupRuntimeSource, /requestRestoreInterruptedSession/);
  assert.match(popupRuntimeSource, /requestResumeScan/);
  assert.match(popupUpdaterSource, /restorePreviousSessionFromGate/);
  assert.match(popupUpdaterSource, /await requestResumeScan\(\);/);
  assert.match(popupUpdaterSource, /waitForResumedFetchState/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(true\);/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(false\);/);
  assert.match(popupUpdateGateSource, /Restore previous session\?/);
  assert.match(popupUpdateGateSource, /syncAppShellGateVisibility/);
  assert.match(popupUpdateGateSource, /const shouldKeepGateVisible = popupState\.startupGateLocked \|\| shouldShow/);
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
  assert.match(popupListSource, /#shared-grid-tooltip/);
  assert.match(popupListSource, /createItemContentSurface\(/);
  assert.match(popupMediaSource, /image\.src = item\.thumbnailUrl;/);
  assert.doesNotMatch(popupMediaSource, /thumbnailObserver/);
  assert.match(popupHtmlSource, /id="shared-grid-tooltip"/);
  assert.match(popupActionsSource, /const isResumeMode = fetchUiState\.primaryActionMode === "resume"/);
  assert.match(popupActionsSource, /if \(!isResetMode && !isResumeMode && sources\.length === 0\)/);
  assert.match(popupActionsSource, /else if \(isResumeMode\) \{\s*await requestResumeScan\(\);/);
  assert.match(popupSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSelectionSource, /!fetchUiState\.isBusy[\s\S]*?!fetchUiState\.isAnyPaused/);
  assert.match(popupCharacterSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSourceMenusSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(backgroundSource, /function createDefaultRestoreStatus/);
  assert.match(backgroundSource, /async function resolvePausedFetchRequest/);
  assert.match(backgroundSource, /if \(currentState\.phase !== "fetch-paused"\) \{\s*pausedFetchRequest = null;/);
  assert.match(backgroundSource, /fetchRecoveryInitError/);
  assert.match(backgroundSource, /const statuses = \["running", "paused", "error", "completed", "aborted"\];/);
  assert.match(backgroundSource, /storedItems = await loadSourceMirrorItems\(sourceScope\.sourceScopeHash, itemLimit\);/);
  assert.match(backgroundSource, /async function resetExtensionState\(options = \{\}\)/);
  assert.match(backgroundSource, /const preserveRecoveryData = options\.preserveRecoveryData !== false;/);
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
testResumeBootstrapKeepsPausedResultsVisible();
testResumeProgressKeepsRestoredBaseline();
testRestoredMirrorItemsMergeIntoRuntimeCatalog();
testGridCardsDoNotDuplicateHiddenListBodies();
testPausedFetchPersistencePreservesRecoveryMetadata();
testPausedSessionAutoRestoresWithoutPrompt();
testRestoreGateOnlyReleasesAfterFetchActuallyStarts();
testStartupGateLockPreventsDashboardFlash();

console.log("Fetch recovery regression checks passed.");
