import { create } from "zustand";
import type { AppStore } from "types/store";
import type { AppSettings, SessionMeta, SourceSelectionState, VideoFilterState, VideoRow } from "types/domain";

const defaultSourceSelectionState: SourceSelectionState = {
  profile: false,
  drafts: false,
  likes: false,
  characters: false,
  characterAccounts: false,
  creators: false
};

const defaultSettings: AppSettings = {
  archive_name_template: "save-sora-library",
  enable_fetch_resume: false,
  remember_fetch_date_choice: false,
  remembered_date_range_preset: "all",
  remembered_custom_date_start: "",
  remembered_custom_date_end: ""
};

const defaultSessionMeta: SessionMeta = {
  active_sources: defaultSourceSelectionState,
  query: "",
  exclude_session_creator_only: false,
  fetch_range_confirmed: false,
  resume_fetch_available: false,
  sort_key: "published_newest",
  group_by: "none",
  date_range_preset: "all",
  custom_date_start: "",
  custom_date_end: "",
  selected_character_account_ids: [],
  viewer_user_id: "",
  viewer_username: "",
  viewer_profile_picture_url: "",
  viewer_can_cameo: true,
  last_fetch_at: null
};

const defaultCreatorProfiles: AppStore["creator_profiles"] = [];

function createDefaultFetchProgress() {
  return {
    active_label: "",
    completed_jobs: 0,
    processed_batches: 0,
    processed_rows: 0,
    running_jobs: 0,
    total_jobs: 0,
    job_progress: []
  };
}

function createDefaultDownloadProgress() {
  return {
    active_label: "",
    completed_items: 0,
    running_workers: 0,
    total_items: 0,
    total_workers: 0,
    worker_progress: []
  };
}

function mergeRows(existingRows: VideoRow[], incomingRows: VideoRow[]): VideoRow[] {
  const rowMap = new Map(existingRows.map((row) => [row.row_id, row]));
  for (const row of incomingRows) {
    rowMap.set(row.row_id, row);
  }

  return [...rowMap.values()];
}

export const useAppStore = create<AppStore>((set) => ({
  phase: "idle",
  error_message: "",
  settings: defaultSettings,
  session_meta: defaultSessionMeta,
  creator_profiles: defaultCreatorProfiles,
  character_accounts: [],
  video_rows: [],
  selected_video_ids: [],
  download_history_ids: [],
  fetch_progress: createDefaultFetchProgress(),
  download_progress: createDefaultDownloadProgress(),
  setPhase: (phase) => set({ phase }),
  setErrorMessage: (errorMessage) => set({ error_message: errorMessage }),
  hydrateState: (payload) => set((state) => ({ ...state, ...payload })),
  setSettings: (settings) => set({ settings }),
  setSessionMeta: (sessionMeta) => set({ session_meta: sessionMeta }),
  setSourceSelections: (sourceSelections) =>
    set((state) => ({
      session_meta: {
        ...state.session_meta,
        active_sources: sourceSelections
      }
    })),
  setFilters: (filters: Partial<VideoFilterState>) =>
    set((state) => ({
      session_meta: {
        ...state.session_meta,
        query: filters.query ?? state.session_meta.query,
        exclude_session_creator_only:
          filters.exclude_session_creator_only ?? state.session_meta.exclude_session_creator_only ?? false,
        sort_key: filters.sort_key ?? state.session_meta.sort_key,
        group_by: filters.group_by ?? state.session_meta.group_by ?? "none",
        date_range_preset: filters.date_range_preset ?? state.session_meta.date_range_preset,
        custom_date_start: filters.custom_date_start ?? state.session_meta.custom_date_start,
        custom_date_end: filters.custom_date_end ?? state.session_meta.custom_date_end
      }
    })),
  setCreatorProfiles: (profiles) => set({ creator_profiles: profiles }),
  addCreatorProfile: (profile) =>
    set((state) => ({
      creator_profiles: mergeCreatorProfiles(state.creator_profiles, profile)
    })),
  removeCreatorProfile: (profileId) =>
    set((state) => ({
      creator_profiles: state.creator_profiles.filter((profile) => profile.profile_id !== profileId)
    })),
  setCharacterAccounts: (accounts) => set({ character_accounts: accounts }),
  setSelectedCharacterAccountIds: (accountIds) =>
    set((state) => ({
      session_meta: {
        ...state.session_meta,
        selected_character_account_ids: accountIds
      }
    })),
  replaceVideoRows: (rows) => set({ video_rows: rows }),
  upsertVideoRows: (rows) => set((state) => ({ video_rows: mergeRows(state.video_rows, rows) })),
  setSelectedVideoIds: (videoIds) => set({ selected_video_ids: videoIds }),
  toggleSelectedVideoId: (videoId) =>
    set((state) => ({
      selected_video_ids: state.selected_video_ids.includes(videoId)
        ? state.selected_video_ids.filter((currentId) => currentId !== videoId)
        : [...state.selected_video_ids, videoId]
    })),
  setFetchProgress: (progress) =>
    set((state) => ({ fetch_progress: { ...state.fetch_progress, ...progress } })),
  setDownloadProgress: (progress) =>
    set((state) => ({ download_progress: { ...state.download_progress, ...progress } })),
  replaceDownloadHistoryIds: (videoIds) => set({ download_history_ids: videoIds }),
  appendDownloadHistoryId: (videoId) =>
    set((state) => ({
      download_history_ids: state.download_history_ids.includes(videoId)
        ? state.download_history_ids
        : [...state.download_history_ids, videoId]
    })),
  clearWorkingSessionState: () =>
    set((state) => ({
      phase: "idle",
      error_message: "",
      session_meta: {
        ...state.session_meta,
        query: "",
        exclude_session_creator_only: false,
        fetch_range_confirmed: false,
        resume_fetch_available: false,
        sort_key: "published_newest",
        group_by: "none",
        date_range_preset: "all",
        custom_date_start: "",
        custom_date_end: "",
        last_fetch_at: null
      },
      video_rows: [],
      selected_video_ids: [],
      fetch_progress: createDefaultFetchProgress(),
      download_progress: createDefaultDownloadProgress()
    }))
}));

function mergeCreatorProfiles(existingProfiles: AppStore["creator_profiles"], nextProfile: AppStore["creator_profiles"][number]) {
  const profileMap = new Map(existingProfiles.map((profile) => [profile.profile_id, profile]));
  profileMap.set(nextProfile.profile_id, nextProfile);
  return [...profileMap.values()].sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function getDefaultSettings(): AppSettings {
  return defaultSettings;
}

export function getDefaultSessionMeta(): SessionMeta {
  return defaultSessionMeta;
}
