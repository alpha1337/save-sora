import type { LowLevelSourceType } from "types/domain";
import type { FetchJob } from "./source-adapters";

export function filterRowsForCharacterScope(
  rows: unknown[],
  job: FetchJob
): unknown[] {
  if (job.source === "characterAccountAppearances" || job.source === "sideCharacter") {
    // The appearances endpoint is already server-scoped to the target `ch_*` id.
    // Filtering again here can drop valid older rows where cameo metadata is sparse.
    return rows;
  }
  if (!isCharacterScopedSource(job.source)) {
    return rows;
  }
  const scope = resolveTargetCharacterScope(job);
  if (!scope) {
    return [];
  }
  return rows.filter((row) => matchesCharacterScope(row, scope.characterId));
}

export function applyCharacterRowContext(
  rows: unknown[],
  job: FetchJob
): unknown[] {
  if (!job.character_id || !isCharacterScopedSource(job.source)) {
    return rows;
  }
  const characterLabel = getCharacterLabelFromJob(job.character_display_name ?? "", job.label);
  return rows.map((row) => {
    if (!row || typeof row !== "object") {
      return row;
    }
    const record = row as Record<string, unknown>;
    return {
      ...record,
      character_id: record.character_id ?? job.character_id,
      character_account_id: record.character_account_id ?? job.character_id,
      __character_context_display_name: record.__character_context_display_name ?? characterLabel
    };
  });
}

function resolveTargetCharacterScope(job: FetchJob): { characterId: string } | null {
  const rawCharacterId = (job.character_id ?? "").trim();
  if (!rawCharacterId || !rawCharacterId.startsWith("ch_")) {
    return null;
  }
  return { characterId: rawCharacterId };
}

function matchesCharacterScope(row: unknown, characterId: string): boolean {
  if (!row || typeof row !== "object") {
    return false;
  }
  const rowCharacterIds = collectCharacterIds(row as Record<string, unknown>);
  return rowCharacterIds.has(characterId);
}

function collectCharacterIds(record: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const visited = new Set<Record<string, unknown>>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value: record, depth: 0 }];
  const MAX_SCAN_DEPTH = 7;

  while (queue.length > 0) {
    const nextEntry = queue.shift();
    if (!nextEntry) {
      continue;
    }
    const candidate = asRecord(nextEntry.value);
    if (!candidate || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    collectIdsFromCandidate(candidate, ids);
    if (nextEntry.depth >= MAX_SCAN_DEPTH) {
      continue;
    }
    for (const nestedValue of getNestedObjects(candidate)) {
      queue.push({ value: nestedValue, depth: nextEntry.depth + 1 });
    }
  }

  return ids;
}

function collectIdsFromCandidate(candidate: Record<string, unknown>, ids: Set<string>): void {
  const directId = pickFirstString([
    candidate.character_id,
    candidate.characterId,
    candidate.character_account_id,
    candidate.characterAccountId,
    candidate.character_user_id,
    candidate.characterUserId,
    candidate.user_id,
    candidate.userId
  ]);
  if (directId.startsWith("ch_")) {
    ids.add(directId);
  }
  for (const cameoProfile of getCameoProfiles(candidate)) {
    const cameoId = pickFirstString([cameoProfile.user_id, cameoProfile.userId]);
    if (cameoId.startsWith("ch_")) {
      ids.add(cameoId);
    }
  }
}

function getNestedObjects(candidate: Record<string, unknown>): unknown[] {
  const nestedValues: unknown[] = [];
  for (const value of Object.values(candidate)) {
    if (!value) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const arrayValue of value) {
        if (arrayValue && typeof arrayValue === "object") {
          nestedValues.push(arrayValue);
        }
      }
      continue;
    }
    if (typeof value === "object") {
      nestedValues.push(value);
    }
  }
  return nestedValues;
}

function getCameoProfiles(candidate: Record<string, unknown>): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  const profileCollections = [
    ...(Array.isArray(candidate.cameo_profiles) ? candidate.cameo_profiles : []),
    ...(Array.isArray(candidate.cameoProfiles) ? candidate.cameoProfiles : [])
  ];
  for (const profile of profileCollections) {
    if (profile && typeof profile === "object") {
      values.push(profile as Record<string, unknown>);
    }
  }
  return values;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function isCharacterScopedSource(source: LowLevelSourceType): boolean {
  return source === "characterAccountAppearances" || source === "characterAccountDrafts" || source === "sideCharacter";
}

function getCharacterLabelFromJob(displayName: string, jobLabel: string): string {
  const direct = displayName.trim();
  if (direct) {
    return direct;
  }
  const fromLabel = jobLabel.replace(/\s+(drafts|appearances)$/i, "").trim();
  return fromLabel.startsWith("ch_") ? "" : fromLabel;
}
