import type {
  BackgroundRequest,
  BackgroundResponse,
  FetchBatchRequest,
  FetchBatchResponse
} from "types/background";
import type { DraftResolutionRecord, FetchJobCheckpoint, LowLevelSourceType, VideoRow } from "types/domain";
import { useAppStore } from "@app/store/use-app-store";
import { sendBackgroundRequest } from "@lib/background/client";
import { createLogger } from "@lib/logging/logger";
import { formatCount } from "@lib/utils/format-utils";
import { getCharacterNames } from "@lib/normalize/shared";
import {
  getFetchBatchCompleteLabel,
  buildFetchBatchErrorWithContext,
  getFetchCompleteLabel,
  getFetchNormalizingBatchLabel,
  getFetchPersistingBatchLabel,
  getFetchQueuedLabel,
  getFetchReceivedBatchLabel,
  getFetchRequestingBatchLabel,
  getFetchSkippedUnavailableLabel,
  getUnknownErrorMessage,
  pickFetchActiveItemTitle
} from "@lib/utils/fetch-status";
import { normalizeCreatorProfileInput } from "@lib/utils/creator-profile-input";
import { stripRawPayloadFromRows } from "@lib/utils/video-row-utils";
import { normalizeCharacterAccounts, normalizeCreatorProfile, normalizeDraftRows, normalizePostRows } from "@lib/normalize/video-row-normalizer";
import {
  buildFetchResumeStateFromCheckpoints,
  buildFetchSelectionSignature,
  buildNextFetchProgressState,
  finalizeFetchJobCheckpoint,
  getNewStoredRowIds
} from "./fetch-runtime-utils";
import {
  buildInitialFetchProgress,
  FetchCancellationError,
  getFetchBatchLimit,
  isDraftSource,
  isFetchCancellationError,
  mergeRefreshedCreatorProfile,
  runWithConcurrency,
  shouldRefreshCreatorProfile,
  throwIfFetchCanceled
} from "./fetch-controller-helpers";
import { applyCharacterRowContext, filterRowsForCharacterScope } from "./character-row-scope";
import { buildFetchJobs, type FetchJob } from "./source-adapters";
import {
  loadFetchCheckpointsForJobs,
  saveFetchBatchState,
  saveFetchRowsForJob
} from "@lib/db/fetch-cache-db";
export {
  buildFetchResumeStateFromCheckpoints,
  finalizeFetchJobCheckpoint,
  getNewStoredRowIds,
  shouldStopForNoGrowthPages,
  shouldStopForStalledCursor
} from "./fetch-runtime-utils";
export { buildInitialFetchProgress } from "./fetch-controller-helpers";
const logger = createLogger("fetch-controller");
const SORA_PROFILE_ORIGIN = "https://sora.chatgpt.com";
const FETCH_BATCH_LIMIT = 100;
const APPEARANCE_FEED_BATCH_LIMIT = 8;
const SIDE_CHARACTER_BATCH_LIMIT = 8;
const ENABLE_FETCH_RESULT_BATCHING = true;
const SIDE_CHARACTER_RESULT_FLUSH_PAGE_SIZE = 24;
const FETCH_PAGE_BUDGET = 3;
const HIGH_VOLUME_SOURCE_PAGE_BUDGET = 1;
const FETCH_CONCURRENCY = 1;
const FETCH_BATCH_TRANSPORT_RETRY_DELAYS_MS = [300, 800, 1600];
const RESUME_HEAD_HYDRATION_MAX_PAGES = 24;
const RESUME_HEAD_HYDRATION_MAX_DURATION_MS = 30_000;
const RESUME_HEAD_HYDRATION_KNOWN_ROW_PAGE_LIMIT = 1;
let activeFetchAbortController: AbortController | null = null;
const characterLabelLookupPromises = new Map<string, Promise<string>>();
interface BatchProcessResult {
  active_item_title: string;
  cache_rows: VideoRow[];
  draftResolutionRecords: DraftResolutionRecord[];
  stored_row_ids: string[];
}

interface PreparedFetchBatchRows {
  activeItemTitle: string;
  draftResolutionRecords: DraftResolutionRecord[];
  inRangeRows: VideoRow[];
}

interface FetchPersistenceContext {
  checkpointByJobId: Map<string, FetchJobCheckpoint>;
  enableResume: boolean;
  selectionSignature: string;
  shouldResume: boolean;
}

interface FetchBatchStreamStartState {
  cursor: string | null;
  endpointKey: string | null;
  offset: number | null;
  processedBatches: number;
  streamedRowCount: number;
}

interface FetchBatchCheckpointPayload {
  batch_rows: VideoRow[];
  checkpoint: FetchJobCheckpoint;
}

async function persistCompletedCheckpoint(
  runtimeJob: FetchJob,
  persistenceContext: FetchPersistenceContext,
  checkpoint: FetchJobCheckpoint | null
): Promise<void> {
  if (!persistenceContext.enableResume) {
    return;
  }
  const completedCheckpoint = finalizeFetchJobCheckpoint(
    runtimeJob,
    persistenceContext.selectionSignature,
    checkpoint,
    {
      fetched_rows: checkpoint?.fetched_rows ?? 0,
      processed_batches: checkpoint?.processed_batches ?? 0,
      status: "completed"
    }
  );
  await saveFetchBatchState(runtimeJob.id, [], completedCheckpoint);
}
export async function fetchSelectedSources(): Promise<void> {
  const bootstrapState = useAppStore.getState();
  const resumeEnabled = bootstrapState.settings.enable_fetch_resume === true;
  useAppStore.setState({
    phase: "fetching",
    error_message: "",
    selected_video_ids: [],
    fetch_progress: {
      active_label: resumeEnabled ? "Resuming cached session..." : "Preparing fetch...",
      completed_jobs: 0,
      processed_batches: 0,
      processed_rows: 0,
      running_jobs: 0,
      total_jobs: 0,
      job_progress: []
    }
  });

  const refreshedState = await refreshCreatorProfilesForFetch();
  const state = refreshedState ?? useAppStore.getState();
  const jobs = buildFetchJobs(state);
  const lastFetchAt = new Date().toISOString();
  const persistenceContext = await buildFetchPersistenceContext(jobs, resumeEnabled);
  const resumeBaseRows = persistenceContext.enableResume ? state.video_rows : [];

  if (jobs.length === 0) {
    throw new Error("Select at least one source, creator, or character account before fetching.");
  }
  logger.info("fetch cache hydrate at fetch start", {
    in_memory_row_count: state.video_rows.length,
    jobs: jobs.length,
    resume_enabled: persistenceContext.enableResume
  });
  useAppStore.getState().replaceVideoRows(resumeBaseRows);
  useAppStore.setState({
    session_meta: {
      ...state.session_meta,
      query: "",
      last_fetch_at: lastFetchAt,
      resume_fetch_available: persistenceContext.shouldResume
    },
    fetch_progress: buildInitialFetchProgress(
      jobs,
      persistenceContext.checkpointByJobId,
      persistenceContext.shouldResume
    )
  });
  const abortController = new AbortController();
  activeFetchAbortController = abortController;
  try {
    await runWithConcurrency(jobs, FETCH_CONCURRENCY, (job) =>
      runFetchJob(job, abortController.signal, persistenceContext)
    );
    useAppStore.setState({
      phase: "ready",
      session_meta: {
        ...useAppStore.getState().session_meta,
        resume_fetch_available: false
      },
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
        session_meta: {
          ...nextState.session_meta,
          resume_fetch_available: persistenceContext.enableResume
        },
        fetch_progress: {
          ...nextState.fetch_progress,
          active_label: "Fetch canceled"
        }
      });
      return;
    }
    if (persistenceContext.enableResume) {
      useAppStore.setState((nextState) => ({
        session_meta: {
          ...nextState.session_meta,
          resume_fetch_available: true
        }
      }));
    }
    throw error;
  } finally {
    if (activeFetchAbortController === abortController) {
      activeFetchAbortController = null;
    }
    await cleanupHiddenWorkersAfterFetch();
  }
}

async function buildFetchPersistenceContext(
  jobs: FetchJob[],
  resumeEnabled: boolean
): Promise<FetchPersistenceContext> {
  const selectionSignature = buildFetchSelectionSignature(jobs);
  const defaultContext: FetchPersistenceContext = {
    checkpointByJobId: new Map(),
    enableResume: resumeEnabled,
    selectionSignature,
    shouldResume: false
  };

  if (!resumeEnabled || jobs.length === 0) {
    return defaultContext;
  }

  try {
    const checkpoints = await loadFetchCheckpointsForJobs(jobs.map((job) => job.id));
    const resumeState = buildFetchResumeStateFromCheckpoints(jobs, checkpoints);
    return {
      ...defaultContext,
      checkpointByJobId: resumeState.checkpointByJobId,
      selectionSignature: resumeState.selectionSignature,
      shouldResume: resumeState.shouldResume
    };
  } catch (error) {
    logger.warn("failed to load fetch checkpoints; falling back to fresh fetch", error);
    return defaultContext;
  }
}

export async function loadCharacterAccountsIntoState(): Promise<void> {
  try {
    const rows = await collectAllRows("characterProfiles", { label: "Character accounts" }, new AbortController().signal);
    const accounts = normalizeCharacterAccounts(rows);
    useAppStore.getState().setCharacterAccounts(accounts);
  } finally {
    await cleanupHiddenWorkers();
  }
}
export async function resolveAndAddCreatorProfile(routeInput: string): Promise<void> {
  try {
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
  } finally {
    await cleanupHiddenWorkers();
  }
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
        return refreshedProfile ? mergeRefreshedCreatorProfile(profile, refreshedProfile) : profile;
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

function prepareFetchBatchRows(runtimeJob: FetchJob, rows: unknown[], fetchedAt: string): PreparedFetchBatchRows {
  const scopedRows = filterRowsForCharacterScope(rows, runtimeJob);
  const rowsWithContext = applyCharacterRowContext(scopedRows, runtimeJob);
  const normalizedRows = isDraftSource(runtimeJob.source)
    ? normalizeDraftRows(runtimeJob.source, rowsWithContext, fetchedAt)
    : normalizePostRows(runtimeJob.source, rowsWithContext, fetchedAt);
  const inRangeRows = filterRowsByFetchWindow(normalizedRows, runtimeJob.fetch_since_ms, runtimeJob.fetch_until_ms);
  const activeItemTitle = pickFetchActiveItemTitle(inRangeRows, runtimeJob.source);
  const draftResolutionRecords = isDraftSource(runtimeJob.source)
    ? buildDraftResolutionRecords(rowsWithContext)
    : [];
  return {
    activeItemTitle,
    draftResolutionRecords,
    inRangeRows
  };
}

async function hydrateRecentRowsBeforeResume(
  runtimeJob: FetchJob,
  signal: AbortSignal,
  persistenceContext: FetchPersistenceContext,
  options: { showStatusUpdates?: boolean } = {}
): Promise<void> {
  if (!persistenceContext.enableResume) {
    return;
  }

  const knownRowIds = new Set(useAppStore.getState().video_rows.map((row) => row.row_id));
  if (knownRowIds.size === 0) {
    return;
  }

  let cursor: string | null = null;
  let offset: number | null = null;
  let endpointKey: string | null = null;
  let knownRowPages = 0;
  let hydratedPages = 0;
  const fetchedAt = new Date().toISOString();
  const hydrationStartedAtMs = Date.now();
  const rowsToPersistByRowId = new Map<string, VideoRow>();
  const showStatusUpdates = options.showStatusUpdates !== false;

  const flushHydratedRowsToCache = async (): Promise<void> => {
    if (!persistenceContext.enableResume || rowsToPersistByRowId.size === 0) {
      return;
    }
    await saveFetchRowsForJob(runtimeJob.id, [...rowsToPersistByRowId.values()]);
    rowsToPersistByRowId.clear();
  };

  while (hydratedPages < RESUME_HEAD_HYDRATION_MAX_PAGES) {
    throwIfFetchCanceled(signal);
    const pageNumber = hydratedPages + 1;
    if (showStatusUpdates) {
      setFetchJobActiveStatus(
        runtimeJob.id,
        `Hydrating newest rows before resume (page ${formatCount(pageNumber)})`
      );
    }
    const response = await sendFetchBatchRequestWithRetry({
      type: "fetch-batch",
      source: runtimeJob.source,
      since_ms: runtimeJob.fetch_since_ms ?? null,
      until_ms: runtimeJob.fetch_until_ms ?? null,
      cursor: cursor ?? undefined,
      offset: offset ?? undefined,
      limit: getFetchBatchLimit(runtimeJob.source, FETCH_BATCH_LIMIT, APPEARANCE_FEED_BATCH_LIMIT, SIDE_CHARACTER_BATCH_LIMIT),
      page_budget: getPageBudgetForSource(runtimeJob.source),
      endpoint_key: endpointKey ?? undefined,
      route_url: runtimeJob.route_url,
      creator_user_id: runtimeJob.creator_user_id,
      creator_username: runtimeJob.creator_username,
      character_id: runtimeJob.character_id
    }, signal);
    throwIfFetchCanceled(signal);
    hydratedPages += 1;
    endpointKey = response.payload.endpoint_key;
    cursor = response.payload.next_cursor;
    offset = response.payload.next_offset;

    const preparedRows = prepareFetchBatchRows(runtimeJob, response.payload.rows, fetchedAt);
    const strippedRows = stripRawPayloadFromRows(preparedRows.inRangeRows);
    if (strippedRows.length > 0) {
      useAppStore.getState().upsertVideoRows(strippedRows);
      for (const row of preparedRows.inRangeRows) {
        rowsToPersistByRowId.set(row.row_id, row);
      }
    }

    let hasKnownRowInPage = false;
    for (const row of strippedRows) {
      if (knownRowIds.has(row.row_id)) {
        hasKnownRowInPage = true;
        continue;
      }
      knownRowIds.add(row.row_id);
    }

    if (hasKnownRowInPage) {
      knownRowPages += 1;
    } else {
      knownRowPages = 0;
    }

    const hitTimeBudget = Date.now() - hydrationStartedAtMs >= RESUME_HEAD_HYDRATION_MAX_DURATION_MS;
    if (response.payload.done || knownRowPages >= RESUME_HEAD_HYDRATION_KNOWN_ROW_PAGE_LIMIT || hitTimeBudget) {
      await flushHydratedRowsToCache();
      if (hitTimeBudget && !response.payload.done && knownRowPages < RESUME_HEAD_HYDRATION_KNOWN_ROW_PAGE_LIMIT) {
        logger.info("resume head hydration stopped at time budget", {
          job_id: runtimeJob.id,
          source: runtimeJob.source,
          hydrated_pages: hydratedPages,
          duration_ms: Date.now() - hydrationStartedAtMs
        });
      }
      return;
    }
  }

  await flushHydratedRowsToCache();
  logger.warn("resume head hydration stopped at page cap", {
    job_id: runtimeJob.id,
    source: runtimeJob.source,
    max_pages: RESUME_HEAD_HYDRATION_MAX_PAGES
  });
}

async function runFetchJob(
  job: FetchJob,
  signal: AbortSignal,
  persistenceContext: FetchPersistenceContext
): Promise<void> {
  const runtimeJob = await resolveFetchJobLabel(job, signal);
  const initialCheckpoint = persistenceContext.shouldResume
    ? persistenceContext.checkpointByJobId.get(runtimeJob.id) ?? null
    : null;

  if (persistenceContext.shouldResume && initialCheckpoint?.status === "completed") {
    logger.info("skipping completed resumed fetch job", {
      job_id: runtimeJob.id,
      source: runtimeJob.source
    });
    return;
  }

  let activeCheckpoint = initialCheckpoint;
  const resultFlushPageSize = initialCheckpoint && persistenceContext.shouldResume
    ? 1
    : getResultFlushPageSizeForSource(runtimeJob.source);
  let pendingStoreRows: VideoRow[] = [];
  let pendingStorePageCount = 0;
  let resumeHydrationCanceled = false;
  let resumeHydrationTask: Promise<void> | null = null;
  const flushPendingStoreRows = (force: boolean): void => {
    if (pendingStoreRows.length === 0) {
      return;
    }
    if (!force && pendingStorePageCount < resultFlushPageSize) {
      return;
    }
    useAppStore.getState().upsertVideoRows(pendingStoreRows);
    pendingStoreRows = [];
    pendingStorePageCount = 0;
  };
  logger.info("running fetch job", { job_id: runtimeJob.id, source: runtimeJob.source, label: runtimeJob.label });
  markFetchJobRunning(runtimeJob);
  throwIfFetchCanceled(signal);
  try {
    const fetchedAt = new Date().toISOString();
    if (initialCheckpoint && persistenceContext.shouldResume) {
      resumeHydrationTask = hydrateRecentRowsBeforeResume(runtimeJob, signal, persistenceContext, {
        showStatusUpdates: false
      }).catch((error) => {
        if (isFetchCancellationError(error)) {
          resumeHydrationCanceled = true;
          return;
        }
        logger.warn("resume head hydration failed; continuing checkpoint resume", {
          job_id: runtimeJob.id,
          source: runtimeJob.source,
          error: getUnknownErrorMessage(error)
        });
      });
      setFetchJobActiveStatus(runtimeJob.id, "Continuing from saved checkpoint...");
    }
    await streamFetchBatches(
      runtimeJob.source,
      runtimeJob,
      signal,
      async (rows) => {
      setFetchJobActiveStatus(runtimeJob.id, getFetchNormalizingBatchLabel(rows.length));
      const preparedRows = prepareFetchBatchRows(runtimeJob, rows, fetchedAt);
      const inRangeRows = preparedRows.inRangeRows;
      const activeItemTitle = preparedRows.activeItemTitle;
      const draftResolutionRecords = preparedRows.draftResolutionRecords;
      if (inRangeRows.length > 0) {
        const strippedRows = stripRawPayloadFromRows(inRangeRows);
        if (resultFlushPageSize <= 1) {
          useAppStore.getState().upsertVideoRows(strippedRows);
        } else {
          pendingStoreRows.push(...strippedRows);
          pendingStorePageCount += 1;
          flushPendingStoreRows(false);
        }
      }
      if (inRangeRows.length > 0) {
        setFetchJobActiveStatus(runtimeJob.id, `${activeItemTitle} · ${getFetchPersistingBatchLabel(inRangeRows.length)}`);
      } else {
        setFetchJobActiveStatus(runtimeJob.id, getFetchPersistingBatchLabel(0));
      }
      return {
        active_item_title: activeItemTitle,
        cache_rows: inRangeRows,
        draftResolutionRecords,
        stored_row_ids: inRangeRows.map((row) => row.row_id)
      };
      },
      initialCheckpoint ? {
        cursor: initialCheckpoint.cursor,
        endpointKey: initialCheckpoint.endpoint_key,
        offset: initialCheckpoint.offset,
        processedBatches: initialCheckpoint.processed_batches,
        streamedRowCount: initialCheckpoint.fetched_rows
      } : undefined,
      async (checkpoint) => {
        activeCheckpoint = checkpoint.checkpoint;
        if (!persistenceContext.enableResume) {
          return;
        }
        await saveFetchBatchState(runtimeJob.id, checkpoint.batch_rows, checkpoint.checkpoint);
      },
      persistenceContext.selectionSignature
    );
    if (resumeHydrationTask) {
      await resumeHydrationTask;
      if (resumeHydrationCanceled) {
        throw new FetchCancellationError();
      }
    }
    throwIfFetchCanceled(signal);

    await persistCompletedCheckpoint(runtimeJob, persistenceContext, activeCheckpoint);

    setFetchJobActiveStatus(runtimeJob.id, getFetchCompleteLabel());
    incrementCompletedJobs(runtimeJob);
  } catch (error) {
    if (isFetchCancellationError(error)) {
      throw error;
    }
    if (!isNonFatalItemLookupError(error)) {
      throw error;
    }
    logger.warn("continuing fetch job after non-fatal item lookup error", {
      job_id: runtimeJob.id,
      source: runtimeJob.source,
      error: getUnknownErrorMessage(error)
    });
    await persistCompletedCheckpoint(runtimeJob, persistenceContext, activeCheckpoint);
    setFetchJobActiveStatus(runtimeJob.id, getFetchSkippedUnavailableLabel());
    setFetchJobActiveStatus(runtimeJob.id, getFetchCompleteLabel());
    incrementCompletedJobs(runtimeJob);
  } finally {
    flushPendingStoreRows(true);
  }
}
async function resolveFetchJobLabel(job: FetchJob, signal: AbortSignal): Promise<FetchJob> {
  throwIfFetchCanceled(signal);
  const currentLabel = resolveCharacterLabelFromJobText(job);
  if (!currentLabel || !currentLabel.startsWith("ch_")) {
    return job;
  }
  const resolvedDisplayName = await resolveCharacterDisplayNameById(currentLabel, signal);
  if (!resolvedDisplayName) {
    return job;
  }
  const nextLabel = job.label.replace(currentLabel, resolvedDisplayName).trim();
  if (!nextLabel || nextLabel === job.label) {
    return job;
  }
  useAppStore.setState((state) => ({
    fetch_progress: {
      ...state.fetch_progress,
      job_progress: state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === job.id ? { ...entry, label: nextLabel } : entry
      )
    }
  }));
  return {
    ...job,
    label: nextLabel,
    character_display_name: resolvedDisplayName
  };
}
function resolveCharacterLabelFromJobText(job: FetchJob): string {
  const fromDisplay = (job.character_display_name ?? "").trim();
  if (fromDisplay && !isGenericCharacterPlaceholder(fromDisplay)) {
    return fromDisplay;
  }
  const fromLabel = job.label.replace(/\s+(drafts|appearances|published|cameos)$/i, "").trim();
  if (fromLabel && !isGenericCharacterPlaceholder(fromLabel)) {
    return fromLabel;
  }
  const fromCharacterId = (job.character_id ?? "").trim();
  if (fromCharacterId) {
    return fromCharacterId;
  }
  const fromJobId = extractCharacterIdFromJobId(job.id);
  return fromJobId;
}
function isGenericCharacterPlaceholder(value: string): boolean {
  return /^character$/i.test(value.trim());
}
function extractCharacterIdFromJobId(jobId: string): string {
  const match = jobId.match(/(ch_[A-Za-z0-9]+)/);
  return match?.[1] ?? "";
}
async function resolveCharacterDisplayNameById(characterId: string, signal: AbortSignal): Promise<string> {
  const normalizedCharacterId = characterId.trim();
  if (!normalizedCharacterId || !normalizedCharacterId.startsWith("ch_")) {
    return "";
  }
  if (!characterLabelLookupPromises.has(normalizedCharacterId)) {
    characterLabelLookupPromises.set(normalizedCharacterId, lookupCharacterDisplayName(normalizedCharacterId, signal));
  }
  return characterLabelLookupPromises.get(normalizedCharacterId) ?? Promise.resolve("");
}
async function lookupCharacterDisplayName(characterId: string, signal: AbortSignal): Promise<string> {
  const routeUrl = `${SORA_PROFILE_ORIGIN}/profile/${encodeURIComponent(characterId)}`;
  try {
    const response = await sendBackgroundRequestCancelable<BackgroundResponse>({
      type: "resolve-creator-profile",
      route_url: routeUrl
    }, signal);
    if (response.ok) {
      const profile = normalizeCreatorProfile((response as BackgroundResponse & { payload?: unknown }).payload, routeUrl);
      const label = profile?.display_name?.trim() || profile?.username?.trim() || "";
      if (label) {
        if (profile) {
          useAppStore.setState((state) => {
            const existingIndex = state.creator_profiles.findIndex((entry) => entry.profile_id === profile.profile_id);
            if (existingIndex === -1) {
              return { creator_profiles: [...state.creator_profiles, profile] };
            }
            const nextProfiles = [...state.creator_profiles];
            nextProfiles[existingIndex] = { ...nextProfiles[existingIndex], ...profile };
            return { creator_profiles: nextProfiles };
          });
        }
        return label;
      }
    }
  } catch (error) {
    if (!isExpectedCharacterLookupError(error)) {
      logger.warn("character label lookup failed", error);
    }
  }
  try {
    const probe = await sendBackgroundRequestCancelable<FetchBatchResponse>({
      type: "fetch-batch",
      source: "characterAccountAppearances",
      character_id: characterId,
      limit: 1,
      page_budget: 1
    }, signal);
    if (!probe.ok || !probe.payload.rows.length) {
      return "";
    }
    const name = resolveCharacterDisplayFromRows(probe.payload.rows, characterId);
    return name;
  } catch (error) {
    logger.warn("character feed probe failed", error);
    return "";
  }
}
function resolveCharacterDisplayFromRows(rows: unknown[], characterId: string): string {
  for (const row of rows) {
    const names = getCharacterNames(row);
    if (names.length > 0) {
      const preferred = names.find((candidate) => candidate && !candidate.startsWith("ch_"));
      return (preferred || names[0] || "").trim();
    }
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const profileRecord = record.profile && typeof record.profile === "object"
      ? record.profile as Record<string, unknown>
      : null;
    if (profileRecord) {
      const profileUserId = typeof profileRecord.user_id === "string" ? profileRecord.user_id.trim() : "";
      if (!profileUserId || profileUserId === characterId) {
        const profileDisplayName = typeof profileRecord.display_name === "string" ? profileRecord.display_name.trim() : "";
        const profileUsername = typeof profileRecord.username === "string" ? profileRecord.username.trim() : "";
        const resolvedFromProfile = profileDisplayName || profileUsername;
        if (resolvedFromProfile && !resolvedFromProfile.startsWith("ch_")) {
          return resolvedFromProfile;
        }
      }
    }
    const cameoProfiles = Array.isArray(record.cameo_profiles) ? record.cameo_profiles : [];
    for (const profileEntry of cameoProfiles) {
      if (!profileEntry || typeof profileEntry !== "object") {
        continue;
      }
      const profile = profileEntry as Record<string, unknown>;
      const profileUserId = typeof profile.user_id === "string" ? profile.user_id : "";
      if (profileUserId && profileUserId !== characterId) {
        continue;
      }
      const displayName = typeof profile.display_name === "string" ? profile.display_name.trim() : "";
      const username = typeof profile.username === "string" ? profile.username.trim() : "";
      const resolved = displayName || username;
      if (resolved && !resolved.startsWith("ch_")) {
        return resolved;
      }
    }
  }
  return "";
}
async function collectAllRows(source: LowLevelSourceType, job: FetchJob | { label: string }, signal: AbortSignal): Promise<unknown[]> {
  const collectedRows: unknown[] = [];
  await streamFetchBatches(source, job, signal, async (rows) => {
    collectedRows.push(...rows);
    return {
      active_item_title: "",
      cache_rows: [],
      draftResolutionRecords: [],
      stored_row_ids: []
    };
  });
  return collectedRows;
}
async function streamFetchBatches(
  source: LowLevelSourceType,
  job: FetchJob | { label: string },
  signal: AbortSignal,
  onBatch: (rows: unknown[]) => Promise<BatchProcessResult>,
  startState?: FetchBatchStreamStartState,
  onCheckpoint?: (payload: FetchBatchCheckpointPayload) => Promise<void>,
  selectionSignature = ""
): Promise<void> {
  let cursor: string | null = startState?.cursor ?? null;
  let offset: number | null = startState?.offset ?? null;
  let endpointKey: string | null = startState?.endpointKey ?? null;
  let done = false;
  let streamedRowCount = startState?.streamedRowCount ?? 0;
  let processedBatches = startState?.processedBatches ?? 0;
  const seenSessionRowIds = new Set(useAppStore.getState().video_rows.map((row) => row.row_id));
  const seenJobRowIds = new Set<string>();
  while (!done) {
    throwIfFetchCanceled(signal);
    const requestCursor = cursor;
    const nextBatchNumber = processedBatches + 1;
    logger.info("fetch batch request", { job: "id" in job ? job.id : job.label, source, batch: nextBatchNumber, endpoint_key: endpointKey, cursor: requestCursor, offset });
    if ("id" in job) {
      setFetchJobActiveStatus(job.id, getFetchRequestingBatchLabel(nextBatchNumber, source, endpointKey));
    }
    let response: FetchBatchResponse;
    try {
      response = await sendFetchBatchRequestWithRetry({
        type: "fetch-batch",
        source,
        since_ms: "fetch_since_ms" in job ? (job.fetch_since_ms ?? null) : null,
        until_ms: "fetch_until_ms" in job ? (job.fetch_until_ms ?? null) : null,
        cursor: requestCursor ?? undefined,
        offset: offset ?? undefined,
        limit: getFetchBatchLimit(source, FETCH_BATCH_LIMIT, APPEARANCE_FEED_BATCH_LIMIT, SIDE_CHARACTER_BATCH_LIMIT),
        page_budget: getPageBudgetForSource(source),
        endpoint_key: endpointKey ?? undefined,
        route_url: "route_url" in job ? job.route_url : undefined,
        creator_user_id: "creator_user_id" in job ? job.creator_user_id : undefined,
        creator_username: "creator_username" in job ? job.creator_username : undefined,
        character_id: "character_id" in job ? job.character_id : undefined
      }, signal);
    } catch (error) {
      if (isFetchCancellationError(error)) {
        throw error;
      }
      throw buildFetchBatchErrorWithContext(error, {
        batchNumber: nextBatchNumber,
        cursor: requestCursor,
        endpointKey,
        jobLabel: job.label,
        offset,
        source
      });
    }
    throwIfFetchCanceled(signal);
    const batchRows = response.payload.rows;
    endpointKey = response.payload.endpoint_key;
    cursor = response.payload.next_cursor;
    offset = response.payload.next_offset;
    const requestDiagnostics = response.payload.request_diagnostics ?? null;
    logger.info("fetch batch response", {
      job: "id" in job ? job.id : job.label,
      source,
      batch: nextBatchNumber,
      rows: batchRows.length,
      done: response.payload.done,
      endpoint_key: endpointKey,
      next_cursor: cursor,
      next_offset: offset,
      requested_at: requestDiagnostics?.requested_at ?? null,
      responded_at: requestDiagnostics?.responded_at ?? null,
      request_status: requestDiagnostics?.status ?? null,
      request_attempts: requestDiagnostics?.attempts ?? null,
      request_network_errors: requestDiagnostics?.network_errors ?? null,
      request_cursor_in: requestDiagnostics?.cursor_in ?? null,
      request_cursor_out: requestDiagnostics?.cursor_out ?? null,
      request_rate_limited: requestDiagnostics?.rate_limited ?? null
    });
    if ("id" in job) {
      setFetchJobActiveStatus(job.id, getFetchReceivedBatchLabel(nextBatchNumber, batchRows.length, source, endpointKey));
    }
    const batchResult = batchRows.length > 0
      ? await onBatch(batchRows)
      : { active_item_title: "", cache_rows: [], draftResolutionRecords: [], stored_row_ids: [] };
    throwIfFetchCanceled(signal);
    getNewStoredRowIds(batchResult.stored_row_ids, seenSessionRowIds);
    const newJobRowIds = getNewStoredRowIds(batchResult.stored_row_ids, seenJobRowIds);
    streamedRowCount += newJobRowIds.length;
    processedBatches += 1;

    if ("id" in job && selectionSignature && onCheckpoint) {
      const checkpoint: FetchJobCheckpoint = {
        job_id: job.id,
        selection_signature: selectionSignature,
        source,
        status: "running",
        fetched_rows: streamedRowCount,
        processed_batches: processedBatches,
        cursor,
        previous_cursor: requestCursor,
        offset,
        endpoint_key: endpointKey,
        updated_at: new Date().toISOString()
      };
      await onCheckpoint({
        batch_rows: batchResult.cache_rows,
        checkpoint
      });
    }

    const pageCompleteLabel = getFetchBatchCompleteLabel(nextBatchNumber, newJobRowIds.length, streamedRowCount);
    updateFetchBatchProgress(
      job,
      streamedRowCount,
      newJobRowIds.length,
      processedBatches,
      pageCompleteLabel,
      endpointKey,
      batchRows
    );
    done = response.payload.done;
    logger.info("fetch batch persisted", { job: "id" in job ? job.id : job.label, source, batch: nextBatchNumber, new_rows: newJobRowIds.length, total_rows: streamedRowCount, processed_batches: processedBatches, stop_reason: response.payload.done ? "server_done" : "" });
  }
}
function filterRowsByFetchWindow(rows: VideoRow[], sinceMs?: number | null, untilMs?: number | null): VideoRow[] {
  if (sinceMs == null && untilMs == null) {
    return rows;
  }
  return rows.filter((row) => {
    const timestampMs = parseRowTimestampMs(row);
    if (timestampMs == null) {
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
function parseRowTimestampMs(row: VideoRow): number | null {
  const parsed = Date.parse(row.published_at || row.created_at || row.fetched_at || "");
  return Number.isFinite(parsed) ? parsed : null;
}
function isExpectedCharacterLookupError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error).toLowerCase();
  return message.includes("status 404") || message.includes("failed to fetch");
}
function isNonFatalItemLookupError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error).toLowerCase();
  return message.includes("requested sora item could not be found") || message.includes("status 404");
}
async function sendFetchBatchRequestWithRetry(
  request: FetchBatchRequest,
  signal: AbortSignal
): Promise<FetchBatchResponse> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= FETCH_BATCH_TRANSPORT_RETRY_DELAYS_MS.length; attempt += 1) {
    throwIfFetchCanceled(signal);
    try {
      return await sendBackgroundRequestCancelable<FetchBatchResponse>(request, signal);
    } catch (error) {
      lastError = error;
      if (isFetchCancellationError(error)) {
        throw error;
      }
      if (attempt >= FETCH_BATCH_TRANSPORT_RETRY_DELAYS_MS.length || !isTransientBackgroundBridgeError(error)) {
        throw error;
      }
      await sleepWithJitter(FETCH_BATCH_TRANSPORT_RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(getUnknownErrorMessage(lastError));
}
function isTransientBackgroundBridgeError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error).toLowerCase();
  return message.includes("message channel closed before a response was received") ||
    message.includes("message channel is closed") ||
    message.includes("back/forward cache") ||
    message.includes("bfcache") ||
    message.includes("message port closed before a response was received") ||
    message.includes("receiving end does not exist") ||
    message.includes("background worker did not return a response");
}
async function sleepWithJitter(durationMs: number, signal: AbortSignal): Promise<void> {
  const jitterMs = Math.floor(Math.random() * 120);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, durationMs + jitterMs);
    if (!signal.aborted) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    }
  });
}

async function sendBackgroundRequestCancelable<T extends BackgroundResponse>(
  request: BackgroundRequest,
  signal: AbortSignal
): Promise<T> {
  throwIfFetchCanceled(signal);
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finalize = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finalize(() => reject(new FetchCancellationError()));
    signal.addEventListener("abort", onAbort, { once: true });
    void sendBackgroundRequest<T>(request)
      .then((response) => finalize(() => resolve(response)))
      .catch((error) => finalize(() => reject(error)));
  });
}
/**
 * Requests an immediate stop for the currently running fetch. In-flight
 * background messages are abandoned client-side so the UI can settle quickly.
 */
export function cancelActiveFetch(): void {
  if (!activeFetchAbortController || activeFetchAbortController.signal.aborted) {
    return;
  }
  activeFetchAbortController.abort();
  useAppStore.getState().setFetchProgress({
    active_label: "Stopping fetch..."
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
function setFetchJobActiveStatus(jobId: string, statusLabel: string): void {
  const currentStatus = useAppStore.getState().fetch_progress.job_progress.find((entry) => entry.job_id === jobId)?.active_item_title ?? "";
  if (currentStatus !== statusLabel) {
    logger.info("fetch status", { job_id: jobId, status: statusLabel });
  }
  useAppStore.setState((state) => ({
    fetch_progress: buildNextFetchProgressState(
      state.fetch_progress,
      state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === jobId
          ? { ...entry, status: "running" as const, active_item_title: statusLabel }
          : entry
      )
    )
  }));
}
function getPageBudgetForSource(source: LowLevelSourceType): number {
  if (
    source === "creatorPublished" ||
    source === "creatorCameos" ||
    source === "sideCharacter" ||
    source === "characterAccountAppearances" ||
    source === "characterAccountDrafts"
  ) {
    return HIGH_VOLUME_SOURCE_PAGE_BUDGET;
  }
  return FETCH_PAGE_BUDGET;
}

export function getResultFlushPageSizeForSource(source: LowLevelSourceType): number {
  if (!ENABLE_FETCH_RESULT_BATCHING) {
    return 1;
  }

  if (source === "sideCharacter" || source === "characterAccountAppearances") {
    return Math.max(1, SIDE_CHARACTER_RESULT_FLUSH_PAGE_SIZE);
  }

  return 1;
}

function markFetchJobRunning(job: FetchJob): void {
  useAppStore.setState((state) => ({
    fetch_progress: buildNextFetchProgressState(
      state.fetch_progress,
      state.fetch_progress.job_progress.map((entry) =>
        entry.job_id === job.id
          ? {
              ...entry,
              status: "running" as const,
              active_item_title: entry.active_item_title || getFetchQueuedLabel(),
              fetched_rows: entry.fetched_rows,
              processed_batches: entry.processed_batches,
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
  newStoredRowCount: number,
  processedBatchCount: number,
  activeItemTitle: string,
  _endpointKey: string | null,
  _batchRows: unknown[]
): void {
  useAppStore.setState((state) => {
    if (!("id" in job)) {
      return {
        fetch_progress: {
          ...state.fetch_progress,
          active_label: `Fetched ${streamedRowCount} rows from ${job.label}`,
          processed_batches: state.fetch_progress.processed_batches + 1,
          processed_rows: state.fetch_progress.processed_rows + newStoredRowCount
        }
      };
    }
    const nextJobProgress = state.fetch_progress.job_progress.map((entry) =>
      entry.job_id === job.id
        ? {
            ...entry,
            status: "running" as const,
            active_item_title: activeItemTitle || entry.active_item_title,
            fetched_rows: streamedRowCount,
            processed_batches: processedBatchCount
          }
        : entry
    );
    return {
      fetch_progress: buildNextFetchProgressState(state.fetch_progress, nextJobProgress, {
        processed_batches: state.fetch_progress.processed_batches + 1,
        processed_rows: state.fetch_progress.processed_rows + newStoredRowCount
      })
    };
  });
}
async function cleanupHiddenWorkersAfterFetch(): Promise<void> {
  await cleanupHiddenWorkers();
}
async function cleanupHiddenWorkers(): Promise<void> {
  try {
    await sendBackgroundRequest<BackgroundResponse>({ type: "cleanup-hidden-workers" });
  } catch (error) {
    logger.warn("hidden worker cleanup request failed", error);
  }
}
