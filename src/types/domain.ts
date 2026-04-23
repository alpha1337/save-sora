/**
 * Shared domain types for the v2 application runtime.
 */
export type AppPhase = "idle" | "fetching" | "ready" | "downloading" | "error";
export type DateRangePreset = "24h" | "7d" | "1m" | "3m" | "all" | "custom";

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
  | "characterAccountAppearances"
  | "sideCharacter"
  | "characterAccountDrafts"
  | "creatorProfileLookup"
  | "creatorPublished"
  | "creatorCameos"
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
  owner_user_id?: string;
  character_user_id?: string;
  account_type?: "creator" | "sideCharacter";
  username: string;
  display_name: string;
  permalink: string;
  profile_picture_url: string | null;
  is_character_profile: boolean;
  published_count: number | null;
  appearance_count: number | null;
  draft_count: number | null;
  created_at: string;
}

export interface CharacterAccount {
  account_id: string;
  username: string;
  display_name: string;
  profile_picture_url: string | null;
  appearance_count: number | null;
  draft_count: number | null;
}

export interface AppSettings {
  archive_name_template: string;
  enable_fetch_resume?: boolean;
  remember_fetch_date_choice?: boolean;
  remembered_date_range_preset?: DateRangePreset;
  remembered_custom_date_start?: string;
  remembered_custom_date_end?: string;
}

export interface SessionMeta {
  active_sources: SourceSelectionState;
  query: string;
  exclude_session_creator_only?: boolean;
  hide_downloaded_videos?: boolean;
  fetch_range_confirmed?: boolean;
  resume_fetch_available?: boolean;
  sort_key: VideoSortOption;
  group_by?: GroupByOption;
  date_range_preset: DateRangePreset;
  custom_date_start: string;
  custom_date_end: string;
  selected_character_account_ids: string[];
  viewer_user_id?: string;
  viewer_username?: string;
  viewer_display_name?: string;
  viewer_profile_picture_url?: string | null;
  viewer_plan_type?: string | null;
  viewer_permalink?: string;
  viewer_created_at?: string;
  viewer_character_count?: number | null;
  viewer_can_cameo?: boolean;
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
  gif_url?: string;
  playback_url: string;
  download_url?: string;
  duration_seconds: number | null;
  estimated_size_bytes: number | null;
  width: number | null;
  height: number | null;
  raw_payload_json: string;
  source_order?: number | null;
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

export type ArchiveVariant = "watermark" | "no-watermark";

export interface ArchiveWorkPlanRow extends VideoRow {
  archive_path: string;
  archive_variant: ArchiveVariant;
  archive_download_url: string;
}

export interface ArchiveWorkPlan {
  rows: ArchiveWorkPlanRow[];
  organizer_rows: ArchiveOrganizerRow[];
  supplemental_entries: ArchiveSupplementalEntry[];
  archive_name: string;
}

export type ProgressStatus = "pending" | "running" | "completed";

export interface FetchJobProgress {
  job_id: string;
  label: string;
  source: LowLevelSourceType;
  status: ProgressStatus;
  active_item_title?: string;
  fetched_rows: number;
  processed_batches: number;
  expected_total_count: number | null;
}

export interface DownloadWorkerProgress {
  worker_id: string;
  label: string;
  status: ProgressStatus;
  completed_items: number;
  active_item_label: string;
  last_completed_item_label: string;
}

export interface FetchProgressState {
  active_label: string;
  completed_jobs: number;
  processed_batches: number;
  processed_rows: number;
  running_jobs: number;
  total_jobs: number;
  job_progress: FetchJobProgress[];
}

export interface FetchJobCheckpoint {
  job_id: string;
  selection_signature: string;
  source: LowLevelSourceType;
  status: ProgressStatus;
  fetched_rows: number;
  processed_batches: number;
  cursor: string | null;
  previous_cursor: string | null;
  offset: number | null;
  endpoint_key: string | null;
  updated_at: string;
}

export interface DownloadProgressState {
  active_label: string;
  completed_items: number;
  running_workers: number;
  total_workers: number;
  total_items: number;
  worker_progress: DownloadWorkerProgress[];
}

export type GroupByOption = "none" | "creator" | "character";

export type VideoSortOption =
  | "published_newest"
  | "published_oldest"
  | "created_newest"
  | "created_oldest"
  | "title_asc"
  | "title_desc"
  | "views_most"
  | "views_fewest"
  | "likes_most"
  | "likes_fewest"
  | "remixes_most"
  | "remixes_fewest";

export interface VideoFilterState {
  query: string;
  exclude_session_creator_only: boolean;
  hide_downloaded_videos: boolean;
  date_range_preset: DateRangePreset;
  custom_date_start: string;
  custom_date_end: string;
  downloadable_only: boolean;
  downloaded_only: boolean;
  sort_key: VideoSortOption;
  group_by: GroupByOption;
}
