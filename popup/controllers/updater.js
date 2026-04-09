import { dom } from "../dom.js";
import {
  fetchRuntimeState,
  fetchUpdateStatus,
  installPendingRuntimeUpdate,
  requestDismissInterruptedSession,
  requestResetState,
  requestResumeScan,
  requestRestoreInterruptedSession,
  requestUpdateCheck,
  saveRuntimeSettings,
} from "../runtime.js";
import { popupState } from "../state.js";
import { showNotice } from "../ui/layout.js";
import { syncUpdateSurfaces } from "../ui/render/update-gate.js";
import { refreshStatus } from "./polling.js";

const UPDATE_GATE_MIN_STARTUP_DWELL_MS = 900;
const UPDATE_GATE_AUTO_INSTALL_DWELL_MS = 3200;
const UPDATE_GATE_POLL_INTERVAL_MS = 220;
const UPDATE_GATE_RELOAD_FALLBACK_MS = 1200;
const UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS = 15000;
const RESTORE_RESUME_SETTLE_TIMEOUT_MS = 12000;
const VOLATILE_BACKUP_DB_NAME = "saveSoraVolatileBackup";
const VOLATILE_BACKUP_DB_VERSION = 4;
const VOLATILE_BACKUP_ITEM_STORE = "items";
const VOLATILE_BACKUP_META_STORE = "meta";
const VOLATILE_BACKUP_UPDATER_STORE = "updater";
const UPDATE_FOLDER_RECORD_KEY = "install-folder";
const CURRENT_EXTENSION_MANIFEST = chrome.runtime.getManifest();
const CURRENT_EXTENSION_NAME =
  CURRENT_EXTENSION_MANIFEST && typeof CURRENT_EXTENSION_MANIFEST.name === "string"
    ? CURRENT_EXTENSION_MANIFEST.name
    : "Save Sora: Sora Bulk Downloader";
const BOOT_UPDATE_GATE_STEPS = 3;

export async function bootstrapUpdaterGate() {
  popupState.skippedUpdateVersion = "";
  setStartupGateLocked(true);
  const updatedVersionNotice = consumeUpdatedVersionNotice();

  try {
    await dom.updateGateVideo?.play?.();
  } catch (_error) {
    // Ignore autoplay failures; the gate still works with the static backdrop.
  }

  try {
    await refreshStatus();
    if (shouldBypassAutomaticUpdateStartup()) {
      popupState.updateGateHidden = true;
      setStartupGateLocked(false);
      syncUpdateSurfaces(popupState.latestUpdateStatus);
      if (updatedVersionNotice) {
        showNotice(
          dom.warningBox,
          `Save Sora updated to v${updatedVersionNotice} and reopened automatically.`,
        );
      }
      return;
    }
    if (shouldRunStartupUpdateSilently()) {
      popupState.updateGateHidden = true;
      setStartupGateLocked(false);
      void requestUpdateCheck({
        trigger: "startup",
        interactive: false,
        applyIfAvailable: false,
      })
        .then((updateStatus) => {
          syncUpdateSurfaces(updateStatus);
        })
        .catch(() => {
          // Keep background update discovery silent while the dashboard is already active.
        });
      syncUpdateSurfaces(popupState.latestUpdateStatus);
      if (updatedVersionNotice) {
        showNotice(
          dom.warningBox,
          `Save Sora updated to v${updatedVersionNotice} and reopened automatically.`,
        );
      }
      return;
    }

    popupState.updateGateHidden = false;
    setBootGateStep({
      step: 1,
      progress: 0.18,
      title: "Starting Save Sora…",
      message: "Preparing the updater and extension runtime before the dashboard opens.",
    });

    const updateCheckPromise = requestUpdateCheck({
      trigger: "startup",
      interactive: false,
      applyIfAvailable: false,
    });

    setBootGateStep({
      step: 2,
      progress: 0.46,
      title: "Checking GitHub for updates…",
      message: "Looking for a newer Save Sora release and validating your updater state.",
    });

    let updateStatus = await awaitUpdateOperation(updateCheckPromise, {
      minimumMs: UPDATE_GATE_MIN_STARTUP_DWELL_MS,
      timeoutMs: UPDATE_GATE_STARTUP_CHECK_TIMEOUT_MS,
    });

    updateStatus = await maybeAutoInstallAfterReview(updateStatus);

    if (shouldBlockDashboard(updateStatus)) {
      await refreshStatus();
      return;
    }

    setBootGateStep({
      step: 3,
      progress: 0.82,
      title: "Loading your dashboard…",
      message: "Restoring your saved settings, working set, and recent extension state.",
    });
    await waitForMs(140);
    setStartupGateLocked(false);
    await refreshStatus();
    if (updatedVersionNotice) {
      showNotice(
        dom.warningBox,
        `Save Sora updated to v${updatedVersionNotice} and reopened automatically.`,
      );
    }
  } catch (error) {
    popupState.updateGateHidden = true;
    setStartupGateLocked(false);
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    await refreshStatus();
  }
}

export function handleUpdateGateLinkClick() {
  void linkInstallFolderFromUserGesture();
}

export function handleUpdateGateInstallClick() {
  if (popupState.restoreGateVisible) {
    void restorePreviousSessionFromGate();
    return;
  }
  void installPendingUpdateFromUi();
}

export function handleUpdateGateRetryClick() {
  void checkForUpdatesFromUi();
}

export function handleUpdateGateSkipClick() {
  if (popupState.restoreGateVisible) {
    void dismissPreviousSessionFromGate();
    return;
  }
  popupState.skippedUpdateVersion =
    popupState.latestUpdateStatus.pendingUpdateVersion || popupState.latestUpdateStatus.latestVersion || "";
  popupState.updateGateHidden = true;
  void refreshStatus();
}

export function handleUpdateGateContinueClick() {
  if (popupState.restoreGateVisible) {
    void startOverInterruptedSessionFromGate();
    return;
  }
  void continueWithoutBlockingUpdateGate();
}

export function handleUpdaterCheckNowClick() {
  void checkForUpdatesFromUi();
}

export function handleUpdaterRelinkClick() {
  void linkInstallFolderFromUserGesture();
}

async function checkForUpdatesFromUi() {
  try {
    popupState.updateGateHidden = false;
    popupState.skippedUpdateVersion = "";
    let updateStatus = await awaitUpdateOperation(
      requestUpdateCheck({
        trigger: "manual",
        interactive: true,
        applyIfAvailable: false,
      }),
    );
    updateStatus = await maybeAutoInstallAfterReview(updateStatus);
    if (!shouldBlockDashboard(updateStatus)) {
      popupState.updateGateHidden = true;
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

async function continueWithoutBlockingUpdateGate() {
  try {
    if (popupState.latestUpdateStatus.phase === "awaiting-folder") {
      await saveRuntimeSettings({
        automaticUpdatesEnabled: false,
      });
    }
    popupState.updateGateHidden = true;
    setStartupGateLocked(false);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    syncUpdateSurfaces(popupState.latestUpdateStatus);
    await refreshStatus();
  }
}

async function restorePreviousSessionFromGate() {
  if (popupState.restoreGatePhase === "restoring") {
    return;
  }

  try {
    popupState.restoreGatePhase = "restoring";
    popupState.restoreGateVisible = true;
    setStartupGateLocked(true);
    if (popupState.latestRuntimeState && typeof popupState.latestRuntimeState === "object") {
      popupState.latestRuntimeState = {
        ...popupState.latestRuntimeState,
        restoreStatus: {
          ...(popupState.latestRuntimeState.restoreStatus || {}),
          phase: "restoring",
          promptVisible: false,
          loadedItems: 0,
          totalItems: Number(popupState.latestRuntimeState.restoreStatus?.totalItems) || 0,
          message: "Loading your previously fetched videos from local storage before Save Sora opens.",
        },
      };
      syncUpdateSurfaces(popupState.latestUpdateStatus);
    }

    const restoredState = await requestRestoreInterruptedSession();
    if (restoredState) {
      popupState.latestRuntimeState = restoredState;
    }
    syncUpdateSurfaces(popupState.latestUpdateStatus);

    const resumedBootstrapState = await requestResumeScan();
    if (resumedBootstrapState && typeof resumedBootstrapState === "object") {
      popupState.latestRuntimeState = resumedBootstrapState;
    }
    syncUpdateSurfaces(popupState.latestUpdateStatus);

    const resumedState = await waitForResumedFetchState();

    popupState.restoreGatePhase = "idle";
    popupState.restoreGateVisible = false;
    popupState.updateGateHidden = true;
    setStartupGateLocked(false);
    if (resumedState) {
      popupState.latestRuntimeState = resumedState;
    }
    syncUpdateSurfaces(popupState.latestUpdateStatus);
    await refreshStatus();
  } catch (error) {
    popupState.restoreGatePhase = "prompt";
    popupState.restoreGateVisible = true;
    setStartupGateLocked(true);
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    syncUpdateSurfaces(popupState.latestUpdateStatus);
    await refreshStatus();
  }
}

async function waitForResumedFetchState() {
  const startedAt = Date.now();
  let lastState = null;

  while (Date.now() - startedAt < RESTORE_RESUME_SETTLE_TIMEOUT_MS) {
    await waitForMs(UPDATE_GATE_POLL_INTERVAL_MS);
    const state = await fetchRuntimeState({
      sortKey: popupState.browseState.sort,
      query: popupState.browseState.query,
      creatorTab: popupState.activeCreatorResultsTab,
    });
    lastState = state;

    const phase = state && typeof state.phase === "string" ? state.phase : "idle";
    const syncStatus =
      state && typeof state.syncStatus === "string" ? state.syncStatus : "idle";
    const restorePhase =
      state &&
      state.restoreStatus &&
      typeof state.restoreStatus === "object" &&
      typeof state.restoreStatus.phase === "string"
        ? state.restoreStatus.phase
        : "idle";

    if (phase === "fetching" || syncStatus === "running") {
      return state;
    }

    if (restorePhase === "error" || (state && typeof state.lastError === "string" && state.lastError)) {
      throw new Error(
        (state && state.lastError) ||
          (state && state.restoreStatus && state.restoreStatus.error) ||
          "Save Sora could not resume the previous fetch.",
      );
    }
  }

  throw new Error("Save Sora could not finish resuming the previous fetch.");
}

async function dismissPreviousSessionFromGate() {
  try {
    popupState.restoreGateVisible = false;
    popupState.restoreGatePhase = "idle";
    setStartupGateLocked(false);
    const dismissedState = await requestDismissInterruptedSession();
    if (dismissedState && typeof dismissedState === "object") {
      popupState.latestRuntimeState = dismissedState;
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    popupState.updateGateHidden = true;
    syncUpdateSurfaces(popupState.latestUpdateStatus);
    await refreshStatus();
  }
}

async function startOverInterruptedSessionFromGate() {
  try {
    popupState.restoreGateVisible = false;
    popupState.restoreGatePhase = "idle";
    setStartupGateLocked(false);
    await requestResetState();
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    popupState.updateGateHidden = true;
    syncUpdateSurfaces(popupState.latestUpdateStatus);
    await refreshStatus();
  }
}

async function installPendingUpdateFromUi() {
  try {
    popupState.updateGateHidden = false;
    popupState.skippedUpdateVersion = "";
    const updateStatus = await awaitUpdateOperation(
      installPendingRuntimeUpdate({ forceApply: true }),
    );
    await maybeFinalizeReloadingUpdate(updateStatus);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
  }
}

async function linkInstallFolderFromUserGesture() {
  if (typeof window.showDirectoryPicker !== "function") {
    presentInstallFolderLinkError(getInstallFolderUnavailableMessage());
    return;
  }

  try {
    popupState.updateGateHidden = false;
    const { handle, folderInfo } = await requestInstallFolderHandleFromUserGesture();
    await persistLinkedInstallFolderRecord(handle, folderInfo);
    let updateStatus = await awaitUpdateOperation(
      requestUpdateCheck({
        trigger: "folder-link",
        interactive: true,
        applyIfAvailable: false,
      }),
    );
    updateStatus = await maybeAutoInstallAfterReview(updateStatus);
    if (!shouldBlockDashboard(updateStatus)) {
      popupState.updateGateHidden = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/aborted|cancelled|canceled/i.test(message)) {
      return;
    }
    presentInstallFolderLinkError(message);
  } finally {
    await refreshStatus();
  }
}

function presentInstallFolderLinkError(message) {
  const resolvedMessage =
    typeof message === "string" && message.trim()
      ? message.trim()
      : "Save Sora could not link the unpacked extension folder.";

  showNotice(dom.errorBox, resolvedMessage);

  if (dom.settingsStatus instanceof HTMLElement) {
    dom.settingsStatus.textContent = resolvedMessage;
  }

  if (typeof window.alert === "function") {
    window.alert(resolvedMessage);
  }
}

function getInstallFolderUnavailableMessage() {
  if (isLikelyBraveBrowser()) {
    return "Brave currently has the File System Access API disabled for this extension, so Save Sora cannot open the folder chooser here. Enable brave://flags/#file-system-access-api, restart Brave, and then try Link folder again.";
  }

  return "This browser cannot grant access to the unpacked extension folder from Save Sora.";
}

function isLikelyBraveBrowser() {
  try {
    if (navigator.brave) {
      return true;
    }
  } catch (_error) {
    // Ignore access issues and continue with user-agent heuristics.
  }

  const brands =
    navigator.userAgentData && Array.isArray(navigator.userAgentData.brands)
      ? navigator.userAgentData.brands
      : [];
  if (brands.some((brand) => typeof brand.brand === "string" && /brave/i.test(brand.brand))) {
    return true;
  }

  return /brave/i.test(navigator.userAgent);
}

async function requestInstallFolderHandleFromUserGesture() {
  const storedRecord = await readStoredInstallFolderRecord();
  if (hasStoredInstallFolderHandle(storedRecord)) {
    try {
      await ensureWritableInstallFolderPermission(storedRecord.handle);
      const folderInfo = await validateSelectedInstallFolder(storedRecord.handle);
      return {
        handle: storedRecord.handle,
        folderInfo,
      };
    } catch (_error) {
      // Fall through to the directory picker if the stored handle is stale or permission is no longer usable.
    }
  }

  const handle = await window.showDirectoryPicker({
    mode: "readwrite",
  });
  await ensureWritableInstallFolderPermission(handle);
  const folderInfo = await validateSelectedInstallFolder(handle);
  return {
    handle,
    folderInfo,
  };
}

async function ensureWritableInstallFolderPermission(handle) {
  if (typeof handle.requestPermission === "function") {
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new Error("Save Sora needs read and write access to that folder to install future updates.");
    }
    return;
  }

  if (typeof handle.queryPermission === "function") {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      throw new Error("Save Sora needs read and write access to that folder to install future updates.");
    }
  }
}

function openUpdaterDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VOLATILE_BACKUP_DB_NAME, VOLATILE_BACKUP_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      let itemStore;
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_ITEM_STORE)) {
        itemStore = db.createObjectStore(VOLATILE_BACKUP_ITEM_STORE, {
          keyPath: "id",
        });
      } else {
        itemStore = request.transaction.objectStore(VOLATILE_BACKUP_ITEM_STORE);
      }
      if (!itemStore.indexNames.contains("sessionKey")) {
        itemStore.createIndex("sessionKey", "sessionKey", { unique: false });
      }
      if (!itemStore.indexNames.contains("sessionProgressKey")) {
        itemStore.createIndex("sessionProgressKey", "sessionProgressKey", { unique: false });
      }
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_META_STORE)) {
        db.createObjectStore(VOLATILE_BACKUP_META_STORE, {
          keyPath: "sessionKey",
        });
      }
      if (!db.objectStoreNames.contains(VOLATILE_BACKUP_UPDATER_STORE)) {
        db.createObjectStore(VOLATILE_BACKUP_UPDATER_STORE, {
          keyPath: "key",
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not open the updater database."));
  });
}

async function validateSelectedInstallFolder(handle) {
  if (!handle || handle.kind !== "directory") {
    throw new Error("Select the unpacked Save Sora extension folder.");
  }

  const manifestHandle = await handle.getFileHandle("manifest.json", { create: false });
  const manifestFile = await manifestHandle.getFile();
  const manifestText = await manifestFile.text();
  const parsedManifest = JSON.parse(manifestText);
  if (!parsedManifest || parsedManifest.name !== CURRENT_EXTENSION_NAME) {
    throw new Error("The selected folder does not look like the Save Sora unpacked extension.");
  }

  return {
    manifestVersion:
      parsedManifest && typeof parsedManifest.version === "string" ? parsedManifest.version : "",
    manifestName:
      parsedManifest && typeof parsedManifest.name === "string" ? parsedManifest.name : "",
  };
}

async function persistLinkedInstallFolderRecord(handle, folderInfo) {
  const db = await openUpdaterDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction([VOLATILE_BACKUP_UPDATER_STORE], "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not store the updater folder link."));
    const store = transaction.objectStore(VOLATILE_BACKUP_UPDATER_STORE);
    const getRequest = store.get(UPDATE_FOLDER_RECORD_KEY);
    getRequest.onsuccess = () => {
      const existingRecord =
        getRequest.result && typeof getRequest.result === "object" ? getRequest.result : {};
      store.put({
        ...existingRecord,
        key: UPDATE_FOLDER_RECORD_KEY,
        handle,
        linkedAt: new Date().toISOString(),
        manifestVersion: folderInfo.manifestVersion,
        manifestName: folderInfo.manifestName,
        updatedAt: new Date().toISOString(),
      });
    };
    getRequest.onerror = () =>
      reject(getRequest.error || new Error("Could not read the existing updater folder link."));
  });
}

function hasStoredInstallFolderHandle(record) {
  return Boolean(record && record.handle && record.handle.kind === "directory");
}

async function readStoredInstallFolderRecord() {
  const db = await openUpdaterDb();
  const transaction = db.transaction([VOLATILE_BACKUP_UPDATER_STORE], "readonly");
  const store = transaction.objectStore(VOLATILE_BACKUP_UPDATER_STORE);
  const record = await new Promise((resolve, reject) => {
    const request = store.get(UPDATE_FOLDER_RECORD_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Could not read the saved updater folder link."));
  });

  return record && typeof record === "object" ? record : null;
}

function setBootGateStep({ step, progress, title, message }) {
  if (dom.updateGate instanceof HTMLElement) {
    dom.updateGate.classList.remove("hidden");
    dom.updateGate.setAttribute("aria-hidden", "false");
    dom.updateGate.setAttribute("aria-busy", "true");
  }
  if (dom.updateGateTitle instanceof HTMLElement && typeof title === "string") {
    dom.updateGateTitle.textContent = title;
  }
  if (dom.updateGateMessage instanceof HTMLElement && typeof message === "string") {
    dom.updateGateMessage.textContent = message;
  }
  if (dom.updateGateSpinner instanceof HTMLElement) {
    dom.updateGateSpinner.classList.remove("hidden");
  }
  if (dom.updateGateProgress instanceof HTMLElement) {
    dom.updateGateProgress.classList.remove("hidden");
    dom.updateGateProgress.setAttribute("aria-hidden", "false");
  }
  if (dom.updateGateProgressFill instanceof HTMLElement) {
    dom.updateGateProgressFill.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }
  if (dom.updateGateProgressLabel instanceof HTMLElement) {
    dom.updateGateProgressLabel.textContent = `Step ${step} of ${BOOT_UPDATE_GATE_STEPS}`;
  }
  if (dom.updateGateChangelog instanceof HTMLElement) {
    dom.updateGateChangelog.classList.add("hidden");
  }
  if (dom.updateGateActions instanceof HTMLElement) {
    dom.updateGateActions.classList.add("hidden");
  }
}

function shouldRunStartupUpdateSilently() {
  return popupState.currentPhase === "fetching" || popupState.currentPhase === "fetch-paused";
}

function setStartupGateLocked(locked) {
  popupState.startupGateLocked = locked === true;
}

function shouldBypassAutomaticUpdateStartup() {
  const runtimeSettings =
    popupState.latestRuntimeState &&
    popupState.latestRuntimeState.settings &&
    typeof popupState.latestRuntimeState.settings === "object"
      ? popupState.latestRuntimeState.settings
      : {};
  return runtimeSettings.automaticUpdatesEnabled === false;
}

async function awaitUpdateOperation(operationPromise, options = {}) {
  const minimumMs = Math.max(0, Number(options.minimumMs) || 0);
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
  const startedAt = Date.now();
  let settled = false;
  let resolvedValue;
  let rejectedError = null;

  operationPromise
    .then((value) => {
      settled = true;
      resolvedValue = value;
    })
    .catch((error) => {
      settled = true;
      rejectedError = error;
    });

  while (!settled || Date.now() - startedAt < minimumMs) {
    if (!settled && timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
      throw new Error("Save Sora timed out while checking GitHub for updates.");
    }

    try {
      const liveStatus = await fetchUpdateStatus();
      syncUpdateSurfaces(liveStatus);
    } catch (_error) {
      // Ignore transient polling failures while the background updater is still working.
    }

    if (settled && Date.now() - startedAt >= minimumMs) {
      break;
    }

    await waitForMs(UPDATE_GATE_POLL_INTERVAL_MS);
  }

  if (rejectedError) {
    throw rejectedError;
  }

  syncUpdateSurfaces(resolvedValue);
  return resolvedValue;
}

async function maybeAutoInstallAfterReview(updateStatus) {
  if (!shouldAutoInstallAfterReview(updateStatus)) {
    return updateStatus;
  }

  await waitForMs(UPDATE_GATE_AUTO_INSTALL_DWELL_MS);

  const liveStatus = await fetchUpdateStatus();
  syncUpdateSurfaces(liveStatus);

  if (!shouldAutoInstallAfterReview(liveStatus) || isSkippedForSession(liveStatus)) {
    return liveStatus;
  }

  const installedStatus = await awaitUpdateOperation(installPendingRuntimeUpdate());
  await maybeFinalizeReloadingUpdate(installedStatus);
  return installedStatus;
}

function shouldAutoInstallAfterReview(updateStatus) {
  return Boolean(
    updateStatus &&
      updateStatus.phase === "update-available" &&
      updateStatus.installFolderLinked === true &&
      updateStatus.automaticUpdatesEnabled !== false,
  );
}

function shouldBlockDashboard(updateStatus) {
  return isBlockingUpdatePhase(updateStatus?.phase) && !isSkippedForSession(updateStatus);
}

function isSkippedForSession(updateStatus) {
  const pendingVersion =
    updateStatus && typeof updateStatus.pendingUpdateVersion === "string" && updateStatus.pendingUpdateVersion
      ? updateStatus.pendingUpdateVersion
      : updateStatus && typeof updateStatus.latestVersion === "string"
        ? updateStatus.latestVersion
        : "";
  return Boolean(
    pendingVersion &&
      popupState.skippedUpdateVersion &&
      popupState.skippedUpdateVersion === pendingVersion,
  );
}

function isBlockingUpdatePhase(phase) {
  return [
    "awaiting-folder",
    "update-available",
    "downloading",
    "applying",
    "reloading",
    "deferred",
    "error",
  ].includes(typeof phase === "string" ? phase : "");
}

async function maybeFinalizeReloadingUpdate(updateStatus) {
  if (!updateStatus || updateStatus.phase !== "reloading") {
    return;
  }

  await waitForMs(UPDATE_GATE_RELOAD_FALLBACK_MS);

  try {
    const liveStatus = await fetchUpdateStatus();
    syncUpdateSurfaces(liveStatus);
    if (liveStatus.phase !== "reloading") {
      return;
    }
  } catch (_error) {
    // Ignore transient runtime disconnects during extension reload.
  }

  window.location.reload();
}

function waitForMs(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function consumeUpdatedVersionNotice() {
  try {
    const url = new URL(window.location.href);
    const updatedVersion = url.searchParams.get("updated");
    if (!updatedVersion) {
      return "";
    }
    url.searchParams.delete("updated");
    window.history.replaceState({}, "", url.toString());
    return updatedVersion;
  } catch (_error) {
    return "";
  }
}
