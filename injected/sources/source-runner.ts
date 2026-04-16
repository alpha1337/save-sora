import type { BackgroundRequest, FetchBatchRequest } from "../../src/types/background";
import { deriveViewerUserId } from "../lib/auth";
import { SORA_ORIGIN } from "../lib/origins";
import {
  extractDraftGenerationId,
  extractSharedVideoId,
  fetchJson,
  getNextCursor,
  getNextCursorForRows,
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
const APPEARANCE_FEED_PAGE_LIMIT = 100;
const DRAFT_SHARE_POST_BASE_RETRY_DELAY_MS = 500;
const DRAFT_SHARE_POST_MAX_RETRY_DELAY_MS = 20000;
const DRAFT_RESOLUTION_LOG_PREFIX = "[Save Sora][Draft Resolve]";
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
  estimated_size_bytes: number | null;
  playback_url: string;
  share_url: string;
  thumbnail_url: string;
  video_id: string;
}

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
async function runFetchBatch(request: FetchBatchRequest) {
  let cursor = request.cursor ?? null;
  let previousCursor: string | null = null;
  let offset: number | null = request.offset ?? 0;
  let estimatedTotalCount = 0;
  let endpointKey: string | null = request.endpoint_key ?? null;
  const rows: unknown[] = [];
  const rowKeys: string[] = [];
  for (let pageIndex = 0; pageIndex < (request.page_budget ?? 1); pageIndex += 1) {
    const batchPayload = await fetchBatchPayload(request, cursor, offset, endpointKey);
    const payload = batchPayload.payload;
    const pageRows = getPostListingRows(payload);
    const inRangeRows = filterRowsByTimeWindow(pageRows, request.since_ms, request.until_ms);
    const enrichedRows = isDraftSource(request.source)
      ? enrichDraftRows(inRangeRows, request.draft_resolution_entries ?? [], request.source)
      : inRangeRows;
    rows.push(...enrichedRows);
    rowKeys.push(...enrichedRows.map((row) => getRawRowKey(row)).filter(Boolean));
    endpointKey = batchPayload.endpointKey;
    estimatedTotalCount = Math.max(estimatedTotalCount, getEstimatedTotalCount(payload, rows.length));
    const nextCursor = getNextCursorForRows(
      payload,
      pageRows,
      cursor ?? "",
      getCursorKindForSource(request.source),
      previousCursor ?? ""
    );
    const requestLimit = getFetchLimitForSource(request.source, request.limit);
    const hasMoreRows = pageRows.length >= requestLimit;
    const nextOffset: number | null = request.source === "drafts"
      ? (nextCursor ? offset : (offset ?? 0) + requestLimit)
      : null;
    const isDone =
      shouldFinishFetchPage(request.source, pageRows.length, nextCursor, hasMoreRows) ||
      reachedOlderThanSinceBoundary(pageRows, request.since_ms);
    previousCursor = cursor;
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
      return selectBestBatchPayload(endpointCandidates, request, cursor);
    }
  }
  return selectBestBatchPayload(endpointCandidates, request, cursor);
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
  request: FetchBatchRequest,
  cursor: string | null
): Promise<{ endpointKey: string | null; payload: unknown }> {
  const attemptFailures: EndpointAttemptFailure[] = [];
  let firstSuccessfulResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestScore = -1;
  let bestPaginatedResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestPaginatedScore = -1;
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
    const nextCursor = getNextCursorForRows(
      payload,
      rows,
      cursor ?? "",
      getCursorKindForSource(request.source)
    );
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
  }
  const resolvedResult = bestPaginatedResult ?? bestResult ?? firstSuccessfulResult;
  if (resolvedResult) {
    return resolvedResult;
  }
  throw new Error(buildFetchBatchAttemptFailureMessage(request, attemptFailures));
}
async function resolveCreatorProfile(routeUrl: string) {
  const username = getUsernameFromRouteUrl(routeUrl);
  if (!username) {
    return null;
  }
  const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
  return {
    ...payload,
    username: typeof payload.username === "string" && payload.username ? payload.username : username,
    permalink:
      typeof payload.permalink === "string" && payload.permalink
        ? payload.permalink
        : typeof payload.url === "string" && payload.url
          ? payload.url
          : `${SORA_ORIGIN}/profile/${encodeURIComponent(username)}`
  };
}
async function resolveViewerIdentity() {
  const viewerUserId = await deriveViewerUserId();
  let username = "";
  let displayName = "";
  try {
    const payload = (await fetchJson(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}`)) as Record<string, unknown>;
    username = pickFirstString([payload.username, payload.user_name, payload.userName]);
    displayName = pickFirstString([payload.display_name, payload.displayName, payload.name, username]);
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
        }
      }
    } catch (_error) {
      // keep empty fallback values
    }
  }
  return {
    user_id: viewerUserId,
    username,
    display_name: displayName
  };
}
async function resolveCreatorTarget(
  explicitCreatorId: string,
  routeUrl: string,
  creatorUsername: string
): Promise<{ userId: string; username: string; identifiers: string[] }> {
  const routeUsername = getUsernameFromRouteUrl(routeUrl);
  const normalizedExplicitId = explicitCreatorId.trim();
  const normalizedUsername = creatorUsername.trim() || routeUsername;
  let resolvedUserId = normalizedExplicitId;
  let resolvedUsername = normalizedUsername;

  if (normalizedUsername) {
    try {
      const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(normalizedUsername)}`)) as Record<string, unknown>;
      resolvedUserId = pickFirstString([resolvedUserId, payload.user_id, payload.userId]);
      resolvedUsername = pickFirstString([
        resolvedUsername,
        payload.username,
        payload.user_name,
        payload.userName,
        routeUsername
      ]);
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

  return {
    userId: resolvedUserId,
    username: resolvedUsername,
    identifiers
  };
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
    return trimmedCharacterId;
  }
  try {
    const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    const resolvedId = pickFirstString([
      payload.character_user_id,
      payload.characterUserId,
      payload.profile_id,
      payload.profileId,
      payload.user_id,
      payload.userId
    ]);
    return resolvedId || trimmedCharacterId;
  } catch (_error) {
    return trimmedCharacterId;
  }
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
    rowRecord.resolved_playback_url = reference.playback_url;
    rowRecord.resolvedPlaybackUrl = reference.playback_url;
    draftRecord.resolved_playback_url = reference.playback_url;
    draftRecord.resolvedPlaybackUrl = reference.playback_url;
    if (!pickFirstString([draftRecord.downloadable_url, draftRecord.downloadableUrl])) {
      draftRecord.downloadable_url = reference.playback_url;
      draftRecord.downloadableUrl = reference.playback_url;
    }
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
    return [{
      key: "likes",
      url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/likes`, { limit, cursor }).toString()
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
  if (request.source === "characterAccountAppearances") {
    const resolvedCharacterId = await resolveCharacterAccountId(
      request.character_id ?? "",
      request.route_url ?? "",
      request.creator_username ?? ""
    );
    const encodedCharacterId = encodeURIComponent(resolvedCharacterId);
    return [
      {
        key: "character-post-listing-posts",
        url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/posts`, { limit, cursor }).toString()
      },
      {
        key: "character-post-listing-profile",
        url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/profile`, { limit, cursor }).toString()
      },
      {
        key: "character-post-listing-public",
        url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/public`, { limit, cursor }).toString()
      },
      {
        key: "character-post-listing-published",
        url: buildUrl(`/backend/project_y/profile/${encodedCharacterId}/post_listing/published`, { limit, cursor }).toString()
      },
      {
        key: "character-feed-nf2",
        optional: true,
        url: buildUrl(`/backend/project_y/profile_feed/${encodedCharacterId}`, { limit, cut: "nf2", cursor }).toString()
      },
      {
        key: "character-feed-appearances",
        optional: true,
        url: buildUrl(`/backend/project_y/profile_feed/${encodedCharacterId}`, { limit, cut: "appearances", cursor }).toString()
      }
    ];
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
          key: `creator-post-listing-posts${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/posts`, { limit, cursor }).toString()
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
          key: `creator-post-listing-published${suffix}`,
          url: buildUrl(`/backend/project_y/profile/${encodedIdentifier}/post_listing/published`, { limit, cursor }).toString()
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
    const candidates: FetchEndpointCandidate[] = creatorTarget.identifiers.map((identifier, index) => ({
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
    return candidates;
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
): { estimated_size_bytes: number | null; thumbnail_url: string; playback_url: string } {
  if (!value || typeof value !== "object") {
    return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "" };
  }
  const resolveFromRecord = (
    record: Record<string, unknown>
  ): { estimated_size_bytes: number | null; thumbnail_url: string; playback_url: string } => ({
    estimated_size_bytes: extractEstimatedSizeBytesFromAnyRecord(record),
    thumbnail_url: extractThumbnailUrlFromAnyRecord(record),
    playback_url: extractPlaybackUrlFromAnyRecord(record)
  });
  const directRecord = value as Record<string, unknown>;
  const directSize = extractEstimatedSizeBytesFromAnyRecord(directRecord);
  const directThumbnail = extractThumbnailUrlFromAnyRecord(directRecord);
  const directPlayback = extractPlaybackUrlFromAnyRecord(directRecord);
  if ((directSize != null || directThumbnail || directPlayback) && resolveSharedVideoIdFromValue(value) === videoId) {
    return { estimated_size_bytes: directSize, thumbnail_url: directThumbnail, playback_url: directPlayback };
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
  return { estimated_size_bytes: null, thumbnail_url: "", playback_url: "" };
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
  return !nextCursor && !hasMoreRows;
}
export function getFetchLimitForSource(
  source: FetchBatchRequest["source"],
  requestedLimit = 100
): number {
  if (
    source === "characters" ||
    source === "characterAccountAppearances" ||
    source === "creatorCameos"
  ) {
    return APPEARANCE_FEED_PAGE_LIMIT;
  }
  return requestedLimit;
}
function getCursorKindForSource(source: FetchBatchRequest["source"]): string {
  if (
    source === "profile" ||
    source === "likes" ||
    source === "creatorPublished"
  ) {
    return "sv2_created_at";
  }
  return "";
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
