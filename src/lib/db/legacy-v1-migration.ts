import { appendDownloadHistoryId } from "@lib/db/download-history-db";
import { createLogger } from "@lib/logging/logger";

const logger = createLogger("legacy-v1-migration");

const LEGACY_DB_NAME = "saveSoraVolatileBackup";
const LEGACY_DOWNLOADED_IDENTITIES_STORE = "downloaded_video_identities";
const LEGACY_MIGRATION_META_KEY = "save-sora-v2-legacy-v1-migration";

type LegacyMigrationMeta = {
  completed_at: string;
  legacy_db_version: number;
  imported_history_ids: number;
};

export async function migrateLegacyV1DataIfNeeded(): Promise<void> {
  const existing = await chrome.storage.local.get(LEGACY_MIGRATION_META_KEY);
  if (existing && existing[LEGACY_MIGRATION_META_KEY]) {
    return;
  }

  const legacyDbInfo = await resolveLegacyDbInfo();
  if (!legacyDbInfo) {
    await writeMigrationMeta({
      completed_at: new Date().toISOString(),
      legacy_db_version: 0,
      imported_history_ids: 0
    });
    return;
  }

  const importedCount = await migrateLegacyDownloadHistoryIds();
  await writeMigrationMeta({
    completed_at: new Date().toISOString(),
    legacy_db_version: legacyDbInfo.version,
    imported_history_ids: importedCount
  });
}

async function resolveLegacyDbInfo(): Promise<{ name: string; version: number } | null> {
  if (typeof indexedDB.databases !== "function") {
    return null;
  }

  try {
    const databases = await indexedDB.databases();
    const match = (Array.isArray(databases) ? databases : []).find(
      (entry) => entry && entry.name === LEGACY_DB_NAME && typeof entry.version === "number"
    );
    if (!match || typeof match.version !== "number") {
      return null;
    }
    return {
      name: LEGACY_DB_NAME,
      version: match.version
    };
  } catch (error) {
    logger.warn("could not inspect indexedDB catalog for legacy migration", error);
    return null;
  }
}

async function migrateLegacyDownloadHistoryIds(): Promise<number> {
  const db = await openLegacyDbReadonly();
  if (!db) {
    return 0;
  }

  try {
    if (!db.objectStoreNames.contains(LEGACY_DOWNLOADED_IDENTITIES_STORE)) {
      return 0;
    }

    const transaction = db.transaction([LEGACY_DOWNLOADED_IDENTITIES_STORE], "readonly");
    const store = transaction.objectStore(LEGACY_DOWNLOADED_IDENTITIES_STORE);
    const keys = await createIndexedDbRequestPromise<IDBValidKey[]>(store.getAllKeys());
    const normalizedIds = [...new Set((Array.isArray(keys) ? keys : []).filter(isFinalVideoId))];

    for (const videoId of normalizedIds) {
      await appendDownloadHistoryId(videoId);
    }

    return normalizedIds.length;
  } finally {
    db.close();
  }
}

function openLegacyDbReadonly(): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => {
      if (request.transaction) {
        request.transaction.abort();
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open legacy IndexedDB database."));
    request.onblocked = () => resolve(null);
  }).catch((error: unknown) => {
    logger.warn("legacy db open failed during migration", error);
    return null;
  });
}

function createIndexedDbRequestPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

function isFinalVideoId(value: IDBValidKey): value is string {
  return typeof value === "string" && value.startsWith("s_");
}

async function writeMigrationMeta(meta: LegacyMigrationMeta): Promise<void> {
  try {
    await chrome.storage.local.set({
      [LEGACY_MIGRATION_META_KEY]: meta
    });
  } catch (error) {
    logger.warn("could not write legacy migration marker", error);
  }
}
