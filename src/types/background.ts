import type { CharacterAccount, CreatorProfile, LowLevelSourceType } from "./domain";

/**
 * Background request and response contracts used between the app page and the
 * extension service worker.
 */
export interface RawBatchResponse {
  rows: unknown[];
  row_keys: string[];
  estimated_total_count: number;
  endpoint_key: string | null;
  next_cursor: string | null;
  next_offset: number | null;
  done: boolean;
}

export interface FetchBatchRequest {
  type: "fetch-batch";
  source: LowLevelSourceType;
  since_ms?: number | null;
  until_ms?: number | null;
  cursor?: string | null;
  offset?: number | null;
  limit?: number;
  page_budget?: number;
  endpoint_key?: string | null;
  route_url?: string;
  creator_user_id?: string;
  creator_username?: string;
  character_id?: string;
  draft_resolution_entries?: Array<{ generation_id: string; video_id: string }>;
}

export interface FetchBatchResponse {
  ok: true;
  payload: RawBatchResponse;
}

export interface ResolveCreatorProfileRequest {
  type: "resolve-creator-profile";
  route_url: string;
}

export interface ResolveCreatorProfileResponse {
  ok: true;
  payload: CreatorProfile | null;
}

export interface ResolveViewerIdentityRequest {
  type: "resolve-viewer-identity";
}

export interface ResolveViewerIdentityResponse {
  ok: true;
  payload: {
    user_id: string;
    username: string;
    display_name: string;
  };
}

export interface ResolveDraftReferenceRequest {
  type: "resolve-draft-reference";
  generation_id: string;
  detail_url?: string;
  row_payload?: unknown;
}

export interface ResolveDraftReferenceResponse {
  ok: true;
  payload: {
    generation_id: string;
    video_id: string;
    share_url: string;
    playback_url?: string;
    thumbnail_url: string;
    estimated_size_bytes: number | null;
    skip_reason?: string;
  };
}

export interface FetchCharacterAccountsRequest {
  type: "fetch-character-accounts";
  cursor?: string | null;
  limit?: number;
}

export interface FetchCharacterAccountsResponse {
  ok: true;
  payload: {
    accounts: CharacterAccount[];
    next_cursor: string | null;
  };
}

export interface FetchDetailHtmlRequest {
  type: "fetch-detail-html";
  detail_url: string;
}

export interface FetchDetailHtmlResponse {
  ok: true;
  payload: {
    detail_url: string;
    html: string;
  };
}

export interface CleanupHiddenWorkersRequest {
  type: "cleanup-hidden-workers";
}

export interface CleanupHiddenWorkersResponse {
  ok: true;
  payload: {
    closed: boolean;
  };
}

export interface BackgroundErrorResponse {
  ok: false;
  error: string;
}

export type BackgroundRequest =
  | FetchBatchRequest
  | ResolveCreatorProfileRequest
  | ResolveViewerIdentityRequest
  | ResolveDraftReferenceRequest
  | FetchCharacterAccountsRequest
  | FetchDetailHtmlRequest
  | CleanupHiddenWorkersRequest;

export type BackgroundResponse =
  | BackgroundErrorResponse
  | FetchBatchResponse
  | ResolveCreatorProfileResponse
  | ResolveViewerIdentityResponse
  | ResolveDraftReferenceResponse
  | FetchCharacterAccountsResponse
  | FetchDetailHtmlResponse
  | CleanupHiddenWorkersResponse;

export interface ContentScriptRunSourceRequest {
  type: "run-source-request";
  payload: BackgroundRequest;
}

export interface ContentScriptPingRequest {
  type: "ping";
}

export type ContentScriptRequest = ContentScriptRunSourceRequest | ContentScriptPingRequest;

export interface ContentScriptResponse {
  ok: boolean;
  payload?: unknown;
  error?: string;
}
