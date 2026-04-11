import type { BackgroundResponse, FetchBatchResponse, FetchDetailHtmlResponse } from "types/background";
import type { DraftResolutionRecord, LowLevelSourceType, VideoRow } from "types/domain";
import { useAppStore } from "@app/store/use-app-store";
import { sendBackgroundRequest } from "@lib/background/client";
import {
  clearWorkingSessionData,
  loadDraftResolutionMap,
  replaceDownloadQueue,
  replaceVideoRows,
  saveDraftResolutionRecords,
  saveSessionMeta,
  upsertVideoRows
} from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";
import { normalizeCreatorProfileInput } from "@lib/utils/creator-profile-input";
import { formatCount } from "@lib/utils/format-utils";
import { extractVideoIdFromDetailHtml, normalizeCharacterAccounts, normalizeCreatorProfile, normalizeDraftRows, normalizePostRows } from "@lib/normalize/video-row-normalizer";
import type { FetchJob } from "./source-adapters";
import { buildFetchJobs } from "./source-adapters";

const logger = createLogger("fetch-controller");
const FETCH_BATCH_LIMIT = 100;
const FETCH_PAGE_BUDGET = 3;
const HIGH_VOLUME_SOURCE_PAGE_BUDGET = 1;
const FETCH_CONCURRENCY = 3;
const DETAIL_FALLBACK_CONCURRENCY = 4;
let activeFetchAbortController: AbortController | null = null;

class FetchCancellationError extends Error {
  constructor() {
    super("Fetch canceled.");
    this.name = "FetchCancellationError";
  }
}

/**
 * Orchestrates end-to-end fetch execution, incremental persistence, and detail
 * fallback for unresolved rows.
 */
export async function fetchSelectedSources(): Promise<void> {
  const state = useAppStore.getState();
  const jobs = buildFetchJobs(state);

  if (jobs.length === 0) {
    throw new Error("Select at least one source, creator, or character account before fetching.");
  }

  useAppStore.setState({
    phase: "fetching",
    error_message: "",
    fetch_progress: {
      active_label: "Starting fetch",
      completed_jobs: 0,
      processed_batches: 0,
      processed_rows: 0,
      running_jobs: 0,
      total_jobs: jobs.length,
      job_progress: jobs.map((job) => ({
        job_id: job.id,
        label: job.label,
        source: job.source,
        status: "pending",
        fetched_rows: 0,
        processed_batches: 0,
        expected_total_count: job.expected_total_count
      }))
    },
    selected_video_ids: []
  });

  await clearWorkingSessionData();
  await replaceDownloadQueue([]);
  await saveSessionMeta({
    ...state.session_meta,
    last_fetch_at: new Date().toISOString()
  });
  useAppStore.getState().replaceVideoRows([]);

  const abortController = new AbortController();
  activeFetchAbortController = abortController;

  try {
    await runWithConcurrency(jobs, FETCH_CONCURRENCY, (job) => runFetchJob(job, abortController.signal));

    useAppStore.setState({
      phase: "ready",
      fetch_progress: {
        ...useAppStore.getState().fetch_progress,
        active_label: "Fetch complete"
      }
    });
  } catch (error) {
    if (isFetchCancellationError(error)) {
      const nextState = useAppStore.getState();
      useAppStore.setState({
        phase: nextState.video_rows.length > 0 ? "ready" : "idle",
        fetch_progress: {
          ...nextState.fetch_progress,
          active_label: "Fetch canceled"
        }
      });
      return;
    }

    throw error;
  } finally {
    if (activeFetchAbortController === abortController) {
      activeFetchAbortController = null;
    }
  }
}

export async function loadCharacterAccountsIntoState(): Promise<void> {
  const rows = await collectAllRows("characterProfiles", { label: "Character accounts" }, new AbortController().signal);
  const accounts = normalizeCharacterAccounts(rows);
  useAppStore.getState().setCharacterAccounts(accounts);
}

export async function resolveAndAddCreatorProfile(routeInput: string): Promise<void> {
  const routeUrl = normalizeCreatorProfileInput(routeInput);
  const response = await sendBackgroundRequest<BackgroundResponse>({
    type: "resolve-creator-profile",
    route_url: routeUrl
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  const profile = normalizeCreatorProfile((response as BackgroundResponse & { payload?: unknown }).payload, routeUrl);
  if (!profile) {
    throw new Error("Could not resolve a creator profile from that route.");
  }

  useAppStore.getState().addCreatorProfile(profile);
}

async function runFetchJob(job: FetchJob, signal: AbortSignal): Promise<void> {
  logger.info("running fetch job", job.id);
  markFetchJobRunning(job);
  throwIfFetchCanceled(signal);

  const fetchedAt = new Date().toISOString();
  await streamFetchBatches(job.source, job, signal, async (rows) => {
    const normalizedRows = isDraftSource(job.source)
      ? normalizeDraftRows(job.source, rows, fetchedAt)
      : normalizePostRows(job.source, rows, fetchedAt);
    const draftResolutionRecords = buildDraftResolutionRecords(rows);
    const persistenceTasks: Array<Promise<void>> = [];

    if (draftResolutionRecords.length > 0) {
      persistenceTasks.push(saveDraftResolutionRecords(draftResolutionRecords));
    }
    if (normalizedRows.length > 0) {
      persistenceTasks.push(upsertVideoRows(normalizedRows));
    }

    if (persistenceTasks.length > 0) {
      await Promise.all(persistenceTasks);
    }

    if (normalizedRows.length > 0) {
      useAppStore.getState().upsertVideoRows(normalizedRows);
    }

    const recoveredRows = await recoverMissingVideoIds(normalizedRows, signal);
    throwIfFetchCanceled(signal);

    if (recoveredRows.length > 0) {
      await upsertVideoRows(recoveredRows);
      useAppStore.getState().upsertVideoRows(recoveredRows);
    }

    return draftResolutionRecords;
  });

  incrementCompletedJobs(job);
}

async function collectAllRows(source: LowLevelSourceType, job: FetchJob | { label: string }, signal: AbortSignal): Promise<unknown[]> {
  const collectedRows: unknown[] = [];
  await streamFetchBatches(source, job, signal, async (rows) => {
    collectedRows.push(...rows);
    return [];
  });

  return collectedRows;
}

async function streamFetchBatches(
  source: LowLevelSourceType,
  job: FetchJob | { label: string },
  signal: AbortSignal,
  onBatch: (rows: unknown[]) => Promise<DraftResolutionRecord[]>
): Promise<void> {
  const draftResolutionMap = await loadDraftResolutionMap();
  let cursor: string | null = null;
  let offset: number | null = null;
  let done = false;
  let streamedRowCount = 0;

  while (!done) {
    throwIfFetchCanceled(signal);
    const response: FetchBatchResponse = await sendBackgroundRequest({
      type: "fetch-batch",
      source,
      cursor,
      offset,
      limit: FETCH_BATCH_LIMIT,
      page_budget: getPageBudgetForSource(source),
      route_url: "route_url" in job ? job.route_url : undefined,
      creator_user_id: "creator_user_id" in job ? job.creator_user_id : undefined,
      creator_username: "creator_username" in job ? job.creator_username : undefined,
      character_id: "character_id" in job ? job.character_id : undefined,
      draft_resolution_entries: [...draftResolutionMap.entries()].map(([generation_id, video_id]) => ({ generation_id, video_id }))
    });
    throwIfFetchCanceled(signal);

    const batchRows = response.payload.rows;
    const learnedDraftResolutionRecords = batchRows.length > 0 ? await onBatch(batchRows) : [];
    throwIfFetchCanceled(signal);

    for (const record of learnedDraftResolutionRecords) {
      draftResolutionMap.set(record.generation_id, record.video_id);
    }

    streamedRowCount += batchRows.length;
    cursor = response.payload.next_cursor;
    offset = response.payload.next_offset;
    done = response.payload.done;

    updateFetchBatchProgress(job, streamedRowCount, batchRows.length, response.payload.estimated_total_count);
  }
}

async function recoverMissingVideoIds(rows: VideoRow[], signal: AbortSignal): Promise<VideoRow[]> {
  const pendingRows = rows.filter((row) => !row.video_id && row.detail_url && row.skip_reason === "missing_video_id");
  if (pendingRows.length === 0) {
    return [];
  }

  const recoveredRows: VideoRow[] = [];
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < pendingRows.length) {
      throwIfFetchCanceled(signal);
      const row = pendingRows[currentIndex];
      currentIndex += 1;

      try {
        const response = await sendBackgroundRequest<FetchDetailHtmlResponse>({
          type: "fetch-detail-html",
          detail_url: row.detail_url
        });
        const videoId = extractVideoIdFromDetailHtml(response.payload.html);
        if (!videoId) {
          continue;
        }

        recoveredRows.push({
          ...row,
          video_id: videoId,
          is_downloadable: true,
          skip_reason: ""
        });
      } catch (error) {
        logger.warn("detail fallback failed", error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DETAIL_FALLBACK_CONCURRENCY, pendingRows.length) }, () => worker()));
  return recoveredRows;
}

/**
 * Requests a cooperative stop for the currently running fetch. The current
 * in-flight batch is allowed to finish, after which the fetch settles cleanly.
 */
export function cancelActiveFetch(): void {
  if (!activeFetchAbortController || activeFetchAbortController.signal.aborted) {
    return;
  }

  activeFetchAbortController.abort();
  useAppStore.getState().setFetchProgress({
    active_label: "Stopping after current batch..."
  });
}

function buildDraftResolutionRecords(rows: unknown[]): DraftResolutionRecord[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }
    const record = row as Record<string, unknown>;
    const generationId = typeof record.generation_id === "string"
      ? record.generation_id
      : typeof record.generationId === "string"
        ? record.generationId
        : "";
    const videoId = typeof record.resolved_video_id === "string"
      ? record.resolved_video_id
      : typeof record.resolvedVideoId === "string"
        ? record.resolvedVideoId
        : "";
    if (!generationId || !videoId) {
      return [];
    }
    return [{ generation_id: generationId, video_id: videoId }];
  });
}

function incrementCompletedJobs(job: FetchJob): void {
  useAppStore.setState((state) => ({
    fetch_progress: buildNextFetchProgressState(
      state.fetch_progress,
      state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === job.id
          ? { ...entry, status: "completed" as const }
          : entry
      ),
      {
        completed_jobs: state.fetch_progress.completed_jobs + 1
      }
    )
  }));
}

function getPageBudgetForSource(source: LowLevelSourceType): number {
  if (
    source === "creatorPublished" ||
    source === "creatorCameos" ||
    source === "characterAccountAppearances" ||
    source === "characterAccountDrafts"
  ) {
    return HIGH_VOLUME_SOURCE_PAGE_BUDGET;
  }

  return FETCH_PAGE_BUDGET;
}

function markFetchJobRunning(job: FetchJob): void {
  useAppStore.setState((state) => ({
    fetch_progress: buildNextFetchProgressState(
      state.fetch_progress,
      state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === job.id
          ? { ...entry, status: "running" as const, expected_total_count: getHigherCount(entry.expected_total_count, job.expected_total_count) }
          : entry
      )
    )
  }));
}

function updateFetchBatchProgress(job: FetchJob | { label: string }, streamedRowCount: number, batchRowCount: number, estimatedTotalCount: number | null): void {
  useAppStore.setState((state) => {
    if (!("id" in job)) {
      return {
        fetch_progress: {
          ...state.fetch_progress,
          active_label: `Fetched ${streamedRowCount} rows from ${job.label}`,
          processed_batches: state.fetch_progress.processed_batches + 1,
          processed_rows: state.fetch_progress.processed_rows + batchRowCount
        }
      };
    }

    const nextJobProgress = state.fetch_progress.job_progress.map((entry) =>
      entry.job_id === job.id
        ? {
            ...entry,
            status: "running" as const,
            fetched_rows: streamedRowCount,
            processed_batches: entry.processed_batches + 1,
            expected_total_count: getHigherCount(entry.expected_total_count, estimatedTotalCount)
          }
        : entry
    );

    return {
      fetch_progress: buildNextFetchProgressState(state.fetch_progress, nextJobProgress, {
        processed_batches: state.fetch_progress.processed_batches + 1,
        processed_rows: state.fetch_progress.processed_rows + batchRowCount
      })
    };
  });
}

function isDraftSource(source: LowLevelSourceType): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function throwIfFetchCanceled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new FetchCancellationError();
  }
}

function isFetchCancellationError(error: unknown): error is FetchCancellationError {
  return error instanceof FetchCancellationError;
}

async function runWithConcurrency<T>(values: T[], concurrency: number, workerFn: (value: T) => Promise<void>): Promise<void> {
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

function buildNextFetchProgressState(
  currentProgress: ReturnType<typeof useAppStore.getState>["fetch_progress"],
  nextJobProgress: ReturnType<typeof useAppStore.getState>["fetch_progress"]["job_progress"],
  overrides: Partial<ReturnType<typeof useAppStore.getState>["fetch_progress"]> = {}
) {
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
  jobProgress: ReturnType<typeof useAppStore.getState>["fetch_progress"]["job_progress"],
  runningJobs: number,
  completedJobs: number,
  totalJobs: number,
  processedRows: number
): string {
  if (runningJobs === 1) {
    const activeJob = jobProgress.find((entry) => entry.status === "running");
    if (activeJob) {
      if (typeof activeJob.expected_total_count === "number" && activeJob.expected_total_count > 0) {
        return `Fetching ${activeJob.label} · ${formatCount(activeJob.fetched_rows)} / ${formatCount(activeJob.expected_total_count)} rows`;
      }

      return `Fetching ${activeJob.label} · ${formatCount(activeJob.fetched_rows)} rows`;
    }
  }

  if (runningJobs > 0) {
    return `Fetching ${runningJobs} active job${runningJobs === 1 ? "" : "s"} · ${processedRows} rows`;
  }

  if (completedJobs >= totalJobs && totalJobs > 0) {
    return "Fetch complete";
  }

  return `${completedJobs} of ${totalJobs} jobs complete`;
}

function getHigherCount(left: number | null, right: number | null): number | null {
  if (typeof left !== "number") {
    return typeof right === "number" ? right : null;
  }
  if (typeof right !== "number") {
    return left;
  }
  return Math.max(left, right);
}
