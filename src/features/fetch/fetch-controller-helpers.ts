import type { CreatorProfile, FetchJobCheckpoint, LowLevelSourceType, VideoRow } from "types/domain";
import type { FetchJob } from "./source-adapters";

export class FetchCancellationError extends Error {
  constructor() {
    super("Fetch canceled.");
    this.name = "FetchCancellationError";
  }
}

export function buildInitialFetchProgress(
  jobs: FetchJob[],
  checkpointByJobId: Map<string, FetchJobCheckpoint>,
  shouldResume: boolean
) {
  const jobProgress = jobs.map((job) => {
    const checkpoint = checkpointByJobId.get(job.id);
    return {
      job_id: job.id,
      label: job.label,
      source: job.source,
      status: checkpoint?.status === "completed" ? "completed" as const : "pending" as const,
      active_item_title: "",
      fetched_rows: checkpoint?.fetched_rows ?? 0,
      processed_batches: checkpoint?.processed_batches ?? 0,
      expected_total_count: job.expected_total_count
    };
  });
  const completedJobs = jobProgress.filter((entry) => entry.status === "completed").length;
  const processedRows = jobProgress.reduce((sum, entry) => sum + entry.fetched_rows, 0);
  const processedBatches = jobProgress.reduce((sum, entry) => sum + entry.processed_batches, 0);

  return {
    active_label: shouldResume ? "Resuming Fetch…" : "Starting Fetch…",
    completed_jobs: completedJobs,
    processed_batches: processedBatches,
    processed_rows: processedRows,
    running_jobs: 0,
    total_jobs: jobs.length,
    job_progress: jobProgress
  };
}

export function getPageSignature(endpointKey: string | null, rowKeys: string[]): string {
  if (!Array.isArray(rowKeys) || rowKeys.length === 0) {
    return "";
  }

  const stableKeys = [...rowKeys].filter(Boolean).sort();
  if (stableKeys.length === 0) {
    return "";
  }

  const seed = `${endpointKey ?? ""}::${stableKeys.join("||")}`;
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${endpointKey ?? "default"}:${hash.toString(36)}`;
}

export function getFetchBatchLimit(
  source: LowLevelSourceType,
  defaultLimit: number,
  appearanceFeedLimit: number,
  sideCharacterLimit: number
): number {
  if (isSideCharacterSource(source)) {
    return sideCharacterLimit;
  }

  if (isServerCursorOnlyAppearanceFeed(source)) {
    return appearanceFeedLimit;
  }

  return defaultLimit;
}

export function isDraftSource(source: LowLevelSourceType): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

export function shouldRefreshCreatorProfile(profile: {
  permalink: string;
  user_id: string;
  account_type?: "creator" | "sideCharacter";
  is_character_profile: boolean;
  appearance_count: number | null;
  published_count: number | null;
}): boolean {
  return Boolean(profile.permalink);
}

export function mergeRefreshedCreatorProfile(savedProfile: CreatorProfile, refreshedProfile: CreatorProfile): CreatorProfile {
  const mergedProfile: CreatorProfile = {
    ...savedProfile,
    ...refreshedProfile,
    profile_id: savedProfile.profile_id
  };

  if (savedProfile.account_type !== "sideCharacter") {
    return mergedProfile;
  }

  return {
    ...mergedProfile,
    account_type: "sideCharacter",
    is_character_profile: true,
    character_user_id: resolveSideCharacterId(savedProfile, refreshedProfile),
    owner_user_id: resolveOwnerUserId(savedProfile, refreshedProfile)
  };
}

export function throwIfFetchCanceled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new FetchCancellationError();
  }
}

export function isFetchCancellationError(error: unknown): error is FetchCancellationError {
  return error instanceof FetchCancellationError;
}

export async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  workerFn: (value: T) => Promise<void>
): Promise<void> {
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < values.length) {
      const value = values[currentIndex];
      currentIndex += 1;
      await workerFn(value);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
}

function isServerCursorOnlyAppearanceFeed(source: LowLevelSourceType): boolean {
  return source === "creatorPublished" || source === "characters" || source === "characterAccountAppearances" || source === "sideCharacter";
}

function isSideCharacterSource(source: LowLevelSourceType): boolean {
  return source === "sideCharacter";
}

export function dedupeVideoRowsById(rows: VideoRow[]): VideoRow[] {
  const rowMap = new Map<string, VideoRow>();
  for (const row of rows) {
    rowMap.set(row.row_id, row);
  }
  return [...rowMap.values()];
}

export function parseVideoRowRawPayload(row: VideoRow): Record<string, unknown> | null {
  if (!row.raw_payload_json?.trim()) return null;
  try {
    const parsedPayload = JSON.parse(row.raw_payload_json);
    return parsedPayload && typeof parsedPayload === "object" ? parsedPayload as Record<string, unknown> : null;
  } catch { return null; }
}

export function getGenerationIdFromDetailUrl(detailUrl: string): string {
  const match = detailUrl.match(/\/d\/(gen_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

function resolveSideCharacterId(savedProfile: CreatorProfile, refreshedProfile: CreatorProfile): string {
  const candidates = [
    refreshedProfile.character_user_id,
    savedProfile.character_user_id,
    refreshedProfile.user_id,
    savedProfile.user_id
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = (candidate || "").trim();
    if (normalizedCandidate.startsWith("ch_")) {
      return normalizedCandidate;
    }
  }

  return savedProfile.character_user_id || refreshedProfile.character_user_id || "";
}

function resolveOwnerUserId(savedProfile: CreatorProfile, refreshedProfile: CreatorProfile): string {
  const candidates = [
    refreshedProfile.owner_user_id,
    savedProfile.owner_user_id,
    refreshedProfile.user_id,
    savedProfile.user_id
  ];

  for (const candidate of candidates) {
    const normalizedCandidate = (candidate || "").trim();
    if (normalizedCandidate.startsWith("user_") || normalizedCandidate.startsWith("user-")) {
      return normalizedCandidate;
    }
  }

  return savedProfile.owner_user_id || refreshedProfile.owner_user_id || "";
}
