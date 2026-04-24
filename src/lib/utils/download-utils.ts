import { writeBlobToDirectory } from "./file-system-access";

/**
 * Browser download helpers for generated CSV files and archive blobs.
 */
interface DownloadOptions {
  directoryHandle?: FileSystemDirectoryHandle | null;
}

export async function downloadBlob(
  fileName: string,
  blob: Blob,
  options: DownloadOptions = {}
): Promise<"directory" | "browser"> {
  if (options.directoryHandle) {
    try {
      if (await writeBlobToDirectory(options.directoryHandle, fileName, blob)) {
        return "directory";
      }
    } catch (_error) {
      // Fall back to the browser download shelf when the saved folder is unavailable.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return "browser";
}

export function downloadTextFile(
  fileName: string,
  content: string,
  contentType = "text/plain;charset=utf-8",
  options: DownloadOptions = {}
): Promise<"directory" | "browser"> {
  return downloadBlob(fileName, new Blob([content], { type: contentType }), options);
}
