import { dom } from "../../dom.js";
import { popupState } from "../../state.js";
import { getFetchUiState } from "../../utils/runtime-state.js";
import { CircleChevronUpIcon, createLucideIcon } from "../../../vendor/lucide.js";

/**
 * Renders the fixed fetch-status drawer shown while the background worker is
 * scanning and streaming Sora results into the popup.
 *
 * @param {object} state
 */
export function syncFetchProgressPanel(state) {
  if (
    !(dom.fetchProgressPanel instanceof HTMLElement) ||
    !(dom.fetchProgressBarShell instanceof HTMLElement) ||
    !(dom.fetchProgressActions instanceof HTMLElement) ||
    !(dom.fetchProgressStage instanceof HTMLElement) ||
    !(dom.fetchProgressDetail instanceof HTMLElement) ||
    !(dom.fetchProgressFill instanceof HTMLElement) ||
    !(dom.fetchProgressToggle instanceof HTMLButtonElement) ||
    !(dom.fetchProgressBody instanceof HTMLElement) ||
    !(dom.fetchProgressPauseAction instanceof HTMLButtonElement) ||
    !(dom.fetchProgressAction instanceof HTMLButtonElement) ||
    !(dom.fetchProgressSource instanceof HTMLElement) ||
    !(dom.fetchProgressCount instanceof HTMLElement) ||
    !(dom.fetchProgressEta instanceof HTMLElement) ||
    !(dom.fetchProgressQueueShell instanceof HTMLElement) ||
    !(dom.fetchProgressQueue instanceof HTMLElement)
  ) {
    return;
  }

  const fetchUiState = getFetchUiState(state, popupState.latestRenderState);
  const phase = fetchUiState.phase;
  const progress =
    state && state.fetchProgress && typeof state.fetchProgress === "object"
      ? state.fetchProgress
      : null;
  const isPaused = fetchUiState.isFetchPaused;
  const isVisible = fetchUiState.isFetching || isPaused;
  const isExpanded =
    isVisible && (popupState.fetchDrawerExpanded || popupState.fetchDrawerHoverExpanded);

  dom.fetchProgressPanel.classList.toggle("hidden", !isVisible);
  dom.fetchProgressPanel.classList.toggle("is-expanded", isExpanded);
  dom.fetchProgressBody.classList.toggle("hidden", !isExpanded);
  dom.fetchProgressActions.classList.toggle("hidden", !isExpanded);
  dom.fetchProgressToggle.setAttribute(
    "aria-expanded",
    isExpanded ? "true" : "false",
  );
  dom.fetchProgressToggle.setAttribute(
    "aria-label",
    isExpanded ? "Collapse background fetch queue" : "Expand background fetch queue",
  );
  dom.fetchProgressToggle.title = isExpanded ? "Collapse queue" : "Expand queue";
  syncFetchProgressToggleIcon();

  if (!isVisible) {
    dom.fetchProgressFill.style.width = "0%";
    dom.fetchProgressBarShell.removeAttribute("data-progress-tooltip");
    dom.fetchProgressBarShell.removeAttribute("aria-label");
    dom.fetchProgressBarShell.style.removeProperty("--fetch-progress-tooltip-position");
    dom.fetchProgressPauseAction.disabled = false;
    dom.fetchProgressPauseAction.textContent = "Pause";
    dom.fetchProgressAction.disabled = false;
    dom.fetchProgressAction.textContent = "Cancel";
    dom.fetchProgressSource.classList.add("hidden");
    dom.fetchProgressQueueShell.classList.add("hidden");
    dom.fetchProgressQueue.replaceChildren();
    setFooterHeight(0);
    return;
  }

  const sourceItemsFound = Math.max(0, Number(progress && progress.sourceItemsFound) || 0);
  const estimatedTotalCount = Math.max(0, Number(progress && progress.totalCount) || 0);
  const hasConcreteSourceEstimate =
    progress &&
    progress.stage === "fetching-source" &&
    progress.hasConcreteTotalCount === true &&
    estimatedTotalCount > 0 &&
    sourceItemsFound >= 0;
  const progressRatio = clampProgressRatio(
    hasConcreteSourceEstimate ? progress && progress.displayRatio : progress && progress.progressRatio,
  );
  const progressPercent = Math.round(progressRatio * 100);
  const visibleWidth = Math.max(4, progressPercent);
  const itemsFound = Math.max(
    0,
    Number(progress && progress.itemsFound) || Number(state && state.fetchedCount) || 0,
  );
  const currentSourceIndex = Math.max(1, Number(progress && progress.currentSourceIndex) || 1);
  const totalSources = Math.max(
    currentSourceIndex,
    Number(progress && progress.totalSources) || 1,
  );
  const currentSourceLabel =
    progress && typeof progress.currentSourceLabel === "string" && progress.currentSourceLabel
      ? progress.currentSourceLabel
      : "videos";
  const queueLabels = getQueueLabels(progress, currentSourceLabel);
  const sourceStatusLabel = getSourceStatusLabel({
    totalSources,
    currentSourceIndex,
    currentSourceLabel,
    hasConcreteSourceEstimate,
    sourceItemsFound,
    estimatedTotalCount,
  });
  const shouldShowSourceStatus = Boolean(sourceStatusLabel);
  const shouldShowQueue = queueLabels.length > 1;
  const tooltipText = getProgressTooltipLabel({
    hasConcreteSourceEstimate,
    isPaused,
    progressPercent,
  });
  const tooltipPosition = `${Math.max(10, Math.min(90, progressPercent || 0))}%`;

  dom.fetchProgressStage.textContent =
    (progress && progress.stageLabel) || "Fetching videos";
  const detailText =
    (progress && progress.detail) ||
    (state && state.message) ||
    "Preparing your results...";
  dom.fetchProgressDetail.textContent = detailText;
  dom.fetchProgressDetail.classList.toggle(
    "hidden",
    !detailText || detailText === dom.fetchProgressStage.textContent,
  );
  dom.fetchProgressFill.style.width = `${visibleWidth}%`;
  dom.fetchProgressBarShell.dataset.progressTooltip = tooltipText;
  dom.fetchProgressBarShell.setAttribute("aria-label", tooltipText);
  dom.fetchProgressBarShell.style.setProperty(
    "--fetch-progress-tooltip-position",
    tooltipPosition,
  );
  dom.fetchProgressSource.textContent = sourceStatusLabel;
  dom.fetchProgressSource.classList.toggle("hidden", !shouldShowSourceStatus);
  dom.fetchProgressCount.textContent =
    itemsFound > 0 ? `${formatCompactCount(itemsFound)} found` : "Searching...";
  dom.fetchProgressEta.textContent = getElapsedLabel(state, isPaused);
  dom.fetchProgressPauseAction.disabled =
    Boolean(progress && (progress.stage === "aborting" || progress.stage === "pausing"));
  dom.fetchProgressPauseAction.textContent = isPaused ? "Resume" : "Pause";
  dom.fetchProgressAction.disabled =
    Boolean(progress && (progress.stage === "aborting" || progress.stage === "pausing"));
  dom.fetchProgressAction.textContent =
    progress && progress.stage === "aborting"
      ? "Stopping"
      : progress && progress.stage === "pausing"
        ? "Pausing"
        : "Cancel";

  renderQueue(queueLabels, currentSourceIndex);
  dom.fetchProgressQueueShell.classList.toggle("hidden", !shouldShowQueue);
  setFooterHeight(0);
}

function syncFetchProgressToggleIcon() {
  const iconContainer = dom.fetchProgressToggle?.querySelector(".fetch-progress-toggle-icon");
  if (!(iconContainer instanceof HTMLElement)) {
    return;
  }

  iconContainer.replaceChildren(
    createLucideIcon(CircleChevronUpIcon, {
      className: "lucide lucide-circle-chevron-up",
      size: 18,
    }),
  );
}

function renderQueue(queueLabels, currentSourceIndex) {
  dom.fetchProgressQueue.replaceChildren();

  if (!Array.isArray(queueLabels) || queueLabels.length <= 1) {
    return;
  }

  queueLabels.forEach((label, index) => {
    const queueItem = document.createElement("div");
    queueItem.className = "fetch-progress-queue-item";

    if (index + 1 < currentSourceIndex) {
      queueItem.classList.add("is-complete");
    } else if (index + 1 === currentSourceIndex) {
      queueItem.classList.add("is-current");
    } else {
      queueItem.classList.add("is-pending");
    }

    const title = document.createElement("span");
    title.className = "fetch-progress-queue-title";
    title.textContent = toTitleCase(label);
    queueItem.append(title);
    dom.fetchProgressQueue.append(queueItem);
  });
}

function getQueueLabels(progress, currentSourceLabel) {
  const queueLabels =
    progress && Array.isArray(progress.queueLabels)
      ? progress.queueLabels
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [];

  if (queueLabels.length > 0) {
    return queueLabels;
  }

  if (typeof currentSourceLabel === "string" && currentSourceLabel) {
    return [currentSourceLabel];
  }

  return ["videos"];
}

function getSourceStatusLabel({
  totalSources,
  currentSourceIndex,
  currentSourceLabel,
  hasConcreteSourceEstimate,
  sourceItemsFound,
  estimatedTotalCount,
}) {
  const sourceLabel = toTitleCase(currentSourceLabel || "videos");
  const sourceEstimateLabel =
    hasConcreteSourceEstimate && estimatedTotalCount > 0
      ? `${formatCompactCount(sourceItemsFound)} of ${formatCompactCount(estimatedTotalCount)} in source`
      : "";

  if (totalSources > 1) {
    const sourceStepLabel = `${currentSourceIndex} of ${totalSources} sources`;
    return sourceEstimateLabel
      ? `${sourceStepLabel} · ${sourceLabel} · ${sourceEstimateLabel}`
      : `${sourceStepLabel} · ${sourceLabel}`;
  }

  return sourceEstimateLabel ? `${sourceLabel} · ${sourceEstimateLabel}` : "";
}

function setFooterHeight(height) {
  const nextHeight = Number.isFinite(Number(height)) && Number(height) > 0 ? `${Math.ceil(Number(height) + 10)}px` : "0px";
  document.documentElement.style.setProperty("--footer-height", nextHeight);
}

function clampProgressRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}

function getProgressTooltipLabel({ hasConcreteSourceEstimate, isPaused, progressPercent }) {
  if (hasConcreteSourceEstimate) {
    return `${progressPercent}% complete`;
  }

  if (isPaused) {
    return "Paused";
  }

  return "Streaming live results";
}

function getElapsedLabel(state, isPaused) {
  const startedAt =
    state && typeof state.startedAt === "string" && state.startedAt ? new Date(state.startedAt) : null;
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    return isPaused ? "Paused" : "Just started";
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return isPaused ? "Paused" : "Just started";
  }

  return `${formatElapsedDuration(elapsedMs)} elapsed`;
}

function formatElapsedDuration(value) {
  const totalSeconds = Math.max(1, Math.round(Number(value) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatCompactCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (numeric < 1000) {
    return String(Math.max(0, Math.round(numeric)));
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function toTitleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
