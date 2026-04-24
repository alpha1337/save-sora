import { SETTINGS_STORE, openSaveSoraV3Db } from "./save-sora-v3-db";

const DOWNLOAD_DIRECTORY_HANDLE_KEY = "download_directory_handle";

interface PersistedDownloadDirectoryHandle {
  kind: "download_directory_handle";
  name: string;
  handle: FileSystemDirectoryHandle;
  updated_at: string;
}

export async function saveDownloadDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openSaveSoraV3Db();
  const record: PersistedDownloadDirectoryHandle = {
    kind: "download_directory_handle",
    name: handle.name,
    handle,
    updated_at: new Date().toISOString()
  };
  await database.put(SETTINGS_STORE, record, DOWNLOAD_DIRECTORY_HANDLE_KEY);
}

export async function loadDownloadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const database = await openSaveSoraV3Db();
  const record: unknown = await database.get(SETTINGS_STORE, DOWNLOAD_DIRECTORY_HANDLE_KEY);
  if (!isPersistedDownloadDirectoryHandle(record)) {
    return null;
  }
  return record.handle;
}

export async function clearDownloadDirectoryHandle(): Promise<void> {
  const database = await openSaveSoraV3Db();
  await database.delete(SETTINGS_STORE, DOWNLOAD_DIRECTORY_HANDLE_KEY);
}

function isPersistedDownloadDirectoryHandle(value: unknown): value is PersistedDownloadDirectoryHandle {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<PersistedDownloadDirectoryHandle>;
  return record.kind === "download_directory_handle" &&
    typeof record.name === "string" &&
    Boolean(record.handle) &&
    typeof record.updated_at === "string";
}
