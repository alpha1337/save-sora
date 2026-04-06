import { dom } from "../dom.js";
import {
  installPendingRuntimeUpdate,
  requestUpdateCheck,
  saveRuntimeSettings,
} from "../runtime.js";
import { popupState } from "../state.js";
import { showNotice } from "../ui/layout.js";
import { refreshStatus } from "./polling.js";

const UPDATE_GATE_MIN_STARTUP_DWELL_MS = 900;
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

export async function bootstrapUpdaterGate() {
  popupState.updateGateHidden = false;
  popupState.skippedUpdateVersion = "";

  try {
    await Promise.all([
      requestUpdateCheck({
        trigger: "startup",
        interactive: false,
        applyIfAvailable: true,
      }),
      new Promise((resolve) => {
        window.setTimeout(resolve, UPDATE_GATE_MIN_STARTUP_DWELL_MS);
      }),
    ]);
  } catch (error) {
    showNotice(dom.errorBox, error instanceof Error ? error.message : String(error));
  } finally {
    await refreshStatus();
    try {
      await dom.updateGateVideo?.play?.();
    } catch (_error) {
      // Ignore autoplay failures; the gate still works with the static backdrop.
    }
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
    await requestUpdateCheck({
      trigger: "manual",
      interactive: true,
      applyIfAvailable: true,
    });
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
    await installPendingRuntimeUpdate();
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
    const handle = await window.showDirectoryPicker({
      mode: "readwrite",
    });
    if (typeof handle.requestPermission === "function") {
      const permission = await handle.requestPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        throw new Error("Save Sora needs read and write access to that folder to install future updates.");
      }
    }
    const folderInfo = await validateSelectedInstallFolder(handle);
    await persistLinkedInstallFolderRecord(handle, folderInfo);
    await requestUpdateCheck({
      trigger: "folder-link",
      interactive: true,
      applyIfAvailable: true,
    });
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
