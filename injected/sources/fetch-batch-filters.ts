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

export function filterRowsForCharacterAccountDrafts(rows: unknown[], characterId: string): unknown[] {
  const trimmedCharacterId = characterId.trim();
  if (!trimmedCharacterId) {
    return rows;
  }

  return rows.filter((row) => rowContainsCharacterId(row, trimmedCharacterId, 0));
}

function extractRowTimestampMs(row: unknown): number | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const post = record.post && typeof record.post === "object" ? (record.post as Record<string, unknown>) : null;
  const draft = record.draft && typeof record.draft === "object" ? (record.draft as Record<string, unknown>) : null;

  return pickFirstTimestampMs([
    record.published_at,
    record.publishedAt,
    record.created_at,
    record.createdAt,
    record.updated_at,
    record.updatedAt,
    post?.published_at,
    post?.publishedAt,
    post?.created_at,
    post?.createdAt,
    post?.updated_at,
    post?.updatedAt,
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

function rowContainsCharacterId(value: unknown, characterId: string, depth: number): boolean {
  if (depth > 6 || value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() === characterId;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => rowContainsCharacterId(entry, characterId, depth + 1));
  }
  if (typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const directCandidates = [
    record.character_id,
    record.characterId,
    record.character_user_id,
    record.characterUserId,
    record.user_id,
    record.userId,
    record.profile_id,
    record.profileId,
    record.id
  ];
  if (directCandidates.some((candidate) => typeof candidate === "string" && candidate.trim() === characterId)) {
    return true;
  }

  return Object.values(record).some((entry) => rowContainsCharacterId(entry, characterId, depth + 1));
}
