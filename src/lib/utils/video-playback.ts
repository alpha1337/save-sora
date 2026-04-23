import type { VideoRow } from "types/domain";

export function resolvePreviewPlaybackUrl(row: Pick<VideoRow, "playback_url">): string {
  return row.playback_url;
}

export function resolveHoverGifUrl(row: Pick<VideoRow, "gif_url" | "raw_payload_json">): string {
  const normalizedGifUrl = normalizeGifUrl(row.gif_url);
  if (normalizedGifUrl) {
    return normalizedGifUrl;
  }

  const rawPayload = row.raw_payload_json?.trim();
  if (!rawPayload) {
    return "";
  }

  try {
    const parsedPayload = JSON.parse(rawPayload);
    if (!parsedPayload || typeof parsedPayload !== "object") {
      return "";
    }

    const payload = parsedPayload as Record<string, unknown>;
    const exactGifPath = getPathValue(payload, ["post", "attachments", 0, "encodings", "gif", "path"]);
    return typeof exactGifPath === "string" ? exactGifPath : "";
  } catch {
    return "";
  }
}

function normalizeGifUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPathValue(source: unknown, path: Array<string | number>): unknown {
  let current: unknown = source;

  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) {
        return undefined;
      }
      current = current[key];
      continue;
    }

    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return current;
}
