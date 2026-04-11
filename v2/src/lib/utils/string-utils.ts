/**
 * Shared string helpers used across normalization, archive naming, and CSV
 * export.
 */
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
  const cleaned = compactWhitespace(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.+$/g, "")
    .replace(/^-+|-+$/g, "");

  return cleaned || fallback;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}
