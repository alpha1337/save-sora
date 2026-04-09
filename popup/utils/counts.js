/**
 * Builds the shared popup count snapshot from the authoritative fetched total
 * plus the current item flags.
 *
 * @param {object} runtimeState
 * @param {object[]} items
 * @returns {{fetchedCount:number,downloadableCount:number,downloadedCount:number,archivedCount:number}}
 */
export function buildRenderCountSnapshot(runtimeState, items) {
  const resolvedItems = Array.isArray(items) ? items : [];
  const fetchedCount = Number.isFinite(Number(runtimeState && runtimeState.fetchedCount))
    ? Math.max(0, Number(runtimeState.fetchedCount))
    : resolvedItems.length;
  let downloadedCount = 0;
  let archivedCount = 0;

  for (const item of resolvedItems) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (item.isDownloaded === true) {
      downloadedCount += 1;
      continue;
    }

    if (item.isRemoved === true) {
      archivedCount += 1;
    }
  }

  return {
    fetchedCount,
    downloadableCount: Math.max(0, fetchedCount - downloadedCount - archivedCount),
    downloadedCount,
    archivedCount,
  };
}
