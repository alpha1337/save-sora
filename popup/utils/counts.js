/**
 * Builds the shared popup count snapshot from the authoritative fetched total
 * plus the current item flags.
 *
 * @param {object} runtimeState
 * @param {object[]} items
 * @returns {{fetchedCount:number,downloadableCount:number,downloadedCount:number,archivedCount:number,downloadableBytes:number|null,downloadedBytes:number|null,archivedBytes:number|null}}
 */
export function buildRenderCountSnapshot(runtimeState, items) {
  const safeRuntimeState =
    runtimeState && typeof runtimeState === "object" ? runtimeState : {};
  const resolvedItems = Array.isArray(items) ? items : [];
  const fetchedCount = Number.isFinite(Number(safeRuntimeState.fetchedCount))
    ? Math.max(0, Number(safeRuntimeState.fetchedCount))
    : resolvedItems.length;
  const localSnapshot = buildLocalItemMetricSnapshot(resolvedItems);
  const shouldPreferRuntimeMetrics =
    safeRuntimeState.popupItemsTruncated === true ||
    Math.max(0, Number(safeRuntimeState.popupHiddenItemCount) || 0) > 0;
  const downloadedCount =
    shouldPreferRuntimeMetrics && hasMetricNumber(safeRuntimeState.popupDownloadedCount)
      ? Math.max(0, Number(safeRuntimeState.popupDownloadedCount))
      : localSnapshot.downloadedCount;
  const archivedCount =
    shouldPreferRuntimeMetrics && hasMetricNumber(safeRuntimeState.popupArchivedCount)
      ? Math.max(0, Number(safeRuntimeState.popupArchivedCount))
      : localSnapshot.archivedCount;
  const downloadableBytes =
    shouldPreferRuntimeMetrics && hasMetricNumber(safeRuntimeState.popupDownloadableBytes)
      ? Math.max(0, Number(safeRuntimeState.popupDownloadableBytes))
      : localSnapshot.downloadableBytes;
  const downloadedBytes =
    shouldPreferRuntimeMetrics && hasMetricNumber(safeRuntimeState.popupDownloadedBytes)
      ? Math.max(0, Number(safeRuntimeState.popupDownloadedBytes))
      : localSnapshot.downloadedBytes;
  const archivedBytes =
    shouldPreferRuntimeMetrics && hasMetricNumber(safeRuntimeState.popupArchivedBytes)
      ? Math.max(0, Number(safeRuntimeState.popupArchivedBytes))
      : localSnapshot.archivedBytes;

  return {
    fetchedCount,
    downloadableCount: Math.max(0, fetchedCount - downloadedCount - archivedCount),
    downloadedCount,
    archivedCount,
    downloadableBytes,
    downloadedBytes,
    archivedBytes,
  };
}

function hasMetricNumber(value) {
  if (value == null || value === "") {
    return false;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue);
}

/**
 * Computes aggregate count and file-size metrics directly from the current item list.
 *
 * @param {object[]} items
 * @returns {{downloadableCount:number,downloadedCount:number,archivedCount:number,downloadableBytes:number|null,downloadedBytes:number|null,archivedBytes:number|null}}
 */
export function buildLocalItemMetricSnapshot(items) {
  const resolvedItems = Array.isArray(items) ? items : [];
  let downloadableCount = 0;
  let downloadedCount = 0;
  let archivedCount = 0;
  let downloadableBytes = 0;
  let downloadedBytes = 0;
  let archivedBytes = 0;
  let hasKnownDownloadableBytes = false;
  let hasKnownDownloadedBytes = false;
  let hasKnownArchivedBytes = false;

  for (const item of resolvedItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const fileSizeBytes = Number(item.fileSizeBytes);
    const hasKnownSize = Number.isFinite(fileSizeBytes) && fileSizeBytes > 0;

    if (item.isDownloaded === true) {
      downloadedCount += 1;
      if (hasKnownSize) {
        downloadedBytes += fileSizeBytes;
        hasKnownDownloadedBytes = true;
      }
      continue;
    }

    if (item.isRemoved === true) {
      archivedCount += 1;
      if (hasKnownSize) {
        archivedBytes += fileSizeBytes;
        hasKnownArchivedBytes = true;
      }
      continue;
    }

    downloadableCount += 1;
    if (hasKnownSize) {
      downloadableBytes += fileSizeBytes;
      hasKnownDownloadableBytes = true;
    }
  }

  return {
    downloadableCount,
    downloadedCount,
    archivedCount,
    downloadableBytes: hasKnownDownloadableBytes ? downloadableBytes : null,
    downloadedBytes: hasKnownDownloadedBytes ? downloadedBytes : null,
    archivedBytes: hasKnownArchivedBytes ? archivedBytes : null,
  };
}
