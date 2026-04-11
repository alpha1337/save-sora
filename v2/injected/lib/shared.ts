import { deriveAuthContext } from "./auth";

/**
 * Shared network and parsing helpers for the injected Sora fetch runtime.
 */
export async function fetchJson(url: string): Promise<unknown> {
  const authContext = await deriveAuthContext();
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${authContext.token}`,
      "oai-language": authContext.language,
      ...(authContext.deviceId ? { "oai-device-id": authContext.deviceId } : {})
    }
  });

  if (!response.ok) {
    throw new Error(`Sora request failed with status ${response.status}.`);
  }

  return (await response.json()) as unknown;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: "include",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(`Sora detail request failed with status ${response.status}.`);
  }

  return response.text();
}

export function getPostListingRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  return pickFirstArray([record.items, record.data, record.results, record.posts, record.entries, record.feed, record.nodes]);
}

export function getNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return pickFirstString([
    record.next_cursor,
    record.nextCursor,
    (record.pagination as Record<string, unknown> | undefined)?.next_cursor,
    (record.pagination as Record<string, unknown> | undefined)?.nextCursor,
    record.cursor
  ]) || null;
}

export function getEstimatedTotalCount(payload: unknown, observedCount: number): number {
  if (!payload || typeof payload !== "object") {
    return observedCount;
  }

  const record = payload as Record<string, unknown>;
  return pickFirstNumber([
    record.total_count,
    record.totalCount,
    record.estimated_total_count,
    record.estimatedTotalCount,
    record.item_count,
    record.itemCount,
    record.result_count,
    record.resultCount,
    (record.pagination as Record<string, unknown> | undefined)?.total_count,
    (record.pagination as Record<string, unknown> | undefined)?.totalCount,
    observedCount
  ]) ?? observedCount;
}

export function getUsernameFromRouteUrl(routeUrl: string): string {
  try {
    const pathname = new URL(routeUrl, window.location.origin).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const profileSegment = segments.find((segment) => segment.startsWith("@")) ?? (segments[0] === "profile" ? segments[1] : segments[0]);
    return typeof profileSegment === "string" ? profileSegment.replace(/^@+/, "") : "";
  } catch (_error) {
    return "";
  }
}

export function resolveSharedVideoIdFromValue(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return extractSharedVideoId(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = resolveSharedVideoIdFromValue(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directMatch = pickFirstString([
    record.shared_post_id,
    record.sharedPostId,
    record.post_id,
    record.postId,
    record.share_id,
    record.shareId,
    record.public_id,
    record.publicId,
    record.id,
    extractSharedVideoId(record.permalink),
    extractSharedVideoId(record.detail_url),
    extractSharedVideoId(record.detailUrl),
    extractSharedVideoId(record.share_url),
    extractSharedVideoId(record.shareUrl),
    extractSharedVideoId(record.url)
  ]);
  if (/^s_[A-Za-z0-9_-]+$/.test(directMatch)) {
    return directMatch;
  }

  for (const entryValue of Object.values(record)) {
    const match = resolveSharedVideoIdFromValue(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

export function extractSharedVideoId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmedValue = value.trim();
  if (/^s_[A-Za-z0-9_-]+$/.test(trimmedValue)) {
    return trimmedValue;
  }

  const match = trimmedValue.match(/\/(?:p|video)\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

export function extractDraftGenerationId(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return /^gen_[A-Za-z0-9_-]+$/.test(value.trim()) ? value.trim() : "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractDraftGenerationId(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directMatch = pickFirstString([record.generation_id, record.generationId, record.id, record.task_id, record.taskId]);
  if (/^gen_[A-Za-z0-9_-]+$/.test(directMatch)) {
    return directMatch;
  }

  for (const entryValue of Object.values(record)) {
    const match = extractDraftGenerationId(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

export function buildNoWatermarkProxyUrl(videoId: string): string {
  return /^s_[A-Za-z0-9_-]+$/.test(videoId) ? `https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}` : "";
}

function pickFirstArray<T>(candidates: unknown[]): T[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as T[];
    }
  }
  return [];
}

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function pickFirstNumber(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const numericValue = Number(candidate);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }
  return null;
}
