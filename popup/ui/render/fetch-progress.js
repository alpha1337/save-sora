import { dom } from "../../dom.js";
import { popupState } from "../../state.js";

/**
 * Renders the fixed fetch-status drawer shown while the background worker is
 * scanning and streaming Sora results into the popup.
 *
 * @param {object} state
 */
export function syncFetchProgressPanel(state) {
  if (
    !(dom.fetchProgressPanel instanceof HTMLElement) ||
    !(dom.fetchProgressActions instanceof HTMLElement) ||
    !(dom.fetchProgressStage instanceof HTMLElement) ||
    !(dom.fetchProgressDetail instanceof HTMLElement) ||
    !(dom.fetchProgressPercent instanceof HTMLElement) ||
    !(dom.fetchProgressFill instanceof HTMLElement) ||
    !(dom.fetchProgressToggle instanceof HTMLButtonElement) ||
    !(dom.fetchProgressBody instanceof HTMLElement) ||
    !(dom.fetchProgressPauseAction instanceof HTMLButtonElement) ||
    !(dom.fetchProgressAction instanceof HTMLButtonElement) ||
    !(dom.fetchProgressSource instanceof HTMLElement) ||
    !(dom.fetchProgressCount instanceof HTMLElement) ||
    !(dom.fetchProgressEta instanceof HTMLElement) ||
    !(dom.fetchProgressQueue instanceof HTMLElement)
  ) {
    return;
  }

  const phase = state && state.phase ? state.phase : "idle";
  const progress =
    state && state.fetchProgress && typeof state.fetchProgress === "object"
      ? state.fetchProgress
      : null;
  const isPaused = phase === "fetch-paused";
  const isVisible = phase === "fetching" || isPaused;

  dom.fetchProgressPanel.classList.toggle("hidden", !isVisible);
  dom.fetchProgressPanel.classList.toggle("is-expanded", isVisible && popupState.fetchDrawerExpanded);
  dom.fetchProgressBody.classList.toggle("hidden", !isVisible || !popupState.fetchDrawerExpanded);
  dom.fetchProgressActions.classList.toggle("hidden", !isVisible || !popupState.fetchDrawerExpanded);
  dom.fetchProgressToggle.setAttribute(
    "aria-expanded",
    isVisible && popupState.fetchDrawerExpanded ? "true" : "false",
  );
  dom.fetchProgressToggle.textContent =
    isVisible && popupState.fetchDrawerExpanded ? "Hide Queue" : "View Queue";

  if (!isVisible) {
    dom.fetchProgressFill.style.width = "0%";
    dom.fetchProgressPauseAction.disabled = false;
    dom.fetchProgressPauseAction.textContent = "Pause Fetch";
    dom.fetchProgressAction.disabled = false;
    dom.fetchProgressAction.textContent = "Cancel Fetch";
    dom.fetchProgressQueue.replaceChildren();
    setFooterHeight(0);
    return;
  }

  const progressRatio = clampProgressRatio(progress && progress.progressRatio);
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

  dom.fetchProgressStage.textContent =
    (progress && progress.stageLabel) || "Fetching videos";
  dom.fetchProgressDetail.textContent =
    (progress && progress.detail) ||
    (state && state.message) ||
    "Preparing your results...";
  dom.fetchProgressPercent.textContent = `${progressPercent}%`;
  dom.fetchProgressFill.style.width = `${visibleWidth}%`;
  dom.fetchProgressSource.textContent = `${toTitleCase(currentSourceLabel)} • ${currentSourceIndex} of ${totalSources}`;
  dom.fetchProgressCount.textContent =
    itemsFound > 0 ? `${formatCompactCount(itemsFound)} found` : "Searching...";
  dom.fetchProgressEta.textContent = isPaused ? "Paused" : getFetchEtaLabel(state, progressRatio);
  dom.fetchProgressPauseAction.disabled =
    Boolean(progress && (progress.stage === "aborting" || progress.stage === "pausing"));
  dom.fetchProgressPauseAction.textContent = isPaused ? "Resume Fetch" : "Pause Fetch";
  dom.fetchProgressAction.disabled =
    Boolean(progress && (progress.stage === "aborting" || progress.stage === "pausing"));
  dom.fetchProgressAction.textContent =
    progress && progress.stage === "aborting"
      ? "Stopping..."
      : progress && progress.stage === "pausing"
        ? "Pausing..."
        : "Cancel Fetch";

  renderQueue(queueLabels, currentSourceIndex);
  setFooterHeight(dom.fetchProgressPanel.offsetHeight || 0);
}

function renderQueue(queueLabels, currentSourceIndex) {
  dom.fetchProgressQueue.replaceChildren();

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

    const status = document.createElement("span");
    status.className = "fetch-progress-queue-status";
    status.textContent =
      index + 1 < currentSourceIndex
        ? "Completed"
        : index + 1 === currentSourceIndex
          ? "In Progress"
          : "Queued";

    queueItem.append(title, status);
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

function getFetchEtaLabel(state, progressRatio) {
  if (progressRatio >= 0.985) {
    return "Finishing up...";
  }

  const startedAt =
    state && typeof state.startedAt === "string" && state.startedAt ? new Date(state.startedAt) : null;
  if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
    return "Estimating time left...";
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1500 || progressRatio < 0.08) {
    return "Estimating time left...";
  }

  const remainingMs = (elapsedMs * (1 - progressRatio)) / progressRatio;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "Finishing up...";
  }

  return `${formatDuration(remainingMs)} left`;
}

function formatDuration(value) {
  const totalSeconds = Math.max(1, Math.round(Number(value) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `About ${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `About ${minutes}m ${seconds}s`;
  }

  return `About ${seconds}s`;
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
