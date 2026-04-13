/**
 * Browser download helpers for generated CSV files and archive blobs.
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function downloadTextFile(fileName: string, content: string, contentType = "text/plain;charset=utf-8"): void {
  downloadBlob(fileName, new Blob([content], { type: contentType }));
}
