export function getFetchUiState(runtimeState, renderState) {
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
  const isFetchPaused = phase === "fetch-paused";
  const isDownloading = phase === "downloading";
  const isBusy = isFetching || isDownloading;
  const isPaused = phase === "paused";
  const isAnyPaused = isPaused || isFetchPaused;
  const primaryActionMode =
    isFetchPaused && hasResumableFetchRequest
      ? "resume"
      : hasResults && !isBusy && syncStatus === "aborted"
        ? "reset"
      : hasResults && !isBusy
        ? "refresh"
        : "scan";

  return {
    phase,
    hasResults,
    hasResumableFetchRequest,
    syncStatus,
    hasPausedFetchSession,
    isFetching,
    isFetchPaused,
    isDownloading,
    isBusy,
    isPaused,
    isAnyPaused,
    primaryActionMode,
  };
}
