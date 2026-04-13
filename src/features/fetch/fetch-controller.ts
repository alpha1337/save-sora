import type {
  BackgroundResponse,
  FetchBatchResponse,
  FetchDetailHtmlResponse,
  ResolveDraftReferenceResponse
} from "types/background";
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
import { getCharacterNames } from "@lib/normalize/shared";
import { normalizeCreatorProfileInput } from "@lib/utils/creator-profile-input";
import { stripRawPayloadFromRows } from "@lib/utils/video-row-utils";
import { extractVideoIdFromDetailHtml, normalizeCharacterAccounts, normalizeCreatorProfile, normalizeDraftRows, normalizePostRows } from "@lib/normalize/video-row-normalizer";
import {
  buildFetchResumeStateFromCheckpoints,
  buildNextFetchProgressState,
  finalizeFetchJobCheckpoint,
  getNewStoredRowIds,
  shouldStopForNoGrowthPages,
  shouldStopForStalledCursor
} from "./fetch-runtime-utils";
import {
  buildInitialFetchProgress,
  getFetchBatchLimit,
  getPageSignature,
  isDraftSource,
  isFetchCancellationError,
  runWithConcurrency,
  shouldRefreshCreatorProfile,
  throwIfFetchCanceled
} from "./fetch-controller-helpers";
import type { FetchResumeState } from "./fetch-runtime-utils";
import type { FetchJob } from "./source-adapters";
import { buildFetchJobs } from "./source-adapters";
export { buildFetchResumeStateFromCheckpoints, finalizeFetchJobCheckpoint, getNewStoredRowIds, shouldStopForNoGrowthPages, shouldStopForStalledCursor } from "./fetch-runtime-utils";
export { buildInitialFetchProgress } from "./fetch-controller-helpers";
const logger = createLogger("fetch-controller");
const SORA_PROFILE_ORIGIN = "https://sora.chatgpt.com";
const FETCH_BATCH_LIMIT = 100;
const APPEARANCE_FEED_BATCH_LIMIT = 100;
const FETCH_PAGE_BUDGET = 3;
const HIGH_VOLUME_SOURCE_PAGE_BUDGET = 1;
const FETCH_CONCURRENCY = 3;
const DETAIL_FALLBACK_CONCURRENCY = 2;
const DRAFT_RECOVERY_MAX_ROUNDS = 4;
const DRAFT_RECOVERY_MAX_ATTEMPTS_PER_ROW = 5;
const DRAFT_RECOVERY_ROUND_BASE_DELAY_MS = 750;
const DRAFT_RECOVERY_REQUEST_DELAY_MS = 140;
let activeFetchAbortController: AbortController | null = null;
const characterLabelLookupPromises = new Map<string, Promise<string>>();
interface BatchProcessResult {
  active_item_title: string;
  draftResolutionRecords: DraftResolutionRecord[];
  persistencePromise: Promise<void>;
  stored_row_ids: string[];
}
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
    await recoverUnresolvedDraftRows(abortController.signal);
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
    await cleanupHiddenWorkersAfterFetch();
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
  const runtimeJob = await resolveFetchJobLabel(job);
  logger.info("running fetch job", runtimeJob.id);
  markFetchJobRunning(runtimeJob, checkpoint);
  throwIfFetchCanceled(signal);
  const fetchedAt = new Date().toISOString();
  const recoveryTasks: Array<Promise<void>> = [];
  const finalCheckpoint = await streamFetchBatches(runtimeJob.source, runtimeJob, signal, checkpoint, selectionSignature, async (rows) => {
    const rowsWithContext = applyFetchJobRowContext(rows, runtimeJob);
    const normalizedRows = isDraftSource(runtimeJob.source)
      ? normalizeDraftRows(runtimeJob.source, rowsWithContext, fetchedAt)
      : normalizePostRows(runtimeJob.source, rowsWithContext, fetchedAt);
    const inRangeRows = filterRowsByFetchWindow(normalizedRows, runtimeJob.fetch_since_ms, runtimeJob.fetch_until_ms);
    const draftResolutionRecords = buildDraftResolutionRecords(rowsWithContext);
    if (inRangeRows.length > 0) {
      useAppStore.getState().upsertVideoRows(stripRawPayloadFromRows(inRangeRows));
    }
    const recoverableRows = getRecoverableRows(inRangeRows);
    if (recoverableRows.length > 0) {
      if (isDraftSource(runtimeJob.source)) {
        setFetchJobActiveStatus(runtimeJob.id, "Fetch successful!");
      }
      recoveryTasks.push(
        recoverMissingVideoIds(
          recoverableRows,
          signal,
          new Map(),
          (statusLabel) => setFetchJobActiveStatus(runtimeJob.id, statusLabel)
        ).then(async (recoveredRows) => {
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
    if (inRangeRows.length > 0) {
      persistenceTasks.push(upsertVideoRows(inRangeRows));
    }
    return {
      active_item_title: pickActiveItemTitle(inRangeRows, runtimeJob.source),
      draftResolutionRecords,
      persistencePromise: persistenceTasks.length > 0 ? Promise.all(persistenceTasks).then(() => undefined) : Promise.resolve(),
      stored_row_ids: inRangeRows.map((row) => row.row_id)
    };
  });
  await Promise.all(recoveryTasks);
  throwIfFetchCanceled(signal);
  await saveFetchJobCheckpoint(
    finalizeFetchJobCheckpoint(runtimeJob, selectionSignature, finalCheckpoint ?? checkpoint, {
      fetched_rows: useAppStore.getState().fetch_progress.job_progress.find((entry) => entry.job_id === runtimeJob.id)?.fetched_rows ?? 0,
      processed_batches: useAppStore.getState().fetch_progress.job_progress.find((entry) => entry.job_id === runtimeJob.id)?.processed_batches ?? 0,
      status: "completed"
    })
  );
  incrementCompletedJobs(runtimeJob);
}
async function resolveFetchJobLabel(job: FetchJob): Promise<FetchJob> {
  const currentLabel = resolveCharacterLabelFromJobText(job);
  if (!currentLabel || !currentLabel.startsWith("ch_")) {
    return job;
  }
  const resolvedDisplayName = await resolveCharacterDisplayNameById(currentLabel);
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
async function resolveCharacterDisplayNameById(characterId: string): Promise<string> {
  const normalizedCharacterId = characterId.trim();
  if (!normalizedCharacterId || !normalizedCharacterId.startsWith("ch_")) {
    return "";
  }
  if (!characterLabelLookupPromises.has(normalizedCharacterId)) {
    characterLabelLookupPromises.set(normalizedCharacterId, lookupCharacterDisplayName(normalizedCharacterId));
  }
  return characterLabelLookupPromises.get(normalizedCharacterId) ?? Promise.resolve("");
}
async function lookupCharacterDisplayName(characterId: string): Promise<string> {
  const routeUrl = `${SORA_PROFILE_ORIGIN}/profile/${encodeURIComponent(characterId)}`;
  try {
    const response = await sendBackgroundRequest<BackgroundResponse>({
      type: "resolve-creator-profile",
      route_url: routeUrl
    });
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
    const probe = await sendBackgroundRequest<FetchBatchResponse>({
      type: "fetch-batch",
      source: "characterAccountAppearances",
      character_id: characterId,
      limit: 1,
      page_budget: 1
    });
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
function applyFetchJobRowContext(rows: unknown[], job: FetchJob): unknown[] {
  if (!job.character_id || (job.source !== "characterAccountDrafts" && job.source !== "characterAccountAppearances")) {
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
function getCharacterLabelFromJob(displayName: string, jobLabel: string): string {
  const direct = displayName.trim();
  if (direct) {
    return direct;
  }
  const fromLabel = jobLabel.replace(/\s+(drafts|appearances)$/i, "").trim();
  return fromLabel.startsWith("ch_") ? "" : fromLabel;
}
async function collectAllRows(source: LowLevelSourceType, job: FetchJob | { label: string }, signal: AbortSignal): Promise<unknown[]> {
  const collectedRows: unknown[] = [];
  await streamFetchBatches(source, job, signal, null, "", async (rows) => {
    collectedRows.push(...rows);
    return {
      active_item_title: "",
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
  const seenJobRowIds = new Set<string>();
  let consecutiveNoGrowthPages = 0;
  let previousPageSignature = "";
  let consecutiveRepeatedPageSignatures = 0;
  let latestCheckpoint = checkpoint;
  while (!done) {
    throwIfFetchCanceled(signal);
    const requestCursor = cursor;
    const response: FetchBatchResponse = await sendBackgroundRequest({
      type: "fetch-batch",
      source,
      since_ms: "fetch_since_ms" in job ? (job.fetch_since_ms ?? null) : null,
      until_ms: "fetch_until_ms" in job ? (job.fetch_until_ms ?? null) : null,
      cursor,
      offset,
      limit: getFetchBatchLimit(source, FETCH_BATCH_LIMIT, APPEARANCE_FEED_BATCH_LIMIT),
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
      : { active_item_title: "", draftResolutionRecords: [], persistencePromise: Promise.resolve(), stored_row_ids: [] };
    throwIfFetchCanceled(signal);
    const newStoredRowIds = getNewStoredRowIds(batchResult.stored_row_ids, seenSessionRowIds);
    const newJobRowIds = getNewStoredRowIds(batchResult.stored_row_ids, seenJobRowIds);
    streamedRowCount += newJobRowIds.length;
    processedBatches += batchRows.length > 0 ? 1 : 0;
    consecutiveNoGrowthPages = newJobRowIds.length === 0 ? consecutiveNoGrowthPages + 1 : 0;
    const currentPageSignature = getPageSignature(response.payload.endpoint_key, response.payload.row_keys);
    if (newStoredRowIds.length === 0 && currentPageSignature) {
      consecutiveRepeatedPageSignatures = currentPageSignature === previousPageSignature
        ? consecutiveRepeatedPageSignatures + 1
        : 1;
    } else {
      consecutiveRepeatedPageSignatures = 0;
    }
    previousPageSignature = currentPageSignature;
    updateFetchBatchProgress(
      job,
      streamedRowCount,
      newJobRowIds.length,
      processedBatches,
      batchResult.active_item_title,
      endpointKey,
      batchRows
    );
    for (const record of batchResult.draftResolutionRecords) {
      draftResolutionMap.set(record.generation_id, record.video_id);
    }
    await batchResult.persistencePromise;
    done =
      response.payload.done ||
      shouldStopForStalledCursor(consecutiveRepeatedPageSignatures, source) ||
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
async function recoverMissingVideoIds(
  rows: VideoRow[],
  signal: AbortSignal,
  attemptByRowId: Map<string, number> = new Map(),
  onStatusLabel?: (statusLabel: string) => void
): Promise<VideoRow[]> {
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
      const attempts = (attemptByRowId.get(row.row_id) ?? 0) + 1;
      attemptByRowId.set(row.row_id, attempts);
      await sleepWithJitter(DRAFT_RECOVERY_REQUEST_DELAY_MS, signal);
      try {
        if (row.source_bucket === "drafts" && row.video_id && !row.playback_url) {
          onStatusLabel?.("Processing draft...");
          recoveredRows.push({
            ...row,
            playback_url: buildDraftPlaybackUrl(row.video_id),
            is_downloadable: true,
            skip_reason: row.skip_reason === "unresolved_draft_video_id" ? "" : row.skip_reason
          });
          onStatusLabel?.("Processing complete!");
          onStatusLabel?.("Complete!");
          continue;
        }
        const generationId = extractGenerationIdFromRow(row);
        const shouldRecoverDraftReference =
          Boolean(generationId) &&
          (row.skip_reason === "unresolved_draft_video_id" || shouldHydrateDraftThumbnail(row));
        if (shouldRecoverDraftReference && generationId) {
          onStatusLabel?.("Processing draft...");
          onStatusLabel?.("Generating a shared URL...");
          const draftReferenceResponse = await sendBackgroundRequest<ResolveDraftReferenceResponse>({
            type: "resolve-draft-reference",
            generation_id: generationId,
            detail_url: row.detail_url || undefined,
            row_payload: safeParseRawPayload(row.raw_payload_json)
          });
          const resolvedVideoId = draftReferenceResponse.payload.video_id || row.video_id;
          const resolvedThumbnailUrl = draftReferenceResponse.payload.thumbnail_url || row.thumbnail_url;
          const resolvedDetailUrl = draftReferenceResponse.payload.share_url || row.detail_url;
          const resolvedEstimatedSize = draftReferenceResponse.payload.estimated_size_bytes ?? row.estimated_size_bytes;
          if (
            resolvedVideoId &&
            (
              resolvedVideoId !== row.video_id ||
              resolvedThumbnailUrl !== row.thumbnail_url ||
              resolvedDetailUrl !== row.detail_url ||
              resolvedEstimatedSize !== row.estimated_size_bytes ||
              row.skip_reason === "unresolved_draft_video_id"
            )
          ) {
            recoveredRows.push({
              ...row,
              video_id: resolvedVideoId,
              thumbnail_url: resolvedThumbnailUrl,
              detail_url: resolvedDetailUrl,
              estimated_size_bytes: resolvedEstimatedSize,
              playback_url: row.playback_url || buildDraftPlaybackUrl(resolvedVideoId),
              is_downloadable: true,
              skip_reason: ""
            });
            onStatusLabel?.("Processing complete!");
            onStatusLabel?.("Complete!");
            continue;
          }
          if (draftReferenceResponse.payload.skip_reason && draftReferenceResponse.payload.skip_reason !== row.skip_reason) {
            recoveredRows.push({
              ...row,
              skip_reason: draftReferenceResponse.payload.skip_reason
            });
            continue;
          }
        }
        if (!row.detail_url) {
          continue;
        }
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
          playback_url: row.playback_url || buildDraftPlaybackUrl(videoId),
          is_downloadable: true,
          skip_reason: ""
        });
        if (row.source_bucket === "drafts") {
          onStatusLabel?.("Processing complete!");
          onStatusLabel?.("Complete!");
        }
      } catch (error) {
        if (!isExpectedDetailFallbackError(error)) {
          logger.warn("detail fallback failed", error);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_FALLBACK_CONCURRENCY, pendingRows.length) }, () => worker()));
  return recoveredRows;
}
async function recoverUnresolvedDraftRows(signal: AbortSignal): Promise<void> {
  const attemptByRowId = new Map<string, number>();
  for (let round = 0; round < DRAFT_RECOVERY_MAX_ROUNDS; round += 1) {
    throwIfFetchCanceled(signal);
    const recoverableRows = getRecoverableRows(useAppStore.getState().video_rows).filter(
      (row) => (attemptByRowId.get(row.row_id) ?? 0) < DRAFT_RECOVERY_MAX_ATTEMPTS_PER_ROW
    );
    if (recoverableRows.length === 0) {
      return;
    }
    const recoveredRows = await recoverMissingVideoIds(recoverableRows, signal, attemptByRowId);
    if (recoveredRows.length > 0) {
      await upsertVideoRows(recoveredRows);
      useAppStore.getState().upsertVideoRows(stripRawPayloadFromRows(recoveredRows));
    }
    const hasPendingRecoverableRows = getRecoverableRows(useAppStore.getState().video_rows).some(
      (row) => (attemptByRowId.get(row.row_id) ?? 0) < DRAFT_RECOVERY_MAX_ATTEMPTS_PER_ROW
    );
    if (!hasPendingRecoverableRows || round >= DRAFT_RECOVERY_MAX_ROUNDS - 1) {
      return;
    }
    const delayMs = DRAFT_RECOVERY_ROUND_BASE_DELAY_MS * (round + 1);
    await sleepWithJitter(delayMs, signal);
  }
}
function getRecoverableRows(rows: VideoRow[]): VideoRow[] {
  return rows.filter((row) => {
    const generationId = extractGenerationIdFromRow(row);
    const hasRecoveryHandle = Boolean(row.detail_url) || Boolean(generationId);
    const needsPlaybackRecovery = row.source_bucket === "drafts" && Boolean(row.video_id) && !row.playback_url;
    if (!hasRecoveryHandle && !needsPlaybackRecovery) {
      return false;
    }
    const needsVideoIdRecovery =
      !row.video_id &&
      (row.skip_reason === "missing_video_id" || row.skip_reason === "unresolved_draft_video_id");
    const needsThumbnailRecovery = shouldHydrateDraftThumbnail(row) && Boolean(generationId);
    return needsVideoIdRecovery || needsThumbnailRecovery || needsPlaybackRecovery;
  });
}
function shouldHydrateDraftThumbnail(row: VideoRow): boolean {
  return row.source_bucket === "drafts" && !row.thumbnail_url;
}
function buildDraftPlaybackUrl(videoId: string): string {
  return /^s_[A-Za-z0-9_-]+$/.test(videoId)
    ? `https://soravdl.com/api/proxy/video/${encodeURIComponent(videoId)}`
    : "";
}
function pickActiveItemTitle(rows: VideoRow[], source: LowLevelSourceType): string {
  for (const row of rows) {
    const candidate = row.title?.trim();
    if (!candidate) {
      continue;
    }
    if (candidate === row.video_id || candidate === row.row_id) {
      continue;
    }
    return isDraftSource(source) ? `Fetching draft ${candidate}...` : `Fetching ${candidate}...`;
  }
  return "";
}
function dedupeRowsById(rows: VideoRow[]): VideoRow[] {
  const rowMap = new Map<string, VideoRow>();
  for (const row of rows) {
    rowMap.set(row.row_id, row);
  }
  return [...rowMap.values()];
}
function safeParseRawPayload(rawPayloadJson: string): unknown {
  if (!rawPayloadJson) {
    return null;
  }
  try {
    return JSON.parse(rawPayloadJson);
  } catch (_error) {
    return null;
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
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("status 404") || message.includes("failed to fetch");
}
function isExpectedDetailFallbackError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("status 403") ||
    message.includes("status 404") ||
    message.includes("message channel closed before a response was received") ||
    message.includes("could not establish connection. receiving end does not exist")
  );
}
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
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
function extractGenerationIdFromRow(row: VideoRow): string {
  const fromDetail = row.detail_url.match(/gen_[A-Za-z0-9_-]+/i)?.[0] ?? "";
  if (fromDetail) {
    return fromDetail;
  }
  const fromRaw = row.raw_payload_json.match(/gen_[A-Za-z0-9_-]+/i)?.[0] ?? "";
  return fromRaw;
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
function setFetchJobActiveStatus(jobId: string, statusLabel: string): void {
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
              active_item_title: entry.active_item_title,
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
  newStoredRowCount: number,
  processedBatchCount: number,
  activeItemTitle: string,
  endpointKey: string | null,
  batchRows: unknown[]
): void {
  const debugSchemaKeys = extractSchemaKeys(batchRows);
  const debugSampleJson = buildDebugSampleJson(batchRows);
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
            processed_batches: processedBatchCount,
            debug_schema_keys: debugSchemaKeys.length > 0 ? debugSchemaKeys : entry.debug_schema_keys,
            debug_sample_json: debugSampleJson || entry.debug_sample_json,
            debug_endpoint_key: endpointKey || entry.debug_endpoint_key
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
function extractSchemaKeys(rows: unknown[]): string[] {
  const firstRecord = rows.find((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  if (!firstRecord) {
    return [];
  }
  return Object.keys(firstRecord).sort();
}
function buildDebugSampleJson(rows: unknown[]): string {
  const firstRow = rows[0];
  if (firstRow === undefined) {
    return "";
  }
  try {
    const rawJson = JSON.stringify(firstRow, null, 2);
    return rawJson.length <= 4000 ? rawJson : `${rawJson.slice(0, 4000)}\n...truncated`;
  } catch {
    return "";
  }
}
async function resolveFetchResumeState(jobs: FetchJob[]): Promise<FetchResumeState> {
  const checkpoints = await loadFetchJobCheckpoints();
  return buildFetchResumeStateFromCheckpoints(jobs, checkpoints);
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
