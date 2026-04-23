import { DOWNLOAD_HISTORY_STORE, openSaveSoraV3Db } from "./save-sora-v3-db";

/**
 * Permanent append-only history store keyed by downloaded video ids.
 */
export async function openDownloadHistoryDb() {
  return openSaveSoraV3Db();
}

export async function listDownloadHistoryIds(): Promise<string[]> {
  const database = await openDownloadHistoryDb();
  const rows = await database.getAll(DOWNLOAD_HISTORY_STORE);
  return rows.map((row) => row.video_id);
}

export async function appendDownloadHistoryId(videoId: string): Promise<void> {
  const database = await openDownloadHistoryDb();
  try {
    await database.add(DOWNLOAD_HISTORY_STORE, { video_id: videoId });
  } catch (error) {
    if (error instanceof DOMException && error.name === "ConstraintError") {
      return;
    }
    throw error;
  }
}

export async function clearDownloadHistory(): Promise<void> {
  const database = await openDownloadHistoryDb();
  await database.clear(DOWNLOAD_HISTORY_STORE);
}
