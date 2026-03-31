import { getItemKey, getItemReviewUrl } from "./items.js";

/**
 * CSV export helpers for the popup.
 *
 * The popup already has the selected working set in memory, so generating the
 * CSV locally keeps the feature simple and avoids routing a one-off file export
 * through the background worker.
 */

/**
 * Builds a CSV string containing the Sora page URLs for the current selection.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 * @returns {{csvText:string|null, exportedCount:number, skippedCount:number}}
 */
export function buildSelectedUrlsCsv(items, selectedKeys) {
  const selectedKeySet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  const rows = [];
  let skippedCount = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (!selectedKeySet.has(getItemKey(item))) {
      continue;
    }

    const reviewUrl = getItemReviewUrl(item);
    if (!reviewUrl) {
      skippedCount += 1;
      continue;
    }

    rows.push(reviewUrl);
  }

  if (!rows.length) {
    return {
      csvText: null,
      exportedCount: 0,
      skippedCount,
    };
  }

  const csvLines = ["url", ...rows.map(escapeCsvValue)];
  return {
    csvText: `\uFEFF${csvLines.join("\r\n")}\r\n`,
    exportedCount: rows.length,
    skippedCount,
  };
}

/**
 * Returns a stable, human-readable filename for the exported CSV.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function buildSelectedUrlsFilename(now = new Date()) {
  const isoDate = now.toISOString().slice(0, 10);
  return `save-sora-selected-urls-${isoDate}.csv`;
}

/**
 * Downloads the CSV through the extension downloads permission.
 *
 * @param {string} csvText
 * @param {string} filename
 * @returns {Promise<number|undefined>}
 */
export async function downloadCsvText(csvText, filename) {
  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);

  try {
    return await chrome.downloads.download({
      url: objectUrl,
      filename,
      conflictAction: "uniquify",
    });
  } finally {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }
}

/**
 * Escapes one CSV cell.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeCsvValue(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}
