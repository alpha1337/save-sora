import type { FetchJobCheckpoint, FetchProgressState, LowLevelSourceType } from "types/domain";
import { formatCount } from "@lib/utils/format-utils";
import type { FetchJob } from "./source-adapters";

const NO_GROWTH_PAGE_LIMIT = 3;
const REPEATED_PAGE_SIGNATURE_LIMIT = 2;

export interface FetchResumeState {
  checkpointByJobId: Map<string, FetchJobCheckpoint>;
  selectionSignature: string;
  shouldResume: boolean;
}

export function buildFetchSelectionSignature(jobs: FetchJob[]): string {
  return jobs
    .map((job) =>
      [
        job.source,
        job.character_id ?? "",
        job.creator_user_id ?? "",
        job.creator_username ?? "",
        job.route_url ?? "",
        String(job.fetch_since_ms ?? ""),
        String(job.fetch_until_ms ?? "")
      ].join("|")
    )
    .sort()
    .join("::");
}

export function buildFetchResumeStateFromCheckpoints(jobs: FetchJob[], checkpoints: FetchJobCheckpoint[]): FetchResumeState {
  const selectionSignature = buildFetchSelectionSignature(jobs);
  const matchingCheckpoints = checkpoints.filter((checkpoint) => checkpoint.selection_signature === selectionSignature);
  const shouldResume = matchingCheckpoints.some((checkpoint) => checkpoint.status !== "completed");

  return {
    checkpointByJobId: shouldResume
      ? new Map(matchingCheckpoints.map((checkpoint) => [checkpoint.job_id, checkpoint]))
      : new Map(),
    selectionSignature,
    shouldResume
  };
}

export function finalizeFetchJobCheckpoint(
  job: FetchJob,
  selectionSignature: string,
  checkpoint: FetchJobCheckpoint | null,
  patch: Pick<FetchJobCheckpoint, "fetched_rows" | "processed_batches" | "status">
): FetchJobCheckpoint {
  return {
    ...checkpoint,
    job_id: job.id,
    selection_signature: selectionSignature,
    source: job.source,
    cursor: checkpoint?.cursor ?? null,
    previous_cursor: checkpoint?.previous_cursor ?? null,
    offset: checkpoint?.offset ?? null,
    endpoint_key: checkpoint?.endpoint_key ?? null,
    ...patch,
    updated_at: new Date().toISOString()
  };
}

export function getNewStoredRowIds(rowIds: string[], knownSessionRowIds: Set<string>): string[] {
  const newStoredRowIds: string[] = [];

  for (const rowId of rowIds) {
    if (!rowId || knownSessionRowIds.has(rowId)) {
      continue;
    }
    knownSessionRowIds.add(rowId);
    newStoredRowIds.push(rowId);
  }

  return newStoredRowIds;
}

export function shouldStopForStalledCursor(
  consecutiveRepeatedPageSignatures: number,
  source: LowLevelSourceType
): boolean {
  if (supportsOffsetPagination(source) || isDraftLikeSource(source)) {
    return false;
  }

  return consecutiveRepeatedPageSignatures >= REPEATED_PAGE_SIGNATURE_LIMIT;
}

export function shouldStopForNoGrowthPages(
  consecutiveNoGrowthPages: number,
  _batchRowCount: number,
  source: LowLevelSourceType
): boolean {
  if (supportsOffsetPagination(source) || isServerCursorOnlyAppearanceFeed(source) || isDraftLikeSource(source)) {
    return false;
  }

  return consecutiveNoGrowthPages >= NO_GROWTH_PAGE_LIMIT;
}

export function buildNextFetchProgressState(
  currentProgress: FetchProgressState,
  nextJobProgress: FetchProgressState["job_progress"],
  overrides: Partial<FetchProgressState> = {}
): FetchProgressState {
  const runningJobs = nextJobProgress.filter((entry) => entry.status === "running").length;
  const completedJobs = overrides.completed_jobs ?? currentProgress.completed_jobs;
  const processedBatches = overrides.processed_batches ?? currentProgress.processed_batches;
  const processedRows = overrides.processed_rows ?? currentProgress.processed_rows;

  return {
    ...currentProgress,
    ...overrides,
    active_label: buildFetchProgressLabel(nextJobProgress, runningJobs, completedJobs, currentProgress.total_jobs, processedRows),
    completed_jobs: completedJobs,
    processed_batches: processedBatches,
    processed_rows: processedRows,
    running_jobs: runningJobs,
    job_progress: nextJobProgress
  };
}

function buildFetchProgressLabel(
  jobProgress: FetchProgressState["job_progress"],
  runningJobs: number,
  completedJobs: number,
  totalJobs: number,
  processedRows: number
): string {
  if (runningJobs === 1) {
    const activeJob = jobProgress.find((entry) => entry.status === "running");
    if (activeJob) {
      if (typeof activeJob.expected_total_count === "number" && activeJob.expected_total_count > 0) {
        return `Fetching ${activeJob.label} · ${formatCount(activeJob.fetched_rows)} new rows · ${formatCount(activeJob.processed_batches)} pages · ${formatCount(activeJob.expected_total_count)} reported total`;
      }

      return `Fetching ${activeJob.label} · ${formatCount(activeJob.fetched_rows)} new rows · ${formatCount(activeJob.processed_batches)} pages`;
    }
  }

  if (runningJobs > 0) {
    return `Fetching ${runningJobs} active job${runningJobs === 1 ? "" : "s"} · ${formatCount(processedRows)} new rows`;
  }

  if (completedJobs >= totalJobs && totalJobs > 0) {
    return "Fetch complete";
  }

  return `${completedJobs} of ${totalJobs} jobs complete`;
}

function supportsOffsetPagination(source: LowLevelSourceType): boolean {
  return source === "drafts";
}

function isDraftLikeSource(source: LowLevelSourceType): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function isServerCursorOnlyAppearanceFeed(source: LowLevelSourceType): boolean {
  return source === "characters" || source === "characterAccountAppearances" || source === "creatorCameos";
}
