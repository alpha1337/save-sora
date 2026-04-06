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
    latestGitHubVersion:
      typeof source.latestGitHubVersion === "string" && source.latestGitHubVersion
        ? source.latestGitHubVersion
        : "",
    latestManifestDetected: source.latestManifestDetected === true,
    latestZipDetected: source.latestZipDetected === true,
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
    pendingUpdateReady: source.pendingUpdateReady === true,
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

  const showProgress = [
    "checking",
    "update-available",
    "downloading",
    "applying",
    "reloading",
    "deferred",
  ].includes(updateStatus.phase);
  dom.updateGateProgress?.classList.toggle("hidden", !showProgress);
  if (dom.updateGateProgressFill instanceof HTMLElement) {
    dom.updateGateProgressFill.style.width = `${Math.round(updateStatus.progress * 100)}%`;
  }
  if (dom.updateGateProgressLabel instanceof HTMLElement) {
    dom.updateGateProgressLabel.textContent = getUpdateGateProgressLabel(updateStatus);
  }

  const shouldShowChangelog =
    updateStatus.updateAvailable &&
    typeof updateStatus.changelogMarkdown === "string" &&
    updateStatus.changelogMarkdown.trim().length > 0;
  dom.updateGateChangelog?.classList.toggle("hidden", !shouldShowChangelog);
  if (dom.updateGateChangelogLabel instanceof HTMLElement) {
    const changelogVersion =
      updateStatus.pendingUpdateVersion ||
      updateStatus.latestVersion ||
      updateStatus.latestGitHubVersion ||
      updateStatus.currentVersion;
    dom.updateGateChangelogLabel.textContent = changelogVersion
      ? `What's new in ${changelogVersion}`
      : "What's new";
  }
  if (dom.updateGateChangelogBody instanceof HTMLElement) {
    renderMarkdownLite(dom.updateGateChangelogBody, updateStatus.changelogMarkdown);
  }

  const showLinkButton = updateStatus.phase === "awaiting-folder";
  const showInstallButton =
    updateStatus.phase === "deferred" ||
    (updateStatus.phase === "update-available" && updateStatus.automaticUpdatesEnabled === false);
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
  dom.updateGateActions?.classList.toggle(
    "is-inline-decision",
    updateStatus.phase === "awaiting-folder" || updateStatus.phase === "update-available" || updateStatus.phase === "deferred",
  );
  dom.updateGateLinkButton?.classList.toggle("hidden", !showLinkButton);
  dom.updateGateInstallButton?.classList.toggle("hidden", !showInstallButton);
  dom.updateGateSkipButton?.classList.toggle("hidden", !showSkipButton);
  dom.updateGateRetryButton?.classList.toggle("hidden", !showRetryButton);
  dom.updateGateContinueButton?.classList.toggle("hidden", !showContinueButton);
  if (dom.updateGateLinkButton instanceof HTMLButtonElement) {
    dom.updateGateLinkButton.textContent =
      updateStatus.installFolderLinked ? "Confirm access" : "Choose folder";
  }
  if (dom.updateGateInstallButton instanceof HTMLButtonElement) {
    dom.updateGateInstallButton.textContent = "Install update";
  }
  if (dom.updateGateSkipButton instanceof HTMLButtonElement) {
    dom.updateGateSkipButton.textContent = "Skip for now";
  }
  if (dom.updateGateContinueButton instanceof HTMLButtonElement) {
    dom.updateGateContinueButton.textContent =
      updateStatus.phase === "awaiting-folder" && updateStatus.automaticUpdatesEnabled
        ? "Not now"
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
  if (dom.updaterStatusDiagnostics instanceof HTMLElement) {
    dom.updaterStatusDiagnostics.textContent = getUpdaterDiagnosticsText(updateStatus);
  }
  if (dom.updaterRelinkButton instanceof HTMLButtonElement) {
    dom.updaterRelinkButton.textContent = updateStatus.installFolderLinked
      ? updateStatus.phase === "awaiting-folder"
        ? "Grant access"
        : "Relink folder"
      : "Link folder";
  }

  if (dom.automaticUpdatesInput instanceof HTMLInputElement) {
    dom.automaticUpdatesInput.checked = updateStatus.automaticUpdatesEnabled;
  }
}

function getUpdateGateTitle(updateStatus) {
  if (updateStatus.phase === "awaiting-folder") {
    return updateStatus.installFolderLinked
      ? "Confirm folder access"
      : "Enable automatic updates";
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
    return updateStatus.installFolderLinked
      ? "Save Sora already remembers the linked install folder. Chrome still needs a quick confirmation before Save Sora can write this update into that folder."
      : "Choose the unpacked Save Sora folder once to turn on automatic updates. Save Sora will remember that folder for future releases, although Chrome may occasionally ask you to confirm access again.";
  }
  if (updateStatus.phase === "update-available") {
    return updateStatus.automaticUpdatesEnabled
      ? "A newer GitHub release is ready. Review what changed below while Save Sora prepares the install."
      : "A newer GitHub release is ready. Review what changed below and choose whether to install it now.";
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
    return updateStatus.installFolderLinked
      ? "The linked folder is already saved. Chrome is only asking you to confirm write access for this install."
      : "The unpacked extension folder needs to be linked once before Save Sora can install GitHub updates automatically.";
  }
  if (updateStatus.phase === "error") {
    return updateStatus.error || "The last update check failed.";
  }
  if (updateStatus.lastCheckedAt) {
    return "Save Sora checks GitHub on startup and periodically while Chrome stays open.";
  }
  return "Save Sora checks GitHub on startup and periodically while Chrome stays open.";
}

function getUpdaterDiagnosticsText(updateStatus) {
  const latestVersion = updateStatus.latestGitHubVersion || updateStatus.latestVersion || "none";
  const manifestState = updateStatus.latestManifestDetected ? "found" : "missing";
  const zipState = updateStatus.latestZipDetected ? "found" : "missing";
  const pendingState = updateStatus.pendingUpdateReady ? "ready" : "not ready";
  return `Latest GitHub version: ${latestVersion} · Manifest: ${manifestState} · Package zip: ${zipState} · Pending update: ${pendingState}`;
}

function getUpdateGateProgressLabel(updateStatus) {
  switch (updateStatus.phase) {
    case "checking":
      return "Step 1 of 5 · Checking GitHub";
    case "update-available":
      return updateStatus.automaticUpdatesEnabled
        ? "Step 2 of 5 · Update found"
        : "Step 2 of 5 · Update ready";
    case "downloading":
      return "Step 3 of 5 · Downloading package";
    case "applying":
      return "Step 4 of 5 · Verifying and installing";
    case "reloading":
      return "Step 5 of 5 · Reloading Save Sora";
    case "deferred":
      return "Step 2 of 5 · Waiting to install";
    default:
      return `${Math.round(updateStatus.progress * 100)}%`;
  }
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
