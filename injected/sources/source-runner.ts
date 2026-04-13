import type { BackgroundRequest, FetchBatchRequest } from "../../src/types/background";
import { deriveViewerUserId } from "../lib/auth";
import { SORA_ORIGIN } from "../lib/origins";
import {
  buildNoWatermarkProxyUrl,
  extractDraftGenerationId,
  extractSharedVideoId,
  fetchJson,
  getNextCursor,
  getNextCursorForRows,
  fetchText,
  getEstimatedTotalCount,
  getPostListingRows,
  getRawRowKey,
  getUsernameFromRouteUrl,
  resolveSharedVideoIdFromValue
} from "../lib/shared";
import {
  filterRowsByTimeWindow,
  filterRowsForCharacterId,
  reachedOlderThanSinceBoundary
} from "./fetch-batch-filters";

const APPEARANCE_FEED_PAGE_LIMIT = 100;

interface FetchEndpointCandidate {
  key: string;
  optional?: boolean;
  url: string;
}

/**
 * Executes typed background requests from inside the signed-in Sora page.
 */
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
    const scopedRows = request.source === "characterAccountDrafts" || request.source === "characterAccountAppearances"
      ? filterRowsForCharacterId(pageRows, request.character_id ?? "")
      : pageRows;
    const inRangeRows = filterRowsByTimeWindow(scopedRows, request.since_ms, request.until_ms);
    const enrichedRows = isDraftSource(request.source)
      ? enrichDraftRows(inRangeRows, request.draft_resolution_entries ?? [])
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
    const hasMoreRows = scopedRows.length >= requestLimit;
    const nextOffset: number | null = supportsOffsetPagination(request.source)
      ? (nextCursor ? offset : (offset ?? 0) + requestLimit)
      : null;
    const isDone =
      shouldFinishFetchPage(request.source, scopedRows.length, nextCursor, hasMoreRows) ||
      reachedOlderThanSinceBoundary(scopedRows, request.since_ms);

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
    return {
      endpointKey: matchedCandidate.key,
      payload: await fetchCandidatePayload(matchedCandidate)
    };
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
  let firstSuccessfulResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestScore = -1;
  let bestPaginatedResult: { endpointKey: string | null; payload: unknown } | null = null;
  let bestPaginatedScore = -1;

  for (const candidate of candidates) {
    const payload = await fetchCandidatePayload(candidate);
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

  return bestPaginatedResult ?? bestResult ?? firstSuccessfulResult ?? { endpointKey: candidates[0]?.key ?? null, payload: { items: [] } };
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

async function resolveCreatorId(explicitCreatorId: string, routeUrl: string, creatorUsername: string): Promise<string> {
  if (explicitCreatorId) {
    return explicitCreatorId;
  }

  const username = creatorUsername || getUsernameFromRouteUrl(routeUrl);
  if (!username) {
    throw new Error("Creator fetch requires a user id or creator route.");
  }

  const payload = (await fetchJson(`/backend/project_y/profile/username/${encodeURIComponent(username)}`)) as Record<string, unknown>;
  const resolvedId = pickFirstString([payload.user_id, payload.userId, username]);
  if (!resolvedId) {
    throw new Error(`Could not resolve a creator id for ${username}.`);
  }
  return resolvedId;
}

function enrichDraftRows(
  rows: unknown[],
  knownResolutionEntries: Array<{ generation_id: string; video_id: string }>
): unknown[] {
  const knownResolutionMap = new Map(knownResolutionEntries.map((entry) => [entry.generation_id, entry.video_id]));
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const record = row as Record<string, unknown>;
    const generationId = extractDraftGenerationId(record);
    if (!generationId) {
      continue;
    }

    const cachedVideoId = knownResolutionMap.get(generationId);
    if (cachedVideoId) {
      record.resolved_video_id = cachedVideoId;
      record.resolved_share_url = `${SORA_ORIGIN}/p/${cachedVideoId}`;
      continue;
    }

    const directVideoId = resolveExistingDraftVideoId(record);
    if (directVideoId) {
      record.resolved_video_id = directVideoId;
      record.resolved_share_url = `${SORA_ORIGIN}/p/${directVideoId}`;
    }
  }

  return rows;
}

async function resolveDraftReference(request: { generation_id: string; detail_url?: string; row_payload?: unknown }) {
  const rowPayload = request.row_payload && typeof request.row_payload === "object"
    ? request.row_payload as Record<string, unknown>
    : {};
  const workingRow: Record<string, unknown> = {
    ...rowPayload,
    generation_id: rowPayload.generation_id ?? rowPayload.generationId ?? request.generation_id,
    detail_url: rowPayload.detail_url ?? rowPayload.detailUrl ?? request.detail_url
  };

  if (shouldSkipDraftRow(workingRow)) {
    return {
      generation_id: request.generation_id,
      video_id: "",
      share_url: "",
      thumbnail_url: "",
      estimated_size_bytes: null,
      skip_reason: classifyDraftSkipReason(workingRow)
    };
  }

  const createdReference = await createSharedDraftReference(workingRow, request.generation_id).catch(() => null);
  return {
    generation_id: request.generation_id,
    video_id: createdReference?.video_id ?? "",
    share_url: createdReference?.share_url ?? "",
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
    return [
      {
        key: "character-appearances",
        optional: true,
        url: buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(request.character_id ?? "")}`, {
          limit,
          cut: "appearances",
          cursor
        }).toString()
      },
      {
        key: "viewer-appearances-fallback",
        optional: true,
        url: buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "appearances", cursor }).toString()
      }
    ];
  }
  if (request.source === "characterAccountDrafts") {
    return [
      {
        key: "character-account-drafts",
        optional: true,
        url: buildUrl(`/backend/project_y/profile/drafts/cameos/character/${encodeURIComponent(request.character_id ?? "")}`, {
          limit,
          cursor
        }).toString()
      },
      {
        key: "viewer-character-drafts-fallback",
        optional: true,
        url: buildUrl("/backend/project_y/profile/drafts/cameos", { limit, cursor }).toString()
      }
    ];
  }
  if (request.source === "creatorPublished") {
    const creatorId = await resolveCreatorId(request.creator_user_id ?? "", request.route_url ?? "", request.creator_username ?? "");
    return [
      {
        key: "creator-post-listing-posts",
        url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/posts`, { limit, cursor }).toString()
      },
      {
        key: "creator-post-listing-profile",
        url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/profile`, { limit, cursor }).toString()
      },
      {
        key: "creator-post-listing-public",
        url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/public`, { limit, cursor }).toString()
      },
      {
        key: "creator-post-listing-published",
        url: buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/published`, { limit, cursor }).toString()
      },
      {
        key: "creator-feed-nf2",
        url: buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`, { limit, cut: "nf2", cursor }).toString()
      }
    ];
  }
  if (request.source === "creatorCameos") {
    const creatorId = await resolveCreatorId(request.creator_user_id ?? "", request.route_url ?? "", request.creator_username ?? "");
    return [{
      key: "creator-appearances",
      url: buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`, { limit, cut: "appearances", cursor }).toString()
    }];
  }

  throw new Error(`Unsupported fetch source: ${request.source}`);
}

async function createSharedDraftReference(row: Record<string, unknown>, generationId: string) {
  const existingVideoId = resolveExistingDraftVideoId(row);
  if (existingVideoId) {
    const metadata = await resolveResolvedDraftMetadata(existingVideoId, row);
    return {
      video_id: existingVideoId,
      share_url: `${SORA_ORIGIN}/p/${existingVideoId}`,
      download_url: buildNoWatermarkProxyUrl(existingVideoId),
      estimated_size_bytes: metadata.estimated_size_bytes,
      thumbnail_url: metadata.thumbnail_url
    };
  }

  if (shouldSkipDraftRow(row)) {
    return null;
  }

  try {
    const response = (await fetchJsonWithMethod("/backend/project_y/post", "POST", {
      attachments_to_create: [{ generation_id: generationId, kind: "sora" }],
      post_text: resolveDraftShareText(row),
      destinations: [{ type: "shared_link_unlisted" }]
    })) as Record<string, unknown>;
    const videoId = resolveSharedVideoIdFromValue(response);
    if (videoId) {
      const metadata = await resolveResolvedDraftMetadata(videoId, response);
      return {
        video_id: videoId,
        share_url: `${SORA_ORIGIN}/p/${videoId}`,
        download_url: buildNoWatermarkProxyUrl(videoId),
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/status 400\b/.test(message)) {
      return null;
    }
    // Fall through to detail/feed recovery. A failed create request should not abort draft fetching.
  }

  const detailUrl = resolveDraftDetailUrl(row, generationId);
  if (detailUrl) {
    const detailHtml = await fetchText(detailUrl).catch(() => "");
    const recoveredId = extractSharedVideoId(detailHtml);
    if (recoveredId) {
      const metadata = await resolveResolvedDraftMetadata(recoveredId, row);
      return {
        video_id: recoveredId,
        share_url: `${SORA_ORIGIN}/p/${recoveredId}`,
        download_url: buildNoWatermarkProxyUrl(recoveredId),
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
  }

  const viewerUserId = await deriveViewerUserId();
  for (const candidateUrl of [
    buildUrl("/backend/project_y/profile_feed/me", { limit: "24", cut: "nf2" }).toString(),
    buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/posts`, { limit: "24" }).toString()
  ]) {
    const payload = await fetchJson(candidateUrl).catch(() => null);
    const recoveredId = payload ? resolveSharedVideoIdFromValue(payload) : "";
    if (recoveredId) {
      const metadata = await resolveResolvedDraftMetadata(recoveredId, payload ?? row);
      return {
        video_id: recoveredId,
        share_url: `${SORA_ORIGIN}/p/${recoveredId}`,
        download_url: buildNoWatermarkProxyUrl(recoveredId),
        estimated_size_bytes: metadata.estimated_size_bytes,
        thumbnail_url: metadata.thumbnail_url
      };
    }
  }

  return null;
}

async function resolveResolvedDraftMetadata(
  videoId: string,
  initialPayload?: unknown
): Promise<{ estimated_size_bytes: number | null; thumbnail_url: string }> {
  const fromInitial = extractResolvedDraftMetadataFromValue(initialPayload, videoId);
  if (fromInitial.estimated_size_bytes != null || fromInitial.thumbnail_url) {
    return fromInitial;
  }

  const viewerUserId = await deriveViewerUserId();
  const metadataEndpoints = [
    buildUrl("/backend/project_y/profile_feed/me", { limit: "48", cut: "nf2" }).toString(),
    buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/posts`, { limit: "48" }).toString(),
    buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/public`, { limit: "48" }).toString()
  ];

  for (const endpoint of metadataEndpoints) {
    const payload = await fetchJson(endpoint).catch(() => null);
    const resolved = extractResolvedDraftMetadataFromValue(payload, videoId);
    if (resolved.estimated_size_bytes != null || resolved.thumbnail_url) {
      return resolved;
    }
  }

  return { estimated_size_bytes: null, thumbnail_url: "" };
}
async function fetchJsonWithMethod(url: string, method: "POST", jsonBody: unknown): Promise<unknown> {
  const auth = await import("../lib/auth").then((module) => module.deriveAuthContext());
  const response = await fetch(new URL(url, SORA_ORIGIN).toString(), {
    method,
    credentials: "include",
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${auth.token}`,
      "content-type": "application/json",
      "oai-language": auth.language,
      ...(auth.deviceId ? { "oai-device-id": auth.deviceId } : {})
    },
    body: JSON.stringify(jsonBody)
  });

  if (!response.ok) {
    throw new Error(`Draft share creation failed with status ${response.status}.`);
  }

  return response.json();
}
function resolveDraftShareText(row: Record<string, unknown>): string {
  return pickFirstString([row.discovery_phrase, row.discoveryPhrase, row.prompt, row.caption, row.description]);
}

export function resolveExistingDraftVideoId(row: Record<string, unknown>): string {
  return pickFirstString([
    row.resolved_video_id,
    row.resolvedVideoId,
    extractSharedVideoId(row.resolved_share_url),
    extractSharedVideoId(row.resolvedShareUrl),
    resolveSharedVideoIdFromValue(row)
  ]);
}
export function extractEstimatedSizeBytesFromResolvedRow(value: unknown, videoId: string): number | null {
  return extractResolvedDraftMetadataFromValue(value, videoId).estimated_size_bytes;
}

function extractResolvedDraftMetadataFromValue(
  value: unknown,
  videoId: string
): { estimated_size_bytes: number | null; thumbnail_url: string } {
  if (!value || typeof value !== "object") {
    return { estimated_size_bytes: null, thumbnail_url: "" };
  }

  const resolveFromRecord = (record: Record<string, unknown>): { estimated_size_bytes: number | null; thumbnail_url: string } => ({
    estimated_size_bytes: extractEstimatedSizeBytesFromAnyRecord(record),
    thumbnail_url: extractThumbnailUrlFromAnyRecord(record)
  });

  const directSize = extractEstimatedSizeBytesFromAnyRecord(value as Record<string, unknown>);
  const directThumbnail = extractThumbnailUrlFromAnyRecord(value as Record<string, unknown>);
  if ((directSize != null || directThumbnail) && resolveSharedVideoIdFromValue(value) === videoId) {
    return { estimated_size_bytes: directSize, thumbnail_url: directThumbnail };
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

  return { estimated_size_bytes: null, thumbnail_url: "" };
}

export function shouldSkipDraftRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || typeof row !== "object") {
    return true;
  }

  const kind = getDraftKind(row);
  const hasDraftShareCandidate = Boolean(extractDraftGenerationId(row)) || Boolean(resolveExistingDraftVideoId(row));
  return Boolean(
    kind === "sora_error" ||
    hasDraftEditedOrRemixStub(row) ||
    isDraftOutputBlocked(row) ||
    hasDraftFailureState(row) ||
    (typeof kind === "string" &&
      kind !== "sora_draft" &&
      kind !== "draft" &&
      !hasDraftShareCandidate)
  );
}

function classifyDraftSkipReason(row: Record<string, unknown>): string {
  if (getDraftKind(row) === "sora_error" || hasDraftFailureState(row)) {
    return "draft_error";
  }

  if (hasDraftEditedOrRemixStub(row)) {
    return "draft_edit_or_remix";
  }

  if (isDraftOutputBlocked(row)) {
    return "draft_content_violation";
  }

  return "unresolved_draft_video_id";
}

function hasDraftEditedOrRemixStub(row: Record<string, unknown>): boolean {
  const cVersion = pickFirstNumber([
    row.c_version,
    row.cVersion,
    (row.draft as Record<string, unknown> | undefined)?.c_version,
    (row.draft as Record<string, unknown> | undefined)?.cVersion
  ]);
  if ((cVersion ?? 0) > 0) {
    return true;
  }

  return pickFirstBoolean([
    row.remix_stub,
    row.remixStub,
    row.is_remix_stub,
    row.isRemixStub,
    row.editor_stub,
    row.editorStub,
    row.is_editor_stub,
    row.isEditorStub
  ]);
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

function extractEstimatedSizeBytesFromAnyRecord(record: Record<string, unknown>): number | null {
  const candidates: unknown[] = [
    record.size_bytes,
    record.sizeBytes,
    record.file_size,
    record.fileSize,
    record.filesize
  ];

  const attachments = getNestedObjectArrays(record);
  for (const attachment of attachments) {
    candidates.push(
      attachment.size_bytes,
      attachment.sizeBytes,
      attachment.file_size,
      attachment.fileSize,
      attachment.filesize
    );

    const encodings = attachment.encodings && typeof attachment.encodings === "object"
      ? attachment.encodings as Record<string, unknown>
      : null;
    const source = encodings?.source && typeof encodings.source === "object"
      ? encodings.source as Record<string, unknown>
      : null;
    const sourceWm = encodings?.source_wm && typeof encodings.source_wm === "object"
      ? encodings.source_wm as Record<string, unknown>
      : null;
    const md = encodings?.md && typeof encodings.md === "object"
      ? encodings.md as Record<string, unknown>
      : null;
    candidates.push(source?.size, sourceWm?.size, md?.size);
  }

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
}

function extractThumbnailUrlFromAnyRecord(record: Record<string, unknown>): string {
  const directCandidates = [record.thumbnail_url, record.thumbnailUrl, record.preview_image_url, record.previewImageUrl, record.poster_url, record.posterUrl, record.image_url, record.imageUrl];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  const attachments = getNestedObjectArrays(record);
  for (const attachment of attachments) {
    const attachmentCandidates = [attachment.thumbnail_url, attachment.thumbnailUrl, attachment.preview_image_url, attachment.previewImageUrl, attachment.poster_url, attachment.posterUrl, attachment.image_url, attachment.imageUrl];
    for (const candidate of attachmentCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }

  return "";
}

function getNestedObjectArrays(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const keys = ["attachments", "outputs", "media", "assets", "files", "videos", "entries", "nodes", "results", "clips"];
  const nested: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (entry && typeof entry === "object") {
        nested.push(entry as Record<string, unknown>);
      }
    }
  }
  return nested;
}

function getDraftKind(row: Record<string, unknown>): string {
  return pickFirstString([
    row.kind,
    (row.draft as Record<string, unknown> | undefined)?.kind,
    (row.item as Record<string, unknown> | undefined)?.kind,
    (row.data as Record<string, unknown> | undefined)?.kind,
    (row.output as Record<string, unknown> | undefined)?.kind
  ]);
}

function isDraftOutputBlocked(row: Record<string, unknown>): boolean {
  return pickFirstBoolean([
    row.output_blocked,
    row.outputBlocked,
    (row.output as Record<string, unknown> | undefined)?.output_blocked,
    (row.output as Record<string, unknown> | undefined)?.outputBlocked,
    row.content_violation,
    row.contentViolation,
    (row.output as Record<string, unknown> | undefined)?.content_violation,
    (row.output as Record<string, unknown> | undefined)?.contentViolation
  ]);
}

function hasDraftFailureState(row: Record<string, unknown>): boolean {
  const failureText = pickFirstString([
    row.status,
    row.state,
    row.error,
    row.error_code,
    row.errorCode,
    row.error_message,
    row.errorMessage,
    (row.output as Record<string, unknown> | undefined)?.status,
    (row.output as Record<string, unknown> | undefined)?.state,
    (row.output as Record<string, unknown> | undefined)?.error,
    (row.output as Record<string, unknown> | undefined)?.error_code,
    (row.output as Record<string, unknown> | undefined)?.errorCode,
    (row.output as Record<string, unknown> | undefined)?.error_message,
    (row.output as Record<string, unknown> | undefined)?.errorMessage
  ]).toLowerCase();

  return /error|failed|blocked|violation/.test(failureText);
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

function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function pickFirstNumber(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const numericValue = Number(candidate);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

function pickFirstBoolean(candidates: unknown[]): boolean {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }

  return false;
}

function isDraftSource(source: FetchBatchRequest["source"]): boolean {
  return source === "drafts" || source === "characterDrafts" || source === "characterAccountDrafts";
}

function supportsOffsetPagination(source: FetchBatchRequest["source"]): boolean {
  return source === "drafts";
}

export function shouldFinishFetchPage(
  source: FetchBatchRequest["source"],
  _pageRowCount: number,
  nextCursor: string | null,
  hasMoreRows: boolean
): boolean {
  if (supportsOffsetPagination(source)) {
    return !nextCursor && !hasMoreRows;
  }

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
