/**
 * Normalization helpers for popup settings and filter form values.
 */

/**
 * Normalizes the current source filter.
 *
 * @param {string|null|undefined} value
 * @returns {"profile"|"drafts"|"both"}
 */
export function normalizeSourceValue(value) {
  return value === "profile" || value === "drafts" ? value : "both";
}

/**
 * Normalizes the current sort mode.
 *
 * @param {string|null|undefined} value
 * @returns {"newest"|"oldest"|"likes"|"views"|"remixes"}
 */
export function normalizeSortValue(value) {
  return value === "oldest" || value === "likes" || value === "views" || value === "remixes"
    ? value
    : "newest";
}
