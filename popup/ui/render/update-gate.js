import { dom } from "../../dom.js";
import { popupState } from "../../state.js";

const ACTIVE_UPDATE_PHASES = new Set([
  "checking",
  "awaiting-folder",
  "update-available",
  "downloading",
  "applying",
  "reloading",
  "deferred",
  "error",
]);

export function syncUpdateSurfaces(updateStatus) {
  const normalizedStatus = normalizeUpdateStatus(updateStatus);
  popupState.latestUpdateStatus = normalizedStatus;
  syncUpdateGate(normalizedStatus);
  syncUpdaterStatusRow(normalizedStatus);
}

function normalizeUpdateStatus(updateStatus) {
  const source = updateStatus && typeof updateStatus === "object" ? updateStatus : {};
  return {
    phase: typeof source.phase === "string" ? source.phase : "idle",
    currentVersion:
      typeof source.currentVersion === "string" && source.currentVersion
        ? source.currentVersion
        : "",
    latestVersion:
      typeof source.latestVersion === "string" && source.latestVersion ? source.latestVersion : "",
    message: typeof source.message === "string" ? source.message : "",
    detail: typeof source.detail === "string" ? source.detail : "",
    progress: Number.isFinite(Number(source.progress))
      ? Math.max(0, Math.min(1, Number(source.progress)))
      : 0,
    lastCheckedAt: typeof source.lastCheckedAt === "string" ? source.lastCheckedAt : null,
    installFolderLinked: source.installFolderLinked === true,
    automaticUpdatesEnabled: source.automaticUpdatesEnabled !== false,
    updateAvailable: source.updateAvailable === true,
    pendingUpdateVersion:
      typeof source.pendingUpdateVersion === "string" ? source.pendingUpdateVersion : "",
    pendingDeferred: source.pendingDeferred === true,
    changelogMarkdown:
      typeof source.changelogMarkdown === "string" ? source.changelogMarkdown : "",
    error: typeof source.error === "string" ? source.error : "",
  };
}

function syncUpdateGate(updateStatus) {
  if (!(dom.updateGate instanceof HTMLElement)) {
    return;
  }

  const pendingVersion = updateStatus.pendingUpdateVersion || updateStatus.latestVersion;
  const skippedThisSession =
    pendingVersion &&
    popupState.skippedUpdateVersion &&
    popupState.skippedUpdateVersion === pendingVersion;
  const dismissedErrorForSession = popupState.updateGateHidden && updateStatus.phase === "error";
  const shouldShow =
    ACTIVE_UPDATE_PHASES.has(updateStatus.phase) &&
    !dismissedErrorForSession &&
    !(skippedThisSession && (updateStatus.phase === "update-available" || updateStatus.phase === "deferred"));

  popupState.updateGateHidden = !shouldShow;
  dom.updateGate.classList.toggle("hidden", !shouldShow);
  dom.updateGate.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  dom.updateGate.setAttribute(
    "aria-busy",
    updateStatus.phase === "checking" ||
      updateStatus.phase === "downloading" ||
      updateStatus.phase === "applying" ||
      updateStatus.phase === "reloading"
      ? "true"
      : "false",
  );

  if (!shouldShow) {
    return;
  }

  if (dom.updateGateTitle instanceof HTMLElement) {
    dom.updateGateTitle.textContent = getUpdateGateTitle(updateStatus);
  }
  if (dom.updateGateMessage instanceof HTMLElement) {
    dom.updateGateMessage.textContent = getUpdateGateMessage(updateStatus);
  }

  const showSpinner = ["checking", "downloading", "applying", "reloading"].includes(
    updateStatus.phase,
  );
  dom.updateGateSpinner?.classList.toggle("hidden", !showSpinner);

  const showProgress = updateStatus.phase === "downloading" || updateStatus.phase === "applying";
  dom.updateGateProgress?.classList.toggle("hidden", !showProgress);
  if (dom.updateGateProgressFill instanceof HTMLElement) {
    dom.updateGateProgressFill.style.width = `${Math.round(updateStatus.progress * 100)}%`;
  }
  if (dom.updateGateProgressLabel instanceof HTMLElement) {
    dom.updateGateProgressLabel.textContent = `${Math.round(updateStatus.progress * 100)}%`;
  }

  const shouldShowChangelog =
    updateStatus.updateAvailable &&
    typeof updateStatus.changelogMarkdown === "string" &&
    updateStatus.changelogMarkdown.trim().length > 0;
  dom.updateGateChangelog?.classList.toggle("hidden", !shouldShowChangelog);
  if (dom.updateGateChangelogBody instanceof HTMLElement) {
    renderMarkdownLite(dom.updateGateChangelogBody, updateStatus.changelogMarkdown);
  }

  const showLinkButton = updateStatus.phase === "awaiting-folder";
  const showInstallButton =
    updateStatus.phase === "update-available" || updateStatus.phase === "deferred";
  const showSkipButton =
    updateStatus.phase === "update-available" || updateStatus.phase === "deferred";
  const showRetryButton = updateStatus.phase === "error";
  const showContinueButton =
    updateStatus.phase === "error" ||
    (updateStatus.phase === "awaiting-folder" && updateStatus.automaticUpdatesEnabled);

  dom.updateGateActions?.classList.toggle(
    "hidden",
    !(showLinkButton || showInstallButton || showSkipButton || showRetryButton || showContinueButton),
  );
  dom.updateGateLinkButton?.classList.toggle("hidden", !showLinkButton);
  dom.updateGateInstallButton?.classList.toggle("hidden", !showInstallButton);
  dom.updateGateSkipButton?.classList.toggle("hidden", !showSkipButton);
  dom.updateGateRetryButton?.classList.toggle("hidden", !showRetryButton);
  dom.updateGateContinueButton?.classList.toggle("hidden", !showContinueButton);
  if (dom.updateGateContinueButton instanceof HTMLButtonElement) {
    dom.updateGateContinueButton.textContent =
      updateStatus.phase === "awaiting-folder" && updateStatus.automaticUpdatesEnabled
        ? "Continue without auto-updates"
        : "Continue without updating";
  }
}

function syncUpdaterStatusRow(updateStatus) {
  if (!(dom.updaterStatusSummary instanceof HTMLElement) || !(dom.updaterStatusDetail instanceof HTMLElement)) {
    return;
  }

  const currentVersion = updateStatus.currentVersion || "Unknown";
  const lastChecked = formatLastChecked(updateStatus.lastCheckedAt);
  const folderStatus = updateStatus.installFolderLinked ? "Install folder linked" : "Install folder not linked";

  dom.updaterStatusSummary.textContent = `Version ${currentVersion} · ${lastChecked} · ${folderStatus}`;
  dom.updaterStatusDetail.textContent = getUpdaterStatusDetail(updateStatus);
  if (dom.updaterRelinkButton instanceof HTMLButtonElement) {
    dom.updaterRelinkButton.textContent = updateStatus.installFolderLinked ? "Relink folder" : "Link folder";
  }

  if (dom.automaticUpdatesInput instanceof HTMLInputElement) {
    dom.automaticUpdatesInput.checked = updateStatus.automaticUpdatesEnabled;
  }
}

function getUpdateGateTitle(updateStatus) {
  if (updateStatus.phase === "awaiting-folder") {
    return "Finish automatic update setup";
  }
  if (updateStatus.phase === "update-available" || updateStatus.phase === "deferred") {
    return `Save Sora ${updateStatus.pendingUpdateVersion || updateStatus.latestVersion} is ready`;
  }
  if (updateStatus.phase === "downloading") {
    return `Downloading Save Sora ${updateStatus.pendingUpdateVersion || updateStatus.latestVersion}…`;
  }
  if (updateStatus.phase === "applying") {
    return `Installing Save Sora ${updateStatus.pendingUpdateVersion || updateStatus.latestVersion}…`;
  }
  if (updateStatus.phase === "reloading") {
    return "Reloading Save Sora…";
  }
  if (updateStatus.phase === "error") {
    return "The update could not finish";
  }
  return "Checking GitHub for updates…";
}

function getUpdateGateMessage(updateStatus) {
  if (updateStatus.message) {
    return updateStatus.detail ? `${updateStatus.message} ${updateStatus.detail}` : updateStatus.message;
  }

  if (updateStatus.phase === "awaiting-folder") {
    return "Choose the unpacked Save Sora folder once so future GitHub releases can install automatically. If you prefer, you can continue without auto-updates for now.";
  }
  if (updateStatus.phase === "update-available") {
    return "A newer GitHub release is available. Review the changelog below and install it now or skip this session.";
  }
  if (updateStatus.phase === "deferred") {
    return "The update is ready, but Save Sora is busy right now. Install it now when you are ready or resume later.";
  }
  if (updateStatus.phase === "error") {
    return updateStatus.error || "Save Sora could not complete the update check.";
  }
  return "Making sure this unpacked extension is running the latest GitHub release before the dashboard opens.";
}

function getUpdaterStatusDetail(updateStatus) {
  if (updateStatus.phase === "update-available" || updateStatus.phase === "deferred") {
    return `Update ${updateStatus.pendingUpdateVersion || updateStatus.latestVersion} is available from GitHub.`;
  }
  if (updateStatus.phase === "awaiting-folder") {
    return "Chrome requires one-time access to the unpacked extension folder before automatic GitHub updates can be installed.";
  }
  if (updateStatus.phase === "error") {
    return updateStatus.error || "The last update check failed.";
  }
  if (updateStatus.lastCheckedAt) {
    return "Save Sora checks GitHub on startup and periodically while Chrome stays open.";
  }
  return "Save Sora checks GitHub on startup and periodically while Chrome stays open.";
}

function formatLastChecked(lastCheckedAt) {
  if (!lastCheckedAt) {
    return "Never checked";
  }

  const date = new Date(lastCheckedAt);
  if (Number.isNaN(date.getTime())) {
    return "Never checked";
  }

  return `Checked ${formatRelativeTime(date)}`;
}

function formatRelativeTime(date) {
  const now = Date.now();
  const diffMs = Math.max(0, now - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes <= 0) {
    return "just now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderMarkdownLite(container, markdown) {
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.replaceChildren();
  const source = typeof markdown === "string" ? markdown.trim() : "";
  if (!source) {
    return;
  }

  const blocks = source.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").map((value) => value.trim()).filter(Boolean);
    const isList = lines.every((line) => /^[-*]\s+/.test(line));
    if (isList) {
      const list = document.createElement("ul");
      list.className = "update-gate-changelog-list";
      for (const line of lines) {
        const item = document.createElement("li");
        item.textContent = line.replace(/^[-*]\s+/, "");
        list.append(item);
      }
      container.append(list);
      continue;
    }

    const paragraph = document.createElement("p");
    paragraph.className = "update-gate-changelog-paragraph";
    paragraph.textContent = lines.join(" ");
    container.append(paragraph);
  }
}
