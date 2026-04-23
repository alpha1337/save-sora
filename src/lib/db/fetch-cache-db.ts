import { openDB } from "idb";
import type { FetchJobCheckpoint, VideoRow } from "types/domain";

const FETCH_CACHE_DB_NAME = "save-sora-v2-fetch-cache";
const FETCH_CACHE_DB_VERSION = 2;
const ROWS_STORE = "rows";
const JOB_ROWS_STORE = "job_rows";
const CHECKPOINTS_STORE = "checkpoints";
const JOB_ROWS_BY_JOB_ID_INDEX = "by_job_id";
const JOB_ROWS_BY_ROW_ID_INDEX = "by_row_id";
const JOB_ROWS_BY_UPDATED_AT_INDEX = "by_updated_at";
const CHECKPOINT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;
const CACHE_ROW_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3;
const CACHE_PRUNE_INTERVAL_MS = 1000 * 60;
let lastCachePruneMs = 0;
let cachePruneInFlight: Promise<void> | null = null;

interface JobRowRecord {
  id: string;
  job_id: string;
  row_id: string;
  updated_at: string;
}

export async function openFetchCacheDb() {
  return openDB(FETCH_CACHE_DB_NAME, FETCH_CACHE_DB_VERSION, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      if (!database.objectStoreNames.contains(ROWS_STORE)) {
        database.createObjectStore(ROWS_STORE, { keyPath: "row_id" });
      }
      const jobRowsStore = database.objectStoreNames.contains(JOB_ROWS_STORE)
        ? transaction.objectStore(JOB_ROWS_STORE)
        : database.createObjectStore(JOB_ROWS_STORE, { keyPath: "id" });
      if (!jobRowsStore.indexNames.contains(JOB_ROWS_BY_JOB_ID_INDEX)) {
        jobRowsStore.createIndex(JOB_ROWS_BY_JOB_ID_INDEX, "job_id", { unique: false });
      }
      if (!jobRowsStore.indexNames.contains(JOB_ROWS_BY_ROW_ID_INDEX)) {
        jobRowsStore.createIndex(JOB_ROWS_BY_ROW_ID_INDEX, "row_id", { unique: false });
      }
      if (!jobRowsStore.indexNames.contains(JOB_ROWS_BY_UPDATED_AT_INDEX)) {
        jobRowsStore.createIndex(JOB_ROWS_BY_UPDATED_AT_INDEX, "updated_at", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHECKPOINTS_STORE)) {
        database.createObjectStore(CHECKPOINTS_STORE, { keyPath: "job_id" });
      }
    }
  });
}

export async function loadFetchRowsForJobs(jobIds: string[]): Promise<VideoRow[]> {
  if (jobIds.length === 0) {
    return [];
  }

  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction([JOB_ROWS_STORE, ROWS_STORE], "readonly");
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const rowsStore = transaction.objectStore(ROWS_STORE);

  const rowIds = new Set<string>();
  for (const jobId of [...new Set(jobIds)]) {
    const records = await jobRowsStore.index(JOB_ROWS_BY_JOB_ID_INDEX).getAll(jobId);
    for (const record of records) {
      const jobRowRecord = record as JobRowRecord;
      if (jobRowRecord.row_id) {
        rowIds.add(jobRowRecord.row_id);
      }
    }
  }

  const rows: VideoRow[] = [];
  for (const rowId of rowIds) {
    const row = await rowsStore.get(rowId);
    if (isVideoRow(row)) {
      rows.push(row);
    }
  }

  await transaction.done;
  return rows;
}

export async function loadAllFetchRows(): Promise<VideoRow[]> {
  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction(ROWS_STORE, "readonly");
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const rawRows = await rowsStore.getAll();
  await transaction.done;
  return rawRows.filter(isVideoRow);
}

export async function loadRecentFetchRows(limit: number): Promise<VideoRow[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (normalizedLimit === 0) {
    return [];
  }

  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction([JOB_ROWS_STORE, ROWS_STORE], "readonly");
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const uniqueRowIds: string[] = [];
  const seenRowIds = new Set<string>();

  let cursor = await jobRowsStore.index(JOB_ROWS_BY_UPDATED_AT_INDEX).openCursor(null, "prev");
  while (cursor && uniqueRowIds.length < normalizedLimit) {
    const record = cursor.value as JobRowRecord;
    const rowId = typeof record?.row_id === "string" ? record.row_id : "";
    if (rowId && !seenRowIds.has(rowId)) {
      seenRowIds.add(rowId);
      uniqueRowIds.push(rowId);
    }
    cursor = await cursor.continue();
  }

  const rows: VideoRow[] = [];
  for (const rowId of uniqueRowIds) {
    const row = await rowsStore.get(rowId);
    if (isVideoRow(row)) {
      rows.push(row);
    }
  }

  await transaction.done;
  return rows;
}

export async function loadLatestSelectionFetchRows(): Promise<VideoRow[]> {
  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction([CHECKPOINTS_STORE, JOB_ROWS_STORE, ROWS_STORE], "readonly");
  const checkpointsStore = transaction.objectStore(CHECKPOINTS_STORE);
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const validCheckpoints: FetchJobCheckpoint[] = [];
  const nowMs = Date.now();

  let checkpointCursor = await checkpointsStore.openCursor();
  while (checkpointCursor) {
    const checkpoint = checkpointCursor.value;
    if (isCheckpointRecord(checkpoint)) {
      const updatedAtMs = Date.parse(checkpoint.updated_at);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= CHECKPOINT_MAX_AGE_MS) {
        validCheckpoints.push(checkpoint);
      }
    }
    checkpointCursor = await checkpointCursor.continue();
  }

  if (validCheckpoints.length === 0) {
    await transaction.done;
    return [];
  }

  const latestCheckpoint = validCheckpoints.reduce((latest, current) => {
    const latestMs = Date.parse(latest.updated_at);
    const currentMs = Date.parse(current.updated_at);
    return currentMs > latestMs ? current : latest;
  });
  const latestSelectionSignature = latestCheckpoint.selection_signature;
  const selectionJobIds = [...new Set(
    validCheckpoints
      .filter((checkpoint) => checkpoint.selection_signature === latestSelectionSignature)
      .map((checkpoint) => checkpoint.job_id)
  )];

  if (selectionJobIds.length === 0) {
    await transaction.done;
    return [];
  }

  const rowIds = new Set<string>();
  for (const jobId of selectionJobIds) {
    const records = await jobRowsStore.index(JOB_ROWS_BY_JOB_ID_INDEX).getAll(jobId);
    for (const record of records) {
      const jobRowRecord = record as JobRowRecord;
      if (jobRowRecord.row_id) {
        rowIds.add(jobRowRecord.row_id);
      }
    }
  }

  const rows: VideoRow[] = [];
  for (const rowId of rowIds) {
    const row = await rowsStore.get(rowId);
    if (isVideoRow(row)) {
      rows.push(row);
    }
  }

  await transaction.done;
  return rows;
}

export async function hasResumableLatestSelectionCheckpoint(): Promise<boolean> {
  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction(CHECKPOINTS_STORE, "readonly");
  const checkpointsStore = transaction.objectStore(CHECKPOINTS_STORE);
  const validCheckpoints: FetchJobCheckpoint[] = [];
  const nowMs = Date.now();

  let checkpointCursor = await checkpointsStore.openCursor();
  while (checkpointCursor) {
    const checkpoint = checkpointCursor.value;
    if (isCheckpointRecord(checkpoint)) {
      const updatedAtMs = Date.parse(checkpoint.updated_at);
      if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs <= CHECKPOINT_MAX_AGE_MS) {
        validCheckpoints.push(checkpoint);
      }
    }
    checkpointCursor = await checkpointCursor.continue();
  }

  await transaction.done;

  if (validCheckpoints.length === 0) {
    return false;
  }

  const latestCheckpoint = validCheckpoints.reduce((latest, current) => {
    const latestMs = Date.parse(latest.updated_at);
    const currentMs = Date.parse(current.updated_at);
    return currentMs > latestMs ? current : latest;
  });

  const latestSelectionSignature = latestCheckpoint.selection_signature;
  const selectionCheckpoints = validCheckpoints.filter(
    (checkpoint) => checkpoint.selection_signature === latestSelectionSignature
  );

  if (selectionCheckpoints.length === 0) {
    return false;
  }

  return selectionCheckpoints.some((checkpoint) => checkpoint.status !== "completed");
}

export async function saveFetchBatchState(jobId: string, rows: VideoRow[], checkpoint: FetchJobCheckpoint): Promise<void> {
  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction([ROWS_STORE, JOB_ROWS_STORE, CHECKPOINTS_STORE], "readwrite");
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const checkpointsStore = transaction.objectStore(CHECKPOINTS_STORE);

  const nowIso = new Date().toISOString();
  for (const row of rows) {
    if (!row.row_id) {
      continue;
    }
    await rowsStore.put(row);
    const jobRowRecord: JobRowRecord = {
      id: buildJobRowId(jobId, row.row_id),
      job_id: jobId,
      row_id: row.row_id,
      updated_at: nowIso
    };
    await jobRowsStore.put(jobRowRecord);
  }

  await checkpointsStore.put(checkpoint);
  await transaction.done;
}

export async function saveFetchRowsForJob(jobId: string, rows: VideoRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction([ROWS_STORE, JOB_ROWS_STORE], "readwrite");
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    if (!row.row_id) {
      continue;
    }
    await rowsStore.put(row);
    const jobRowRecord: JobRowRecord = {
      id: buildJobRowId(jobId, row.row_id),
      job_id: jobId,
      row_id: row.row_id,
      updated_at: nowIso
    };
    await jobRowsStore.put(jobRowRecord);
  }

  await transaction.done;
}

export async function loadFetchCheckpointsForJobs(jobIds: string[]): Promise<FetchJobCheckpoint[]> {
  if (jobIds.length === 0) {
    return [];
  }

  const database = await openFetchCacheDb();
  await maybePruneFetchCache(database);
  const transaction = database.transaction(CHECKPOINTS_STORE, "readwrite");
  const checkpointsStore = transaction.objectStore(CHECKPOINTS_STORE);
  const validCheckpoints: FetchJobCheckpoint[] = [];
  const nowMs = Date.now();

  for (const jobId of [...new Set(jobIds)]) {
    const checkpoint = await checkpointsStore.get(jobId);
    if (!isCheckpointRecord(checkpoint)) {
      continue;
    }

    const updatedAtMs = Date.parse(checkpoint.updated_at);
    if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs > CHECKPOINT_MAX_AGE_MS) {
      await checkpointsStore.delete(jobId);
      continue;
    }

    validCheckpoints.push(checkpoint);
  }

  await transaction.done;
  return validCheckpoints;
}

export async function clearFetchCacheDatabase(): Promise<void> {
  const database = await openFetchCacheDb();
  const transaction = database.transaction([ROWS_STORE, JOB_ROWS_STORE, CHECKPOINTS_STORE], "readwrite");
  await transaction.objectStore(ROWS_STORE).clear();
  await transaction.objectStore(JOB_ROWS_STORE).clear();
  await transaction.objectStore(CHECKPOINTS_STORE).clear();
  await transaction.done;
}

function buildJobRowId(jobId: string, rowId: string): string {
  return `${jobId}::${rowId}`;
}

function isVideoRow(value: unknown): value is VideoRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.row_id === "string" && typeof record.source_type === "string";
}

function isCheckpointRecord(value: unknown): value is FetchJobCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.job_id === "string" &&
    typeof record.selection_signature === "string" &&
    typeof record.source === "string" &&
    typeof record.status === "string" &&
    typeof record.fetched_rows === "number" &&
    typeof record.processed_batches === "number" &&
    (typeof record.cursor === "string" || record.cursor === null) &&
    (typeof record.previous_cursor === "string" || record.previous_cursor === null) &&
    (typeof record.offset === "number" || record.offset === null) &&
    (typeof record.endpoint_key === "string" || record.endpoint_key === null) &&
    typeof record.updated_at === "string"
  );
}

async function maybePruneFetchCache(
  database: Awaited<ReturnType<typeof openFetchCacheDb>>
): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastCachePruneMs < CACHE_PRUNE_INTERVAL_MS) {
    return;
  }
  if (cachePruneInFlight) {
    await cachePruneInFlight;
    return;
  }

  lastCachePruneMs = nowMs;
  cachePruneInFlight = pruneStaleCacheRecords(database)
    .catch(() => {
      // Do not break active fetches if cache pruning fails.
    })
    .finally(() => {
      cachePruneInFlight = null;
    });
  await cachePruneInFlight;
}

async function pruneStaleCacheRecords(
  database: Awaited<ReturnType<typeof openFetchCacheDb>>
): Promise<void> {
  const cutoffMs = Date.now() - CACHE_ROW_MAX_AGE_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const transaction = database.transaction([JOB_ROWS_STORE, ROWS_STORE, CHECKPOINTS_STORE], "readwrite");
  const jobRowsStore = transaction.objectStore(JOB_ROWS_STORE);
  const rowsStore = transaction.objectStore(ROWS_STORE);
  const checkpointsStore = transaction.objectStore(CHECKPOINTS_STORE);
  const rowIdsToCheck = new Set<string>();
  const staleCheckpointJobIds: string[] = [];

  let checkpointCursor = await checkpointsStore.openCursor();
  while (checkpointCursor) {
    const checkpoint = checkpointCursor.value;
    if (!isCheckpointRecord(checkpoint)) {
      await checkpointCursor.delete();
      checkpointCursor = await checkpointCursor.continue();
      continue;
    }
    const updatedAtMs = Date.parse(checkpoint.updated_at);
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < cutoffMs) {
      staleCheckpointJobIds.push(checkpoint.job_id);
      await checkpointCursor.delete();
    }
    checkpointCursor = await checkpointCursor.continue();
  }

  let staleJobRowCursor = await jobRowsStore.index(JOB_ROWS_BY_UPDATED_AT_INDEX).openCursor(IDBKeyRange.upperBound(cutoffIso));
  while (staleJobRowCursor) {
    const record = staleJobRowCursor.value as JobRowRecord;
    if (record?.row_id) {
      rowIdsToCheck.add(record.row_id);
    }
    await staleJobRowCursor.delete();
    staleJobRowCursor = await staleJobRowCursor.continue();
  }

  for (const jobId of staleCheckpointJobIds) {
    let jobCursor = await jobRowsStore.index(JOB_ROWS_BY_JOB_ID_INDEX).openCursor(jobId);
    while (jobCursor) {
      const record = jobCursor.value as JobRowRecord;
      if (record?.row_id) {
        rowIdsToCheck.add(record.row_id);
      }
      await jobCursor.delete();
      jobCursor = await jobCursor.continue();
    }
  }

  for (const rowId of rowIdsToCheck) {
    const remainingReferences = await jobRowsStore.index(JOB_ROWS_BY_ROW_ID_INDEX).count(rowId);
    if (remainingReferences === 0) {
      await rowsStore.delete(rowId);
    }
  }

  await transaction.done;
}
