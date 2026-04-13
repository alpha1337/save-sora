import { openDB } from "idb";
import type { AppSettings, DraftResolutionRecord, FetchJobCheckpoint, SessionMeta, VideoRow } from "types/domain";

const SESSION_DB_NAME = "save-sora-v2-session";
const SESSION_DB_VERSION = 2;

export interface SessionDbSnapshot {
  settings: AppSettings | null;
  session_meta: SessionMeta | null;
  video_rows: VideoRow[];
  download_queue: string[];
  draft_resolution_records: DraftResolutionRecord[];
  fetch_job_checkpoints: FetchJobCheckpoint[];
}

/**
 * Resettable working-session storage used by the fullscreen app.
 */
export async function openSessionDb() {
  return openDB(SESSION_DB_NAME, SESSION_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings");
      }
      if (!database.objectStoreNames.contains("session_meta")) {
        database.createObjectStore("session_meta");
      }
      if (!database.objectStoreNames.contains("video_rows")) {
        database.createObjectStore("video_rows", { keyPath: "row_id" });
      }
      if (!database.objectStoreNames.contains("download_queue")) {
        database.createObjectStore("download_queue", { keyPath: "video_id" });
      }
      if (!database.objectStoreNames.contains("draft_resolution_cache")) {
        database.createObjectStore("draft_resolution_cache", { keyPath: "generation_id" });
      }
      if (!database.objectStoreNames.contains("fetch_job_checkpoints")) {
        database.createObjectStore("fetch_job_checkpoints", { keyPath: "job_id" });
      }
    }
  });
}

export async function loadSessionDbSnapshot(): Promise<SessionDbSnapshot> {
  const database = await openSessionDb();
  const [settings, sessionMeta, videoRows, queueRows, draftResolutionRows, fetchJobCheckpoints] = await Promise.all([
    database.get("settings", "settings"),
    database.get("session_meta", "session_meta"),
    database.getAll("video_rows"),
    database.getAll("download_queue"),
    database.getAll("draft_resolution_cache"),
    database.getAll("fetch_job_checkpoints")
  ]);

  return {
    settings: settings ?? null,
    session_meta: sessionMeta ?? null,
    video_rows: videoRows,
    download_queue: queueRows.map((entry) => entry.video_id),
    draft_resolution_records: draftResolutionRows,
    fetch_job_checkpoints: fetchJobCheckpoints
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const database = await openSessionDb();
  await database.put("settings", settings, "settings");
}

export async function saveSessionMeta(sessionMeta: SessionMeta): Promise<void> {
  const database = await openSessionDb();
  await database.put("session_meta", sessionMeta, "session_meta");
}

export async function replaceVideoRows(rows: VideoRow[]): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction("video_rows", "readwrite");
  await transaction.store.clear();
  for (const row of rows) {
    await transaction.store.put(row);
  }
  await transaction.done;
}

export async function upsertVideoRows(rows: VideoRow[]): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction("video_rows", "readwrite");
  for (const row of rows) {
    await transaction.store.put(row);
  }
  await transaction.done;
}

export async function replaceDownloadQueue(videoIds: string[]): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction("download_queue", "readwrite");
  await transaction.store.clear();
  for (const videoId of videoIds) {
    await transaction.store.put({ video_id: videoId });
  }
  await transaction.done;
}

export async function loadDraftResolutionMap(): Promise<Map<string, string>> {
  const database = await openSessionDb();
  const rows = await database.getAll("draft_resolution_cache");
  return new Map(rows.map((row) => [row.generation_id, row.video_id]));
}

export async function saveDraftResolutionRecords(records: DraftResolutionRecord[]): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction("draft_resolution_cache", "readwrite");
  for (const record of records) {
    await transaction.store.put(record);
  }
  await transaction.done;
}

export async function loadFetchJobCheckpoints(): Promise<FetchJobCheckpoint[]> {
  const database = await openSessionDb();
  return database.getAll("fetch_job_checkpoints");
}

export async function saveFetchJobCheckpoint(checkpoint: FetchJobCheckpoint): Promise<void> {
  const database = await openSessionDb();
  await database.put("fetch_job_checkpoints", checkpoint);
}

export async function clearFetchJobCheckpoints(): Promise<void> {
  const database = await openSessionDb();
  await database.clear("fetch_job_checkpoints");
}

export async function clearWorkingSessionData(): Promise<void> {
  const database = await openSessionDb();
  const transaction = database.transaction(
    ["session_meta", "video_rows", "download_queue", "draft_resolution_cache", "fetch_job_checkpoints"],
    "readwrite"
  );
  await transaction.objectStore("session_meta").clear();
  await transaction.objectStore("video_rows").clear();
  await transaction.objectStore("download_queue").clear();
  await transaction.objectStore("draft_resolution_cache").clear();
  await transaction.objectStore("fetch_job_checkpoints").clear();
  await transaction.done;
}
