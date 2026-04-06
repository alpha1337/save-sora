import { dom } from "../dom.js";
import {
  fetchUpdateStatus,
  installPendingRuntimeUpdate,
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
const VOLATILE_BACKUP_DB_NAME = "saveSoraVolatileBackup";
const VOLATILE_BACKUP_DB_VERSION = 3;
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
  popupState.updateGateHidden = false;
  popupState.skippedUpdateVersion = "";
  const updatedVersionNotice = consumeUpdatedVersionNotice();

  try {
    await dom.updateGateVideo?.play?.();
  } catch (_error) {
    // Ignore autoplay failures; the gate still works with the static backdrop.
  }

  try {
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
    await refreshStatus();
    if (updatedVersionNotice) {
      showNotice(
        dom.warningBox,
        `Save Sora updated to v${updatedVersionNotice} and reopened automatically.`,
      );
    }
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
    await refreshStatus();
  }
}

export function handleUpdateGateLinkClick() {
  void linkInstallFolderFromUserGesture();
}

export function handleUpdateGateInstallClick() {
  void installPendingUpdateFromUi();
}

export function handleUpdateGateRetryClick() {
  void checkForUpdatesFromUi();
}

export function handleUpdateGateSkipClick() {
  popupState.skippedUpdateVersion =
    popupState.latestUpdateStatus.pendingUpdateVersion || popupState.latestUpdateStatus.latestVersion || "";
  popupState.updateGateHidden = true;
  void refreshStatus();
}

export function handleUpdateGateContinueClick() {
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
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
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
    showNotice(dom.errorBox, "This version of Chrome cannot grant access to the unpacked extension folder.");
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
    showNotice(dom.errorBox, message);
  } finally {
    await refreshStatus();
  }
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

async function awaitUpdateOperation(operationPromise, options = {}) {
  const minimumMs = Math.max(0, Number(options.minimumMs) || 0);
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
