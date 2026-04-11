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

export interface BackgroundErrorResponse {
  ok: false;
  error: string;
}

export type BackgroundRequest =
  | FetchBatchRequest
  | ResolveCreatorProfileRequest
  | FetchCharacterAccountsRequest
  | FetchDetailHtmlRequest;

export type BackgroundResponse =
  | BackgroundErrorResponse
  | FetchBatchResponse
  | ResolveCreatorProfileResponse
  | FetchCharacterAccountsResponse
  | FetchDetailHtmlResponse;

export interface ContentScriptRequest {
  type: "run-source-request";
  payload: BackgroundRequest;
}

export interface ContentScriptResponse {
  ok: boolean;
  payload?: unknown;
  error?: string;
}
