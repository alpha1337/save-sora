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
import { extractVideoIdFromDetailHtml, normalizeCharacterAccounts, normalizeCreatorProfile, normalizeDraftRows, normalizePostRows } from "@lib/normalize/video-row-normalizer";
import type { FetchJob } from "./source-adapters";
import { buildFetchJobs } from "./source-adapters";

const logger = createLogger("fetch-controller");
const FETCH_BATCH_LIMIT = 100;
const FETCH_PAGE_BUDGET = 3;
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
      total_jobs: jobs.length
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
  useAppStore.getState().setFetchProgress({ active_label: job.label });
  throwIfFetchCanceled(signal);

  if (job.source === "creatorCharacters") {
    const rows = await collectAllRows(job.source, job, signal);
    const accounts = normalizeCharacterAccounts(rows);
    const dedupedProfiles = accounts.map((account) => ({
      account_id: account.account_id,
      display_name: account.display_name,
      profile_picture_url: account.profile_picture_url,
      username: account.username
    }));
    logger.debug("creator character index discovered", dedupedProfiles.length);
    incrementCompletedJobs();
    return;
  }

  const rows = await collectAllRows(job.source, job, signal);
  throwIfFetchCanceled(signal);
  const fetchedAt = new Date().toISOString();
  const normalizedRows = isDraftSource(job.source)
    ? normalizeDraftRows(job.source, rows, fetchedAt)
    : normalizePostRows(job.source, rows, fetchedAt);
  const recoveredRows = await recoverMissingVideoIds(normalizedRows, signal);
  throwIfFetchCanceled(signal);

  const draftResolutionRecords = buildDraftResolutionRecords(rows);
  if (draftResolutionRecords.length > 0) {
    await saveDraftResolutionRecords(draftResolutionRecords);
  }

  await upsertVideoRows(recoveredRows);
  useAppStore.getState().upsertVideoRows(recoveredRows);
  incrementCompletedJobs();
}

async function collectAllRows(source: LowLevelSourceType, job: FetchJob | { label: string }, signal: AbortSignal): Promise<unknown[]> {
  const draftResolutionMap = await loadDraftResolutionMap();
  const collectedRows: unknown[] = [];
  let cursor: string | null = null;
  let offset: number | null = null;
  let done = false;

  while (!done) {
    throwIfFetchCanceled(signal);
    const response: FetchBatchResponse = await sendBackgroundRequest({
      type: "fetch-batch",
      source,
      cursor,
      offset,
      limit: FETCH_BATCH_LIMIT,
      page_budget: FETCH_PAGE_BUDGET,
      route_url: "route_url" in job ? job.route_url : undefined,
      creator_user_id: "creator_user_id" in job ? job.creator_user_id : undefined,
      creator_username: "creator_username" in job ? job.creator_username : undefined,
      character_id: "character_id" in job ? job.character_id : undefined,
      draft_resolution_entries: [...draftResolutionMap.entries()].map(([generation_id, video_id]) => ({ generation_id, video_id }))
    });
    throwIfFetchCanceled(signal);

    collectedRows.push(...response.payload.rows);
    cursor = response.payload.next_cursor;
    offset = response.payload.next_offset;
    done = response.payload.done;

    useAppStore.getState().setFetchProgress({
      active_label: `Fetched ${collectedRows.length} rows from ${job.label}`,
      processed_batches: useAppStore.getState().fetch_progress.processed_batches + 1,
      processed_rows: useAppStore.getState().fetch_progress.processed_rows + response.payload.rows.length
    });
  }

  return collectedRows;
}

async function recoverMissingVideoIds(rows: VideoRow[], signal: AbortSignal): Promise<VideoRow[]> {
  const pendingRows = rows.filter((row) => !row.video_id && row.detail_url && row.skip_reason === "missing_video_id");
  if (pendingRows.length === 0) {
    return rows;
  }

  const updatedRowMap = new Map(rows.map((row) => [row.row_id, row]));
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

        updatedRowMap.set(row.row_id, {
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
  return [...updatedRowMap.values()];
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

function incrementCompletedJobs(): void {
  const state = useAppStore.getState();
  state.setFetchProgress({
    completed_jobs: state.fetch_progress.completed_jobs + 1,
    active_label: `${state.fetch_progress.completed_jobs + 1} of ${state.fetch_progress.total_jobs} jobs complete`
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
