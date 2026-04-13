import type {
  AppPhase,
  AppSettings,
  CharacterAccount,
  CreatorProfile,
  DownloadProgressState,
  FetchProgressState,
  SessionMeta,
  SourceSelectionState,
  VideoFilterState,
  VideoRow
} from "./domain";

/**
 * Central client state for the fullscreen v2 application.
 */
export interface AppStoreState {
  phase: AppPhase;
  error_message: string;
  settings: AppSettings;
  session_meta: SessionMeta;
  creator_profiles: CreatorProfile[];
  character_accounts: CharacterAccount[];
  video_rows: VideoRow[];
  selected_video_ids: string[];
  download_history_ids: string[];
  fetch_progress: FetchProgressState;
  download_progress: DownloadProgressState;
}

export interface AppStoreActions {
  setPhase: (phase: AppPhase) => void;
  setErrorMessage: (errorMessage: string) => void;
  hydrateState: (payload: Partial<AppStoreState>) => void;
  setSettings: (settings: AppSettings) => void;
  setSessionMeta: (sessionMeta: SessionMeta) => void;
  setSourceSelections: (sourceSelections: SourceSelectionState) => void;
  setFilters: (filters: Partial<VideoFilterState>) => void;
  setCreatorProfiles: (profiles: CreatorProfile[]) => void;
  addCreatorProfile: (profile: CreatorProfile) => void;
  removeCreatorProfile: (profileId: string) => void;
  setCharacterAccounts: (accounts: CharacterAccount[]) => void;
  setSelectedCharacterAccountIds: (accountIds: string[]) => void;
  replaceVideoRows: (rows: VideoRow[]) => void;
  upsertVideoRows: (rows: VideoRow[]) => void;
  setSelectedVideoIds: (videoIds: string[]) => void;
  toggleSelectedVideoId: (videoId: string) => void;
  setFetchProgress: (progress: Partial<FetchProgressState>) => void;
  setDownloadProgress: (progress: Partial<DownloadProgressState>) => void;
  replaceDownloadHistoryIds: (videoIds: string[]) => void;
  appendDownloadHistoryId: (videoId: string) => void;
  clearWorkingSessionState: () => void;
}

export type AppStore = AppStoreState & AppStoreActions;
