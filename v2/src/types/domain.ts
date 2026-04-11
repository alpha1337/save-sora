/**
 * Shared domain types for the v2 application runtime.
 */
export type AppPhase = "idle" | "fetching" | "ready" | "downloading" | "error";

export type TopLevelSourceType =
  | "profile"
  | "drafts"
  | "likes"
  | "characters"
  | "characterAccounts"
  | "creators";

export type LowLevelSourceType =
  | "profile"
  | "drafts"
  | "likes"
  | "characters"
  | "characterDrafts"
  | "characterProfiles"
  | "characterAccountPosts"
  | "characterAccountAppearances"
  | "characterAccountDrafts"
  | "creatorProfileLookup"
  | "creatorPublished"
  | "creatorCameos"
  | "creatorCharacters"
  | "detailHtml";

export type SourceBucket =
  | "published"
  | "drafts"
  | "liked"
  | "cameos"
  | "characters"
  | "character-account"
  | "creators";

export interface SourceSelectionState {
  profile: boolean;
  drafts: boolean;
  likes: boolean;
  characters: boolean;
  characterAccounts: boolean;
  creators: boolean;
}

export interface CreatorProfile {
  profile_id: string;
  user_id: string;
  username: string;
  display_name: string;
  permalink: string;
  profile_picture_url: string | null;
  is_character_profile: boolean;
  created_at: string;
}

export interface CharacterAccount {
  account_id: string;
  username: string;
  display_name: string;
  profile_picture_url: string | null;
}

export interface AppSettings {
  archive_name_template: string;
  include_raw_payload_in_csv: boolean;
}

export interface SessionMeta {
  active_sources: SourceSelectionState;
  query: string;
  sort_key: VideoSortKey;
  selected_character_account_ids: string[];
  last_fetch_at: string | null;
}

export interface VideoRow {
  row_id: string;
  video_id: string;
  source_type: string;
  source_bucket: SourceBucket;
  title: string;
  prompt: string;
  discovery_phrase: string;
  description: string;
  caption: string;
  creator_name: string;
  creator_username: string;
  character_name: string;
  character_username: string;
  character_names: string[];
  category_tags: string[];
  created_at: string | null;
  published_at: string | null;
  like_count: number | null;
  view_count: number | null;
  share_count: number | null;
  repost_count: number | null;
  remix_count: number | null;
  detail_url: string;
  thumbnail_url: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  raw_payload_json: string;
  is_downloadable: boolean;
  skip_reason: string;
  fetched_at: string;
}

export interface DraftResolutionRecord {
  generation_id: string;
  video_id: string;
}

export interface DownloadHistoryRecord {
  video_id: string;
}

export interface ArchiveOrganizerRow {
  video_id: string;
  file_name: string;
  library_path: string;
  link_paths: string[];
  source_bucket: SourceBucket;
  creator_name: string;
  character_names: string[];
  category_tags: string[];
}

export interface ArchiveSupplementalEntry {
  archive_path: string;
  content: Blob | string;
}

export interface ArchiveWorkPlan {
  rows: VideoRow[];
  organizer_rows: ArchiveOrganizerRow[];
  supplemental_entries: ArchiveSupplementalEntry[];
  archive_name: string;
}

export interface FetchProgressState {
  active_label: string;
  completed_jobs: number;
  processed_batches: number;
  processed_rows: number;
  total_jobs: number;
}

export interface DownloadProgressState {
  active_label: string;
  completed_items: number;
  total_items: number;
}

export type VideoSortKey = "created_at" | "published_at" | "title";

export interface VideoFilterState {
  query: string;
  downloadable_only: boolean;
  downloaded_only: boolean;
  sort_key: VideoSortKey;
}
