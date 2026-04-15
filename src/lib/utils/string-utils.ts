/**
 * Shared string helpers used across normalization, archive naming, and CSV
 * export.
 */
const WINDOWS_RESERVED_BASE_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function slugify(value: string): string {
  return compactWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeFileNamePart(value: string, fallback = "item"): string {
  const cleanedPrimary = cleanFileNameToken(value);
  const cleanedFallback = cleanFileNameToken(fallback) || "item";
  const baseName = cleanedPrimary || cleanedFallback;

  return WINDOWS_RESERVED_BASE_NAME_PATTERN.test(baseName)
    ? `${baseName}-item`
    : baseName;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function cleanFileNameToken(value: string): string {
  return compactWhitespace(value)
    .normalize("NFKD")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\x20-\x7E]+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .replace(/[ .]+$/g, "")
    .replace(/^[-. ]+|[-. ]+$/g, "");
}
