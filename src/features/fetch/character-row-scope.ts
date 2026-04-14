import type { LowLevelSourceType } from "types/domain";
import type { FetchJob } from "./source-adapters";

export function filterRowsForCharacterScope(
  rows: unknown[],
  job: FetchJob
): unknown[] {
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
  const candidateObjects = [record, ...getCandidateObjects(record)];
  for (const candidate of candidateObjects) {
    const directId = pickFirstString([
      candidate.character_id,
      candidate.characterId,
      candidate.character_account_id,
      candidate.characterAccountId,
      candidate.character_user_id,
      candidate.characterUserId
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
  return ids;
}

function getCandidateObjects(record: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];
  for (const key of ["post", "payload", "item", "output", "data", "result", "entry", "node", "card"]) {
    const value = record[key];
    if (value && typeof value === "object") {
      candidates.push(value as Record<string, unknown>);
    }
  }
  return candidates;
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

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function isCharacterScopedSource(source: LowLevelSourceType): boolean {
  return source === "characterAccountAppearances" || source === "characterAccountDrafts";
}

function getCharacterLabelFromJob(displayName: string, jobLabel: string): string {
  const direct = displayName.trim();
  if (direct) {
    return direct;
  }
  const fromLabel = jobLabel.replace(/\s+(drafts|appearances)$/i, "").trim();
  return fromLabel.startsWith("ch_") ? "" : fromLabel;
}
