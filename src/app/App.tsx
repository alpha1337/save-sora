import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, RefreshCcw, Settings, Trash2 } from "lucide-react";
import DatePicker from "react-datepicker";
import { useAppStore } from "@app/store/use-app-store";
import { selectFilteredVideoRows } from "@app/store/selectors";
import { bootstrapAppState } from "@app/controllers/bootstrap-controller";
import { downloadSelectedRows } from "@app/controllers/download-controller";
import { clearDownloadHistoryFromSettings, clearFetchCacheFromSettings, updateSettings } from "@app/controllers/settings-controller";
import { Button } from "@components/atoms/button";
import { Switch } from "@components/atoms/switch";
import { CharacterAccountSelector } from "@components/molecules/character-account-selector";
import { CreatorProfileManager } from "@components/molecules/creator-profile-manager";
import { Input } from "@components/atoms/input";
import { Panel } from "@components/atoms/panel";
import { SourceMultiSelectDropdown } from "@components/molecules/source-multi-select-dropdown";
import { ResultsPanel } from "@components/organisms/results-panel";
import { DownloadTakeover } from "@components/organisms/download-takeover";
import { AppShellTemplate } from "@components/templates/app-shell-template";
import { createLogger } from "@lib/logging/logger";
import { cancelActiveFetch, fetchSelectedSources, loadCharacterAccountsIntoState, resolveAndAddCreatorProfile } from "@features/fetch/fetch-controller";
import { saveSessionState } from "@lib/db/session-db";
import { getUserFacingErrorMessage } from "@lib/utils/user-facing-errors";
import type { AppSettings, DateRangePreset, TopLevelSourceType } from "types/domain";
import "./settings-modal.css";

const logger = createLogger("app");
const APP_VERSION = __APP_VERSION__;

/**
 * App container that binds dumb components to store selectors and controllers.
 */
export function App() {
  const state = useAppStore();
  const filteredRows = useMemo(() => selectFilteredVideoRows(state), [state]);
  const downloadableRowsByVideoId = useMemo(() => {
    const rowsByVideoId = new Map<string, (typeof state.video_rows)[number]>();
    for (const row of state.video_rows) {
      if (!isZipReadyRow(row) || rowsByVideoId.has(row.video_id)) {
        continue;
      }
      rowsByVideoId.set(row.video_id, row);
    }
    return rowsByVideoId;
  }, [state.video_rows]);
  const downloadableVideoIds = useMemo(() => [...downloadableRowsByVideoId.keys()], [downloadableRowsByVideoId]);
  const downloadableVideoIdSet = useMemo(() => new Set(downloadableVideoIds), [downloadableVideoIds]);
  const filteredDownloadableRows = useMemo(() => {
    const seenVideoIds = new Set<string>();
    const dedupedRows: typeof filteredRows = [];
    for (const row of filteredRows) {
      if (!isZipReadyRow(row) || seenVideoIds.has(row.video_id)) {
        continue;
      }
      seenVideoIds.add(row.video_id);
      dedupedRows.push(row);
    }
    return dedupedRows;
  }, [filteredRows]);
  const selectedDownloadableVideoIds = useMemo(() => {
    const uniqueIds = new Set<string>();
    const orderedIds: string[] = [];
    for (const videoId of state.selected_video_ids) {
      if (!videoId || uniqueIds.has(videoId) || !downloadableVideoIdSet.has(videoId)) {
        continue;
      }
      uniqueIds.add(videoId);
      orderedIds.push(videoId);
    }
    return orderedIds;
  }, [downloadableVideoIdSet, state.selected_video_ids]);
  const visibleDownloadableIds = useMemo(
    () => filteredDownloadableRows.map((row) => row.video_id),
    [filteredDownloadableRows]
  );
  const downloadableRowsCount = downloadableVideoIds.length;
  const selectedDownloadableRowCount = selectedDownloadableVideoIds.length;
  const selectedVisibleRowCount = useMemo(
    () => visibleDownloadableIds.filter((videoId) => state.selected_video_ids.includes(videoId)).length,
    [state.selected_video_ids, visibleDownloadableIds]
  );
  const selectedRows = useMemo(
    () =>
      selectedDownloadableVideoIds
        .map((videoId) => downloadableRowsByVideoId.get(videoId))
        .filter((row): row is (typeof state.video_rows)[number] => Boolean(row)),
    [downloadableRowsByVideoId, selectedDownloadableVideoIds]
  );
  const selectedCharacterAccountCount = useMemo(() => {
    const accountIdSet = new Set(state.character_accounts.map((account) => account.account_id));
    return state.session_meta.selected_character_account_ids.filter((accountId) => accountIdSet.has(accountId)).length;
  }, [state.character_accounts, state.session_meta.selected_character_account_ids]);
  const selectedCharacterAccountVideoCountOverrides = useMemo(() => {
    if (state.video_rows.length === 0 || state.character_accounts.length === 0) {
      return {};
    }

    const matcherByAccountId = new Map(
      state.character_accounts.map((account) => [
        account.account_id,
        {
          accountId: account.account_id.trim().toLowerCase(),
          displayName: normalizeCharacterLabel(account.display_name),
          username: normalizeCharacterLabel(account.username)
        }
      ])
    );
    const rowsByAccountId = new Map(state.character_accounts.map((account) => [account.account_id, new Set<string>()]));

    for (const row of state.video_rows) {
      if (
        row.source_type !== "characterAccountAppearances" &&
        row.source_type !== "characterAccountDrafts" &&
        row.source_type !== "sideCharacter"
      ) {
        continue;
      }
      const normalizedCharacterIdSet = extractCharacterAccountIdsFromRawPayload(row.raw_payload_json);
      const normalizedCharacterNameSet = new Set(
        [row.character_name, ...row.character_names]
          .map(normalizeCharacterLabel)
          .filter(Boolean)
      );
      const normalizedCharacterUsername = normalizeCharacterLabel(row.character_username);
      const rowKey = row.row_id || `${row.source_type}:${row.video_id}:${row.detail_url}`;
      for (const [accountId, matcher] of matcherByAccountId) {
        const matchesAccountId = Boolean(matcher.accountId && normalizedCharacterIdSet.has(matcher.accountId));
        const matchesUsername = Boolean(
          matcher.username &&
          (normalizedCharacterUsername === matcher.username || normalizedCharacterNameSet.has(matcher.username))
        );
        const matchesDisplayName = Boolean(matcher.displayName && normalizedCharacterNameSet.has(matcher.displayName));
        if (!matchesAccountId && !matchesUsername && !matchesDisplayName) {
          continue;
        }
        rowsByAccountId.get(accountId)?.add(rowKey);
      }
    }

    const overrides: Record<string, number> = {};
    for (const [accountId, rowIds] of rowsByAccountId) {
      overrides[accountId] = rowIds.size;
    }
    return overrides;
  }, [state.character_accounts, state.video_rows]);
  const selectedBytes = useMemo(
    () => selectedRows.reduce((sum, row) => sum + (row.estimated_size_bytes ?? 0), 0),
    [selectedRows]
  );
  const allVisibleSelected = visibleDownloadableIds.length > 0 && selectedVisibleRowCount === visibleDownloadableIds.length;
  const isFetching = state.phase === "fetching";
  const isDownloading = state.phase === "downloading";
  const canBuildZip = !isDownloading && !isFetching && downloadableRowsCount > 0;
  const canResumeFetch = state.settings.enable_fetch_resume === true && state.session_meta.resume_fetch_available === true;
  const fetchActionLabel = isFetching ? "Stop Fetch" : canResumeFetch ? "Resume Fetch" : "Fetch Videos";
  const [creatorRouteInput, setCreatorRouteInput] = useState("");
  const [fetchDateModalOpen, setFetchDateModalOpen] = useState(false);
  const [fetchDatePresetDraft, setFetchDatePresetDraft] = useState<DateRangePreset>("all");
  const [fetchDateStartDraft, setFetchDateStartDraft] = useState("");
  const [fetchDateEndDraft, setFetchDateEndDraft] = useState("");
  const [rememberFetchChoiceDraft, setRememberFetchChoiceDraft] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(state.settings);
  const [isStateHydrated, setIsStateHydrated] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const autoSelectAllDownloadableRef = useRef(true);
  const autoLoadCharacterAccountsRef = useRef(false);
  const autoSelectCharacterAccountsRef = useRef(false);

  useEffect(() => {
    void bootstrapAppState()
      .then(() => {
        setIsStateHydrated(true);
      })
      .catch((error) => {
        logger.error("bootstrap failed", error);
        useAppStore.getState().setPhase("error");
        useAppStore.getState().setErrorMessage(getUserFacingErrorMessage(error));
      });
  }, []);

  useEffect(() => {
    if (!isStateHydrated) {
      return;
    }
    void saveSessionState({
      creator_profiles: state.creator_profiles,
      selected_character_account_ids: state.session_meta.selected_character_account_ids
    }).catch((error) => {
      logger.warn("session state save failed", error);
    });
  }, [isStateHydrated, state.creator_profiles, state.session_meta.selected_character_account_ids]);

  useEffect(() => {
    if (!settingsModalOpen) {
      setSettingsDraft(state.settings);
    }
  }, [settingsModalOpen, state.settings]);

  function setAppError(error: unknown): void {
    const userFacingMessage = getUserFacingErrorMessage(error);
    if (userFacingMessage === "Fetch canceled.") {
      const currentState = useAppStore.getState();
      useAppStore.setState({
        phase: currentState.video_rows.length > 0 ? "ready" : "idle",
        error_message: ""
      });
      return;
    }
    useAppStore.getState().setPhase("error");
    useAppStore.getState().setErrorMessage(userFacingMessage);
  }

  useEffect(() => {
    if (state.video_rows.length === 0) {
      autoSelectAllDownloadableRef.current = true;
      return;
    }

    if (!autoSelectAllDownloadableRef.current) {
      return;
    }

    if (downloadableRowsCount === 0) {
      return;
    }

    const hasUnselectedDownloadableRows = [...downloadableVideoIdSet].some((videoId) => !state.selected_video_ids.includes(videoId));
    if (!hasUnselectedDownloadableRows) {
      return;
    }

    state.setSelectedVideoIds([...new Set([...state.selected_video_ids, ...downloadableVideoIdSet])]);
  }, [downloadableRowsCount, downloadableVideoIdSet, state, state.selected_video_ids, state.video_rows.length]);

  async function handleFetch(): Promise<void> {
    try {
      autoSelectAllDownloadableRef.current = true;
      await fetchSelectedSources();
    } catch (error) {
      setAppError(error);
    }
  }

  function handleCancelFetch(): void {
    cancelActiveFetch();
  }

  async function handleClearSessionResults(): Promise<void> {
    try {
      if (state.phase === "fetching" || state.phase === "downloading") {
        return;
      }
      useAppStore.getState().clearWorkingSessionState();
    } catch (error) {
      setAppError(error);
    }
  }

  async function handleDownload(): Promise<void> {
    try {
      if (selectedDownloadableRowCount === 0 && downloadableVideoIds.length > 0) {
        state.setSelectedVideoIds([...new Set([...state.selected_video_ids, ...downloadableVideoIds])]);
      }
      await downloadSelectedRows();
    } catch (error) {
      setAppError(error);
    }
  }

  async function handleAddCreatorProfile(): Promise<void> {
    try {
      await resolveAndAddCreatorProfile(creatorRouteInput.trim());
      setCreatorRouteInput("");
    } catch (error) {
      setAppError(error);
    }
  }

  function handleToggleSelectedVideoId(videoId: string): void {
    if (state.selected_video_ids.includes(videoId)) {
      autoSelectAllDownloadableRef.current = false;
    }
    state.toggleSelectedVideoId(videoId);
  }

  function handleSetSelectedVideoIds(videoIds: string[]): void {
    const currentSelected = new Set(state.selected_video_ids);
    const nextSelected = new Set(videoIds);
    const removedDownloadable = [...downloadableVideoIdSet].some((videoId) => currentSelected.has(videoId) && !nextSelected.has(videoId));
    if (removedDownloadable) {
      autoSelectAllDownloadableRef.current = false;
    }
    state.setSelectedVideoIds(videoIds);
  }

  function handleSelectionPresetChange(preset: "all_visible" | "mine" | "others" | "none"): void {
    const visibleRows = filteredRows.filter((row) => row.is_downloadable && row.video_id);
    const visibleIds = visibleRows.map((row) => row.video_id);
    const visibleSet = new Set(visibleIds);
    const viewerUsername = normalizeIdentity(state.session_meta.viewer_username ?? "");
    const mineIds = visibleRows
      .filter((row) => viewerUsername && normalizeIdentity(row.creator_username) === viewerUsername)
      .map((row) => row.video_id);
    const othersIds = visibleRows
      .filter((row) => !viewerUsername || normalizeIdentity(row.creator_username) !== viewerUsername)
      .map((row) => row.video_id);
    const hiddenSelectedIds = state.selected_video_ids.filter((videoId) => !visibleSet.has(videoId));

    if (preset === "all_visible") {
      autoSelectAllDownloadableRef.current = true;
      handleSetSelectedVideoIds([...new Set([...hiddenSelectedIds, ...visibleIds])]);
      return;
    }

    if (preset === "mine") {
      handleSetSelectedVideoIds([...new Set([...hiddenSelectedIds, ...mineIds])]);
      return;
    }

    if (preset === "others") {
      handleSetSelectedVideoIds([...new Set([...hiddenSelectedIds, ...othersIds])]);
      return;
    }

    handleSetSelectedVideoIds(hiddenSelectedIds);
  }

  function handleToggleSource(source: TopLevelSourceType, checked: boolean): void {
    state.setSourceSelections({ ...state.session_meta.active_sources, [source]: checked });
  }

  function openFetchDateModal(): void {
    setFetchDatePresetDraft(state.session_meta.date_range_preset);
    setFetchDateStartDraft(state.session_meta.custom_date_start);
    setFetchDateEndDraft(state.session_meta.custom_date_end);
    setRememberFetchChoiceDraft(state.settings.remember_fetch_date_choice === true);
    setFetchDateModalOpen(true);
  }

  function applyFetchRangeToSession(dateRangePreset: DateRangePreset, customDateStart: string, customDateEnd: string): void {
    const currentState = useAppStore.getState();
    currentState.setSessionMeta({
      ...currentState.session_meta,
      date_range_preset: dateRangePreset,
      custom_date_start: customDateStart,
      custom_date_end: customDateEnd,
      fetch_range_confirmed: true
    });
  }

  async function handleFetchAction(): Promise<void> {
    if (isFetching) {
      handleCancelFetch();
      return;
    }

    if (state.settings.remember_fetch_date_choice === true && isFetchRangeConfigured(rememberedDatePreset, rememberedCustomDateStart, rememberedCustomDateEnd)) {
      applyFetchRangeToSession(rememberedDatePreset, rememberedCustomDateStart, rememberedCustomDateEnd);
      await handleFetch();
      return;
    }

    openFetchDateModal();
  }

  async function handleFetchDateSubmit(): Promise<void> {
    if (!isFetchRangeConfigured(fetchDatePresetDraft, fetchDateStartDraft, fetchDateEndDraft)) {
      useAppStore.getState().setErrorMessage("Enter a valid custom date range to continue.");
      return;
    }

    try {
      await updateSettings({
        ...state.settings,
        remember_fetch_date_choice: rememberFetchChoiceDraft,
        remembered_date_range_preset: fetchDatePresetDraft,
        remembered_custom_date_start: fetchDateStartDraft,
        remembered_custom_date_end: fetchDateEndDraft
      });
      applyFetchRangeToSession(fetchDatePresetDraft, fetchDateStartDraft, fetchDateEndDraft);
      setFetchDateModalOpen(false);
      await handleFetch();
    } catch (error) {
      setAppError(error);
    }
  }

  function openSettingsModal(): void {
    setSettingsDraft(state.settings);
    setSettingsModalOpen(true);
  }

  async function handleSaveSettings(): Promise<void> {
    try {
      const rememberedPreset = normalizeRememberedDatePreset(settingsDraft);
      const rememberedStart = settingsDraft.remembered_custom_date_start ?? "";
      const rememberedEnd = settingsDraft.remembered_custom_date_end ?? "";
      if (!isFetchRangeConfigured(rememberedPreset, rememberedStart, rememberedEnd)) {
        useAppStore.getState().setErrorMessage("Enter a valid custom remembered date range in Settings.");
        return;
      }
      const nextArchiveNameTemplate = settingsDraft.archive_name_template.trim() || state.settings.archive_name_template;
      await updateSettings({
        ...state.settings,
        ...settingsDraft,
        archive_name_template: nextArchiveNameTemplate,
        enable_fetch_resume: settingsDraft.enable_fetch_resume === true,
        remember_fetch_date_choice: settingsDraft.remember_fetch_date_choice === true,
        remembered_date_range_preset: rememberedPreset,
        remembered_custom_date_start: rememberedStart,
        remembered_custom_date_end: rememberedEnd
      });
      setSettingsModalOpen(false);
    } catch (error) {
      setAppError(error);
    }
  }

  async function handleClearFetchDatabase(): Promise<void> {
    const isFetchActive = useAppStore.getState().phase === "fetching";
    const confirmMessage = isFetchActive
      ? "A fetch is running. Stop fetch and clear cached fetch rows and checkpoints?"
      : "Clear cached fetch rows and checkpoints?";
    if (!window.confirm(confirmMessage)) {
      return;
    }
    try {
      if (isFetchActive) {
        cancelActiveFetch();
        const didStop = await waitForFetchToStop();
        if (!didStop) {
          useAppStore.getState().setErrorMessage("Fetch is still stopping. Try clearing cache again in a moment.");
          return;
        }
      }
      await clearFetchCacheFromSettings();
    } catch (error) {
      setAppError(error);
    }
  }

  async function handleClearDownloadHistory(): Promise<void> {
    if (!window.confirm("Clear download history?")) {
      return;
    }
    try {
      await clearDownloadHistoryFromSettings();
    } catch (error) {
      setAppError(error);
    }
  }

  const showCreatorSidebar = true;
  const showCharacterSidebar = state.session_meta.active_sources.characterAccounts;
  const hasSidebar = showCreatorSidebar || showCharacterSidebar;
  const rememberedDatePreset = normalizeRememberedDatePreset(state.settings);
  const rememberedCustomDateStart = state.settings.remembered_custom_date_start ?? "";
  const rememberedCustomDateEnd = state.settings.remembered_custom_date_end ?? "";
  const settingsRememberedDatePreset = normalizeRememberedDatePreset(settingsDraft);
  const settingsRememberedCustomDateStart = settingsDraft.remembered_custom_date_start ?? "";
  const settingsRememberedCustomDateEnd = settingsDraft.remembered_custom_date_end ?? "";

  useEffect(() => {
    if (!hasSidebar && sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [hasSidebar, sidebarCollapsed]);

  useEffect(() => {
    if (autoLoadCharacterAccountsRef.current || state.character_accounts.length > 0) {
      return;
    }
    if (state.phase === "fetching" || state.phase === "downloading") {
      return;
    }

    autoLoadCharacterAccountsRef.current = true;
    void loadCharacterAccountsIntoState().catch((error) => {
      setAppError(error);
    });
  }, [state.character_accounts.length, state.phase]);

  useEffect(() => {
    if (!showCharacterSidebar || state.character_accounts.length === 0) {
      return;
    }
    if (autoSelectCharacterAccountsRef.current) {
      return;
    }

    const accountIds = state.character_accounts.map((account) => account.account_id).filter(Boolean);
    if (accountIds.length === 0) {
      return;
    }

    const selectedIdSet = new Set(state.session_meta.selected_character_account_ids);
    const selectedVisibleCount = accountIds.filter((accountId) => selectedIdSet.has(accountId)).length;
    if (selectedVisibleCount > 0) {
      autoSelectCharacterAccountsRef.current = true;
      return;
    }

    state.setSelectedCharacterAccountIds(accountIds);
    autoSelectCharacterAccountsRef.current = true;
  }, [showCharacterSidebar, state, state.character_accounts, state.session_meta.selected_character_account_ids]);

  const sidebar = hasSidebar ? (
    <Panel className="ss-stack">
      {showCreatorSidebar ? (
        <div>
          <h3>Saved Creators</h3>
          <CreatorProfileManager
            creatorProfiles={state.creator_profiles}
            creatorRouteInput={creatorRouteInput}
            disabled={state.phase === "fetching" || state.phase === "downloading"}
            onAddCreatorProfile={() => void handleAddCreatorProfile()}
            onCreatorRouteInputChange={setCreatorRouteInput}
            onRemoveCreatorProfile={(profileId) => state.removeCreatorProfile(profileId)}
          />
        </div>
      ) : null}
      {showCharacterSidebar ? (
        <div>
          <h3>{`Character Accounts (${selectedCharacterAccountCount} Selected)`}</h3>
          <CharacterAccountSelector
            accounts={state.character_accounts}
            disabled={state.phase === "fetching" || state.phase === "downloading"}
            onSetSelectedAccountIds={(accountIds) => state.setSelectedCharacterAccountIds([...new Set(accountIds)])}
            onToggleAccount={(accountId, checked) => {
              const selectedIds = checked
                ? [...state.session_meta.selected_character_account_ids, accountId]
                : state.session_meta.selected_character_account_ids.filter((selectedId) => selectedId !== accountId);
              state.setSelectedCharacterAccountIds([...new Set(selectedIds)]);
            }}
            selectedAccountIds={state.session_meta.selected_character_account_ids}
            videoCountOverrides={selectedCharacterAccountVideoCountOverrides}
          />
        </div>
      ) : null}
      <div className="ss-selected-video-id-panel">
        <h3>{`Selected Video IDs (${selectedDownloadableVideoIds.length})`}</h3>
        <textarea
          aria-label="Selected video IDs to download"
          className="ss-selected-video-id-textbox"
          placeholder="No selected downloadable video IDs yet."
          readOnly
          spellCheck={false}
          value={selectedDownloadableVideoIds.join("\n")}
          wrap="off"
        />
      </div>
    </Panel>
  ) : undefined;

  return (
    <>
      <AppShellTemplate
      sidebarCollapsed={sidebarCollapsed}
      sidebar={sidebar}
      header={
        <div className="ss-header-grid">
          <div>
            <h1>{`Save Sora v${APP_VERSION}`}</h1>
            <p className="ss-muted">Download videos from Sora and build organized ZIP files.</p>
          </div>
          <div className="ss-inline-actions">
            <SourceMultiSelectDropdown
              disabled={state.phase === "fetching" || state.phase === "downloading"}
              onToggleSource={handleToggleSource}
              showCameos={state.session_meta.viewer_can_cameo !== false}
              sourceSelections={state.session_meta.active_sources}
            />
            <Button asChild tone="secondary">
              <a href="https://ko-fi.com/savesora" rel="noreferrer noopener" target="_blank">
                <Heart size={16} />
                Donate
              </a>
            </Button>
            <Button disabled={state.phase === "fetching" || state.phase === "downloading"} onClick={() => void handleClearSessionResults()} tone="secondary" type="button">
              <Trash2 size={16} />
              Clear Results
            </Button>
            <Button
              disabled={isDownloading}
              onClick={() => void handleFetchAction()}
              tone={isFetching ? "warning" : "default"}
              type="button"
            >
              <RefreshCcw size={16} />
              {fetchActionLabel}
            </Button>
            <Button
              disabled={state.phase === "fetching" || state.phase === "downloading"}
              onClick={openSettingsModal}
              tone="secondary"
              type="button"
            >
              <Settings size={16} />
              Settings
            </Button>
          </div>
        </div>
      }
    >
      <div className="ss-stack ss-stack--stretch">
        {state.error_message ? <Panel className="ss-error-panel">{state.error_message}</Panel> : null}
        <ResultsPanel
          allVisibleSelected={allVisibleSelected}
          downloadableRowCount={downloadableRowsCount}
          downloadProgress={state.download_progress}
          fetchProgress={state.fetch_progress}
          downloadDisabled={!canBuildZip}
          hasSidebar={hasSidebar}
          hasRows={downloadableRowsCount > 0}
          hasQuery={state.session_meta.query.trim().length > 0}
          phase={state.phase}
          onDownload={() => void handleDownload()}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onSelectionPresetChange={handleSelectionPresetChange}
          onQueryChange={(value) => state.setFilters({ query: value })}
          onSortKeyChange={(value) => state.setFilters({ sort_key: value })}
          onGroupByChange={(value) => state.setFilters({ group_by: value })}
          onSetSelectedVideoIds={handleSetSelectedVideoIds}
          onToggleSelectedVideoId={handleToggleSelectedVideoId}
          groupBy={state.session_meta.group_by ?? "none"}
          query={state.session_meta.query}
          rows={filteredDownloadableRows}
          selectableRowCount={visibleDownloadableIds.length}
          selectedDownloadableRowCount={selectedDownloadableRowCount}
          selectedBytes={selectedBytes}
          selectedVideoIds={state.selected_video_ids}
          selectedVisibleRowCount={selectedVisibleRowCount}
          sidebarCollapsed={sidebarCollapsed}
          sortKey={state.session_meta.sort_key}
          totalRowCount={downloadableRowsCount}
        />
      </div>
      <Dialog.Root onOpenChange={setFetchDateModalOpen} open={fetchDateModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ss-dialog-overlay" />
          <Dialog.Content className="ss-dialog-content">
            <Dialog.Title>Choose Fetch Date Range</Dialog.Title>
            <Dialog.Description>
              Select the time window for this fetch run, then submit to continue.
            </Dialog.Description>
            <div className="ss-stack">
              <div className="ss-date-preset-grid" role="radiogroup" aria-label="Fetch date range presets">
                {[
                  { label: "Today", value: "24h" },
                  { label: "This week", value: "7d" },
                  { label: "Last 30 days", value: "1m" },
                  { label: "Last 3 months", value: "3m" },
                  { label: "All time", value: "all" },
                  { label: "Custom", value: "custom" }
                ].map((option) => (
                  <button
                    aria-checked={fetchDatePresetDraft === option.value}
                    className="ss-date-preset-button"
                    data-selected={fetchDatePresetDraft === option.value}
                    key={option.value}
                    onClick={() => setFetchDatePresetDraft(option.value as DateRangePreset)}
                    role="radio"
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {fetchDatePresetDraft === "custom" ? (
                <div className="ss-date-picker-row">
                  <DatePicker
                    calendarClassName="ss-react-datepicker"
                    className="ss-input"
                    dateFormat="yyyy-MM-dd"
                    onChange={(value: Date | null) => setFetchDateStartDraft(formatDateInput(value))}
                    placeholderText="Start date"
                    selected={parseDateInput(fetchDateStartDraft)}
                  />
                  <DatePicker
                    calendarClassName="ss-react-datepicker"
                    className="ss-input"
                    dateFormat="yyyy-MM-dd"
                    minDate={parseDateInput(fetchDateStartDraft)}
                    onChange={(value: Date | null) => setFetchDateEndDraft(formatDateInput(value))}
                    placeholderText="End date"
                    selected={parseDateInput(fetchDateEndDraft)}
                  />
                </div>
              ) : null}
              <div className="ss-settings-toggle-card ss-settings-toggle-card--compact">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Remember this choice?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={rememberFetchChoiceDraft ? "enabled" : "disabled"}
                    >
                      {rememberFetchChoiceDraft ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Remember selected fetch date range"
                    checked={rememberFetchChoiceDraft}
                    id="fetch-date-remember-choice"
                    onCheckedChange={setRememberFetchChoiceDraft}
                  />
                </div>
                <p className="ss-muted">If enabled, future fetches will skip this dialog and use the saved range.</p>
              </div>
            </div>
            <div className="ss-inline-actions ss-dialog-footer-actions">
              <Dialog.Close asChild>
                <Button tone="secondary" type="button">Cancel</Button>
              </Dialog.Close>
              <Button
                disabled={!isFetchRangeConfigured(fetchDatePresetDraft, fetchDateStartDraft, fetchDateEndDraft)}
                onClick={() => void handleFetchDateSubmit()}
                type="button"
              >
                Submit and Fetch
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root onOpenChange={setSettingsModalOpen} open={settingsModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ss-dialog-overlay" />
          <Dialog.Content className="ss-dialog-content">
            <Dialog.Title className="ss-settings-modal-title">Settings</Dialog.Title>
            <Dialog.Description>
              What would you like your zip file to be named?
            </Dialog.Description>
            <div className="ss-stack">
              <label className="ss-stack">
                <span className="ss-settings-name-label">ZIP file name</span>
                <Input
                  onChange={(event) =>
                    setSettingsDraft((current) => ({
                      ...current,
                      archive_name_template: event.target.value
                    }))
                  }
                  value={settingsDraft.archive_name_template}
                />
              </label>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Enable Database?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={settingsDraft.enable_fetch_resume === true ? "enabled" : "disabled"}
                    >
                      {settingsDraft.enable_fetch_resume === true ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Enable database cache and resume checkpoints"
                    checked={settingsDraft.enable_fetch_resume === true}
                    id="settings-enable-fetch-resume"
                    onCheckedChange={(checked) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        enable_fetch_resume: checked
                      }))
                    }
                  />
                </div>
                <p className="ss-muted">Loads saved rows and resumes checkpoints.</p>
              </div>
              <div className="ss-settings-toggle-card">
                <div className="ss-settings-toggle-row">
                  <div className="ss-settings-toggle-copy">
                    <span className="ss-settings-toggle-label">Remember fetch date?</span>
                    <span
                      className="ss-settings-toggle-status"
                      data-state={settingsDraft.remember_fetch_date_choice === true ? "enabled" : "disabled"}
                    >
                      {settingsDraft.remember_fetch_date_choice === true ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <Switch
                    ariaLabel="Remember selected fetch date range and skip date prompt"
                    checked={settingsDraft.remember_fetch_date_choice === true}
                    id="settings-remember-fetch-date-choice"
                    onCheckedChange={(checked) =>
                      setSettingsDraft((current) => ({
                        ...current,
                        remember_fetch_date_choice: checked
                      }))
                    }
                  />
                </div>
                <p className="ss-muted">Select the saved range used when the fetch date prompt is skipped.</p>
                <div className="ss-date-preset-grid" aria-label="Remembered fetch date range" role="radiogroup">
                  {[
                    { label: "Today", value: "24h" },
                    { label: "This week", value: "7d" },
                    { label: "Last 30 days", value: "1m" },
                    { label: "Last 3 months", value: "3m" },
                    { label: "All time", value: "all" },
                    { label: "Custom", value: "custom" }
                  ].map((option) => (
                    <button
                      aria-checked={settingsRememberedDatePreset === option.value}
                      className="ss-date-preset-button"
                      data-selected={settingsRememberedDatePreset === option.value}
                      key={`settings-${option.value}`}
                      onClick={() =>
                        setSettingsDraft((current) => ({
                          ...current,
                          remembered_date_range_preset: option.value as DateRangePreset
                        }))
                      }
                      role="radio"
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {settingsRememberedDatePreset === "custom" ? (
                  <div className="ss-date-picker-row">
                    <DatePicker
                      calendarClassName="ss-react-datepicker"
                      className="ss-input"
                      dateFormat="yyyy-MM-dd"
                      onChange={(value: Date | null) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          remembered_custom_date_start: formatDateInput(value)
                        }))
                      }
                      placeholderText="Start date"
                      selected={parseDateInput(settingsRememberedCustomDateStart)}
                    />
                    <DatePicker
                      calendarClassName="ss-react-datepicker"
                      className="ss-input"
                      dateFormat="yyyy-MM-dd"
                      minDate={parseDateInput(settingsRememberedCustomDateStart)}
                      onChange={(value: Date | null) =>
                        setSettingsDraft((current) => ({
                          ...current,
                          remembered_custom_date_end: formatDateInput(value)
                        }))
                      }
                      placeholderText="End date"
                      selected={parseDateInput(settingsRememberedCustomDateEnd)}
                    />
                  </div>
                ) : null}
              </div>
              <div className="ss-settings-actions-row">
                <Button onClick={() => void handleClearFetchDatabase()} tone="warning" type="button">
                  <Trash2 size={16} />
                  Clear Fetch Database
                </Button>
                <Button onClick={() => void handleClearDownloadHistory()} tone="danger" type="button">
                  <Trash2 size={16} />
                  Clear Download History
                </Button>
              </div>
            </div>
            <div className="ss-settings-actions-row">
              <Dialog.Close asChild>
                <Button tone="secondary" type="button">Cancel</Button>
              </Dialog.Close>
              <Button onClick={() => void handleSaveSettings()} type="button">
                Save Settings
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      </AppShellTemplate>
      <DownloadTakeover
        downloadProgress={state.download_progress}
        selectedBytes={selectedBytes}
        visible={state.phase === "downloading"}
      />
    </>
  );
}

function normalizeCharacterLabel(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function extractCharacterAccountIdsFromRawPayload(rawPayloadJson: string): Set<string> {
  if (!rawPayloadJson.trim()) {
    return new Set<string>();
  }

  const normalizedIds = new Set<string>();
  const idMatches = rawPayloadJson.match(/ch_[A-Za-z0-9]+/g) ?? [];
  for (const idMatch of idMatches) {
    normalizedIds.add(idMatch.toLowerCase());
  }
  return normalizedIds;
}

function isZipReadyRow(row: { is_downloadable: boolean; video_id: string }): boolean {
  return Boolean(row.is_downloadable && row.video_id);
}

function isFetchRangeConfigured(dateRangePreset: DateRangePreset, customDateStart: string, customDateEnd: string): boolean {
  if (dateRangePreset !== "custom") {
    return true;
  }
  const parsedStart = parseDateInput(customDateStart);
  const parsedEnd = parseDateInput(customDateEnd);
  if (!parsedStart || !parsedEnd) {
    return false;
  }
  return parsedStart.getTime() <= parsedEnd.getTime();
}

function normalizeRememberedDatePreset(settings: AppSettings): DateRangePreset {
  const preset = settings.remembered_date_range_preset;
  if (
    preset === "24h" ||
    preset === "7d" ||
    preset === "1m" ||
    preset === "3m" ||
    preset === "all" ||
    preset === "custom"
  ) {
    return preset;
  }
  return "all";
}

function parseDateInput(value: string): Date | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateInput(value: Date | null): string {
  if (!value) {
    return "";
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

async function waitForFetchToStop(timeoutMs = 10000): Promise<boolean> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    if (useAppStore.getState().phase !== "fetching") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return useAppStore.getState().phase !== "fetching";
}
