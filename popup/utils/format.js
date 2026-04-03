/**
 * Formatting helpers used throughout the popup UI.
 */

const WHOLE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

const FILE_SIZE_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Formats a created-at timestamp for display in the item cards.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatCreatedAt(value) {
  if (value == null || value === "") {
    return "";
  }

  let date;
  if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Formats a duration in seconds as `m:ss`.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatDuration(value) {
  const totalSeconds = Math.max(0, Math.round(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Formats a large engagement metric with compact notation.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatCompactCount(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (numeric < 1000) {
    return String(Math.max(0, Math.round(numeric)));
  }

  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

/**
 * Formats a count using locale-aware group separators.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatWholeNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  return WHOLE_NUMBER_FORMATTER.format(Math.max(0, Math.round(numeric)));
}

/**
 * Formats a file size in bytes using a human-readable unit.
 *
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatFileSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = size >= 100 || unitIndex === 0 ? Math.round(size) : Number(size.toFixed(1));
  return `${FILE_SIZE_NUMBER_FORMATTER.format(rounded)} ${units[unitIndex]}`;
}

/**
 * Shortens long prompt text for the compact item card layout.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function truncatePrompt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "No prompt text available.";
  }

  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > 120 ? `${singleLine.slice(0, 117)}...` : singleLine;
}
