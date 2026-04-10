import { getDefaultItemTitle, getItemKey } from "./items.js";

/**
 * Metadata export helpers for the popup.
 *
 * The popup already has the selected working set in memory, so generating the
 * CSV locally keeps the feature simple and avoids routing a one-off file export
 * through the background worker.
 */

/**
 * Resolves the best metadata text available for a fetched item.
 *
 * The fallback order intentionally mirrors the archive metadata export so both
 * download paths stay aligned: prompt -> description -> discovery phrase ->
 * caption.
 *
 * @param {object} item
 * @returns {string}
 */
export function getItemMetadataText(item) {
  const candidates = [
    item && typeof item.prompt === "string" ? item.prompt.trim() : "",
    item && typeof item.description === "string" ? item.description.trim() : "",
    item && typeof item.discoveryPhrase === "string" ? item.discoveryPhrase.trim() : "",
    item && typeof item.caption === "string" ? item.caption.trim() : "",
  ];

  return candidates.find(Boolean) || "";
}

/**
 * Builds a plain-text metadata export for the current selection.
 *
 * @param {object[]} items
 * @param {string[]} selectedKeys
 * @returns {{textContent:string|null, exportedCount:number, skippedCount:number}}
 */
export function buildSelectedMetadataText(items, selectedKeys) {
  const selectedKeySet = new Set(Array.isArray(selectedKeys) ? selectedKeys : []);
  const rows = [];
  let skippedCount = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (!selectedKeySet.has(getItemKey(item))) {
      continue;
    }

    const exportText = getItemMetadataText(item);

    if (!exportText) {
      skippedCount += 1;
      continue;
    }

    const title = getDefaultItemTitle(item).trim() || (item && typeof item.id === "string" ? item.id : "Video");
    rows.push(title && title !== exportText ? `${title}\n${exportText}` : exportText);
  }

  if (!rows.length) {
    return {
      textContent: null,
      exportedCount: 0,
      skippedCount,
    };
  }

  return {
    textContent: rows.join("\n\n"),
    exportedCount: rows.length,
    skippedCount,
  };
}

/**
 * Returns a stable filename for the selected metadata text export.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function buildSelectedMetadataFilename(now = new Date()) {
  const isoDate = now.toISOString().slice(0, 10);
  return `save-sora-selected-metadata-${isoDate}.txt`;
}

/**
 * Downloads plain text through the extension downloads permission.
 *
 * @param {string} textContent
 * @param {string} filename
 * @returns {Promise<number|undefined>}
 */
export async function downloadTextFile(textContent, filename) {
  const blob = new Blob([textContent], {
    type: "text/plain;charset=utf-8",
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
