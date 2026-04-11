import { openDB } from "idb";

const DOWNLOAD_HISTORY_DB_NAME = "save-sora-v2-download-history";
const DOWNLOAD_HISTORY_DB_VERSION = 1;

/**
 * Permanent append-only history store keyed by final resolved `s_*` ids.
 */
export async function openDownloadHistoryDb() {
  return openDB(DOWNLOAD_HISTORY_DB_NAME, DOWNLOAD_HISTORY_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("download_history")) {
        database.createObjectStore("download_history", { keyPath: "video_id" });
      }
    }
  });
}

export async function listDownloadHistoryIds(): Promise<string[]> {
  const database = await openDownloadHistoryDb();
  const rows = await database.getAll("download_history");
  return rows.map((row) => row.video_id);
}

export async function appendDownloadHistoryId(videoId: string): Promise<void> {
  const database = await openDownloadHistoryDb();
  try {
    await database.add("download_history", { video_id: videoId });
  } catch (error) {
    if (error instanceof DOMException && error.name === "ConstraintError") {
      return;
    }
    throw error;
  }
}

export async function clearDownloadHistory(): Promise<void> {
  const database = await openDownloadHistoryDb();
  await database.clear("download_history");
}
