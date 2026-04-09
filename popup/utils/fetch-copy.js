import { formatWholeNumber } from "./format.js";

function getFetchProgress(runtimeState) {
  return runtimeState && runtimeState.fetchProgress && typeof runtimeState.fetchProgress === "object"
    ? runtimeState.fetchProgress
    : {};
}

function getFetchStageSnapshot(runtimeState) {
  const progress = getFetchProgress(runtimeState);
  return {
    stage: typeof progress.stage === "string" ? progress.stage : "",
    stageLabel:
      typeof progress.stageLabel === "string" && progress.stageLabel
        ? progress.stageLabel
        : "Finding videos",
    fetchedCount: Math.max(0, Number(runtimeState && runtimeState.fetchedCount) || 0),
  };
}

function getFetchWaitingCopy(stage, fetchedCount) {
  if (fetchedCount > 0 || stage === "processing" || stage === "finalizing") {
    return "Results will appear after this batch finishes processing.";
  }

  if (stage === "opening") {
    return "This first step can take a moment while the first batch loads.";
  }

  return "Results will start appearing after the first batch finishes loading.";
}

export function buildFetchSelectionSummary({ runtimeState, flavorMessage = "", hasRenderableResults = false }) {
  const { stage, stageLabel, fetchedCount } = getFetchStageSnapshot(runtimeState);
  if (fetchedCount > 0 && hasRenderableResults) {
    return `${flavorMessage || stageLabel} • ${formatWholeNumber(fetchedCount)} found so far.`;
  }

  if (fetchedCount > 0) {
    return `${stageLabel} • ${formatWholeNumber(fetchedCount)} found so far. ${getFetchWaitingCopy(stage, fetchedCount)}`;
  }

  return `${stageLabel} • ${getFetchWaitingCopy(stage, fetchedCount)}`;
}

export function buildFetchEmptyStateText(runtimeState) {
  const { stage, stageLabel, fetchedCount } = getFetchStageSnapshot(runtimeState);
  if (fetchedCount > 0) {
    return `${stageLabel}.\n${formatWholeNumber(fetchedCount)} found so far. ${getFetchWaitingCopy(stage, fetchedCount)}`;
  }

  return `${stageLabel}.\n${getFetchWaitingCopy(stage, fetchedCount)}`;
}
