import type {
  BackgroundRequest,
  FetchBatchRequest
} from "../../src/types/background";
import { deriveViewerUserId } from "../lib/auth";
import { SORA_ORIGIN } from "../lib/origins";
import {
  extractDraftGenerationId,
  extractSharedVideoId,
  fetchJson,
  fetchJsonWithDiagnostics,
  getNextCursor,
  fetchText,
  getEstimatedTotalCount,
  getPostListingRows,
  getRawRowKey,
  isRetriableSoraStatus,
  getUsernameFromRouteUrl,
  pickFirstString,
  resolveSharedVideoIdFromValue
} from "../lib/shared";
import {
  extractDownloadUrlFromAnyRecord,
  extractEstimatedSizeBytesFromAnyRecord,
  extractPlaybackUrlFromAnyRecord,
  extractThumbnailUrlFromAnyRecord,
  getDraftKind,
  resolveExistingDraftVideoId as resolveExistingDraftVideoIdFromDraftHelpers
} from "./draft-metadata-helpers";
import {
  filterRowsByTimeWindow,
  reachedOlderThanSinceBoundary
} from "./fetch-batch-filters";
const DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS = 500;
const DRAFT_SHARE_POST_MAX_RETRY_DELAY_MS = 20000;
const DRAFT_RESOLUTION_LOG_PREFIX = "[Save Sora][Draft Resolve]";
const SAVEV_API_ORIGIN = "https://crx-api.savev.co";
const SAVEV_SORA_WATERMARK_UUID = "eaa665130fc1a1d2f3acc5c5265a1c00ddd9924fc6d20566___";
const SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
interface FetchEndpointCandidate {
  key: string;
  optional?: boolean;
  url: string;
}
interface EndpointAttemptFailure {
  key: string;
  request: string;
  status: number | null;
}
interface DraftShareReference {
  download_url: string;
  estimated_size_bytes: number | null;
  playback_url: string;
  share_url: string;
  thumbnail_url: string;
  video_id: string;
}
const creatorTargetCache = new Map<string, { userId: string; username: string; identifiers: string[] }>();
const characterIdByUsernameCache = new Map<string, string>();

function logDraftResolutionStep(
  step: string,
  context: Record<string, unknown>
): void {
  try {
    console.log(`${DRAFT_RESOLUTION_LOG_PREFIX} ${step}`, context);
  } catch (_error) {
    // no-op
  }
}
export async function runSourceRequest(request: BackgroundRequest): Promise<unknown> {
  if (request.type === "fetch-detail-html") {
    return { detail_url: request.detail_url, html: await fetchText(request.detail_url) };
  }
  if (request.type === "resolve-viewer-identity") {
    return resolveViewerIdentity();
  }
  if (request.type === "resolve-draft-reference") {
    return resolveDraftReference(request);
  }
  if (request.type === "get-sora-watermark-task") {
    return getSoraWatermarkTask(request);
  }
  if (request.type === "get-sora-watermark-free-video") {
    return getSoraWatermarkFreeVideo(request);
  }
  if (request.type === "resolve-creator-profile") {
    return resolveCreatorProfile(request.route_url);
  }
  if (request.type === "fetch-character-accounts") {
    const viewerUserId = await deriveViewerUserId();
    const url = new URL(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, SORA_ORIGIN);
    url.searchParams.set("limit", String(request.limit ?? 100));
    if (request.cursor) {
      url.searchParams.set("cursor", request.cursor);
    }
    const payload = await fetchJson(url.toString());
    return {
      accounts: getPostListingRows(payload),
      next_cursor: getNextCursor(payload)
    };
  }
  if (request.type === "fetch-batch") {
    return runFetchBatch(request);
  }
  throw new Error(`Unsupported injected request type: ${String((request as { type?: string }).type)}`);
}

async function getSoraWatermarkTask(request: { video_id: string }): Promise<string> {
  const videoId = request.video_id.trim();
  if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("getSoraWatermarkTask requires a valid s_* video_id.");
  }
  const targetUrl = `${SORA_ORIGIN}/p/${encodeURIComponent(videoId)}`;

  const endpointUrl = new URL("/v2/oversea-extension/soraWatermark/soraWatermarkTask", SAVEV_API_ORIGIN);
  endpointUrl.searchParams.set("url", targetUrl);
  endpointUrl.searchParams.set("uuid", SAVEV_SORA_WATERMARK_UUID);

  const response = await fetch(endpointUrl.toString(), {
    headers: {
      accept: "*/*"
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`getSoraWatermarkTask failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const taskId = typeof payload.data === "string" ? payload.data.trim() : "";
  if (!taskId) {
    throw new Error("getSoraWatermarkTask response missing data.");
  }

  return taskId;
}

async function getSoraWatermarkFreeVideo(request: { task_id: string }): Promise<string | null> {
  const taskId = request.task_id.trim();
  if (!taskId) {
    throw new Error("getSoraWatermarkFreeVideo requires a non-empty task_id.");
  }

  const endpointUrl = new URL("/v2/oversea-extension/soraWatermark/queryTask", SAVEV_API_ORIGIN);
  endpointUrl.searchParams.set("taskId", taskId);

  const response = await fetch(endpointUrl.toString(), {
    headers: {
      accept: "*/*"
    },
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`getSoraWatermarkFreeVideo failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  if (typeof payload.data !== "string") {
    return null;
  }
  const normalizedUrl = payload.data.trim();
  return normalizedUrl.length > 0 ? normalizedUrl : null;
}

async function runFetchBatch(request: FetchBatchRequest) {
  if (request.source === "creatorPublished") {
    return runCreatorPublishedBatch(request);
  }
  if (request.source === "characterAccountAppearances" || request.source === "sideCharacter") {
    return runCharacterAccountAppearancesBatch(request);
  }

  let cursor = request.cursor ?? null;
  let offset: number | null = request.offset ?? (request.source === "drafts" || request.source === "likes" ? 0 : null);
  let estimatedTotalCount = 0;
  let endpointKey: string | null = request.endpoint_key ?? null;
  const rows: unknown[] = [];
  const rowKeys: string[] = [];
  for (let pageIndex = 0; pageIndex < (request.page_budget ?? 1); pageIndex += 1) {
    const batchPayload = await fetchBatchPayload(request, cursor, offset, endpointKey);
    const payload = batchPayload.payload;
    const pageRows = annotateLikesRowsWithSourceOrder(
      request.source,
      batchPayload.endpointKey,
      getPostListingRows(payload),
      offset
    );
    const inRangeRows = filterRowsByTimeWindow(pageRows, request.since_ms, request.until_ms);
    const enrichedRows = isDraftSource(request.source)
      ? enrichDraftRows(inRangeRows, request.draft_resolution_entries ?? [], request.source)
      : inRangeRows;
    rows.push(...enrichedRows);
    rowKeys.push(...enrichedRows.map((row) => getRawRowKey(row)).filter(Boolean));
    endpointKey = batchPayload.endpointKey;
    estimatedTotalCount = Math.max(estimatedTotalCount, getEstimatedTotalCount(payload, rows.length));
    const nextCursor = getNextCursor(payload);
    const requestLimit = getFetchLimitForSource(request.source, request.limit);
    const hasMoreRows = pageRows.length >= requestLimit;
    const usesOffsetPagination = shouldUseOffsetPagination(request.source, batchPayload.endpointKey);
    const nextOffset: number | null = usesOffsetPagination
      ? (offset ?? 0) + Math.max(1, pageRows.length)
      : null;
    const isDone =
      shouldFinishFetchPage(request.source, pageRows.length, nextCursor, hasMoreRows) ||
      reachedOlderThanSinceBoundary(pageRows, request.since_ms);
    cursor = nextCursor;
    offset = nextOffset;
    if (isDone) {
      return {
        rows,
        row_keys: rowKeys,
        estimated_total_count: estimatedTotalCount,
        endpoint_key: endpointKey,
        next_cursor: cursor,
        next_offset: offset,
        done: true
      };
    }
  }
  return {
    rows,
    row_keys: rowKeys,
    estimated_total_count: estimatedTotalCount,
    endpoint_key: endpointKey,
    next_cursor: cursor,
    next_offset: offset,
    done: false
  };
}

async function runCharacterAccountAppearancesBatch(request: FetchBatchRequest) {
  const resolvedCharacterId = await resolveCharacterAccountId(
    request.character_id ?? "",
    request.route_url ?? "",
    request.creator_username ?? ""
  );
  if (!resolvedCharacterId.startsWith("ch_")) {
    throw new Error("Character appearances fetch requires a resolvable ch_* id.");
  }
  const limit = String(getFetchLimitForSource(request.source, request.limit));
  const requestedCursor = request.cursor ?? null;
  const fetchResult = await fetchJsonWithDiagnostics(
    buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(resolvedCharacterId)}`, {
      limit,
      cut: "appearances",
      cursor: requestedCursor
    }).toString(),
    request.source === "sideCharacter"
      ? { adaptive429: true }
      : {}
  );
  const payload = fetchResult.payload;
  const pageRows = getPostListingRows(payload);
  const nextCursor = getNextCursor(payload);
  const endpointKey = request.source === "sideCharacter"
    ? "side-character-feed-appearances"
    : "character-feed-appearances";
  return {
    rows: pageRows,
    row_keys: pageRows.map((row) => getRawRowKey(row)).filter(Boolean),
    estimated_total_count: getEstimatedTotalCount(payload, pageRows.length),
    endpoint_key: endpointKey,
    next_cursor: nextCursor,
    next_offset: null,
    request_diagnostics: request.source === "sideCharacter"
      ? {
          ...fetchResult.diagnostics,
          cursor_in: requestedCursor,
          cursor_out: nextCursor
        }
      : undefined,
    done: !nextCursor || reachedOlderThanSinceBoundary(pageRows, request.since_ms)
  };
}

async function runCreatorPublishedBatch(request: FetchBatchRequest) {
  const resolvedCreatorId = await resolveCreatorPublishedUserId(
    request.creator_user_id ?? "",
    request.route_url ?? "",
    request.creator_username ?? ""
  );
  if (!resolvedCreatorId) {
    throw new Error("Creator published fetch requires a resolvable user id.");
  }
  const limit = String(getFetchLimitForSource(request.source, request.limit));
  const payload = await fetchJson(
    buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(resolvedCreatorId)}`, {
      limit,
      cut: "nf2",
      cursor: request.cursor ?? null
    }).toString()
  );
  const pageRows = getPostListingRows(payload);
  const nextCursor = getNextCursor(payload);
  return {
    rows: pageRows,
    row_keys: pageRows.map((row) => getRawRowKey(row)).filter(Boolean),
    estimated_total_count: getEstimatedTotalCount(payload, pageRows.length),
    endpoint_key: "creator-feed-nf2",
    next_cursor: nextCursor,
    next_offset: null,
    done: !nextCursor || reachedOlderThanSinceBoundary(pageRows, request.since_ms)
  };
}

function annotateLikesRowsWithSourceOrder(
  source: FetchBatchRequest["source"],
  endpointKey: string | null,
  rows: unknown[],
  offset: number | null
): unknown[] {
  if (source !== "likes" || endpointKey !== "likes") {
    return rows;
  }

  const baseOffset = Math.max(0, offset ?? 0);
  return rows.map((row, index) => {
    if (!row || typeof row !== "object") {
      return row;
    }
    const record = row as Record<string, unknown>;
    return {
      ...record,
      __save_sora_like_rank: baseOffset + index
    };
  });
}
async function fetchBatchPayload(
  request: FetchBatchRequest,
  cursor: string | null,
  offset: number | null,
  endpointKey: string | null
): Promise<{ endpointKey: string | null; payload: unknown }> {
  const limit = String(getFetchLimitForSource(request.source, request.limit));
  const endpointCandidates = await buildFetchEndpointCandidates(request, cursor, offset, limit);
  const matchedCandidate = endpointKey ? endpointCandidates.find((candidate) => candidate.key === endpointKey) ?? null : null;
  if (matchedCandidate) {
    try {
      return {
        endpointKey: matchedCandidate.key,
        payload: await fetchCandidatePayload(matchedCandidate)
      };
    } catch (_error) {
      // If a pinned endpoint fails, re-run endpoint selection so we can try all candidates and report attempts.
      return selectBestBatchPayload(endpointCandidates, request);
    }
  }
  return selectBestBatchPayload(endpointCandidates, request);
}
async function fetchCandidatePayload(candidate: FetchEndpointCandidate): Promise<unknown> {
  if (!candidate.optional) {
    return fetchJson(candidate.url);
  }
  try {
    return await fetchJson(candidate.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/status (400|404)\b/.test(message)) {
      return { items: [], next_cursor: null };
    }
    throw error;
  }
}
async function selectBestBatchPayload(
  candidates: FetchEndpointCandidate[],
  request: FetchBatchRequest
): Promise<{ endpointKey: string | null; payload: unknown }> {
  const attemptFailures: EndpointAttemptFailure[] = [];
  if (shouldUseStrictSequentialEndpointSelection(request.source)) {
    for (const candidate of candidates) {
      try {
        return {
          endpointKey: candidate.key,
          payload: await fetchCandidatePayload(candidate)
        };
      } catch (error) {
        attemptFailures.push({
          key: candidate.key,
          request: describeRequestFromCandidateUrl(candidate.url),
          status: extractStatusFromErrorMessage(error instanceof Error ? error.message : String(error))
        });
      }
    }
    throw new Error(buildFetchBatchAttemptFailureMessage(request, attemptFailures));
  }
  let firstSuccessfulResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestScore = -1;
  let bestPaginatedResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestPaginatedScore = -1;
  let bestEstimatedResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestEstimatedTotalCount = -1;
  let bestEstimatedRowCount = -1;
  let bestEstimatedHasCursor = -1;
  let bestEstimatedPriority = -1;
  for (const candidate of candidates) {
    let payload: unknown;
    try {
      payload = await fetchCandidatePayload(candidate);
    } catch (error) {
      attemptFailures.push({
        key: candidate.key,
        request: describeRequestFromCandidateUrl(candidate.url),
        status: extractStatusFromErrorMessage(error instanceof Error ? error.message : String(error))
      });
      continue;
    }
    const rows = getPostListingRows(payload);
    const nextCursor = getNextCursor(payload);
    const score = rows.length;
    const result = { endpointKey: candidate.key, payload };
    if (!firstSuccessfulResult) {
      firstSuccessfulResult = result;
    }
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
    if (nextCursor && score > 0 && score > bestPaginatedScore) {
      bestPaginatedScore = score;
      bestPaginatedResult = result;
    }
    if (score > 0) {
      const estimatedTotalCount = getEstimatedTotalCount(payload, score);
      const hasCursor = nextCursor ? 1 : 0;
      const priority = getEndpointCandidatePriority(request.source, candidate.key);
      const shouldReplaceEstimated =
        estimatedTotalCount > bestEstimatedTotalCount ||
        (
          estimatedTotalCount === bestEstimatedTotalCount &&
          (
            score > bestEstimatedRowCount ||
            (
              score === bestEstimatedRowCount &&
              (
                hasCursor > bestEstimatedHasCursor ||
                (
                  hasCursor === bestEstimatedHasCursor &&
                  priority > bestEstimatedPriority
                )
              )
            )
          )
        );
      if (shouldReplaceEstimated) {
        bestEstimatedTotalCount = estimatedTotalCount;
        bestEstimatedRowCount = score;
        bestEstimatedHasCursor = hasCursor;
        bestEstimatedPriority = priority;
        bestEstimatedResult = result;
      }
    }
  }
  const resolvedResult = bestEstimatedResult ?? bestPaginatedResult ?? bestResult ?? firstSuccessfulResult;
  if (resolvedResult) {
    return resolvedResult;
  }
  throw new Error(buildFetchBatchAttemptFailureMessage(request, attemptFailures));
}

function shouldUseStrictSequentialEndpointSelection(source: FetchBatchRequest["source"]): boolean {
  return (
    source === "creatorPublished" ||
    source === "characterAccountAppearances" ||
    source === "sideCharacter"
  );
}

function getEndpointCandidatePriority(source: FetchBatchRequest["source"], endpointKey: string): number {
  const normalizedKey = endpointKey.toLowerCase();
  if (source === "creatorPublished") {
    if (normalizedKey.includes("profile")) {
      return 5;
    }
    if (normalizedKey.includes("published")) {
      return 4;
    }
    if (normalizedKey.includes("public")) {
      return 3;
    }
    if (normalizedKey.includes("feed-nf2")) {
      return 2;
    }
    if (normalizedKey.includes("posts")) {
      return 1;
    }
  }
  return 0;
}
async function resolveCreatorProfile(routeUrl: string) {
  const username = getUsernameFromRouteUrl(routeUrl);
  if (!username) {
    return null;
  }
  const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
  const profileRecord = getLookupProfileRecord(payload);
  const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
  const resolvedUsername = resolveLookupUsername(payload, username);
  const resolvedCharacterUserId = resolveLookupCharacterId(payload) || await resolveCharacterIdFromAppearancesProbe(resolvedUsername || username);
  const resolvedPermalink =
    pickFirstString([
      profileRecord.permalink,
      profileRecord.url,
      payload.permalink,
      payload.url
    ]) || `${SORA_ORIGIN}/profile/${encodeURIComponent(resolvedUsername || username)}`;

  return {
    ...payload,
    ...profileRecord,
    owner_profile: ownerProfileRecord ?? profileRecord.owner_profile ?? payload.owner_profile ?? null,
    username: resolvedUsername,
    user_id: resolveLookupUserId(payload) || pickFirstString([profileRecord.user_id, profileRecord.userId, payload.user_id, payload.userId]),
    owner_user_id: pickFirstString([
      profileRecord.owner_user_id,
      profileRecord.ownerUserId,
      payload.owner_user_id,
      payload.ownerUserId,
      ownerProfileRecord?.user_id,
      ownerProfileRecord?.userId
    ]),
    character_user_id: resolvedCharacterUserId,
    permalink: resolvedPermalink
  };
}
async function resolveViewerIdentity() {
  const viewerUserId = await deriveViewerUserId();
  let username = "";
  let displayName = "";
  let canCameo = true;
  let profilePictureUrl = "";
  let planType: string | null = null;
  let permalink = "";
  let createdAt = "";
  let characterCount: number | null = null;
  try {
    const payload = (await fetchJson("/backend/project_y/v2/me")) as Record<string, unknown>;
    const profileRecord = payload.profile && typeof payload.profile === "object"
      ? payload.profile as Record<string, unknown>
      : null;
    username = pickFirstString([
      profileRecord?.username,
      profileRecord?.user_name,
      profileRecord?.userName,
      payload.username,
      payload.user_name,
      payload.userName
    ]);
    displayName = pickFirstString([
      profileRecord?.display_name,
      profileRecord?.displayName,
      profileRecord?.name,
      payload.display_name,
      payload.displayName,
      payload.name,
      username
    ]);
    profilePictureUrl = pickFirstString([
      profileRecord?.profile_picture_url,
      profileRecord?.profilePictureUrl,
      profileRecord?.avatar_url,
      profileRecord?.avatarUrl,
      payload.profile_picture_url,
      payload.profilePictureUrl,
      payload.avatar_url,
      payload.avatarUrl,
      profilePictureUrl
    ]);
    planType = pickFirstString([
      profileRecord?.plan_type,
      profileRecord?.planType,
      payload.plan_type,
      payload.planType,
      planType
    ]) || null;
    permalink = pickFirstString([
      profileRecord?.permalink,
      profileRecord?.url,
      payload.permalink,
      payload.url,
      permalink
    ]);
    createdAt = pickFirstTimestamp([
      profileRecord?.created_at,
      profileRecord?.createdAt,
      payload.created_at,
      payload.createdAt,
      createdAt
    ]);
    characterCount = pickFirstNumber([
      profileRecord?.character_count,
      profileRecord?.characterCount,
      payload.character_count,
      payload.characterCount,
      characterCount
    ]);
    const canCameoValue = profileRecord?.can_cameo ?? profileRecord?.canCameo ?? payload.can_cameo ?? payload.canCameo;
    if (typeof canCameoValue === "boolean") {
      canCameo = canCameoValue;
    }
  } catch (_error) {
    // keep fallback values
  }
  try {
    if (!username || !displayName) {
      const payload = (await fetchJson(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}`)) as Record<string, unknown>;
      username = pickFirstString([payload.username, payload.user_name, payload.userName, username]);
      displayName = pickFirstString([payload.display_name, payload.displayName, payload.name, displayName, username]);
      profilePictureUrl = pickFirstString([
        payload.profile_picture_url,
        payload.profilePictureUrl,
        payload.avatar_url,
        payload.avatarUrl,
        profilePictureUrl
      ]);
      planType = pickFirstString([payload.plan_type, payload.planType, planType]) || null;
      permalink = pickFirstString([payload.permalink, payload.url, permalink]);
      createdAt = pickFirstTimestamp([payload.created_at, payload.createdAt, createdAt]);
      characterCount = pickFirstNumber([payload.character_count, payload.characterCount, characterCount]);
      const canCameoValue = payload.can_cameo ?? payload.canCameo;
      if (typeof canCameoValue === "boolean") {
        canCameo = canCameoValue;
      }
    }
  } catch (_error) {
    // fall through to feed probing
  }
  if (!username) {
    try {
      const feedPayload = await fetchJson(buildUrl("/backend/project_y/profile_feed/me", { limit: "1", cut: "nf2" }).toString());
      const firstRow = getPostListingRows(feedPayload)[0];
      if (firstRow && typeof firstRow === "object") {
        const rowRecord = firstRow as Record<string, unknown>;
        const profileRecord = rowRecord.profile && typeof rowRecord.profile === "object"
          ? rowRecord.profile as Record<string, unknown>
          : null;
        if (profileRecord) {
          username = pickFirstString([profileRecord.username, profileRecord.user_name, profileRecord.userName]);
          displayName = pickFirstString([profileRecord.display_name, profileRecord.displayName, profileRecord.name, username]);
          profilePictureUrl = pickFirstString([
            profileRecord.profile_picture_url,
            profileRecord.profilePictureUrl,
            profileRecord.avatar_url,
            profileRecord.avatarUrl,
            profilePictureUrl
          ]);
          planType = pickFirstString([profileRecord.plan_type, profileRecord.planType, planType]) || null;
          permalink = pickFirstString([profileRecord.permalink, profileRecord.url, permalink]);
          createdAt = pickFirstTimestamp([profileRecord.created_at, profileRecord.createdAt, createdAt]);
          characterCount = pickFirstNumber([
            profileRecord.character_count,
            profileRecord.characterCount,
            characterCount
          ]);
          const canCameoValue = profileRecord.can_cameo ?? profileRecord.canCameo;
          if (typeof canCameoValue === "boolean") {
            canCameo = canCameoValue;
          }
        }
      }
    } catch (_error) {
      // keep empty fallback values
    }
  }
  if (!displayName) {
    displayName = username;
  }
  if (!permalink && username) {
    permalink = `${SORA_ORIGIN}/profile/${encodeURIComponent(username)}`;
  }
  return {
    user_id: viewerUserId,
    username,
    display_name: displayName,
    can_cameo: canCameo,
    profile_picture_url: profilePictureUrl || null,
    plan_type: planType,
    permalink,
    created_at: createdAt,
    character_count: characterCount
  };
}

function pickFirstNumber(values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsedValue = Number(value.trim());
      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }
  }
  return null;
}

function pickFirstTimestamp(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}
async function resolveCreatorTarget(
  explicitCreatorId: string,
  routeUrl: string,
  creatorUsername: string
): Promise<{ userId: string; username: string; identifiers: string[] }> {
  const routeUsername = getUsernameFromRouteUrl(routeUrl);
  const normalizedExplicitId = explicitCreatorId.trim();
  const normalizedUsername = creatorUsername.trim() || routeUsername;
  const cacheKey = [
    normalizedExplicitId.toLowerCase(),
    normalizedUsername.toLowerCase(),
    routeUsername.toLowerCase()
  ].join("|");
  const cachedTarget = creatorTargetCache.get(cacheKey);
  if (cachedTarget) {
    return cachedTarget;
  }
  let resolvedUserId = normalizedExplicitId;
  let resolvedUsername = normalizedUsername;

  if (normalizedUsername) {
    try {
      const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(normalizedUsername)}`)) as Record<string, unknown>;
      resolvedUserId = pickFirstString([resolveLookupUserId(payload), resolveLookupCharacterId(payload), resolvedUserId]);
      resolvedUsername = resolveLookupUsername(payload, resolvedUsername || routeUsername);
    } catch (_error) {
      // Keep fallbacks from explicit id / route parsing.
    }
  }

  const identifiers = [...new Set([
    resolvedUserId,
    normalizedExplicitId,
    resolvedUsername,
    normalizedUsername,
    routeUsername
  ].map((value) => value.trim()).filter(Boolean))];

  if (identifiers.length === 0) {
    throw new Error("Creator fetch requires a user id or creator route.");
  }

  const target = {
    userId: resolvedUserId,
    username: resolvedUsername,
    identifiers
  };
  creatorTargetCache.set(cacheKey, target);
  return target;
}
async function resolveCharacterAccountId(
  explicitCharacterId: string,
  routeUrl: string,
  creatorUsername: string
): Promise<string> {
  const trimmedCharacterId = explicitCharacterId.trim();
  if (trimmedCharacterId.startsWith("ch_")) {
    return trimmedCharacterId;
  }
  const username = creatorUsername || getUsernameFromRouteUrl(routeUrl);
  if (!username) {
    return "";
  }
  const normalizedUsername = username.trim().toLowerCase();
  const cachedCharacterId = characterIdByUsernameCache.get(normalizedUsername);
  if (cachedCharacterId) {
    return cachedCharacterId;
  }
  try {
    const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    const resolvedCharacterId = resolveLookupCharacterId(payload);
    if (resolvedCharacterId) {
      characterIdByUsernameCache.set(normalizedUsername, resolvedCharacterId);
      return resolvedCharacterId;
    }
  } catch (_error) {
    // fall through to appearances probe
  }
  const probedCharacterId = await resolveCharacterIdFromAppearancesProbe(username);
  if (probedCharacterId) {
    characterIdByUsernameCache.set(normalizedUsername, probedCharacterId);
    return probedCharacterId;
  }
  return "";
}

async function resolveCreatorPublishedUserId(
  explicitCreatorId: string,
  routeUrl: string,
  creatorUsername: string
): Promise<string> {
  const trimmedCreatorId = explicitCreatorId.trim();
  if (isUserAccountId(trimmedCreatorId)) {
    return trimmedCreatorId;
  }
  const username = creatorUsername || getUsernameFromRouteUrl(routeUrl);
  if (!username) {
    return "";
  }
  try {
    const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    const resolvedUserId = resolveLookupUserId(payload);
    return isUserAccountId(resolvedUserId) ? resolvedUserId : "";
  } catch (_error) {
    return "";
  }
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getLookupProfileRecord(payload: Record<string, unknown>): Record<string, unknown> {
  return asObjectRecord(payload.profile) ?? payload;
}

function getLookupOwnerProfileRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  return asObjectRecord(value.owner_profile) ?? asObjectRecord(value.ownerProfile);
}

function resolveLookupUsername(payload: Record<string, unknown>, fallbackUsername = ""): string {
  const profileRecord = getLookupProfileRecord(payload);
  const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
  return pickFirstString([
    profileRecord.username,
    profileRecord.user_name,
    profileRecord.userName,
    profileRecord.handle,
    payload.username,
    payload.user_name,
    payload.userName,
    payload.handle,
    ownerProfileRecord?.username,
    ownerProfileRecord?.user_name,
    ownerProfileRecord?.userName,
    ownerProfileRecord?.handle,
    fallbackUsername
  ]);
}

function resolveLookupUserId(payload: Record<string, unknown>): string {
  const profileRecord = getLookupProfileRecord(payload);
  const ownerProfileRecord = getLookupOwnerProfileRecord(profileRecord) ?? getLookupOwnerProfileRecord(payload);
  const candidates = [
    profileRecord.user_id,
    profileRecord.userId,
    payload.user_id,
    payload.userId,
    profileRecord.owner_user_id,
    profileRecord.ownerUserId,
    payload.owner_user_id,
    payload.ownerUserId,
    ownerProfileRecord?.user_id,
    ownerProfileRecord?.userId
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return candidates.find((value) => isUserAccountId(value)) ?? "";
}

function resolveLookupCharacterId(payload: Record<string, unknown>): string {
  const profileRecord = getLookupProfileRecord(payload);
  const characterRecord = asObjectRecord(profileRecord.character) ?? asObjectRecord(payload.character);
  const candidates = [
    profileRecord.character_user_id,
    profileRecord.characterUserId,
    payload.character_user_id,
    payload.characterUserId,
    profileRecord.profile_id,
    profileRecord.profileId,
    profileRecord.id,
    payload.profile_id,
    payload.profileId,
    payload.id,
    profileRecord.user_id,
    profileRecord.userId,
    payload.user_id,
    payload.userId,
    characterRecord?.character_user_id,
    characterRecord?.characterUserId,
    characterRecord?.profile_id,
    characterRecord?.profileId,
    characterRecord?.id,
    characterRecord?.user_id,
    characterRecord?.userId
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);

  return candidates.find((value) => value.startsWith("ch_")) ?? "";
}

async function resolveCharacterIdFromAppearancesProbe(username: string): Promise<string> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!normalizedUsername) {
    return "";
  }

  const cachedCharacterId = characterIdByUsernameCache.get(normalizedUsername);
  if (cachedCharacterId) {
    return cachedCharacterId;
  }

  try {
    const payload = await fetchJson(
      buildUrl(`/backend/project_y/profile_feed/username/${encodeURIComponent(username)}`, {
        limit: "1",
        cut: "appearances"
      }).toString()
    );
    const rows = getPostListingRows(payload);
    const resolvedCharacterId = resolveCharacterIdFromAppearanceRows(rows, normalizedUsername);
    if (resolvedCharacterId) {
      characterIdByUsernameCache.set(normalizedUsername, resolvedCharacterId);
      return resolvedCharacterId;
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function resolveCharacterIdFromAppearanceRows(rows: unknown[], normalizedUsername: string): string {
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const record = row as Record<string, unknown>;
    const directCharacterId = pickFirstString([
      record.character_id,
      record.characterId,
      record.character_user_id,
      record.characterUserId,
      record.character_account_id,
      record.characterAccountId
    ]);
    if (directCharacterId.startsWith("ch_")) {
      return directCharacterId;
    }

    const postRecord = record.post && typeof record.post === "object" ? record.post as Record<string, unknown> : null;
    const cameoProfileEntries = [
      ...(Array.isArray(record.cameo_profiles) ? record.cameo_profiles : []),
      ...(Array.isArray(record.cameoProfiles) ? record.cameoProfiles : []),
      ...(Array.isArray(postRecord?.cameo_profiles) ? postRecord?.cameo_profiles as unknown[] : []),
      ...(Array.isArray(postRecord?.cameoProfiles) ? postRecord?.cameoProfiles as unknown[] : [])
    ];

    let fallbackCharacterId = "";
    for (const cameoProfileEntry of cameoProfileEntries) {
      if (!cameoProfileEntry || typeof cameoProfileEntry !== "object") {
        continue;
      }
      const cameoProfile = cameoProfileEntry as Record<string, unknown>;
      const cameoCharacterId = pickFirstString([cameoProfile.user_id, cameoProfile.userId]);
      if (!cameoCharacterId.startsWith("ch_")) {
        continue;
      }
      const cameoUsername = pickFirstString([
        cameoProfile.username,
        cameoProfile.user_name,
        cameoProfile.userName,
        cameoProfile.handle
      ]).toLowerCase();
      if (cameoUsername && cameoUsername === normalizedUsername) {
        return cameoCharacterId;
      }
      if (!fallbackCharacterId) {
        fallbackCharacterId = cameoCharacterId;
      }
    }
    if (fallbackCharacterId) {
      return fallbackCharacterId;
    }
  }

  return "";
}

function isUserAccountId(value: string): boolean {
  return value.startsWith("user_") || value.startsWith("user-");
}
function enrichDraftRows(
  rows: unknown[],
  knownResolutionEntries: Array<{ generation_id: string; video_id: string }>,
  source: FetchBatchRequest["source"]
): unknown[] {
  const knownResolutionMap = new Map(knownResolutionEntries.map((entry) => [entry.generation_id, entry.video_id]));
  for (const [rowIndex, row] of rows.entries()) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const generationId = extractDraftGenerationId(record);
    if (!generationId) {
      continue;
    }
    const draftKind = getDraftKind(record);
    logDraftResolutionStep("Start gen_* -> s_* resolution", {
      source,
      row_index: rowIndex,
      generation_id: generationId,
      kind: draftKind,
      has_post: Boolean(record.post)
    });
    const draftRecord = record.draft && typeof record.draft === "object" ? record.draft as Record<string, unknown> : record;
    const postVideoId = resolveSharedVideoIdFromValue(record.post ?? null);
    if (postVideoId) {
      logDraftResolutionStep("Resolved from row.post", {
        source,
        generation_id: generationId,
        video_id: postVideoId
      });
      const metadata = extractResolvedDraftMetadataFromValue(record.post, postVideoId);
      applyResolvedDraftReference(record, draftRecord, {
        video_id: postVideoId,
        share_url: `${SORA_ORIGIN}/p/${postVideoId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      });
      continue;
    }
    const cachedVideoId = knownResolutionMap.get(generationId);
    if (cachedVideoId) {
      logDraftResolutionStep("Resolved from in-memory draft cache", {
        source,
        generation_id: generationId,
        video_id: cachedVideoId
      });
      const metadata = extractResolvedDraftMetadataFromValue(record, cachedVideoId);
      applyResolvedDraftReference(record, draftRecord, {
        video_id: cachedVideoId,
        share_url: `${SORA_ORIGIN}/p/${cachedVideoId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      });
      continue;
    }
    const directVideoId = resolveExistingDraftVideoId(record);
    if (directVideoId) {
      logDraftResolutionStep("Resolved from existing row payload", {
        source,
        generation_id: generationId,
        video_id: directVideoId
      });
      const metadata = extractResolvedDraftMetadataFromValue(record, directVideoId);
      applyResolvedDraftReference(record, draftRecord, {
        video_id: directVideoId,
        share_url: `${SORA_ORIGIN}/p/${directVideoId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      });
      continue;
    }
    const canCreateSharedReference =
      !record.post &&
      isShareableDraftKind(getDraftKind(record)) &&
      (
        source === "drafts" ||
        source === "characterDrafts" ||
        source === "characterAccountDrafts"
      );
    if (!canCreateSharedReference) {
      const skipReasons: string[] = [];
      if (record.post) {
        skipReasons.push("post_present_without_resolved_video_id");
      }
      if (!isShareableDraftKind(draftKind)) {
        skipReasons.push(`unsupported_kind:${draftKind || "unknown"}`);
      }
      if (!(source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts")) {
        skipReasons.push(`unsupported_source:${source}`);
      }
      logDraftResolutionStep("Skipped share creation path", {
        source,
        generation_id: generationId,
        reasons: skipReasons
      });
    }
    if (canCreateSharedReference) {
      logDraftResolutionStep("Deferring share creation to app recovery stage", {
        source,
        generation_id: generationId
      });
    }
  }
  return rows;
}

function applyResolvedDraftReference(
  rowRecord: Record<string, unknown>,
  draftRecord: Record<string, unknown>,
  reference: DraftShareReference
): void {
  rowRecord.resolved_video_id = reference.video_id;
  rowRecord.resolvedVideoId = reference.video_id;
  rowRecord.resolved_share_url = reference.share_url;
  rowRecord.resolvedShareUrl = reference.share_url;
  draftRecord.resolved_video_id = reference.video_id;
  draftRecord.resolvedVideoId = reference.video_id;
  draftRecord.resolved_share_url = reference.share_url;
  draftRecord.resolvedShareUrl = reference.share_url;

  if (reference.playback_url) {
    ensureResolvedDownloadUrls(rowRecord, reference);
    ensureResolvedDownloadUrls(draftRecord, reference);
    rowRecord.resolved_playback_url = reference.playback_url;
    rowRecord.resolvedPlaybackUrl = reference.playback_url;
    draftRecord.resolved_playback_url = reference.playback_url;
    draftRecord.resolvedPlaybackUrl = reference.playback_url;
    if (!pickFirstString([draftRecord.downloadable_url, draftRecord.downloadableUrl])) {
      draftRecord.downloadable_url = reference.playback_url;
      draftRecord.downloadableUrl = reference.playback_url;
    }
  }
  if (reference.download_url) {
    rowRecord.resolved_download_url = reference.download_url;
    rowRecord.resolvedDownloadUrl = reference.download_url;
    draftRecord.resolved_download_url = reference.download_url;
    draftRecord.resolvedDownloadUrl = reference.download_url;
  }
  if (typeof reference.estimated_size_bytes === "number" && Number.isFinite(reference.estimated_size_bytes)) {
    rowRecord.resolved_estimated_size_bytes = reference.estimated_size_bytes;
    rowRecord.resolvedEstimatedSizeBytes = reference.estimated_size_bytes;
    draftRecord.resolved_estimated_size_bytes = reference.estimated_size_bytes;
    draftRecord.resolvedEstimatedSizeBytes = reference.estimated_size_bytes;
  }
  if (reference.thumbnail_url) {
    rowRecord.resolved_thumbnail_url = reference.thumbnail_url;
    rowRecord.resolvedThumbnailUrl = reference.thumbnail_url;
    draftRecord.resolved_thumbnail_url = reference.thumbnail_url;
    draftRecord.resolvedThumbnailUrl = reference.thumbnail_url;
  }
}

function ensureResolvedDownloadUrls(target: Record<string, unknown>, reference: DraftShareReference): void {
  const currentDownloadUrls = target.download_urls && typeof target.download_urls === "object"
    ? target.download_urls as Record<string, unknown>
    : {};
  target.download_urls = {
    ...currentDownloadUrls,
    watermark: reference.playback_url,
    no_watermark: reference.download_url || currentDownloadUrls.no_watermark || null
  };

  const currentDownloadUrlsCamel = target.downloadUrls && typeof target.downloadUrls === "object"
    ? target.downloadUrls as Record<string, unknown>
    : {};
  target.downloadUrls = {
    ...currentDownloadUrlsCamel,
    watermark: reference.playback_url,
    no_watermark: reference.download_url || currentDownloadUrlsCamel.no_watermark || null
  };
}

function isShareableDraftKind(kind: string): boolean {
  const normalizedKind = kind.trim().toLowerCase();
  return normalizedKind === "sora_draft" || normalizedKind === "draft";
}

async function resolveDraftReference(request: { generation_id: string; detail_url?: string; row_payload?: unknown }) {
  logDraftResolutionStep("resolve-draft-reference request received", {
    generation_id: request.generation_id
  });
  const rowPayload = request.row_payload && typeof request.row_payload === "object"
    ? request.row_payload as Record<string, unknown>
    : {};
  const workingRow: Record<string, unknown> = {
    ...rowPayload,
    generation_id: rowPayload.generation_id ?? rowPayload.generationId ?? request.generation_id,
    detail_url: rowPayload.detail_url ?? rowPayload.detailUrl ?? request.detail_url
  };
  if (shouldSkipDraftRow(workingRow)) {
    const skipReason = classifyDraftSkipReason(workingRow);
    logDraftResolutionStep("resolve-draft-reference skipped", {
      generation_id: request.generation_id,
      skip_reason: skipReason,
      kind: getDraftKind(workingRow)
    });
    return {
      generation_id: request.generation_id,
      video_id: "",
      share_url: "",
      playback_url: "",
      download_url: "",
      thumbnail_url: "",
      estimated_size_bytes: null,
      skip_reason: skipReason
    };
  }
  const createdReference = await createSharedDraftReference(workingRow, request.generation_id).catch(() => null);
  logDraftResolutionStep("resolve-draft-reference completed", {
    generation_id: request.generation_id,
    resolved_video_id: createdReference?.video_id ?? "",
    skip_reason: createdReference?.video_id ? "" : "unresolved_draft_video_id"
  });
  return {
    generation_id: request.generation_id,
    video_id: createdReference?.video_id ?? "",
    share_url: createdReference?.share_url ?? "",
    playback_url: createdReference?.playback_url ?? "",
    download_url: createdReference?.download_url ?? "",
    thumbnail_url: createdReference?.thumbnail_url ?? "",
    estimated_size_bytes: createdReference?.estimated_size_bytes ?? null,
    skip_reason: createdReference?.video_id ? "" : "unresolved_draft_video_id"
  };
}
async function buildFetchEndpointCandidates(
  request: FetchBatchRequest,
  cursor: string | null,
  offset: number | null,
  limit: string
): Promise<FetchEndpointCandidate[]> {
  if (request.source === "profile") {
    return [{ key: "profile-feed", url: buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "nf2", cursor }).toString() }];
  }
  if (request.source === "drafts") {
    return [{ key: "drafts-v2", url: buildUrl("/backend/project_y/profile/drafts/v2", { limit, cursor, offset }).toString() }];
  }
  if (request.source === "likes") {
    const viewerUserId = await deriveViewerUserId();
    const includeOffset = !cursor;
    return [{
      key: "likes",
      url: buildUrl(
        `/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/likes`,
        includeOffset ? { limit, cursor, offset } : { limit, cursor }
      ).toString()
    }];
  }
  if (request.source === "characters") {
    return [{ key: "viewer-appearances", url: buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "appearances", cursor }).toString() }];
  }
  if (request.source === "characterDrafts") {
    return [{ key: "viewer-character-drafts", url: buildUrl("/backend/project_y/profile/drafts/cameos", { limit, cursor }).toString() }];
  }
  if (request.source === "characterProfiles") {
    const viewerUserId = await deriveViewerUserId();
    return [{
      key: "character-profiles",
      url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, { limit, cursor }).toString()
    }];
  }
  if (request.source === "characterAccountAppearances" || request.source === "sideCharacter") {
    const resolvedCharacterId = await resolveCharacterAccountId(
      request.character_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    const encodedCharacterId = encodeURIComponent(resolvedCharacterId);
    const endpointKey = request.source === "sideCharacter"
      ? "side-character-feed-appearances"
      : "character-feed-appearances";
    return [{
      key: endpointKey,
      url: buildUrl(`/backend/project_y/profile_feed/${encodedCharacterId}`, { limit, cut: "appearances", cursor }).toString()
    }];
  }
  if (request.source === "characterAccountDrafts") {
    const resolvedCharacterId = await resolveCharacterAccountId(
      request.character_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    const encodedCharacterId = encodeURIComponent(resolvedCharacterId);
    return [
      {
        key: "character-account-drafts",
        optional: true,
        url: buildUrl(`/backend/project_y/profile/drafts/cameos/character/${encodedCharacterId}`, {
          limit,
          cursor
        }).toString()
      },
      {
        key: "character-post-listing-drafts",
        optional: true,
        url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/drafts`, { limit, cursor }).toString()
      }
    ];
  }
  if (request.source === "creatorPublished") {
    const creatorTarget = await resolveCreatorTarget(
      request.creator_user_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    const endpointCandidates: FetchEndpointCandidate[] = [];
    creatorTarget.identifiers.forEach((identifier, index) => {
      const suffix = index === 0 ? "" : `-alt${index}`;
      const encodedIdentifier = encodeURIComponent(identifier);
      endpointCandidates.push(
        {
          key: `creator-post-listing-published${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/published`, { limit, cursor }).toString()
        },
        {
          key: `creator-post-listing-profile${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/profile`, { limit, cursor }).toString()
        },
        {
          key: `creator-post-listing-public${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/public`, { limit, cursor }).toString()
        },
        {
          key: `creator-post-listing-posts${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/posts`, { limit, cursor }).toString()
        },
        {
          key: `creator-feed-nf2${suffix}`,
          url: buildUrl(`/backend/project_y/profile_feed/${encodedIdentifier}`, { limit, cut: "nf2", cursor }).toString()
        }
      );
    });
    if (creatorTarget.username) {
      const encodedUsername = encodeURIComponent(creatorTarget.username);
      endpointCandidates.push(
        {
          key: "creator-post-listing-posts-username",
          url: buildUrl(`/backend/project_y/profile/username/${encodedUsername}/post_listing/posts`, { limit, cursor }).toString()
        },
        {
          key: "creator-post-listing-profile-username",
          url: buildUrl(`/backend/project_y/profile/username/${encodedUsername}/post_listing/profile`, { limit, cursor }).toString()
        }
      );
    }
    return endpointCandidates;
  }
  if (request.source === "creatorCameos") {
    const creatorTarget = await resolveCreatorTarget(
      request.creator_user_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    const orderedIdentifiers = [
      creatorTarget.userId,
      request.creator_user_id ?? "",
      ...creatorTarget.identifiers
    ]
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index);
    const candidates: FetchEndpointCandidate[] = orderedIdentifiers.map((identifier, index) => ({
      key: index === 0 ? "creator-appearances" : `creator-appearances-alt${index}`,
      url: buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(identifier)}`, { limit, cut: "appearances", cursor }).toString()
    }));
    if (creatorTarget.username) {
      candidates.push({
        key: "creator-appearances-username",
        url: buildUrl(`/backend/project_y/profile_feed/username/${encodeURIComponent(creatorTarget.username)}`, {
          limit,
          cut: "appearances",
          cursor
        }).toString()
      });
    }
    return candidates.filter((candidate, index, list) => list.findIndex((entry) => entry.url === candidate.url) === index);
  }
  throw new Error(`Unsupported fetch source: ${request.source}`);
}
async function createSharedDraftReference(row: Record<string, unknown>, generationId: string) {
  logDraftResolutionStep("createSharedDraftReference start", { generation_id: generationId });
  const existingVideoId = resolveExistingDraftVideoId(row);
  if (existingVideoId) {
    logDraftResolutionStep("Using existing s_* id from payload", {
      generation_id: generationId,
      video_id: existingVideoId
    });
    const metadata = extractResolvedDraftMetadataFromValue(row, existingVideoId);
    return {
      video_id: existingVideoId,
      share_url: `${SORA_ORIGIN}/p/${existingVideoId}`,
      playback_url: metadata.playback_url,
      download_url: metadata.download_url,
      estimated_size_bytes: metadata.estimated_size_bytes,
      thumbnail_url: metadata.thumbnail_url
    };
  }

  if (shouldSkipDraftRow(row)) {
    logDraftResolutionStep("Skipping draft due to blocked kind", {
      generation_id: generationId,
      skip_reason: classifyDraftSkipReason(row),
      kind: getDraftKind(row)
    });
    return null;
  }

  const detailUrl = resolveDraftDetailUrl(row, generationId);
  if (detailUrl) {
    logDraftResolutionStep("Attempting detail JSON resolution", {
      generation_id: generationId,
      detail_url: detailUrl
    });
    const detailPayload = await fetchJson(detailUrl).catch(() => null);
    if (detailPayload) {
      const recoveredFromPayload = resolveSharedVideoIdFromValue(detailPayload);
      if (recoveredFromPayload) {
        logDraftResolutionStep("Resolved from detail JSON payload", {
          generation_id: generationId,
          video_id: recoveredFromPayload
        });
        const metadata = extractResolvedDraftMetadataFromValue(detailPayload, recoveredFromPayload);
        return {
          video_id: recoveredFromPayload,
          share_url: `${SORA_ORIGIN}/p/${recoveredFromPayload}`,
          playback_url: metadata.playback_url,
          download_url: metadata.download_url,
          estimated_size_bytes: metadata.estimated_size_bytes,
          thumbnail_url: metadata.thumbnail_url
        };
      }
      logDraftResolutionStep("Detail JSON did not include s_* id", {
        generation_id: generationId
      });
    }

    logDraftResolutionStep("Attempting detail HTML resolution", {
      generation_id: generationId,
      detail_url: detailUrl
    });
    const detailHtml = await fetchText(detailUrl).catch(() => "");
    const recoveredId = extractSharedVideoId(detailHtml);
    if (recoveredId) {
      logDraftResolutionStep("Resolved from detail HTML", {
        generation_id: generationId,
        video_id: recoveredId
      });
      const metadata = extractResolvedDraftMetadataFromValue(row, recoveredId);
      return {
        video_id: recoveredId,
        share_url: `${SORA_ORIGIN}/p/${recoveredId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
    logDraftResolutionStep("Detail HTML did not include s_* id", {
      generation_id: generationId
    });
  }

  try {
    logDraftResolutionStep("Attempting share-link POST /backend/project_y/post", {
      generation_id: generationId
    });
    const response = (await fetchJsonWithMethod("/backend/project_y/post", "POST", {
      attachments_to_create: [{ generation_id: generationId, kind: "sora" }],
      post_text: resolveDraftShareText(row),
      destinations: [{ type: "shared_link_unlisted" }]
    })) as Record<string, unknown>;
    const videoId = resolveSharedVideoIdFromValue(response);
    if (videoId) {
      logDraftResolutionStep("Resolved from share-link POST response", {
        generation_id: generationId,
        video_id: videoId
      });
      const metadata = extractResolvedDraftMetadataFromValue(response, videoId);
      return {
        video_id: videoId,
        share_url: `${SORA_ORIGIN}/p/${videoId}`,
        playback_url: metadata.playback_url,
        download_url: metadata.download_url,
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
    logDraftResolutionStep("Share-link POST response missing s_* id", {
      generation_id: generationId
    });
  } catch (_error) {
    logDraftResolutionStep("Share-link POST failed", {
      generation_id: generationId
    });
    // Fail closed: the fetch controller will keep retrying unresolved drafts.
  }

  logDraftResolutionStep("Resolution failed; leaving draft unresolved", {
    generation_id: generationId
  });
  return null;
}
async function fetchJsonWithMethod(url: string, method: "POST", jsonBody: unknown): Promise<unknown> {
  const auth = await import("../lib/auth").then((module) => module.deriveAuthContext());
  const requestUrl = new URL(url, SORA_ORIGIN).toString();
  const generationId = resolveShareRequestGenerationId(jsonBody);
  const headers = {
    accept: "application/json, text/plain, */*",
    authorization: `Bearer ${auth.token}`,
    "content-type": "application/json",
    "oai-language": auth.language,
    ...(auth.deviceId ? { "oai-device-id": auth.deviceId } : {})
  };
  let attempt = 0;
  for (;;) {
    logDraftResolutionStep("Share POST attempt", {
      generation_id: generationId,
      request_url: requestUrl,
      attempt: attempt + 1
    });
    const response = await fetch(requestUrl, {
      method,
      credentials: "include",
      headers,
      body: JSON.stringify(jsonBody)
    });
    if (response.ok) {
      logDraftResolutionStep("Share POST success", {
        generation_id: generationId,
        status: response.status,
        attempt: attempt + 1
      });
      return response.json();
    }
    if (!isRetriableSoraStatus(response.status)) {
      logDraftResolutionStep("Share POST non-retriable failure", {
        generation_id: generationId,
        status: response.status,
        attempt: attempt + 1
      });
      throw new Error(`Draft share creation failed with status ${response.status}. Request: POST /backend/project_y/post.`);
    }
    const retryDelayMs = resolveDraftShareRetryDelayMs(attempt);
    logDraftResolutionStep("Share POST retriable failure", {
      generation_id: generationId,
      status: response.status,
      attempt: attempt + 1,
      retry_delay_ms: retryDelayMs
    });
    await sleepWithJitter(retryDelayMs);
    attempt += 1;
  }
}

function resolveShareRequestGenerationId(jsonBody: unknown): string {
  if (!jsonBody || typeof jsonBody !== "object") {
    return "";
  }
  const record = jsonBody as Record<string, unknown>;
  const attachments = Array.isArray(record.attachments_to_create)
    ? record.attachments_to_create
    : [];
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object") {
      continue;
    }
    const generationId = pickFirstString([
      (attachment as Record<string, unknown>).generation_id,
      (attachment as Record<string, unknown>).generationId
    ]);
    if (generationId) {
      return generationId;
    }
  }
  return "";
}
function resolveDraftShareText(row: Record<string, unknown>): string {
  const draftRecord = row.draft && typeof row.draft === "object" ? row.draft as Record<string, unknown> : null;
  return pickFirstString([
    row.discovery_phrase,
    row.discoveryPhrase,
    row.prompt,
    row.caption,
    row.description,
    draftRecord?.discovery_phrase,
    draftRecord?.discoveryPhrase,
    draftRecord?.prompt,
    draftRecord?.caption,
    draftRecord?.description
  ]);
}
export function resolveExistingDraftVideoId(row: Record<string, unknown>): string {
  return resolveExistingDraftVideoIdFromDraftHelpers(row);
}
export function extractEstimatedSizeBytesFromResolvedRow(value: unknown, videoId: string): number | null {
  return extractResolvedDraftMetadataFromValue(value, videoId).estimated_size_bytes;
}
function extractResolvedDraftMetadataFromValue(
  value: unknown,
  videoId: string
): { estimated_size_bytes: number | null; thumbnail_url: string; playback_url: string; download_url: string } {
  if (!value || typeof value !== "object") {
    return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "", download_url: "" };
  }
  const resolveFromRecord = (
    record: Record<string, unknown>
  ): { estimated_size_bytes: number | null; thumbnail_url: string; playback_url: string; download_url: string } => ({
    estimated_size_bytes: extractEstimatedSizeBytesFromAnyRecord(record),
    thumbnail_url: extractThumbnailUrlFromAnyRecord(record),
    playback_url: extractPlaybackUrlFromAnyRecord(record),
    download_url: extractDownloadUrlFromAnyRecord(record)
  });
  const directRecord = value as Record<string, unknown>;
  const directSize = extractEstimatedSizeBytesFromAnyRecord(directRecord);
  const directThumbnail = extractThumbnailUrlFromAnyRecord(directRecord);
  const directPlayback = extractPlaybackUrlFromAnyRecord(directRecord);
  const directDownload = extractDownloadUrlFromAnyRecord(directRecord);
  if ((directSize != null || directThumbnail || directPlayback || directDownload) && resolveSharedVideoIdFromValue(value) === videoId) {
    return {
      estimated_size_bytes: directSize,
      thumbnail_url: directThumbnail,
      playback_url: directPlayback,
      download_url: directDownload
    };
  }
  const rows = getPostListingRows(value);
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    if (resolveSharedVideoIdFromValue(row) !== videoId) {
      continue;
    }
    return resolveFromRecord(row as Record<string, unknown>);
  }
  return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "", download_url: "" };
}
export function shouldSkipDraftRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || typeof row !== "object") {
    return true;
  }
  const kind = getDraftKind(row).trim().toLowerCase();
  return kind === "sora_error" || kind === "sora_content_violation";
}
function classifyDraftSkipReason(row: Record<string, unknown>): string {
  const kind = getDraftKind(row).trim().toLowerCase();
  if (kind === "sora_error") {
    return "draft_error";
  }
  if (kind === "sora_content_violation") {
    return "draft_content_violation";
  }
  return "unresolved_draft_video_id";
}
function resolveDraftDetailUrl(row: Record<string, unknown>, generationId: string): string {
  const directUrl = typeof row.detail_url === "string"
    ? row.detail_url
    : typeof row.detailUrl === "string"
      ? row.detailUrl
      : typeof row.url === "string"
        ? row.url
        : "";
  if (directUrl) {
    return directUrl;
  }
  return `${SORA_ORIGIN}/d/${generationId}`;
}
function buildUrl(pathname: string, params: Record<string, string | number | null | undefined>): URL {
  const url = new URL(pathname, SORA_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url;
}
function sleepWithJitter(durationMs: number): Promise<void> {
  const jitterMs = Math.floor(Math.random() * 150);
  return new Promise((resolve) => setTimeout(resolve, durationMs + jitterMs));
}
function resolveDraftShareRetryDelayMs(attempt: number): number {
  const exponential = Math.min(
    DRAFT_SHARE_POST_MAX_RETRY_DELAY_MS,
    DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS * Math.pow(2, Math.min(8, attempt))
  );
  return Math.max(DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS, exponential);
}
function isDraftSource(source: FetchBatchRequest["source"]): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}
export function shouldFinishFetchPage(_source: FetchBatchRequest["source"], _pageRowCount: number, nextCursor: string | null, hasMoreRows: boolean): boolean {
  if (_source === "drafts" || _source === "likes") {
    return !nextCursor && !hasMoreRows;
  }
  return !nextCursor;
}
export function getFetchLimitForSource(
  _source: FetchBatchRequest["source"],
  requestedLimit = 100
): number {
  return requestedLimit;
}

function shouldUseOffsetPagination(source: FetchBatchRequest["source"], endpointKey: string | null): boolean {
  if (source === "drafts") {
    return true;
  }

  return source === "likes" && endpointKey === "likes";
}
function buildFetchBatchAttemptFailureMessage(
  request: FetchBatchRequest,
  failures: EndpointAttemptFailure[]
): string {
  if (failures.length === 0) {
    return `Sora fetch-batch failed for source=${request.source} with no successful endpoint candidates.`;
  }
  const summary = failures
    .map((failure) => {
      const statusLabel = typeof failure.status === "number" ? `status ${failure.status}` : "unknown status";
      return `${failure.key} (${statusLabel}) ${failure.request}`;
    })
    .join(" | ");
  return `Sora fetch-batch failed for source=${request.source}. Attempts: ${summary}`;
}
function describeRequestFromCandidateUrl(candidateUrl: string): string {
  try {
    const url = new URL(candidateUrl);
    const filteredParams = new URLSearchParams();
    const includeParam = (key: string) => {
      const value = url.searchParams.get(key);
      if (!value) {
        return;
      }
      filteredParams.set(key, value.length > 48 ? `${value.slice(0, 48)}...` : value);
    };
    includeParam("cut");
    includeParam("limit");
    includeParam("cursor");
    includeParam("offset");
    const query = filteredParams.toString();
    return `GET ${url.pathname}${query ? `?${query}` : ""}`;
  } catch (_error) {
    return `GET ${candidateUrl}`;
  }
}
function extractStatusFromErrorMessage(message: string): number | null {
  const match = message.match(/status\s+(\d{3})/i);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}
