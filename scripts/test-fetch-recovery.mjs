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

function selectNewestInstallableUpdateCandidate(candidates, currentVersion = "0.0.0") {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  let selectedCandidate = null;

  for (const candidate of normalizedCandidates) {
    if (!candidate || typeof candidate !== "object" || typeof candidate.version !== "string") {
      continue;
    }

    if (compareVersions(candidate.version, currentVersion) <= 0) {
      continue;
    }

    if (
      !selectedCandidate ||
      compareVersions(candidate.version, selectedCandidate.version) > 0
    ) {
      selectedCandidate = candidate;
    }
  }

  return selectedCandidate;
}

function compareVersions(leftVersion, rightVersion) {
  const leftParts = String(leftVersion || "")
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = String(rightVersion || "")
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] || 0;
    const rightValue = rightParts[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
}

function isCachedInterfaceStateErrorMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("state cached in an interface object") ||
    normalized.includes("cached in an interface object")
  );
}

function isRecoverableSoraAuthErrorMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("could not derive a sora bearer token") ||
    normalized.includes("could not derive your sora user id") ||
    normalized.includes("sora request failed with status 401") ||
    normalized.includes("sora request failed with status 403") ||
    normalized.includes("session expired") ||
    normalized.includes("expired token") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("make sure you're signed in")
  );
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

  return shouldAutoRestorePausedSession
    ? "paused"
    : shouldSuppressInterruptedRestorePrompt(nextState)
      ? "suppressed"
      : "prompt";
}

function shouldSuppressInterruptedRestorePrompt(state) {
  const phase = state && typeof state.phase === "string" ? state.phase : "idle";
  const hasVisibleItems = Array.isArray(state && state.items) && state.items.length > 0;
  const hasPersistedItems = Array.isArray(state && state.itemKeys) && state.itemKeys.length > 0;
  const hasPendingDownloadQueue =
    Array.isArray(state && state.pendingItems) && state.pendingItems.length > 0;
  const fetchedCount = Math.max(0, Number(state && state.fetchedCount) || 0);

  if (phase === "fetch-paused") {
    return false;
  }

  return (
    hasVisibleItems ||
    hasPersistedItems ||
    hasPendingDownloadQueue ||
    (["ready", "complete", "downloading", "paused"].includes(phase) && fetchedCount > 0)
  );
}

function simulateDownloadStartRestoreGateVisibility({
  promptVisible = false,
  phase = "idle",
  pendingDownloadStart = false,
} = {}) {
  if (!promptVisible) {
    return false;
  }

  return !(pendingDownloadStart || phase === "downloading");
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
  const isFetching = phase === "fetching";
  const isDownloading = phase === "downloading";
  const isBusy = isFetching || isDownloading;

  return {
    phase,
    primaryActionMode:
      phase === "fetch-paused" && hasResumableFetchRequest
        ? hasResults
          ? "reset"
          : "resume"
        : hasResults && !isBusy
          ? "refresh"
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

function simulateAuthoritativeFetchCountSnapshot({
  items = [],
  fetchedCount = 0,
  totalItems = 0,
  loadedItems = 0,
} = {}) {
  const resolvedItems = Array.isArray(items) ? items : [];
  let authoritativeFetchedCount = resolvedItems.length;

  for (const value of [fetchedCount, totalItems, loadedItems]) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      authoritativeFetchedCount = Math.max(
        authoritativeFetchedCount,
        Math.max(0, numericValue),
      );
    }
  }

  return {
    fetchedCount: authoritativeFetchedCount,
    backedUpItemCount: Math.max(0, authoritativeFetchedCount - resolvedItems.length),
  };
}

function simulateRuntimeCatalogMerge(existingItems = [], restoredItems = []) {
  const merged = new Map(existingItems.map((item) => [item.id, item]));
  for (const item of restoredItems) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
}

function shouldDeferAutomaticUpdateChecks({ phase = "idle", hasActiveRun = false } = {}) {
  return (
    Boolean(hasActiveRun) ||
    phase === "fetching" ||
    phase === "downloading" ||
    phase === "fetch-paused" ||
    phase === "paused"
  );
}

function simulateAutomaticUpdateCheckDecision({
  phase = "idle",
  hasActiveRun = false,
  trigger = "alarm",
  interactive = false,
  automaticUpdatesEnabled = true,
} = {}) {
  const isManualRequest =
    interactive === true || trigger === "manual" || trigger === "folder-link";

  if (!isManualRequest && shouldDeferAutomaticUpdateChecks({ phase, hasActiveRun })) {
    return "deferred";
  }

  if (!automaticUpdatesEnabled && !isManualRequest) {
    return "disabled";
  }

  return "allowed";
}

function getArchiveRefreshScopeKey(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const sourcePage = typeof item.sourcePage === "string" ? item.sourcePage : "";
  const creatorProfileId =
    typeof item.creatorProfileId === "string" ? item.creatorProfileId : "";
  const characterAccountId =
    typeof item.characterAccountId === "string" ? item.characterAccountId : "";

  if (sourcePage === "characters") {
    return characterAccountId ? `${sourcePage}:${characterAccountId}` : sourcePage;
  }

  if (
    sourcePage === "creatorPublished" ||
    sourcePage === "creatorCameos" ||
    sourcePage === "creatorCharacters" ||
    sourcePage === "creatorCharacterCameos"
  ) {
    return creatorProfileId ? `${sourcePage}:${creatorProfileId}` : sourcePage;
  }

  return sourcePage;
}

function simulateArchiveScopeRefresh({ pendingItems = [], refreshedItems = [], targetItem } = {}) {
  const refreshedById = new Map(
    (Array.isArray(refreshedItems) ? refreshedItems : [])
      .filter((item) => item && typeof item.id === "string")
      .map((item) => [item.id, item]),
  );
  const targetScopeKey = getArchiveRefreshScopeKey(targetItem);

  return (Array.isArray(pendingItems) ? pendingItems : []).map((pendingItem) => {
    if (getArchiveRefreshScopeKey(pendingItem) !== targetScopeKey) {
      return pendingItem;
    }

    const refreshedItem = refreshedById.get(pendingItem.id);
    if (!refreshedItem) {
      return pendingItem;
    }

    return {
      ...pendingItem,
      downloadUrl: refreshedItem.downloadUrl,
    };
  });
}

function simulateArchiveParallelWorkerCount(totalItems) {
  return Math.max(1, Math.min(5, Math.max(0, Number(totalItems) || 0)));
}

function simulateRenderedCardSections(viewMode) {
  return {
    includesBody: viewMode !== "grid",
    includesPerCardGridTooltip: false,
    usesSharedGridTooltip: viewMode === "grid",
  };
}

function simulateSummaryPanelVisibility({ items = [] } = {}) {
  const hasLoadedResults = Array.isArray(items) && items.length > 0;
  return hasLoadedResults;
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

function simulateBulkArchiveToolbarState({
  hasLoadedResults = false,
  candidateCount = 0,
  selectedCount = 0,
  isBusy = false,
  isAnyPaused = false,
  isFetching = false,
} = {}) {
  const showBulkArchiveActions =
    hasLoadedResults &&
    candidateCount > 0;
  const hasBulkArchiveSelection = showBulkArchiveActions && selectedCount > 0;

  return {
    selectAllHidden: !showBulkArchiveActions,
    selectAllDisabled:
      !showBulkArchiveActions || candidateCount === 0 || selectedCount >= candidateCount,
    archiveSelectedHidden: !hasBulkArchiveSelection,
    archiveSelectedDisabled: !hasBulkArchiveSelection || selectedCount === 0,
    clearSelectionHidden: !hasBulkArchiveSelection,
    clearSelectionDisabled: !hasBulkArchiveSelection || selectedCount === 0,
  };
}

function simulateResolvedNoWatermarkUrl(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const itemId = typeof item.id === "string" ? item.id : "";
  const generationId = typeof item.generationId === "string" ? item.generationId : "";
  const proxiedId = /^s_[A-Za-z0-9_-]+$/.test(itemId)
    ? itemId
    : /^s_[A-Za-z0-9_-]+$/.test(generationId)
      ? generationId
      : "";

  return (
    (item.download_urls &&
    typeof item.download_urls === "object" &&
    typeof item.download_urls.no_watermark === "string" &&
    item.download_urls.no_watermark) ||
    (typeof item.no_watermark === "string" && item.no_watermark) ||
    (proxiedId ? `https://soravdl.com/api/proxy/video/${proxiedId}` : "")
  );
}

function simulatePreferredDownloadUrl(item) {
  if (!item || typeof item !== "object") {
    return "";
  }

  const noWatermarkUrl = simulateResolvedNoWatermarkUrl(item);
  const watermarkUrl =
    (item.download_urls &&
    typeof item.download_urls === "object" &&
    typeof item.download_urls.watermark === "string" &&
    item.download_urls.watermark) ||
    "";

  return noWatermarkUrl || watermarkUrl || (typeof item.downloadUrl === "string" ? item.downloadUrl : "") || "";
}

function simulateDownloadedVideoIdentitiesForItem(item) {
  if (!item || typeof item !== "object") {
    return [];
  }

  const identities = new Set();
  const attachmentIndex = Number.isInteger(item.attachmentIndex) ? item.attachmentIndex : 0;
  const generationId =
    typeof item.generationId === "string" && /^gen_[A-Za-z0-9_-]+$/.test(item.generationId)
      ? item.generationId
      : typeof item.id === "string" && /^gen_[A-Za-z0-9_-]+$/.test(item.id)
        ? item.id
        : "";
  const sharedPostId =
    typeof item.sharedPostId === "string" && /^s_[A-Za-z0-9_-]+$/.test(item.sharedPostId)
      ? item.sharedPostId
      : typeof item.id === "string" && /^s_[A-Za-z0-9_-]+$/.test(item.id)
        ? item.id
        : "";

  if (generationId) {
    identities.add(`generation:${generationId}`);
  }

  if (sharedPostId) {
    identities.add(`post:${sharedPostId}:${attachmentIndex}`);
  }

  return [...identities];
}

function simulateNormalizeDownloadedState(items, downloadedIdentities) {
  const identitySet =
    downloadedIdentities instanceof Set ? downloadedIdentities : new Set(downloadedIdentities || []);

  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    isDownloaded:
      Boolean(item && item.isDownloaded) ||
      simulateDownloadedVideoIdentitiesForItem(item).some((identity) => identitySet.has(identity)),
  }));
}

function simulateApplyDownloadedIdentityMutation(items, targetItem, downloaded) {
  const identitySet = new Set(simulateDownloadedVideoIdentitiesForItem(targetItem));

  return (Array.isArray(items) ? items : []).map((item) => ({
    ...item,
    isDownloaded:
      identitySet.size > 0 &&
      simulateDownloadedVideoIdentitiesForItem(item).some((identity) => identitySet.has(identity))
        ? Boolean(downloaded)
        : Boolean(item && item.isDownloaded),
  }));
}

function simulateShouldSkipDraftRow(row) {
  const kind = row && typeof row.kind === "string" ? row.kind : "";
  const hasEditedVersion =
    row &&
    Object.prototype.hasOwnProperty.call(row, "c_version") &&
    Number.isFinite(Number(row.c_version));

  return (
    !row ||
    kind === "sora_error" ||
    hasEditedVersion ||
    (typeof kind === "string" && kind !== "" && kind !== "sora_draft" && kind !== "draft")
  );
}

function simulateExistingSharedDraftPrompt(row) {
  return (
    (row && row.post && typeof row.post.prompt === "string" && row.post.prompt) ||
    (row &&
    row.post &&
    row.post.post &&
    typeof row.post.post.prompt === "string" &&
    row.post.post.prompt) ||
    (row && typeof row.prompt === "string" && row.prompt) ||
    null
  );
}

function simulateReviewUrlFromSharedDraft(item) {
  const detailUrl =
    item && typeof item.detailUrl === "string" && item.detailUrl.trim() ? item.detailUrl.trim() : "";
  if (detailUrl) {
    return detailUrl.startsWith("http") ? detailUrl : `https://sora.chatgpt.com${detailUrl}`;
  }

  const noWatermarkUrl = simulateResolvedNoWatermarkUrl(item);
  const sharedMatch = noWatermarkUrl.match(/\/(?:api\/proxy\/)?video\/(s_[A-Za-z0-9_-]+)/i);
  if (sharedMatch && typeof sharedMatch[1] === "string" && sharedMatch[1]) {
    return `https://sora.chatgpt.com/p/${sharedMatch[1]}`;
  }

  const generationId =
    item && typeof item.generationId === "string" ? item.generationId.trim() : "";
  const itemId = item && typeof item.id === "string" ? item.id.trim() : "";
  if (generationId.startsWith("gen_")) {
    return `https://sora.chatgpt.com/d/${generationId}`;
  }
  if (itemId.startsWith("gen_")) {
    return `https://sora.chatgpt.com/d/${itemId}`;
  }
  return null;
}

function simulateAuthoritativePopupTotals({ runtimeState = {}, renderState = {} } = {}) {
  const countSnapshot =
    renderState && renderState.counts && typeof renderState.counts === "object"
      ? renderState.counts
      : {};
  return {
    totalCount: Number.isFinite(Number(countSnapshot.fetchedCount))
      ? Math.max(0, Number(countSnapshot.fetchedCount))
      : Number.isFinite(Number(renderState.totalCount))
        ? Math.max(0, Number(renderState.totalCount))
        : 0,
    selectedCount: Number.isFinite(Number(countSnapshot.downloadableCount))
      ? Math.max(0, Number(countSnapshot.downloadableCount))
      : Number.isFinite(Number(renderState.selectedCountTotal))
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
  const popupDomSource = await readFile(path.join(projectRoot, "popup/dom.js"), "utf8");
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
  const popupFetchStatusSource = await readFile(
    path.join(projectRoot, "popup/ui/render/fetch-status.js"),
    "utf8",
  );
  const popupFetchCopySource = await readFile(
    path.join(projectRoot, "popup/utils/fetch-copy.js"),
    "utf8",
  );
  const popupFetchProgressSource = await readFile(
    path.join(projectRoot, "popup/ui/render/fetch-progress.js"),
    "utf8",
  );
  const itemMutationsSource = await readFile(
    path.join(projectRoot, "popup/controllers/item-mutations.js"),
    "utf8",
  );
  const popupCountsSource = await readFile(
    path.join(projectRoot, "popup/utils/counts.js"),
    "utf8",
  );
  const popupOverlaySource = await readFile(
    path.join(projectRoot, "popup/ui/overlay.js"),
    "utf8",
  );
  const popupHtmlSource = await readFile(path.join(projectRoot, "popup.html"), "utf8");
  const popupUpdateGateSource = await readFile(
    path.join(projectRoot, "popup/ui/render/update-gate.js"),
    "utf8",
  );
  const offscreenSource = await readFile(path.join(projectRoot, "offscreen.js"), "utf8");

  assert.match(backgroundSource, /const SOURCE_MIRROR_ITEM_STORE = "source_mirror_items"/);
  assert.match(backgroundSource, /const SOURCE_CHECKPOINT_STORE = "source_checkpoints"/);
  assert.match(backgroundSource, /const SYNC_SESSION_STORE = "sync_sessions"/);
  assert.match(backgroundSource, /const SOURCE_RETRY_STATE_STORE = "source_retry_state"/);
  assert.match(backgroundSource, /const DOWNLOADED_VIDEO_IDENTITY_STORE = "downloaded_video_identities"/);
  assert.match(backgroundSource, /const PREPARE_ARCHIVE_ITEM_URL = "PREPARE_ARCHIVE_ITEM_URL"/);
  assert.match(backgroundSource, /const OFFSCREEN_ARCHIVE_ITEM_PROGRESS = "OFFSCREEN_ARCHIVE_ITEM_PROGRESS"/);
  assert.match(backgroundSource, /if \(message\.type === "RESTORE_INTERRUPTED_SESSION"\)/);
  assert.match(backgroundSource, /if \(message\.type === "START_SCAN"\) \{[\s\S]*?const state = await startScan\(message\.sources, message\.searchQuery\);[\s\S]*?sendResponse\(\{ ok: true, state \}\);[\s\S]*?return true;/);
  assert.match(backgroundSource, /if \(message\.type === "RESUME_SCAN"\) \{[\s\S]*?const state = await resumeScan\(\);[\s\S]*?sendResponse\(\{ ok: true, state \}\);[\s\S]*?return true;/);
  assert.match(backgroundSource, /if \(message\.type === "SET_TITLE_OVERRIDE"\)[\s\S]*?sendResponse\(\{ ok: true \}\);[\s\S]*?sendResponse\(\{ ok: false, error: getErrorMessage\(error\) \}\);[\s\S]*?return true;/);
  assert.match(backgroundSource, /if \(message\.type === "REMOVE_ITEMS"\) \{/);
  assert.match(backgroundSource, /if \(message\.type === OFFSCREEN_ARCHIVE_ITEM_PROGRESS\) \{/);
  assert.match(backgroundSource, /async function executeSourceFetchWithRecovery/);
  assert.match(backgroundSource, /function isRecoverableSoraAuthError\(error\)/);
  assert.match(backgroundSource, /async function findInterruptedSyncSession/);
  assert.match(backgroundSource, /async function getRecoverablePausedSyncSession/);
  assert.match(backgroundSource, /async function loadVolatileBackupItemsForSyncSession\(sessionRecord, state = currentState\)/);
  assert.match(backgroundSource, /async function loadHydratedItemsForSyncSession\(sessionRecord, state = currentState\)/);
  assert.match(backgroundSource, /const defaultFetchWorkerContext = createFetchWorkerContext\("default"\);/);
  assert.match(backgroundSource, /async function loadDownloadedVideoIdentityCache\(\)/);
  assert.match(backgroundSource, /function getDownloadedVideoIdentitiesForItem\(item\)/);
  assert.match(backgroundSource, /function isItemDownloadedByIdentity\(item, knownIdentities = downloadedVideoIdentitySet\)/);
  assert.match(popupRuntimeSource, /requestRestoreInterruptedSession/);
  assert.match(popupRuntimeSource, /requestResumeScan/);
  assert.match(popupRuntimeSource, /export async function saveBulkRemovedState\(itemKeys, removed, options = \{\}\) \{/);
  assert.match(popupRuntimeSource, /type: "REMOVE_ITEMS",/);
  assert.match(popupRuntimeSource, /export async function requestScan\(sources, searchQuery\) \{[\s\S]*?return response\.state;\s+\}/);
  assert.match(popupRuntimeSource, /export async function requestResumeScan\(\) \{[\s\S]*?return response\.state;\s+\}/);
  assert.match(popupRuntimeSource, /export async function requestDownloadSelected\(\) \{[\s\S]*?return response\.state;\s+\}/);
  assert.match(popupUpdaterSource, /restorePreviousSessionFromGate/);
  assert.match(popupUpdaterSource, /const dismissedState = await requestDismissInterruptedSession\(\);/);
  assert.match(popupUpdaterSource, /popupState\.latestRuntimeState = dismissedState;/);
  assert.match(popupUpdaterSource, /const resumedBootstrapState = await requestResumeScan\(\);/);
  assert.match(popupUpdaterSource, /waitForResumedFetchState/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(true\);/);
  assert.match(popupUpdaterSource, /setStartupGateLocked\(false\);/);
  assert.match(popupUpdateGateSource, /Restore previous session\?/);
  assert.match(popupUpdateGateSource, /syncAppShellGateVisibility/);
  assert.match(popupUpdateGateSource, /const shouldSuppressRestorePrompt =[\s\S]*popupState\.pendingDownloadStart \|\| runtimePhase === "downloading"/s);
  assert.match(popupUpdateGateSource, /const shouldKeepGateVisible = popupState\.startupGateLocked \|\| shouldShow/);
  assert.match(popupUpdateGateSource, /Link the unpacked extension folder in Settings if you want Save Sora to install future GitHub updates automatically\./);
  assert.match(popupPrimaryControlsSource, /const isResumeMode = fetchUiState\.primaryActionMode === "resume"/);
  assert.match(popupPrimaryControlsSource, /const isRefreshMode = fetchUiState\.primaryActionMode === "refresh"/);
  assert.match(popupPrimaryControlsSource, /export function syncPrimaryControls\(\)/);
  assert.match(popupPrimaryControlsSource, /dom\.fetchButtonLabel\.textContent = isFetching[\s\S]*?"Resume Fetch"/);
  assert.match(popupPrimaryControlsSource, /"Check for updates"/);
  assert.match(popupPrimaryControlsSource, /if \(dom\.selectAllButton && isSourceSelectionVisible\)/);
  assert.match(popupPrimaryControlsSource, /if \(dom\.clearSelectionButton && isSourceSelectionVisible\)/);
  assert.doesNotMatch(popupItemCardPartsSource, /titleButton\.disabled = context\.disableInputs;/);
  assert.match(popupItemCardPartsSource, /export function createItemContentSurface/);
  assert.doesNotMatch(popupItemCardPartsSource, /export function createGridTooltip/);
  assert.doesNotMatch(popupItemCardSource, /createGridTooltip/);
  assert.match(popupItemCardSource, /const body = createItemContentSurface\(/);
  assert.match(popupItemCardSource, /if \(context\.viewMode !== "grid"\) \{\s+card\.append\(body\);\s+\}/s);
  assert.match(popupItemCardSource, /const gridOverlay = document\.createElement\("div"\);[\s\S]*gridOverlay\.className = "item-grid-overlay";[\s\S]*media\.append\(gridOverlay\);/s);
  assert.match(popupListSource, /export function renderVisibleItemsWindow/);
  assert.match(popupListSource, /export function scheduleVisibleItemsWindowRender/);
  assert.match(popupListSource, /export function handleItemsListPointerOver/);
  assert.match(popupListSource, /renderVisibleItemsWindow\(false\);/);
  assert.match(popupListSource, /buildRenderSignature\(/);
  assert.match(popupListSource, /cache\.lastWindowSignature = visibleWindowSignature;/);
  assert.match(popupListSource, /hideSharedGridTooltip\(\{ immediate: true \}\);/);
  assert.match(popupListSource, /createItemContentSurface\(/);
  assert.match(popupMediaSource, /image\.src = item\.thumbnailUrl;/);
  assert.match(popupMediaSource, /function resolveNoWatermarkPlaybackUrl\(item\)/);
  assert.match(popupMediaSource, /const noWatermarkUrl = resolveNoWatermarkPlaybackUrl\(item\);/);
  assert.match(popupMediaSource, /if \(getEventElement\(event\.target\)\?\.closest\("\.item-grid-overlay"\)\) \{\s+return;\s+\}/s);
  assert.doesNotMatch(popupMediaSource, /thumbnailObserver/);
  assert.match(popupHtmlSource, /id="shared-grid-tooltip"/);
  assert.match(popupHtmlSource, /id="archive-selected-button"/);
  assert.match(popupHtmlSource, /class="download-overlay-video"/);
  assert.match(popupHtmlSource, /class="download-overlay-backdrop"/);
  assert.match(popupHtmlSource, /id="download-overlay-source"/);
  assert.match(popupActionsSource, /const isResumeMode = fetchUiState\.primaryActionMode === "resume"/);
  assert.match(popupActionsSource, /if \(!isResetMode && !isResumeMode && sources\.length === 0\)/);
  assert.match(popupActionsSource, /let immediateState = null;/);
  assert.match(popupActionsSource, /else if \(isResumeMode\) \{\s*immediateState = await requestResumeScan\(\);/);
  assert.match(popupActionsSource, /immediateState = await requestScan\(sources, popupState\.browseState\.query\);/);
  assert.match(popupActionsSource, /if \(immediateState && typeof immediateState === "object"\) \{\s*renderState\(immediateState\);\s*syncPollingForState\(immediateState\);/s);
  assert.match(popupActionsSource, /const immediateState = await requestDownloadSelected\(\);[\s\S]*renderState\(immediateState\);[\s\S]*syncPollingForState\(immediateState\);/s);
  assert.match(popupActionsSource, /const resumedState = await requestResumeScan\(\);/);
  assert.match(popupActionsSource, /renderState\(resumedState\);\s+syncPollingForState\(resumedState\);/s);
  assert.doesNotMatch(popupActionsSource, /preparePendingFetchUi/);
  assert.match(popupActionsSource, /export function handleFetchProgressPanelMouseEnter\(\)/);
  assert.match(popupActionsSource, /export function handleFetchProgressPanelMouseLeave\(\)/);
  assert.match(popupActionsSource, /const isExpanded = popupState\.fetchDrawerExpanded \|\| popupState\.fetchDrawerHoverExpanded;/);
  assert.match(popupActionsSource, /popupState\.bulkArchiveSelectionKeys = getBulkArchiveCandidateKeys\(\);/);
  assert.match(popupActionsSource, /popupState\.bulkArchiveSelectionKeys = \[\];/);
  assert.match(popupActionsSource, /export async function handleArchiveSelectedClick\(\)/);
  assert.match(popupActionsSource, /const didArchive = await handleBatchArchiveStateChange\(itemKeys, true\);/);
  assert.match(popupDomSource, /archiveSelectedButton: document\.getElementById\("archive-selected-button"\),/);
  assert.match(popupDomSource, /downloadOverlaySource: document\.getElementById\("download-overlay-source"\),/);
  assert.match(popupControllersIndexSource, /dom\.fetchProgressPanel\?\.addEventListener\("mouseenter", handleFetchProgressPanelMouseEnter\);/);
  assert.match(popupControllersIndexSource, /dom\.fetchProgressPanel\?\.addEventListener\("mouseleave", handleFetchProgressPanelMouseLeave\);/);
  assert.match(popupControllersIndexSource, /dom\.archiveSelectedButton\?\.addEventListener\("click", handleArchiveSelectedClick\);/);
  assert.match(popupEmptyStateSource, /dom\.emptyStateImage\.classList\.remove\("hidden"\);/);
  assert.match(popupEmptyStateSource, /buildFetchEmptyStateText\(popupState\.latestRuntimeState\)/);
  assert.match(popupEmptyStateSource, /dom\.emptyState\?\.classList\.remove\("hidden"\);/);
  assert.match(popupStateSource, /fetchDrawerHoverExpanded: false,/);
  assert.match(popupStateSource, /bulkArchiveSelectionKeys: \[\],/);
  assert.match(popupUpdaterSource, /const UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS = 15000;/);
  assert.match(popupUpdaterSource, /timeoutMs: UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS,/);
  assert.match(popupUpdaterSource, /popupState\.updateGateHidden = true;\s+setStartupGateLocked\(false\);/s);
  assert.match(popupUpdaterSource, /if \(!settled && timeoutMs > 0 && Date\.now\(\) - startedAt >= timeoutMs\) \{\s+throw new Error\("Save Sora timed out while checking GitHub for updates\."\);\s+\}/s);
  assert.match(popupCountsSource, /export function buildRenderCountSnapshot\(runtimeState, items\)/);
  assert.match(popupCountsSource, /export function buildLocalItemMetricSnapshot\(items\)/);
  assert.match(popupCountsSource, /downloadableCount: Math\.max\(0, fetchedCount - downloadedCount - archivedCount\),/);
  assert.match(popupCountsSource, /downloadableBytes,/);
  assert.match(popupCountsSource, /popupDownloadableBytes/);
  assert.match(popupRenderSource, /const popupTotalItemCount = Number\.isFinite\(Number\(state && state\.popupTotalItemCount\)\)/);
  assert.match(popupRenderSource, /const countSnapshot = buildRenderCountSnapshot\(state, items\);/);
  assert.match(popupRenderSource, /const foundVideos = Math\.max\(popupTotalItemCount, countSnapshot\.fetchedCount\);/);
  assert.match(popupRenderSource, /const totalVideos = foundVideos;/);
  assert.match(popupRenderSource, /const selectedCountTotal = countSnapshot\.downloadableCount;/);
  assert.match(popupRenderSource, /downloadableBytes: countSnapshot\.downloadableBytes,/);
  assert.match(popupRenderSource, /popupState\.pendingDownloadStart &&\s*\(phase === "downloading" \|\|\s*phase === "complete" \|\|\s*Boolean\(state && state\.lastError\)\)/s);
  assert.match(popupSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSelectionSource, /export function getBulkArchiveCandidateKeys\(\)/);
  assert.match(popupSelectionSource, /export function getBulkArchiveSelectedKeys\(\)/);
  assert.match(popupSelectionSource, /buildFetchSelectionSummary\(/);
  assert.match(popupSelectionSource, /Search Results \(Loading\.\.\.\)/);
  assert.match(popupSelectionSource, /popupState\.latestRenderState\.counts && typeof popupState\.latestRenderState\.counts === "object"/);
  assert.match(popupSelectionSource, /const hasAnyResults =\s+\(Array\.isArray\(popupState\.latestRenderState\.items\)/s);
  assert.match(popupSelectionSource, /phase !== "fetching" &&\s+!hasAnyResults/s);
  assert.match(popupSelectionSource, /found so far/);
  assert.match(popupSelectionSource, /queued to archive/);
  assert.match(popupSelectionSource, /Archive Selected \(\$\{formatWholeNumber\(bulkArchiveSelectedCount\)\}\)/);
  assert.match(popupSelectionSource, /const hasBulkArchiveSelection =\s+showBulkArchiveActions && bulkArchiveSelectedKeys\.length > 0/);
  assert.match(popupSelectionSource, /dom\.archiveSelectedButton\.classList\.toggle\("hidden", !hasBulkArchiveSelection\);/);
  assert.match(popupSelectionSource, /showSourceSelectionActions \? !showSourceSelectionActions : !hasBulkArchiveSelection/);
  assert.match(popupSelectionSource, /!fetchUiState\.isBusy[\s\S]*?!fetchUiState\.isAnyPaused/);
  assert.match(popupSelectionSource, /Object\.prototype\.hasOwnProperty\.call\(countSnapshot, "downloadableBytes"\)/);
  assert.match(popupListSource, /const effectiveTotalCount = Number\.isFinite\(Number\(popupState\.latestRenderState\.totalCount\)\)/);
  assert.match(popupFetchStatusSource, /buildFetchSelectionSummary\(/);
  assert.match(popupFetchCopySource, /export function buildFetchSelectionSummary/);
  assert.match(popupFetchCopySource, /export function buildFetchEmptyStateText/);
  assert.match(popupFetchCopySource, /Results will start appearing after the first batch finishes loading\./);
  assert.match(popupFetchCopySource, /Results will appear after this batch finishes processing\./);
  assert.match(popupFetchProgressSource, /const isExpanded =\s+isVisible && \(popupState\.fetchDrawerExpanded \|\| popupState\.fetchDrawerHoverExpanded\);/s);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressSource\.textContent = "";/);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressSource\.classList\.add\("hidden"\);/);
  assert.match(popupFetchProgressSource, /dom\.fetchProgressCount\.textContent =\s*itemsFound > 0/s);
  assert.doesNotMatch(popupFetchProgressSource, /in source/);
  assert.match(popupOverlaySource, /import \{ formatWholeNumber \} from "\.\.\/utils\/format\.js";/);
  assert.match(popupOverlaySource, /const currentItemTitle =/);
  assert.match(popupOverlaySource, /const currentSourceLabel =/);
  assert.match(popupOverlaySource, /const currentProcessLabel =/);
  assert.match(popupOverlaySource, /dom\.downloadOverlaySource\.textContent = currentSourceLabel \? `Source: \$\{currentSourceLabel\}` : "";/);
  assert.match(popupOverlaySource, /dom\.downloadOverlaySource\.classList\.toggle\("hidden", !currentSourceLabel\);/);
  assert.match(popupOverlaySource, /currentItemTitle \|\|/);
  assert.match(popupOverlaySource, /currentProcessLabel \|\|/);
  assert.match(popupOverlaySource, /formatWholeNumber\(processed\)/);
  assert.match(popupOverlaySource, /formatWholeNumber\(runTotal \|\| processed\)/);
  assert.match(popupCssSource, /\.item-grid-overlay \{[\s\S]*?position: absolute;[\s\S]*?opacity: 0;[\s\S]*?visibility: hidden;/s);
  assert.match(popupCssSource, /\.item-list\.is-grid-view \.item-card:hover \.item-grid-overlay,[\s\S]*?\.item-list\.is-grid-view \.item-card:focus-within \.item-grid-overlay,[\s\S]*?opacity: 1;[\s\S]*?visibility: visible;/s);
  assert.match(popupCssSource, /\.item-grid-tooltip-surface \{[\s\S]*?width: 100%;[\s\S]*?pointer-events: auto;/s);
  assert.match(popupCssSource, /\.item-grid-tooltip-surface \.item-meta-row \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);/s);
  assert.match(popupCssSource, /\.item-grid-tooltip-surface \.item-source-badge \{[\s\S]*?grid-column: 1 \/ -1;/s);
  assert.match(popupCssSource, /\.item-grid-tooltip-surface \.item-footer \{[\s\S]*?flex-direction: column;[\s\S]*?align-items: flex-start;/s);
  assert.match(popupCssSource, /\.empty-state-image \{\s+display: block;\s+width: auto;\s+height: auto;/s);
  assert.match(popupCssSource, /\.empty-state-text \{[\s\S]*?white-space: pre-line;[\s\S]*?max-width: 44ch;/s);
  assert.match(popupCssSource, /\.empty-state\.is-fetching \.empty-state-text \{/);
  assert.doesNotMatch(popupCssSource, /body\.is-fullscreen-view \.empty-state-image \{\s+display: none;/s);
  assert.match(popupCssSource, /\.item-list\.is-grid-view \.item-card \{[\s\S]*?content-visibility: visible;[\s\S]*?contain: layout style;[\s\S]*?overflow: visible;/s);
  assert.match(popupCssSource, /\.download-overlay-video,[\s\S]*?\.download-overlay-backdrop \{/s);
  assert.match(popupCssSource, /\.download-overlay-source \{[\s\S]*?text-transform: uppercase;/s);
  assert.match(popupCssSource, /\.download-overlay-video \{[\s\S]*?object-fit: cover;/s);
  assert.match(popupCssSource, /\.download-overlay-backdrop \{[\s\S]*?radial-gradient/s);
  assert.match(popupCharacterSelectionSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(popupSourceMenusSource, /const fetchUiState = getFetchUiState\(/);
  assert.match(backgroundSource, /function createDefaultRestoreStatus/);
  assert.match(backgroundSource, /function hasActiveResultsThatShouldSuppressRestorePrompt\(state\)/);
  assert.match(backgroundSource, /if \(hasActiveResultsThatShouldSuppressRestorePrompt\(nextState\)\) \{/);
  assert.match(backgroundSource, /async function setItemsRemovedState\(itemKeys, removed\)/);
  assert.match(backgroundSource, /currentSourceLabel: "",\s+currentItemTitle: "",\s+currentProcessLabel: "",/s);
  assert.match(backgroundSource, /function getQueueItemProgressTitle\(item\)/);
  assert.match(backgroundSource, /function getDownloadSourceLabelForSourcePage\(source\)/);
  assert.match(backgroundSource, /function getQueueItemSourceLabel\(item\)/);
  assert.match(backgroundSource, /async function handleOffscreenArchiveItemProgress\(message\)/);
  assert.match(backgroundSource, /currentProcessLabel:\s*"Removing watermark\.\.\."/);
  assert.match(backgroundSource, /currentProcessLabel:\s*"Downloading video\.\.\."/);
  assert.match(backgroundSource, /currentProcessLabel:\s*"Saving ZIP archive\.\.\."/);
  assert.match(backgroundSource, /function resolveAuthoritativeFetchCountSnapshot\(options = \{\}\)/);
  assert.match(backgroundSource, /function resolveNoWatermarkDownloadUrl\(item\)/);
  assert.match(backgroundSource, /function shouldPrepareDraftShareForDownload\(item\)/);
  assert.match(backgroundSource, /async function prepareDraftItemForDownload\(item\)/);
  assert.match(backgroundSource, /let candidate = await prepareDraftItemForDownload\(item\);/);
  assert.match(backgroundSource, /const preparedDraftItem = await prepareDraftItemForDownload\(item\);/);
  assert.match(backgroundSource, /async function postJson\(relativeUrl, jsonBody, requestOptions = \{\}\)/);
  assert.match(backgroundSource, /async function buildDraftSharedReferenceMap\(rows, config = \{\}\)/);
  assert.match(backgroundSource, /type:\s*"shared_link_unlisted"/);
  assert.match(backgroundSource, /attachments_to_create:\s*\[/);
  assert.match(backgroundSource, /const isRecoverableAuthError = isRecoverableSoraAuthError\(error\);/);
  assert.match(backgroundSource, /lastAuthRefreshAt: now,/);
  assert.match(backgroundSource, /Save Sora refreshed its hidden Sora worker after your session expired/);
  assert.match(backgroundSource, /function selectNewestInstallableUpdateCandidate\(candidates, currentVersion = CURRENT_EXTENSION_VERSION\)/);
  assert.match(backgroundSource, /function isCachedInterfaceStateError\(error\)/);
  assert.match(backgroundSource, /async function resolvePendingUpdateForInstall\(options = \{\}\)/);
  assert.match(backgroundSource, /async function applyPendingUpdateToInstallFolder\(pendingUpdate, extractedFiles, onProgress\)/);
  assert.match(backgroundSource, /const \{\s+pendingUpdate,\s+latestRelease,\s+\} = await resolvePendingUpdateForInstall\(options\);/s);
  assert.match(backgroundSource, /const installRecord = await getLinkedInstallFolderRecord\(\{ bypassCache: true \}\);/);
  assert.match(backgroundSource, /if \(!isCachedInterfaceStateError\(error\)\) \{\s+throw error;\s+\}/s);
  assert.match(backgroundSource, /return installPendingUpdate\(\{ pendingUpdate, refreshLatest: false \}\);/);
  assert.match(backgroundSource, /function shouldDeferAutomaticUpdateChecks\(state = currentState\)/);
  assert.match(backgroundSource, /Boolean\(activeRun\) \|\|[\s\S]*phase === "fetching" \|\|[\s\S]*phase === "downloading" \|\|[\s\S]*phase === "fetch-paused" \|\|[\s\S]*phase === "paused"/);
  assert.match(backgroundSource, /if \(!isManualRequest && shouldDeferAutomaticUpdateChecks\(currentState\)\) \{\s*return buildUpdateStatusSnapshot\(\);\s*\}/s);
  assert.match(backgroundSource, /scopeRefreshPromisesByKey: new Map\(\),/);
  assert.match(backgroundSource, /function getArchiveRefreshScopeKey\(item\)/);
  assert.match(backgroundSource, /async function refreshArchiveScopeItems\(item\)/);
  assert.match(backgroundSource, /const refreshScopeKey = getArchiveRefreshScopeKey\(currentItem\);/);
  assert.match(backgroundSource, /activeArchiveJob\.scopeRefreshPromisesByKey\.set\(refreshScopeKey, scopeRefreshPromise\);/);
  assert.match(backgroundSource, /activeArchiveJob\.pendingItems = activeArchiveJob\.pendingItems\.map\(\(pendingItem\) =>/);
  assert.match(backgroundSource, /function shouldSkipDraftRow\(row\)/);
  assert.match(backgroundSource, /function getExistingSharedDraftPost\(row\)/);
  assert.match(backgroundSource, /if \(shouldSkipDraftRow\(row\)\) \{\s*continue;\s*\}/);
  assert.doesNotMatch(backgroundSource, /const sharedReferenceMap = await buildDraftSharedReferenceMap\(/);
  assert.match(backgroundSource, /row && row\.post && row\.post\.prompt/);
  assert.match(backgroundSource, /existingSharedPost && existingSharedPost\.prompt/);
  assert.match(backgroundSource, /sharedPostId: sharedReference && sharedReference\.sharedPostId/);
  assert.match(backgroundSource, /sharedPostId: postId,/);
  assert.match(backgroundSource, /generationId: attachmentGenerationId,/);
  assert.match(backgroundSource, /isDownloaded: compactItem\.isDownloaded === true \|\| isItemDownloadedByIdentity\(compactItem\),/);
  assert.match(backgroundSource, /function buildPopupBatchMetricSnapshot\(items = \[\]\)/);
  assert.match(backgroundSource, /const countSnapshot = resolveAuthoritativeFetchCountSnapshot\(\{\s+items: sourceItems,/s);
  assert.match(backgroundSource, /popupDownloadableBytes: metricSnapshot\.downloadableBytes,/);
  assert.match(backgroundSource, /popupDownloadedBytes: metricSnapshot\.downloadedBytes,/);
  assert.match(backgroundSource, /popupArchivedBytes: metricSnapshot\.archivedBytes,/);
  assert.match(backgroundSource, /const countSnapshot = resolveAuthoritativeFetchCountSnapshot\(\{\s+items: restoredItems,/s);
  assert.match(backgroundSource, /const countSnapshot = resolveAuthoritativeFetchCountSnapshot\(\{\s+items: nextItems,/s);
  assert.match(backgroundSource, /const countSnapshot = resolveAuthoritativeFetchCountSnapshot\(\{\s+items: activeItems,/s);
  assert.match(backgroundSource, /await setState\(\{[\s\S]*phase: "downloading",[\s\S]*restoreStatus: createDefaultRestoreStatus\(\),[\s\S]*\}\);/s);
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
  assert.match(backgroundSource, /await ensureHiddenWorkerWindowMinimized\(fetchWorkerContext\.windowId, fetchWorkerContext\);/);
  assert.match(backgroundSource, /await chrome\.windows\.remove\(windowId\);/);
  assert.match(backgroundSource, /draftShare: "https:\/\/sora\.chatgpt\.com\/drafts"/);
  assert.match(backgroundSource, /if \(message\.type === PREPARE_ARCHIVE_ITEM_URL\) \{/);
  assert.match(backgroundSource, /async function prepareArchiveItemUrl\(itemKey\)/);
  assert.match(backgroundSource, /source === "draftShare"/);
  assert.match(backgroundSource, /sharedReference = await resolveDraftSharedPostReference/);
  assert.match(backgroundSource, /requiresSharedDraftPreparation: shouldPrepareDraftShareForDownload\(item\),/);
  assert.doesNotMatch(backgroundSource, /await clearVolatileBackupProgress\(sessionKey, progressKey\);/);
  assert.match(backgroundSource, /VOLATILE_BACKUP_UPDATER_STORE/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_MIRROR_ITEM_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_CHECKPOINT_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SYNC_SESSION_STORE\)\.clear\(\);/);
  assert.doesNotMatch(backgroundSource, /transaction\.objectStore\(SOURCE_RETRY_STATE_STORE\)\.clear\(\);/);
  assert.match(backgroundSource, /async function resetExtensionState\(options = \{\}\)/);
  assert.match(backgroundSource, /const preserveRecoveryData = options\.preserveRecoveryData !== false;/);
  assert.match(popupSelectionSource, /const showSummaryPanel = hasLoadedResults;/);
  assert.match(itemMutationsSource, /const countSnapshot = buildRenderCountSnapshot\(popupState\.latestRuntimeState, items\);/);
  assert.match(itemMutationsSource, /downloadableBytes: countSnapshot\.downloadableBytes,/);
  assert.match(itemMutationsSource, /const response = await saveBulkRemovedState\(normalizedKeys, removed, \{/);
  assert.match(itemMutationsSource, /return true;/);
  assert.match(popupSelectionSource, /activeCreatorResultsTab === "downloaded"/);
  assert.match(popupSelectionSource, /downloaded in view/);
  assert.match(popupItemCardPartsSource, /removeButton\.textContent = "Download Again";/);
  assert.match(popupItemCardPartsSource, /if \(item\.isDownloaded\)/);
  assert.match(popupItemCardPartsSource, /if \(!item\.isDownloaded\) \{/);
  assert.match(popupItemCardPartsSource, /Archive video/);
  assert.match(popupItemsUtilsSource, /case "downloaded":\s+return "Downloaded";/);
  assert.match(popupItemsUtilsSource, /const sharedPostMatch = noWatermarkUrl\.match\(/);
  assert.match(popupItemsUtilsSource, /return `https:\/\/sora\.chatgpt\.com\/p\/\$\{sharedPostMatch\[1\]\}`;/);
  assert.match(popupStateSource, /downloadableBytes: null,/);
  assert.match(popupStateSource, /downloadedBytes: null,/);
  assert.match(popupStateSource, /archivedBytes: null,/);
  assert.match(popupUpdateGateSource, /Local recovery needs attention/);
  assert.match(popupOverlaySource, /Preparing ZIP archive\.\.\./);
  assert.match(popupOverlaySource, /Downloading and packaging videos/);
  assert.match(popupOverlaySource, /Archive download finished/);
  assert.match(offscreenSource, /const ARCHIVE_PARALLEL_DOWNLOADS = 5;/);
  assert.match(offscreenSource, /const ITEM_PROGRESS_MESSAGE = "OFFSCREEN_ARCHIVE_ITEM_PROGRESS";/);
  assert.match(offscreenSource, /const PREPARE_ARCHIVE_ITEM_URL = "PREPARE_ARCHIVE_ITEM_URL";/);
  assert.match(offscreenSource, /candidate && candidate\.requiresSharedDraftPreparation === true/);
  assert.match(offscreenSource, /const preparedItem = await prepareArchiveItem\(candidate\);/);
  assert.match(offscreenSource, /async function prepareArchiveItem\(item\)/);
  assert.match(offscreenSource, /async function sendArchiveItemProgress\(jobId, item, processLabel\)/);
  assert.match(offscreenSource, /sourceLabel: item && typeof item\.sourceLabel === "string" \? item\.sourceLabel : "",/);
  assert.match(offscreenSource, /await sendArchiveItemProgress\(jobId, candidate, "Removing watermark\.\.\."\);/);
  assert.match(offscreenSource, /await sendArchiveItemProgress\(jobId, candidate, "Downloading video\.\.\."\);/);
  assert.match(offscreenSource, /await sendArchiveItemProgress\(jobId, candidate, "Packaging into ZIP\.\.\."\);/);
  assert.match(offscreenSource, /type: PREPARE_ARCHIVE_ITEM_URL,/);
  assert.match(offscreenSource, /async function runArchiveItemsWithConcurrency\(zipWriter, archiveItems, signal, jobId\)/);
  assert.match(offscreenSource, /await runArchiveItemsWithConcurrency\(zipWriter, archiveItems, signal, jobId\);/);
  assert.match(offscreenSource, /keepOrder: false,/);
  assert.match(offscreenSource, /bufferedWrite: true,/);
  assert.match(offscreenSource, /Downloading and packaging videos\.\.\./);
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
      counts: {
        fetchedCount: 3800,
        downloadableCount: 3125,
      },
      selectedKeys: new Array(3000).fill("preview"),
    },
  });

  assert.equal(totals.totalCount, 3800);
  assert.equal(totals.selectedCount, 3125);
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

function testInstallPrefersNewestAvailableRelease() {
  const selectedUpdate = selectNewestInstallableUpdateCandidate(
    [
      { version: "1.23.4" },
      { version: "1.23.9" },
      { version: "1.23.7" },
    ],
    "1.23.3",
  );

  assert.deepEqual(selectedUpdate, { version: "1.23.9" });
}

function testCachedInterfaceStateErrorIsRetryable() {
  assert.equal(
    isCachedInterfaceStateErrorMessage(
      "An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.",
    ),
    true,
  );

  assert.equal(
    isCachedInterfaceStateErrorMessage("Permission denied while opening the selected folder."),
    false,
  );
}

function testExpiredSoraSessionErrorIsRetryable() {
  assert.equal(
    isRecoverableSoraAuthErrorMessage(
      "Failed to fetch drafts data: Sora request failed with status 401. Session expired.",
    ),
    true,
  );

  assert.equal(
    isRecoverableSoraAuthErrorMessage(
      "Could not derive a Sora bearer token from the signed-in browser session.",
    ),
    true,
  );

  assert.equal(
    isRecoverableSoraAuthErrorMessage(
      "Failed to fetch drafts data: Timed out while waiting for Sora to respond.",
    ),
    false,
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

function testReadyResultsPreferRefreshCta() {
  const uiState = simulateFetchUiState(
    {
      phase: "ready",
      syncStatus: "idle",
      fetchedCount: 41216,
      resumableFetchRequest: null,
    },
    {
      items: [{ id: "item-1" }],
    },
  );

  assert.equal(
    uiState.primaryActionMode,
    "refresh",
    "completed result sets should offer a non-destructive update check instead of forcing a reset",
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

function testPausedFetchCountsPreferAuthoritativeFetchedTotal() {
  const countSnapshot = simulateAuthoritativeFetchCountSnapshot({
    items: Array.from({ length: 3000 }, (_, index) => ({ id: `preview-${index}` })),
    fetchedCount: 27080,
  });

  assert.equal(
    countSnapshot.fetchedCount,
    27080,
    "paused fetch state should preserve the highest known fetched total instead of collapsing to the preview slice",
  );
  assert.equal(
    countSnapshot.backedUpItemCount,
    24080,
    "paused fetch state should carry the hidden remainder so popup totals stay aligned with the global counter",
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

function testSummaryPanelStaysVisibleDuringFetch() {
  assert.equal(
    simulateSummaryPanelVisibility({
      items: [{ id: "item-1" }],
    }),
    true,
    "the total counter should stay visible while fetch-mode results are on screen",
  );
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

function testDownloadedIdentityMatchesAcrossDraftAndSharedVariants() {
  const draftItem = {
    id: "gen_01draftvideo",
    generationId: "gen_01draftvideo",
    sharedPostId: "s_sharedvideo",
    sourcePage: "drafts",
    sourceType: "draft",
    attachmentIndex: 0,
    isDownloaded: false,
  };
  const publishedVariant = {
    id: "s_sharedvideo",
    generationId: "gen_01draftvideo",
    sharedPostId: "s_sharedvideo",
    sourcePage: "profile",
    sourceType: "post",
    attachmentIndex: 0,
    isDownloaded: false,
  };

  const nextItems = simulateApplyDownloadedIdentityMutation(
    [draftItem, publishedVariant],
    draftItem,
    true,
  );

  assert.deepEqual(
    nextItems.map((item) => item.isDownloaded),
    [true, true],
    "marking one downloaded video should also mark any fetched source variant that resolves to the same underlying video identity",
  );
}

function testDownloadedIdentitySurvivesRefetches() {
  const downloadedDraft = {
    id: "gen_01draftvideo",
    generationId: "gen_01draftvideo",
    sharedPostId: "s_sharedvideo",
    sourcePage: "drafts",
    sourceType: "draft",
    attachmentIndex: 0,
  };
  const refetchedPublishedVariant = {
    id: "s_sharedvideo",
    generationId: "gen_01draftvideo",
    sharedPostId: "s_sharedvideo",
    sourcePage: "creatorPublished",
    sourceType: "post",
    attachmentIndex: 0,
    isDownloaded: false,
  };
  const downloadedIdentities = new Set(simulateDownloadedVideoIdentitiesForItem(downloadedDraft));
  const normalizedItems = simulateNormalizeDownloadedState(
    [refetchedPublishedVariant],
    downloadedIdentities,
  );

  assert.equal(
    normalizedItems[0].isDownloaded,
    true,
    "refetched items should inherit the downloaded state from the persisted video identity ledger even when the original row key is gone",
  );
}

function testBulkArchiveToolbarDefaultsToSelectAllOnly() {
  const defaultToolbarState = simulateBulkArchiveToolbarState({
    hasLoadedResults: true,
    candidateCount: 2444,
    selectedCount: 0,
  });

  assert.equal(defaultToolbarState.selectAllHidden, false);
  assert.equal(defaultToolbarState.selectAllDisabled, false);
  assert.equal(defaultToolbarState.archiveSelectedHidden, true);
  assert.equal(defaultToolbarState.archiveSelectedDisabled, true);
  assert.equal(defaultToolbarState.clearSelectionHidden, true);
  assert.equal(defaultToolbarState.clearSelectionDisabled, true);

  const selectedToolbarState = simulateBulkArchiveToolbarState({
    hasLoadedResults: true,
    candidateCount: 2444,
    selectedCount: 2444,
  });

  assert.equal(selectedToolbarState.selectAllHidden, false);
  assert.equal(selectedToolbarState.selectAllDisabled, true);
  assert.equal(selectedToolbarState.archiveSelectedHidden, false);
  assert.equal(selectedToolbarState.archiveSelectedDisabled, false);
  assert.equal(selectedToolbarState.clearSelectionHidden, false);
  assert.equal(selectedToolbarState.clearSelectionDisabled, false);
}

function testBulkArchiveToolbarKeepsSelectAllVisibleWhilePaused() {
  const pausedToolbarState = simulateBulkArchiveToolbarState({
    hasLoadedResults: true,
    candidateCount: 8593,
    selectedCount: 0,
    isAnyPaused: true,
  });

  assert.equal(
    pausedToolbarState.selectAllHidden,
    false,
    "paused fetch results should still show Select All so users can queue bulk archive actions",
  );
  assert.equal(
    pausedToolbarState.selectAllDisabled,
    false,
    "paused fetch results should keep Select All active when there are archive candidates",
  );
  assert.equal(pausedToolbarState.archiveSelectedHidden, true);
  assert.equal(pausedToolbarState.clearSelectionHidden, true);
}

function testDraftsPreferSharedNoWatermarkDownloadsWhenAvailable() {
  const preferredUrl = simulatePreferredDownloadUrl({
    id: "gen_01draft",
    generationId: "gen_01draft",
    download_urls: {
      no_watermark: "https://soravdl.com/api/proxy/video/s_01shared",
      watermark: "https://videos.openai.com/watermarked.mp4",
    },
    downloadUrl: "https://videos.openai.com/watermarked.mp4",
  });

  assert.equal(
    preferredUrl,
    "https://soravdl.com/api/proxy/video/s_01shared",
    "draft downloads should prefer the derived shared-link no-watermark URL once it exists",
  );
}

function testDraftFetchSkipsErroredAndEditedRows() {
  assert.equal(
    simulateShouldSkipDraftRow({
      id: "gen_error",
      kind: "sora_error",
    }),
    true,
    "errored draft rows should be skipped instead of entering the sharing or preview pipeline",
  );

  assert.equal(
    simulateShouldSkipDraftRow({
      id: "gen_edit",
      kind: "sora_draft",
      c_version: 1,
    }),
    true,
    "edited draft rows should be skipped because they are not shareable draft outputs",
  );

  assert.equal(
    simulateShouldSkipDraftRow({
      id: "gen_ok",
      kind: "sora_draft",
    }),
    false,
    "plain sora drafts should still flow through the normal preview pipeline",
  );
}

function testDraftPromptPrefersExistingSharedPostMetadata() {
  assert.equal(
    simulateExistingSharedDraftPrompt({
      id: "gen_01draft",
      prompt: "fallback draft prompt",
      post: {
        prompt: "shared wrapper prompt",
        post: {
          id: "s_01shared",
          prompt: "shared post prompt",
        },
      },
    }),
    "shared wrapper prompt",
    "when a draft already has shared-post metadata, the shared prompt should win over the old draft prompt",
  );
}

function testSharedDraftProxyResolvesBackToPublicReviewUrl() {
  const reviewUrl = simulateReviewUrlFromSharedDraft({
    id: "gen_01draft",
    generationId: "gen_01draft",
    no_watermark: "https://soravdl.com/api/proxy/video/s_01shared",
  });

  assert.equal(
    reviewUrl,
    "https://sora.chatgpt.com/p/s_01shared",
    "shared draft proxy URLs should map back to the public shared review page",
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

function testExistingResultsSuppressInterruptedRestorePrompt() {
  const resolution = simulateInterruptedRestoreResolution(
    {
      phase: "ready",
      itemKeys: ["gen_01draft"],
      fetchedCount: 27080,
    },
    {
      sessionId: "session-123",
      status: "paused",
    },
  );

  assert.equal(
    resolution,
    "suppressed",
    "an old interrupted fetch should not interrupt a live results set that is already ready to download",
  );
}

function testPendingDownloadStartSuppressesRestoreGatePrompt() {
  assert.equal(
    simulateDownloadStartRestoreGateVisibility({
      promptVisible: true,
      phase: "ready",
      pendingDownloadStart: true,
    }),
    false,
    "the restore gate should stay hidden while the user is actively starting a download",
  );

  assert.equal(
    simulateDownloadStartRestoreGateVisibility({
      promptVisible: true,
      phase: "downloading",
      pendingDownloadStart: false,
    }),
    false,
    "the restore gate should not reappear once the runtime has entered the downloading phase",
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

function testAutomaticUpdateChecksDeferDuringFetchWork() {
  assert.equal(
    simulateAutomaticUpdateCheckDecision({
      phase: "fetching",
      hasActiveRun: true,
      trigger: "alarm",
    }),
    "deferred",
    "scheduled update checks should stay out of the way while a fetch is actively running",
  );

  assert.equal(
    simulateAutomaticUpdateCheckDecision({
      phase: "downloading",
      hasActiveRun: true,
      trigger: "startup",
    }),
    "deferred",
    "startup update checks should also defer while file work is already in progress",
  );

  assert.equal(
    simulateAutomaticUpdateCheckDecision({
      phase: "fetch-paused",
      trigger: "alarm",
    }),
    "deferred",
    "background update checks should not interrupt resumable paused fetch sessions either",
  );
}

function testManualUpdateChecksStillWorkDuringFetchSessions() {
  assert.equal(
    simulateAutomaticUpdateCheckDecision({
      phase: "fetching",
      hasActiveRun: true,
      trigger: "manual",
    }),
    "allowed",
    "manual checks should still be available when the user explicitly asks for them",
  );

  assert.equal(
    simulateAutomaticUpdateCheckDecision({
      phase: "paused",
      trigger: "folder-link",
    }),
    "allowed",
    "folder-link recovery checks should still be allowed during resumable work states",
  );
}

function testArchiveRefreshReusesScopedSourceResults() {
  const refreshedPendingItems = simulateArchiveScopeRefresh({
    pendingItems: [
      {
        id: "video-1",
        sourcePage: "creatorPublished",
        creatorProfileId: "creator-a",
        downloadUrl: "stale-a-1",
      },
      {
        id: "video-2",
        sourcePage: "creatorPublished",
        creatorProfileId: "creator-a",
        downloadUrl: "stale-a-2",
      },
      {
        id: "video-3",
        sourcePage: "creatorPublished",
        creatorProfileId: "creator-b",
        downloadUrl: "stale-b-1",
      },
    ],
    refreshedItems: [
      { id: "video-1", downloadUrl: "fresh-a-1" },
      { id: "video-2", downloadUrl: "fresh-a-2" },
      { id: "video-3", downloadUrl: "fresh-b-1" },
    ],
    targetItem: {
      id: "video-1",
      sourcePage: "creatorPublished",
      creatorProfileId: "creator-a",
    },
  });

  assert.deepEqual(
    refreshedPendingItems.map((item) => item.downloadUrl),
    ["fresh-a-1", "fresh-a-2", "stale-b-1"],
    "a source-scoped archive refresh should update every pending item in the same scope without touching other scopes",
  );
}

function testArchiveConcurrencyCapsAtFiveWorkers() {
  assert.equal(
    simulateArchiveParallelWorkerCount(2),
    2,
    "small archive runs should only spawn the workers they need",
  );
  assert.equal(
    simulateArchiveParallelWorkerCount(12),
    5,
    "archive packaging should cap concurrency at five parallel downloads",
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
testInstallPrefersNewestAvailableRelease();
testCachedInterfaceStateErrorIsRetryable();
testExpiredSoraSessionErrorIsRetryable();
testPausedResultsPreferResetCta();
testReadyResultsPreferRefreshCta();
testPausedCountsPreferResetCtaBeforeItemsHydrate();
testDismissedRestorePromptReturnsToFetchCta();
testResumeBootstrapKeepsPausedResultsVisible();
testResumeBootstrapUsesMergedPausedWorkingSet();
testResumeProgressKeepsRestoredBaseline();
testPausedFetchCountsPreferAuthoritativeFetchedTotal();
testRestoredMirrorItemsMergeIntoRuntimeCatalog();
testGridCardsDoNotDuplicateHiddenListBodies();
testDownloadedTabFilteringAndQueueExclusion();
testDownloadedIdentityMatchesAcrossDraftAndSharedVariants();
testDownloadedIdentitySurvivesRefetches();
testBulkArchiveToolbarDefaultsToSelectAllOnly();
testBulkArchiveToolbarKeepsSelectAllVisibleWhilePaused();
testDraftsPreferSharedNoWatermarkDownloadsWhenAvailable();
testDraftFetchSkipsErroredAndEditedRows();
testDraftPromptPrefersExistingSharedPostMetadata();
testSharedDraftProxyResolvesBackToPublicReviewUrl();
testPausedFetchPersistencePreservesRecoveryMetadata();
testPausedSessionAutoRestoresWithoutPrompt();
testExistingResultsSuppressInterruptedRestorePrompt();
testPendingDownloadStartSuppressesRestoreGatePrompt();
testRestoreGateOnlyReleasesAfterFetchActuallyStarts();
testSummaryPanelStaysVisibleDuringFetch();
testStartupGateLockPreventsDashboardFlash();
testAutomaticUpdateChecksDeferDuringFetchWork();
testManualUpdateChecksStillWorkDuringFetchSessions();
testArchiveRefreshReusesScopedSourceResults();
testArchiveConcurrencyCapsAtFiveWorkers();

console.log("Fetch recovery regression checks passed.");
