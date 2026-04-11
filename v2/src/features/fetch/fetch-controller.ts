import type { BackgroundResponse, FetchBatchResponse, FetchDetailHtmlResponse } from "types/background";
import type { DraftResolutionRecord, FetchJobCheckpoint, LowLevelSourceType, VideoRow } from "types/domain";
import { useAppStore } from "@app/store/use-app-store";
import { sendBackgroundRequest } from "@lib/background/client";
import {
  clearWorkingSessionData,
  loadFetchJobCheckpoints,
  loadDraftResolutionMap,
  replaceDownloadQueue,
  saveFetchJobCheckpoint,
  saveDraftResolutionRecords,
  saveSessionMeta,
  upsertVideoRows
} from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";
import { normalizeCreatorProfileInput } from "@lib/utils/creator-profile-input";
import { formatCount } from "@lib/utils/format-utils";
import { stripRawPayloadFromRows } from "@lib/utils/video-row-utils";
import { extractVideoIdFromDetailHtml, normalizeCharacterAccounts, normalizeCreatorProfile, normalizeDraftRows, normalizePostRows } from "@lib/normalize/video-row-normalizer";
import type { FetchJob } from "./source-adapters";
import { buildFetchJobs } from "./source-adapters";

const logger = createLogger("fetch-controller");
const FETCH_BATCH_LIMIT = 100;
const FETCH_PAGE_BUDGET = 3;
const HIGH_VOLUME_SOURCE_PAGE_BUDGET = 1;
const FETCH_CONCURRENCY = 3;
const DETAIL_FALLBACK_CONCURRENCY = 4;
const NO_GROWTH_PAGE_LIMIT = 3;
let activeFetchAbortController: AbortController | null = null;

interface BatchProcessResult {
  draftResolutionRecords: DraftResolutionRecord[];
  persistencePromise: Promise<void>;
  stored_row_ids: string[];
}

interface FetchResumeState {
  checkpointByJobId: Map<string, FetchJobCheckpoint>;
  selectionSignature: string;
  shouldResume: boolean;
}

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
  const refreshedState = await refreshCreatorProfilesForFetch();
  const state = refreshedState ?? useAppStore.getState();
  const jobs = buildFetchJobs(state);
  const resumeState = await resolveFetchResumeState(jobs);
  const lastFetchAt = new Date().toISOString();
  const jobsToRun = jobs.filter((job) => resumeState.checkpointByJobId.get(job.id)?.status !== "completed");

  if (jobs.length === 0) {
    throw new Error("Select at least one source, creator, or character account before fetching.");
  }

  if (!resumeState.shouldResume) {
    await clearWorkingSessionData();
    await replaceDownloadQueue([]);
    await saveSessionMeta({
      ...state.session_meta,
      query: "",
      last_fetch_at: lastFetchAt
    });
    useAppStore.getState().replaceVideoRows([]);
  }

  useAppStore.setState({
    phase: "fetching",
    error_message: "",
    session_meta: {
      ...state.session_meta,
      query: "",
      last_fetch_at: lastFetchAt
    },
    fetch_progress: buildInitialFetchProgress(jobs, resumeState.checkpointByJobId, resumeState.shouldResume),
    selected_video_ids: []
  });
  await saveSessionMeta({
    ...state.session_meta,
    query: "",
    last_fetch_at: lastFetchAt
  });

  const abortController = new AbortController();
  activeFetchAbortController = abortController;

  try {
    await runWithConcurrency(jobsToRun, FETCH_CONCURRENCY, (job) =>
      runFetchJob(job, abortController.signal, resumeState.selectionSignature, resumeState.checkpointByJobId.get(job.id) ?? null)
    );

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

async function refreshCreatorProfilesForFetch() {
  const state = useAppStore.getState();
  const profilesNeedingRefresh = state.creator_profiles.filter((profile) => shouldRefreshCreatorProfile(profile));
  if (profilesNeedingRefresh.length === 0) {
    return state;
  }

  const refreshedProfiles = await Promise.all(
    profilesNeedingRefresh.map(async (profile) => {
      if (!profile.permalink) {
        return profile;
      }

      try {
        const response = await sendBackgroundRequest<BackgroundResponse>({
          type: "resolve-creator-profile",
          route_url: profile.permalink
        });
        const refreshedProfile = normalizeCreatorProfile((response as BackgroundResponse & { payload?: unknown }).payload, profile.permalink);
        return refreshedProfile ? { ...profile, ...refreshedProfile, profile_id: profile.profile_id } : profile;
      } catch (error) {
        logger.warn("creator profile refresh failed", error);
        return profile;
      }
    })
  );

  const refreshedProfileMap = new Map(refreshedProfiles.map((profile) => [profile.profile_id, profile]));
  const nextProfiles = state.creator_profiles.map((profile) => refreshedProfileMap.get(profile.profile_id) ?? profile);
  useAppStore.getState().setCreatorProfiles(nextProfiles);
  return { ...useAppStore.getState(), creator_profiles: nextProfiles };
}

async function runFetchJob(
  job: FetchJob,
  signal: AbortSignal,
  selectionSignature: string,
  checkpoint: FetchJobCheckpoint | null
): Promise<void> {
  logger.info("running fetch job", job.id);
  markFetchJobRunning(job, checkpoint);
  throwIfFetchCanceled(signal);

  const fetchedAt = new Date().toISOString();
  const recoveryTasks: Array<Promise<void>> = [];
  const finalCheckpoint = await streamFetchBatches(job.source, job, signal, checkpoint, selectionSignature, async (rows) => {
    const normalizedRows = isDraftSource(job.source)
      ? normalizeDraftRows(job.source, rows, fetchedAt)
      : normalizePostRows(job.source, rows, fetchedAt);
    const draftResolutionRecords = buildDraftResolutionRecords(rows);

    if (normalizedRows.length > 0) {
      useAppStore.getState().upsertVideoRows(stripRawPayloadFromRows(normalizedRows));
    }

    const recoverableRows = getRecoverableRows(normalizedRows);
    if (recoverableRows.length > 0) {
      recoveryTasks.push(
        recoverMissingVideoIds(recoverableRows, signal).then(async (recoveredRows) => {
          if (recoveredRows.length === 0) {
            return;
          }
          await upsertVideoRows(recoveredRows);
          useAppStore.getState().upsertVideoRows(stripRawPayloadFromRows(recoveredRows));
        })
      );
    }

    const persistenceTasks: Array<Promise<void>> = [];
    if (draftResolutionRecords.length > 0) {
      persistenceTasks.push(saveDraftResolutionRecords(draftResolutionRecords));
    }
    if (normalizedRows.length > 0) {
      persistenceTasks.push(upsertVideoRows(normalizedRows));
    }

    return {
      draftResolutionRecords,
      persistencePromise: persistenceTasks.length > 0 ? Promise.all(persistenceTasks).then(() => undefined) : Promise.resolve(),
      stored_row_ids: normalizedRows.map((row) => row.row_id)
    };
  });

  await Promise.all(recoveryTasks);
  throwIfFetchCanceled(signal);

  await saveFetchJobCheckpoint(
    finalizeFetchJobCheckpoint(job, selectionSignature, finalCheckpoint ?? checkpoint, {
      fetched_rows: useAppStore.getState().fetch_progress.job_progress.find((entry) => entry.job_id === job.id)?.fetched_rows ?? 0,
      processed_batches: useAppStore.getState().fetch_progress.job_progress.find((entry) => entry.job_id === job.id)?.processed_batches ?? 0,
      status: "completed"
    })
  );

  incrementCompletedJobs(job);
}

async function collectAllRows(source: LowLevelSourceType, job: FetchJob | { label: string }, signal: AbortSignal): Promise<unknown[]> {
  const collectedRows: unknown[] = [];
  await streamFetchBatches(source, job, signal, null, "", async (rows) => {
    collectedRows.push(...rows);
    return {
      draftResolutionRecords: [],
      persistencePromise: Promise.resolve(),
      stored_row_ids: []
    };
  });

  return collectedRows;
}

async function streamFetchBatches(
  source: LowLevelSourceType,
  job: FetchJob | { label: string },
  signal: AbortSignal,
  checkpoint: FetchJobCheckpoint | null,
  selectionSignature: string,
  onBatch: (rows: unknown[]) => Promise<BatchProcessResult>
): Promise<FetchJobCheckpoint | null> {
  const draftResolutionMap = await loadDraftResolutionMap();
  let cursor: string | null = checkpoint?.cursor ?? null;
  let offset: number | null = checkpoint?.offset ?? null;
  let endpointKey: string | null = checkpoint?.endpoint_key ?? null;
  let done = false;
  let streamedRowCount = checkpoint?.fetched_rows ?? 0;
  let processedBatches = checkpoint?.processed_batches ?? 0;
  const seenSessionRowIds = new Set(useAppStore.getState().video_rows.map((row) => row.row_id));
  let consecutiveNoGrowthPages = 0;
  let latestCheckpoint = checkpoint;

  while (!done) {
    throwIfFetchCanceled(signal);
    const requestCursor = cursor;
    const response: FetchBatchResponse = await sendBackgroundRequest({
      type: "fetch-batch",
      source,
      cursor,
      offset,
      limit: FETCH_BATCH_LIMIT,
      page_budget: getPageBudgetForSource(source),
      endpoint_key: endpointKey,
      route_url: "route_url" in job ? job.route_url : undefined,
      creator_user_id: "creator_user_id" in job ? job.creator_user_id : undefined,
      creator_username: "creator_username" in job ? job.creator_username : undefined,
      character_id: "character_id" in job ? job.character_id : undefined,
      draft_resolution_entries: [...draftResolutionMap.entries()].map(([generation_id, video_id]) => ({ generation_id, video_id }))
    });
    throwIfFetchCanceled(signal);

    const batchRows = response.payload.rows;
    endpointKey = response.payload.endpoint_key;
    cursor = response.payload.next_cursor;
    offset = response.payload.next_offset;
    const batchResult = batchRows.length > 0
      ? await onBatch(batchRows)
      : { draftResolutionRecords: [], persistencePromise: Promise.resolve(), stored_row_ids: [] };
    throwIfFetchCanceled(signal);

    const newStoredRowIds = getNewStoredRowIds(batchResult.stored_row_ids, seenSessionRowIds);
    streamedRowCount += newStoredRowIds.length;
    processedBatches += 1;
    consecutiveNoGrowthPages = newStoredRowIds.length === 0 ? consecutiveNoGrowthPages + 1 : 0;
    updateFetchBatchProgress(job, streamedRowCount, newStoredRowIds.length, processedBatches);

    for (const record of batchResult.draftResolutionRecords) {
      draftResolutionMap.set(record.generation_id, record.video_id);
    }

    await batchResult.persistencePromise;

    done =
      response.payload.done ||
      shouldStopForStalledCursor(requestCursor, response.payload.next_cursor, newStoredRowIds.length, batchRows.length, source) ||
      shouldStopForNoGrowthPages(consecutiveNoGrowthPages, batchRows.length, source);

    if ("id" in job) {
      latestCheckpoint = buildFetchJobCheckpoint(job, selectionSignature, latestCheckpoint, {
        cursor,
        previous_cursor: requestCursor,
        offset,
        endpoint_key: endpointKey,
        fetched_rows: streamedRowCount,
        processed_batches: processedBatches,
        status: "running"
      });
      await saveFetchJobCheckpoint(latestCheckpoint);
    }
  }

  return latestCheckpoint;
}

async function recoverMissingVideoIds(rows: VideoRow[], signal: AbortSignal): Promise<VideoRow[]> {
  const pendingRows = dedupeRowsById(rows);
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

function getRecoverableRows(rows: VideoRow[]): VideoRow[] {
  return rows.filter((row) => !row.video_id && row.detail_url && row.skip_reason === "missing_video_id");
}

function dedupeRowsById(rows: VideoRow[]): VideoRow[] {
  const rowMap = new Map<string, VideoRow>();
  for (const row of rows) {
    rowMap.set(row.row_id, row);
  }
  return [...rowMap.values()];
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
    active_label: "Stopping after current page..."
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

function markFetchJobRunning(job: FetchJob, checkpoint: FetchJobCheckpoint | null): void {
  useAppStore.setState((state) => ({
    fetch_progress: buildNextFetchProgressState(
      state.fetch_progress,
      state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === job.id
          ? {
              ...entry,
              status: "running" as const,
              fetched_rows: checkpoint?.fetched_rows ?? entry.fetched_rows,
              processed_batches: checkpoint?.processed_batches ?? entry.processed_batches,
              expected_total_count: entry.expected_total_count ?? job.expected_total_count
            }
          : entry
      )
    )
  }));
}

function updateFetchBatchProgress(
  job: FetchJob | { label: string },
  streamedRowCount: number,
  batchRowCount: number,
  processedBatchCount: number
): void {
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
            processed_batches: processedBatchCount
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

async function resolveFetchResumeState(jobs: FetchJob[]): Promise<FetchResumeState> {
  const checkpoints = await loadFetchJobCheckpoints();
  return buildFetchResumeStateFromCheckpoints(jobs, checkpoints);
}

function buildFetchSelectionSignature(jobs: FetchJob[]): string {
  return jobs
    .map((job) => [job.source, job.character_id ?? "", job.creator_user_id ?? "", job.creator_username ?? "", job.route_url ?? ""].join("|"))
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

function buildFetchJobCheckpoint(
  job: FetchJob,
  selectionSignature: string,
  previousCheckpoint: FetchJobCheckpoint | null,
  patch: Omit<FetchJobCheckpoint, "job_id" | "selection_signature" | "source" | "updated_at">
): FetchJobCheckpoint {
  return {
    ...previousCheckpoint,
    job_id: job.id,
    selection_signature: selectionSignature,
    source: job.source,
    ...patch,
    updated_at: new Date().toISOString()
  };
}

export function finalizeFetchJobCheckpoint(
  job: FetchJob,
  selectionSignature: string,
  checkpoint: FetchJobCheckpoint | null,
  patch: Pick<FetchJobCheckpoint, "fetched_rows" | "processed_batches" | "status">
): FetchJobCheckpoint {
  return buildFetchJobCheckpoint(job, selectionSignature, checkpoint, {
    cursor: checkpoint?.cursor ?? null,
    previous_cursor: checkpoint?.previous_cursor ?? null,
    offset: checkpoint?.offset ?? null,
    endpoint_key: checkpoint?.endpoint_key ?? null,
    ...patch
  });
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
  requestCursor: string | null,
  nextCursor: string | null,
  newStoredRowCount: number,
  batchRowCount: number,
  source: LowLevelSourceType
): boolean {
  if (supportsOffsetPagination(source)) {
    return false;
  }

  if (!requestCursor || !nextCursor) {
    return false;
  }

  return requestCursor === nextCursor && newStoredRowCount === 0 && batchRowCount > 0;
}

export function shouldStopForNoGrowthPages(
  consecutiveNoGrowthPages: number,
  batchRowCount: number,
  source: LowLevelSourceType
): boolean {
  if (supportsOffsetPagination(source) || batchRowCount === 0) {
    return false;
  }

  return consecutiveNoGrowthPages >= NO_GROWTH_PAGE_LIMIT;
}

function supportsOffsetPagination(source: LowLevelSourceType): boolean {
  return source === "drafts";
}

function isDraftSource(source: LowLevelSourceType): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function shouldRefreshCreatorProfile(profile: ReturnType<typeof useAppStore.getState>["creator_profiles"][number]): boolean {
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
    return `Fetching ${runningJobs} active job${runningJobs === 1 ? "" : "s"} · ${formatCount(processedRows)} rows`;
  }

  if (completedJobs >= totalJobs && totalJobs > 0) {
    return "Fetch complete";
  }

  return `${completedJobs} of ${totalJobs} jobs complete`;
}
