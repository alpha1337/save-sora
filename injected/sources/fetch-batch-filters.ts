export function filterRowsByTimeWindow(rows: unknown[], sinceMs?: number | null, untilMs?: number | null): unknown[] {
  if (sinceMs == null && untilMs == null) {
    return rows;
  }

  return rows.filter((row) => {
    const timestampMs = extractRowTimestampMs(row);
    if (timestampMs == null) {
      // Keep rows that lack timestamps so draft fetches are not silently dropped.
      return true;
    }
    if (sinceMs != null && timestampMs < sinceMs) {
      return false;
    }
    if (untilMs != null && timestampMs > untilMs) {
      return false;
    }
    return true;
  });
}

export function reachedOlderThanSinceBoundary(rows: unknown[], sinceMs?: number | null): boolean {
  if (sinceMs == null || rows.length === 0) {
    return false;
  }

  let seenTimestamp = false;
  for (const row of rows) {
    const timestampMs = extractRowTimestampMs(row);
    if (timestampMs == null) {
      return false;
    }
    seenTimestamp = true;
    if (timestampMs >= sinceMs) {
      return false;
    }
  }

  return seenTimestamp;
}

function extractRowTimestampMs(row: unknown): number | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const post = record.post && typeof record.post === "object" ? (record.post as Record<string, unknown>) : null;
  const draft = record.draft && typeof record.draft === "object" ? (record.draft as Record<string, unknown>) : null;

  return pickFirstTimestampMs([
    record.liked_at,
    record.likedAt,
    record.liked_on,
    record.likedOn,
    record.posted_at,
    record.postedAt,
    record.published_at,
    record.publishedAt,
    record.created_at,
    record.createdAt,
    record.updated_at,
    record.updatedAt,
    post?.liked_at,
    post?.likedAt,
    post?.liked_on,
    post?.likedOn,
    post?.posted_at,
    post?.postedAt,
    post?.published_at,
    post?.publishedAt,
    post?.created_at,
    post?.createdAt,
    post?.updated_at,
    post?.updatedAt,
    draft?.liked_at,
    draft?.likedAt,
    draft?.liked_on,
    draft?.likedOn,
    draft?.posted_at,
    draft?.postedAt,
    draft?.published_at,
    draft?.publishedAt,
    draft?.created_at,
    draft?.createdAt,
    draft?.updated_at,
    draft?.updatedAt
  ]);
}

function pickFirstTimestampMs(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const parsed = parseTimestampMsCandidate(candidate);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
}

function parseTimestampMsCandidate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
