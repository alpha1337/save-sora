import { openDB } from "idb";

export const SAVE_SORA_V3_DB_NAME = "save-sora-v3";
export const SAVE_SORA_V3_DB_VERSION = 2;

export const DOWNLOAD_HISTORY_STORE = "download_history";
export const SETTINGS_STORE = "settings";
export const SAVED_ACCOUNTS_STORE = "saved_accounts";
export const CURSOR_CHECKPOINTS_STORE = "cursor_checkpoints";
export const JOB_ROWS_STORE = "job_rows";
export const ROWS_STORE = "rows";

export const SAVED_ACCOUNTS_CREATORS_INDEX = "creators";
export const SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX = "side_characters";
export const SAVED_ACCOUNTS_USER_INDEX = "user";
export const JOB_ROWS_BY_JOB_ID_INDEX = "by_job_id";
export const JOB_ROWS_BY_ROW_ID_INDEX = "by_row_id";
export const JOB_ROWS_BY_UPDATED_AT_INDEX = "by_updated_at";

/**
 * Single flattened IndexedDB for Save Sora v3.
 */
export async function openSaveSoraV3Db() {
  return openDB(SAVE_SORA_V3_DB_NAME, SAVE_SORA_V3_DB_VERSION, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      if (!database.objectStoreNames.contains(DOWNLOAD_HISTORY_STORE)) {
        database.createObjectStore(DOWNLOAD_HISTORY_STORE, { keyPath: "video_id" });
      }
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) {
        database.createObjectStore(SETTINGS_STORE);
      }
      const savedAccountsStore = database.objectStoreNames.contains(SAVED_ACCOUNTS_STORE)
        ? transaction.objectStore(SAVED_ACCOUNTS_STORE)
        : database.createObjectStore(SAVED_ACCOUNTS_STORE, { keyPath: "id" });
      if (!savedAccountsStore.indexNames.contains(SAVED_ACCOUNTS_CREATORS_INDEX)) {
        savedAccountsStore.createIndex(SAVED_ACCOUNTS_CREATORS_INDEX, "creators", { unique: false });
      }
      if (!savedAccountsStore.indexNames.contains(SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX)) {
        savedAccountsStore.createIndex(SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX, "side_characters", { unique: false });
      }
      if (!savedAccountsStore.indexNames.contains(SAVED_ACCOUNTS_USER_INDEX)) {
        savedAccountsStore.createIndex(SAVED_ACCOUNTS_USER_INDEX, "user_index", { unique: false });
      }

      if (!database.objectStoreNames.contains(CURSOR_CHECKPOINTS_STORE)) {
        database.createObjectStore(CURSOR_CHECKPOINTS_STORE, { keyPath: "job_id" });
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

      if (!database.objectStoreNames.contains(ROWS_STORE)) {
        database.createObjectStore(ROWS_STORE, { keyPath: "row_id" });
      }
    }
  });
}
