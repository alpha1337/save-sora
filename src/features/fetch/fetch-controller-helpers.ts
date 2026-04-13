import type { FetchJobCheckpoint, LowLevelSourceType } from "types/domain";
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

export function getFetchBatchLimit(source: LowLevelSourceType, defaultLimit: number, appearanceFeedLimit: number): number {
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
  is_character_profile: boolean;
  appearance_count: number | null;
  published_count: number | null;
}): boolean {
  if (!profile.permalink) {
    return false;
  }

  if (!profile.user_id) {
    return true;
  }

  if (profile.is_character_profile) {
    return profile.appearance_count == null;
  }

  return profile.published_count == null || profile.appearance_count == null;
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
  return source === "characters" || source === "characterAccountAppearances" || source === "creatorCameos";
}
