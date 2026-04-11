import type { BackgroundRequest, FetchBatchRequest } from "../../src/types/background";
import { deriveViewerUserId } from "../lib/auth";
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
  getUsernameFromRouteUrl,
  resolveSharedVideoIdFromValue
} from "../lib/shared";

const DRAFT_RESOLUTION_CONCURRENCY = 6;

/**
 * Executes typed background requests from inside the signed-in Sora page.
 */
export async function runSourceRequest(request: BackgroundRequest): Promise<unknown> {
  if (request.type === "fetch-detail-html") {
    return { detail_url: request.detail_url, html: await fetchText(request.detail_url) };
  }

  if (request.type === "resolve-creator-profile") {
    return resolveCreatorProfile(request.route_url);
  }

  if (request.type === "fetch-character-accounts") {
    const viewerUserId = await deriveViewerUserId();
    const url = new URL(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, window.location.origin);
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
  const rows: unknown[] = [];

  for (let pageIndex = 0; pageIndex < (request.page_budget ?? 1); pageIndex += 1) {
    const payload = await fetchBatchPayload(request, cursor, offset);
    const pageRows = getPostListingRows(payload);
    const enrichedRows = isDraftSource(request.source)
      ? await enrichDraftRows(pageRows, request.draft_resolution_entries ?? [])
      : pageRows;

    rows.push(...enrichedRows);
    estimatedTotalCount = Math.max(estimatedTotalCount, getEstimatedTotalCount(payload, rows.length));

    const nextCursor = getNextCursorForRows(
      payload,
      pageRows,
      cursor ?? "",
      getCursorKindForSource(request.source),
      previousCursor ?? ""
    );
    const hasMoreRows = pageRows.length >= (request.limit ?? 100);
    const nextOffset: number | null = supportsOffsetPagination(request.source)
      ? (nextCursor ? offset : (offset ?? 0) + (request.limit ?? 100))
      : null;
    const isDone = supportsOffsetPagination(request.source)
      ? (!nextCursor && !hasMoreRows)
      : !nextCursor;

    previousCursor = cursor;
    cursor = nextCursor;
    offset = nextOffset;

    if (isDone) {
      return {
        rows,
        estimated_total_count: estimatedTotalCount,
        next_cursor: cursor,
        next_offset: offset,
        done: true
      };
    }
  }

  return {
    rows,
    estimated_total_count: estimatedTotalCount,
    next_cursor: cursor,
    next_offset: offset,
    done: false
  };
}

async function fetchBatchPayload(request: FetchBatchRequest, cursor: string | null, offset: number | null): Promise<unknown> {
  const limit = String(request.limit ?? 100);

  if (request.source === "profile") {
    return fetchJson(buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "nf2", cursor }).toString());
  }
  if (request.source === "drafts") {
    return fetchJson(buildUrl("/backend/project_y/profile/drafts/v2", { limit, cursor, offset }).toString());
  }
  if (request.source === "likes") {
    const viewerUserId = await deriveViewerUserId();
    return fetchJson(
      buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/post_listing/likes`, { limit, cursor }).toString()
    );
  }
  if (request.source === "characters") {
    return fetchJson(buildUrl("/backend/project_y/profile_feed/me", { limit, cut: "appearances", cursor }).toString());
  }
  if (request.source === "characterDrafts") {
    return fetchJson(buildUrl("/backend/project_y/profile/drafts/cameos", { limit, cursor }).toString());
  }
  if (request.source === "characterProfiles") {
    const viewerUserId = await deriveViewerUserId();
    return fetchJson(buildUrl(`/backend/project_y/profile/${encodeURIComponent(viewerUserId)}/characters`, { limit, cursor }).toString());
  }
  if (request.source === "characterAccountAppearances") {
    return (
      (await fetchPreferredPayload(
        [
          buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(request.character_id ?? "")}`, {
            limit,
            cut: "appearances",
            cursor
          }).toString(),
          buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(request.character_id ?? "")}`, {
            limit,
            cut: "nf2",
            cursor
          }).toString()
        ],
        cursor ?? "",
        getCursorKindForSource(request.source)
      )) ?? { items: [], next_cursor: null }
    );
  }
  if (request.source === "characterAccountDrafts") {
    return (
      (await fetchOptionalJson(
        buildUrl(`/backend/project_y/profile/drafts/cameos/character/${encodeURIComponent(request.character_id ?? "")}`, {
          limit,
          cursor
        }).toString()
      )) ?? { items: [], next_cursor: null }
    );
  }
  if (request.source === "creatorPublished") {
    const creatorId = await resolveCreatorId(request.creator_user_id ?? "", request.route_url ?? "", request.creator_username ?? "");
    return fetchFirstSuccessfulJson([
      buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/posts`, { limit, cursor }).toString(),
      buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/profile`, { limit, cursor }).toString(),
      buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/public`, { limit, cursor }).toString(),
      buildUrl(`/backend/project_y/profile/${encodeURIComponent(creatorId)}/post_listing/published`, { limit, cursor }).toString(),
      buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`, { limit, cut: "nf2", cursor }).toString()
    ]);
  }
  if (request.source === "creatorCameos") {
    const creatorId = await resolveCreatorId(request.creator_user_id ?? "", request.route_url ?? "", request.creator_username ?? "");
    return (
      (await fetchOptionalJson(
        buildUrl(`/backend/project_y/profile_feed/${encodeURIComponent(creatorId)}`, { limit, cut: "appearances", cursor }).toString()
      )) ?? { items: [], next_cursor: null }
    );
  }
  throw new Error(`Unsupported fetch source: ${request.source}`);
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
          : `${window.location.origin}/profile/${encodeURIComponent(username)}`
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
  const resolvedId = String(payload.user_id ?? payload.userId ?? username);
  if (!resolvedId) {
    throw new Error(`Could not resolve a creator id for ${username}.`);
  }
  return resolvedId;
}

async function enrichDraftRows(
  rows: unknown[],
  knownResolutionEntries: Array<{ generation_id: string; video_id: string }>
): Promise<unknown[]> {
  const knownResolutionMap = new Map(knownResolutionEntries.map((entry) => [entry.generation_id, entry.video_id]));
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < rows.length) {
      const index = currentIndex;
      currentIndex += 1;
      const row = rows[index] as Record<string, unknown>;
      const generationId = extractDraftGenerationId(row);
      if (!generationId) {
        continue;
      }

      const cachedVideoId = knownResolutionMap.get(generationId);
      if (cachedVideoId) {
        row.resolved_video_id = cachedVideoId;
        row.resolved_share_url = `${window.location.origin}/p/${cachedVideoId}`;
        continue;
      }

      const directVideoId = resolveExistingDraftVideoId(row);
      if (directVideoId) {
        row.resolved_video_id = directVideoId;
        row.resolved_share_url = `${window.location.origin}/p/${directVideoId}`;
        continue;
      }

      if (shouldSkipDraftRow(row)) {
        continue;
      }

      try {
        const createdReference = await createSharedDraftReference(row, generationId);
        if (createdReference) {
          row.resolved_video_id = createdReference.video_id;
          row.resolved_share_url = createdReference.share_url;
        }
      } catch (_error) {
        // Keep unresolved drafts in the batch instead of aborting the entire fetch.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(DRAFT_RESOLUTION_CONCURRENCY, rows.length) }, () => worker()));
  return rows;
}

async function fetchFirstSuccessfulJson(candidateUrls: string[]): Promise<unknown> {
  let lastError: unknown = null;

  for (const candidateUrl of candidateUrls) {
    try {
      return await fetchJson(candidateUrl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sora request failed for all candidate endpoints.");
}

async function fetchPreferredPayload(
  candidateUrls: string[],
  requestCursor: string,
  cursorKind: string
): Promise<unknown | null> {
  let firstSuccessfulPayload: unknown | null = null;
  let bestPayload: unknown | null = null;
  let bestScore = -1;
  let bestPaginatedPayload: unknown | null = null;
  let bestPaginatedScore = -1;
  let lastError: unknown = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const payload = await fetchOptionalJson(candidateUrl);
      if (!payload) {
        continue;
      }

      const rows = getPostListingRows(payload);
      const nextCursor = getNextCursorForRows(payload, rows, requestCursor, cursorKind);
      const score = rows.length;

      if (!firstSuccessfulPayload) {
        firstSuccessfulPayload = payload;
      }

      if (score > bestScore) {
        bestScore = score;
        bestPayload = payload;
      }

      if (nextCursor && score > 0 && score > bestPaginatedScore) {
        bestPaginatedScore = score;
        bestPaginatedPayload = payload;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (bestPaginatedPayload) {
    return bestPaginatedPayload;
  }

  if (bestPayload) {
    return bestPayload;
  }

  if (firstSuccessfulPayload) {
    return firstSuccessfulPayload;
  }

  if (lastError) {
    throw lastError;
  }

  return null;
}

async function fetchOptionalJson(url: string): Promise<unknown | null> {
  try {
    return await fetchJson(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/status (400|404)\b/.test(message)) {
      return null;
    }
    throw error;
  }
}

async function createSharedDraftReference(row: Record<string, unknown>, generationId: string) {
  const existingVideoId = resolveExistingDraftVideoId(row);
  if (existingVideoId) {
    return { video_id: existingVideoId, share_url: `${window.location.origin}/p/${existingVideoId}`, download_url: buildNoWatermarkProxyUrl(existingVideoId) };
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
      return { video_id: videoId, share_url: `${window.location.origin}/p/${videoId}`, download_url: buildNoWatermarkProxyUrl(videoId) };
    }
  } catch (_error) {
    // Fall through to detail/feed recovery. A failed create request should not abort draft fetching.
  }

  const detailUrl = resolveDraftDetailUrl(row, generationId);
  if (detailUrl) {
    const detailHtml = await fetchText(detailUrl).catch(() => "");
    const recoveredId = extractSharedVideoId(detailHtml);
    if (recoveredId) {
      return { video_id: recoveredId, share_url: `${window.location.origin}/p/${recoveredId}`, download_url: buildNoWatermarkProxyUrl(recoveredId) };
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
      return { video_id: recoveredId, share_url: `${window.location.origin}/p/${recoveredId}`, download_url: buildNoWatermarkProxyUrl(recoveredId) };
    }
  }

  return null;
}

async function fetchJsonWithMethod(url: string, method: "POST", jsonBody: unknown): Promise<unknown> {
  const auth = await import("../lib/auth").then((module) => module.deriveAuthContext());
  const response = await fetch(url, {
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
  return String(row.discovery_phrase ?? row.discoveryPhrase ?? row.prompt ?? row.caption ?? "");
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

export function shouldSkipDraftRow(row: Record<string, unknown> | null | undefined): boolean {
  if (!row || typeof row !== "object") {
    return true;
  }

  const kind = getDraftKind(row);
  const hasDraftShareCandidate = Boolean(extractDraftGenerationId(row)) || Boolean(resolveExistingDraftVideoId(row));
  return Boolean(
    kind === "sora_error" ||
    hasDraftEditedVersion(row) ||
    isDraftOutputBlocked(row) ||
    hasDraftFailureState(row) ||
    (typeof kind === "string" &&
      kind !== "sora_draft" &&
      kind !== "draft" &&
      !hasDraftShareCandidate)
  );
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
  return `${window.location.origin}/d/${generationId}`;
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

function hasDraftEditedVersion(row: Record<string, unknown>): boolean {
  return pickFirstNumber([
    row.c_version,
    row.cVersion,
    (row.draft as Record<string, unknown> | undefined)?.c_version,
    (row.draft as Record<string, unknown> | undefined)?.cVersion,
    (row.item as Record<string, unknown> | undefined)?.c_version,
    (row.item as Record<string, unknown> | undefined)?.cVersion,
    (row.data as Record<string, unknown> | undefined)?.c_version,
    (row.data as Record<string, unknown> | undefined)?.cVersion,
    (row.output as Record<string, unknown> | undefined)?.c_version,
    (row.output as Record<string, unknown> | undefined)?.cVersion
  ]) !== null;
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
  const url = new URL(pathname, window.location.origin);
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

function getCursorKindForSource(source: FetchBatchRequest["source"]): string {
  if (
    source === "profile" ||
    source === "likes" ||
    source === "characters" ||
    source === "characterAccountAppearances" ||
    source === "creatorPublished" ||
    source === "creatorCameos"
  ) {
    return "sv2_created_at";
  }

  return "";
}
