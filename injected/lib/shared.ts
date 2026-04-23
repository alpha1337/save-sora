import { deriveAuthContext } from "./auth";
import { SORA_ORIGIN } from "./origins";

const FETCH_RETRY_DELAYS_MS = [500, 1500, 3000];
const DEFAULT_MAX_ATTEMPTS = FETCH_RETRY_DELAYS_MS.length + 1;
const ADAPTIVE_429_BASE_DELAY_MS = 900;
const ADAPTIVE_429_MAX_DELAY_MS = 20000;
const ADAPTIVE_429_MAX_ATTEMPTS = 12;

export interface FetchJsonDiagnostics {
  requested_at: string;
  responded_at: string;
  status: number;
  attempts: number;
  rate_limited: boolean;
  network_errors: number;
}

interface FetchJsonOptions {
  adaptive429?: boolean;
  adaptive429BaseDelayMs?: number;
  adaptive429MaxDelayMs?: number;
  maxAttempts?: number;
}

/**
 * Shared network and parsing helpers for the injected Sora fetch runtime.
 */
export async function fetchJson(url: string): Promise<unknown> {
  return (await fetchJsonWithDiagnostics(url)).payload;
}

export async function fetchJsonWithDiagnostics(
  url: string,
  options: FetchJsonOptions = {}
): Promise<{ payload: unknown; diagnostics: FetchJsonDiagnostics }> {
  const authContext = await deriveAuthContext();
  const resolvedUrl = resolveSoraUrl(url);
  const headers = {
    accept: "application/json, text/plain, */*",
    authorization: `Bearer ${authContext.token}`,
    "oai-language": authContext.language,
    ...(authContext.deviceId ? { "oai-device-id": authContext.deviceId } : {})
  };
  const requestedAt = new Date().toISOString();
  const maxAttempts = resolveMaxAttempts(options);
  let rateLimited = false;
  let networkErrorCount = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(resolvedUrl, {
        credentials: "include",
        headers
      });
    } catch (error) {
      networkErrorCount += 1;
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (isLastAttempt || !isRetriableFetchError(error)) {
        throw new Error(
          buildSoraNetworkRequestErrorMessage(
            resolvedUrl,
            "GET",
            attempt + 1,
            getFetchErrorMessage(error)
          )
        );
      }
      await sleep(resolveRetryDelayMs(null, attempt, options));
      continue;
    }

    if (response.ok) {
      return {
        payload: (await response.json()) as unknown,
        diagnostics: {
          requested_at: requestedAt,
          responded_at: new Date().toISOString(),
          status: response.status,
          attempts: attempt + 1,
          rate_limited: rateLimited,
          network_errors: networkErrorCount
        }
      };
    }

    if (response.status === 429) {
      rateLimited = true;
    }

    const isLastAttempt = attempt >= maxAttempts - 1;
    if (isLastAttempt || !isRetriableSoraStatus(response.status)) {
      throw new Error(buildSoraRequestErrorMessage(response.status, resolvedUrl, "GET", attempt + 1));
    }

    const delayMs = resolveRetryDelayMs(response, attempt, options);
    await sleep(delayMs);
  }

  throw new Error("Sora request failed after retries.");
}

export async function fetchText(url: string): Promise<string> {
  const resolvedUrl = resolveSoraUrl(url);
  const response = await fetch(resolvedUrl, {
    credentials: "include",
    redirect: "follow"
  });

  if (!response.ok) {
    throw new Error(buildSoraRequestErrorMessage(response.status, resolvedUrl, "GET"));
  }

  return response.text();
}

export function getPostListingRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  return pickFirstArray([record.items, record.data, record.results, record.posts, record.entries, record.feed, record.nodes]);
}

export function getNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return pickFirstString([
    record.next_cursor,
    record.nextCursor,
    (record.pagination as Record<string, unknown> | undefined)?.next_cursor,
    (record.pagination as Record<string, unknown> | undefined)?.nextCursor,
    record.cursor
  ]) || null;
}

export function getNextCursorForRows(
  payload: unknown,
  rows: unknown[],
  requestCursor = "",
  cursorKind = "",
  previousCursor = ""
): string | null {
  const explicitCursor = normalizeCursorToken(getNextCursor(payload));
  const nestedCursor = normalizeCursorToken(findNestedCursorToken(payload, requestCursor));

  if (explicitCursor && explicitCursor !== requestCursor) {
    return explicitCursor;
  }

  if (nestedCursor && nestedCursor !== requestCursor) {
    return nestedCursor;
  }

  const derivedCursor = normalizeCursorToken(buildCreatedAtCursorFromRows(rows, cursorKind));
  if (derivedCursor && derivedCursor !== requestCursor && derivedCursor !== previousCursor) {
    return derivedCursor;
  }

  if (explicitCursor) {
    return explicitCursor;
  }

  if (nestedCursor) {
    return nestedCursor;
  }

  return derivedCursor;
}

export function getEstimatedTotalCount(payload: unknown, observedCount: number): number {
  if (!payload || typeof payload !== "object") {
    return observedCount;
  }

  const record = payload as Record<string, unknown>;
  return pickFirstNumber([
    record.total_count,
    record.totalCount,
    record.estimated_total_count,
    record.estimatedTotalCount,
    record.item_count,
    record.itemCount,
    record.result_count,
    record.resultCount,
    (record.pagination as Record<string, unknown> | undefined)?.total_count,
    (record.pagination as Record<string, unknown> | undefined)?.totalCount,
    observedCount
  ]) ?? observedCount;
}

export function getUsernameFromRouteUrl(routeUrl: string): string {
  const normalizedRouteUrl = routeUrl.trim();
  if (/^@?[A-Za-z0-9._-]+$/.test(normalizedRouteUrl)) {
    return normalizedRouteUrl.replace(/^@+/, "");
  }

  try {
    const pathname = new URL(routeUrl, SORA_ORIGIN).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const profileSegment = segments.find((segment) => segment.startsWith("@")) ?? (segments[0] === "profile" ? segments[1] : segments[0]);
    return typeof profileSegment === "string" ? profileSegment.replace(/^@+/, "") : "";
  } catch (_error) {
    return "";
  }
}

function resolveSoraUrl(url: string): string {
  try {
    return new URL(url, SORA_ORIGIN).toString();
  } catch (_error) {
    return url;
  }
}

export function isRetriableSoraStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
}

function resolveMaxAttempts(options: FetchJsonOptions): number {
  if (typeof options.maxAttempts === "number" && options.maxAttempts > 0) {
    return Math.max(1, Math.floor(options.maxAttempts));
  }

  return options.adaptive429 ? ADAPTIVE_429_MAX_ATTEMPTS : DEFAULT_MAX_ATTEMPTS;
}

function resolveRetryDelayMs(response: Response | null, attempt: number, options: FetchJsonOptions): number {
  if (response && options.adaptive429 && response.status === 429) {
    const retryAfterDelay = parseRetryAfterMs(response.headers.get("retry-after"));
    if (retryAfterDelay != null) {
      return clampDelay(retryAfterDelay, options);
    }
    const baseDelay = options.adaptive429BaseDelayMs ?? ADAPTIVE_429_BASE_DELAY_MS;
    const exponentialDelay = baseDelay * Math.pow(2, Math.min(6, attempt));
    return clampDelay(exponentialDelay, options);
  }

  return FETCH_RETRY_DELAYS_MS[Math.min(attempt, FETCH_RETRY_DELAYS_MS.length - 1)] ?? FETCH_RETRY_DELAYS_MS[FETCH_RETRY_DELAYS_MS.length - 1] ?? 3000;
}

function isRetriableFetchError(error: unknown): boolean {
  const message = getFetchErrorMessage(error).toLowerCase();
  if (!message) {
    return true;
  }
  if (message.includes("aborted")) {
    return false;
  }
  return message.includes("failed to fetch") || message.includes("network") || message.includes("load failed");
}

function getFetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error ?? "").trim();
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const trimmedHeader = headerValue.trim();
  if (!trimmedHeader) {
    return null;
  }

  const secondsValue = Number(trimmedHeader);
  if (Number.isFinite(secondsValue) && secondsValue >= 0) {
    return secondsValue * 1000;
  }

  const parsedDateMs = Date.parse(trimmedHeader);
  if (!Number.isFinite(parsedDateMs)) {
    return null;
  }
  return Math.max(0, parsedDateMs - Date.now());
}

function clampDelay(delayMs: number, options: FetchJsonOptions): number {
  const maxDelay = options.adaptive429MaxDelayMs ?? ADAPTIVE_429_MAX_DELAY_MS;
  return Math.min(maxDelay, Math.max(250, Math.round(delayMs)));
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function buildSoraRequestErrorMessage(status: number, requestUrl: string, method: "GET" | "POST", attempts = 1): string {
  const requestLabel = describeRequestForError(requestUrl, method);
  const attemptsLabel = attempts > 1 ? ` Attempts: ${attempts}.` : "";
  if (status === 400) {
    return `Sora request failed with status 400. Request: ${requestLabel}.${attemptsLabel}`;
  }
  if (status === 401 || status === 403) {
    return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
  }
  if (status === 404) {
    return `Sora request failed with status 404. Request: ${requestLabel}.${attemptsLabel}`;
  }
  if (status === 429) {
    return `Sora request failed with status 429. Request: ${requestLabel}.${attemptsLabel}`;
  }
  if (status >= 500) {
    return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
  }
  return `Sora request failed with status ${status}. Request: ${requestLabel}.${attemptsLabel}`;
}

function buildSoraNetworkRequestErrorMessage(
  requestUrl: string,
  method: "GET" | "POST",
  attempts: number,
  lastErrorMessage: string
): string {
  const requestLabel = describeRequestForError(requestUrl, method);
  const attemptLabel = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
  const trailingError = lastErrorMessage ? ` Last error: ${lastErrorMessage}.` : "";
  return `Sora request failed due to a network error after ${attemptLabel}. Request: ${requestLabel}.${trailingError}`;
}

function describeRequestForError(requestUrl: string, method: "GET" | "POST"): string {
  try {
    const url = new URL(requestUrl);
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
    return `${method} ${url.pathname}${query ? `?${query}` : ""}`;
  } catch (_error) {
    return `${method} ${requestUrl}`;
  }
}

export function resolveSharedVideoIdFromValue(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return extractSharedVideoId(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = resolveSharedVideoIdFromValue(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const typeHint = pickFirstString([
    record.kind,
    record.type,
    record.role,
    record.asset_type,
    record.assetType,
    record.media_type,
    record.mediaType
  ]).toLowerCase();
  const isSourceLikeRecord = typeHint.includes("source") || typeHint.includes("reference") || typeHint.includes("input");
  if (isSourceLikeRecord) {
    return "";
  }
  const directMatch = pickFirstString([
    record.shared_post_id,
    record.sharedPostId,
    record.post_id,
    record.postId,
    record.share_id,
    record.shareId,
    record.public_id,
    record.publicId,
    record.id,
    extractSharedVideoId(record.permalink),
    extractSharedVideoId(record.detail_url),
    extractSharedVideoId(record.detailUrl),
    extractSharedVideoId(record.share_url),
    extractSharedVideoId(record.shareUrl),
    extractSharedVideoId(record.url)
  ]);
  if (/^s_[A-Za-z0-9_-]+$/.test(directMatch)) {
    return directMatch;
  }

  for (const entryValue of Object.values(record)) {
    const match = resolveSharedVideoIdFromValue(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

export function extractSharedVideoId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmedValue = value.trim();
  if (/^s_[A-Za-z0-9_-]+$/.test(trimmedValue)) {
    return trimmedValue;
  }

  const match = trimmedValue.match(/\/(?:p|video)\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

export function extractDraftGenerationId(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) {
    return "";
  }

  if (typeof value === "string") {
    return /^gen_[A-Za-z0-9_-]+$/.test(value.trim()) ? value.trim() : "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractDraftGenerationId(entry, depth + 1);
      if (match) {
        return match;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const directMatch = pickFirstString([record.generation_id, record.generationId, record.id, record.task_id, record.taskId]);
  if (/^gen_[A-Za-z0-9_-]+$/.test(directMatch)) {
    return directMatch;
  }

  for (const entryValue of Object.values(record)) {
    const match = extractDraftGenerationId(entryValue, depth + 1);
    if (match) {
      return match;
    }
  }

  return "";
}

function pickFirstArray<T>(candidates: unknown[]): T[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as T[];
    }
  }
  return [];
}

export function pickFirstString(candidates: unknown[]): string {
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

function isLikelyCursorKey(value: string): boolean {
  return /(?:^|_|[A-Z])cursor|page.*token|continuation/i.test(value);
}

function findNestedCursorToken(payload: unknown, requestCursor = "", keyName = "", depth = 0): string | null {
  if (depth > 6 || payload == null) {
    return null;
  }

  if (typeof payload === "string") {
    if (isLikelyCursorKey(keyName) && payload && payload !== requestCursor && payload.length < 2048) {
      return payload;
    }

    return null;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      const match = findNestedCursorToken(entry, requestCursor, keyName, depth + 1);
      if (match) {
        return match;
      }
    }

    return null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const priorityKeys = ["next_cursor", "nextCursor", "end_cursor", "endCursor", "cursor", "page_cursor", "pageCursor"];

  for (const candidateKey of priorityKeys) {
    if (!(candidateKey in record)) {
      continue;
    }

    const match = findNestedCursorToken(record[candidateKey], requestCursor, candidateKey, depth + 1);
    if (match) {
      return match;
    }
  }

  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (priorityKeys.includes(entryKey) || (!isLikelyCursorKey(entryKey) && depth > 2)) {
      continue;
    }

    const match = findNestedCursorToken(entryValue, requestCursor, entryKey, depth + 1);
    if (match) {
      return match;
    }
  }

  return null;
}

function normalizeCursorToken(value: string | null): string {
  return typeof value === "string" && value ? value : "";
}

function normalizeCursorTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }

    const parsedDateValue = Date.parse(value);
    if (Number.isFinite(parsedDateValue)) {
      return parsedDateValue / 1000;
    }
  }

  return null;
}

export function encodeCursorPayload(payload: Record<string, unknown>): string | null {
  try {
    return btoa(JSON.stringify(payload));
  } catch (_error) {
    return null;
  }
}

function buildCreatedAtCursorFromRows(rows: unknown[], cursorKind = ""): string | null {
  if (!cursorKind) {
    return null;
  }

  const sourceRows = Array.isArray(rows) ? rows : [];
  for (let index = sourceRows.length - 1; index >= 0; index -= 1) {
    const row = sourceRows[index];
    const rowRecord = row && typeof row === "object" ? row as Record<string, unknown> : null;
    const postRecord = rowRecord?.post && typeof rowRecord.post === "object"
      ? rowRecord.post as Record<string, unknown>
      : null;

    const candidates = [
      rowRecord?.created_at,
      rowRecord?.createdAt,
      postRecord?.created_at,
      postRecord?.createdAt,
      postRecord?.posted_at,
      postRecord?.postedAt,
      postRecord?.updated_at,
      postRecord?.updatedAt
    ];

    for (const candidate of candidates) {
      const createdAt = normalizeCursorTimestamp(candidate);
      if (createdAt == null) {
        continue;
      }

      return encodeCursorPayload({
        kind: cursorKind,
        created_at: createdAt
      });
    }
  }

  return null;
}

export function getRawRowKey(row: unknown): string {
  if (!row || typeof row !== "object") {
    return "";
  }

  const record = row as Record<string, unknown>;
  return pickFirstString([
    resolveSharedVideoIdFromValue(record),
    extractDraftGenerationId(record),
    record.post_id,
    record.postId,
    record.public_id,
    record.publicId,
    record.id,
    extractSharedVideoId(record.permalink),
    extractSharedVideoId(record.detail_url),
    extractSharedVideoId(record.detailUrl),
    extractSharedVideoId(record.url),
    pickFirstString([
      typeof record.url === "string" ? record.url : "",
      typeof record.detail_url === "string" ? record.detail_url : "",
      typeof record.detailUrl === "string" ? record.detailUrl : ""
    ])
  ]);
}
