type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemPermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

interface PermissionAwareDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemPermissionDescriptor) => Promise<PermissionState>;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: FileSystemPermissionMode }) => Promise<FileSystemDirectoryHandle>;
}

export function canPickDownloadDirectory(): boolean {
  return typeof getDirectoryPickerWindow().showDirectoryPicker === "function";
}

export async function pickWritableDownloadDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = getDirectoryPickerWindow().showDirectoryPicker;
  if (!picker) {
    throw new Error("This browser does not support choosing a default ZIP folder.");
  }

  const handle = await picker({ id: "save-sora-zip-directory", mode: "readwrite" });
  const hasPermission = await requestDirectoryWritePermission(handle);
  if (!hasPermission) {
    throw new Error("Save Sora needs write access to use that folder for ZIP files.");
  }
  return handle;
}

export async function writeBlobToDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<boolean> {
  if (!(await hasDirectoryWritePermission(directoryHandle))) {
    return false;
  }

  const safeFileName = sanitizeLocalFileName(fileName);
  const fileHandle = await directoryHandle.getFileHandle(safeFileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return true;
}

export async function hasDirectoryWritePermission(directoryHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissionAwareHandle = directoryHandle as PermissionAwareDirectoryHandle;
  if (!permissionAwareHandle.queryPermission) {
    return true;
  }
  return await permissionAwareHandle.queryPermission({ mode: "readwrite" }) === "granted";
}

export function isDirectoryPickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function requestDirectoryWritePermission(directoryHandle: FileSystemDirectoryHandle): Promise<boolean> {
  const permissionAwareHandle = directoryHandle as PermissionAwareDirectoryHandle;
  if (!permissionAwareHandle.requestPermission) {
    return true;
  }
  return await permissionAwareHandle.requestPermission({ mode: "readwrite" }) === "granted";
}

function sanitizeLocalFileName(fileName: string): string {
  return fileName.trim().replace(/[\\/]+/g, "-") || "save-sora.zip";
}

function getDirectoryPickerWindow(): DirectoryPickerWindow {
  return window as DirectoryPickerWindow;
}
