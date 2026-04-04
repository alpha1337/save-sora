/**
 * Mutable popup-only state.
 *
 * The background worker remains the source of truth for scan and download data.
 * This module only tracks transient UI concerns that belong to the popup itself.
 */
export const popupState = {
  titleSaveTimers: new Map(),
  pollTimer: null,
  settingsSaveTimer: null,
  fetchStatusTimer: null,
  activeTab: "overview",
  activeFetchStatusMessage: "",
  lastRenderedSignature: "",
  lastSelectionScreenSignature: "",
  latestBusy: false,
  latestPaused: false,
  characterAccountsLoading: false,
  hasAttemptedCharacterAccountLoad: false,
  characterAccounts: [],
  selectedCharacterAccountIds: [],
  creatorProfiles: [],
  selectedCreatorProfileIds: [],
  activeSourceSelectionTab: "",
  activeCreatorResultsTab: "all",
  openCreatorActionMenuId: "",
  creatorDetailsProfileId: "",
  creatorProfileRepairKey: "",
  creatorProfileRepairPending: false,
  creatorDialogSubmitting: false,
  hasCustomOverviewSourceSelection: false,
  pendingDownloadStart: false,
  downloadOverlaySessionActive: false,
  appliedSettingsDefaults: {
    source: "",
    sort: "",
  },
  latestRenderState: {
    items: [],
    selectedKeys: [],
    titleOverrides: {},
    disableInputs: false,
    phase: "idle",
  },
  browseState: {
    query: "",
    sort: "newest",
  },
  latestSummaryContext: {
    totalCount: 0,
    selectedCount: 0,
    visibleCount: 0,
    visibleSelectedCount: 0,
    phase: "idle",
  },
};
