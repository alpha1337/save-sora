import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import DatePicker from "react-datepicker";
import { useAppStore } from "@app/store/use-app-store";
import { selectFilteredVideoRows } from "@app/store/selectors";
import { bootstrapAppState } from "@app/controllers/bootstrap-controller";
import { downloadSelectedRows } from "@app/controllers/download-controller";
import { exportSessionRowsToCsv } from "@app/controllers/export-controller";
import { Button } from "@components/atoms/button";
import { CharacterAccountSelector } from "@components/molecules/character-account-selector";
import { CreatorProfileManager } from "@components/molecules/creator-profile-manager";
import { Panel } from "@components/atoms/panel";
import { SourceMultiSelectDropdown } from "@components/molecules/source-multi-select-dropdown";
import { ResultsPanel } from "@components/organisms/results-panel";
import { AppShellTemplate } from "@components/templates/app-shell-template";
import { createLogger } from "@lib/logging/logger";
import { replaceDownloadQueue, saveSessionMeta } from "@lib/db/session-db";
import { fetchSelectedSources, loadCharacterAccountsIntoState, resolveAndAddCreatorProfile } from "@features/fetch/fetch-controller";
import { getUserFacingErrorMessage } from "@lib/utils/user-facing-errors";
import type { DateRangePreset, TopLevelSourceType } from "types/domain";

const logger = createLogger("app");

/**
 * App container that binds dumb components to store selectors and controllers.
 */
export function App() {
  const state = useAppStore();
  const filteredRows = useMemo(() => selectFilteredVideoRows(state), [state]);
  const zipReadyRows = useMemo(
    () => state.video_rows.filter((row) => isZipReadyRow(row)),
    [state.video_rows]
  );
  const downloadableVideoIds = useMemo(() => [...new Set(zipReadyRows.map((row) => row.video_id))], [zipReadyRows]);
  const downloadableVideoIdSet = useMemo(() => new Set(downloadableVideoIds), [downloadableVideoIds]);
  const visibleDownloadableIds = useMemo(
    () => [...new Set(filteredRows.filter((row) => row.is_downloadable && row.video_id).map((row) => row.video_id))],
    [filteredRows]
  );
  const downloadableRowsCount = downloadableVideoIds.length;
  const selectedDownloadableRowCount = useMemo(
    () => state.selected_video_ids.filter((videoId) => downloadableVideoIdSet.has(videoId)).length,
    [downloadableVideoIdSet, state.selected_video_ids]
  );
  const selectedVisibleRowCount = useMemo(
    () => visibleDownloadableIds.filter((videoId) => state.selected_video_ids.includes(videoId)).length,
    [state.selected_video_ids, visibleDownloadableIds]
  );
  const selectedRows = useMemo(
    () => state.video_rows.filter((row) => state.selected_video_ids.includes(row.video_id) && row.is_downloadable && row.video_id),
    [state.selected_video_ids, state.video_rows]
  );
  const selectedCharacterAccountCount = useMemo(() => {
    const accountIdSet = new Set(state.character_accounts.map((account) => account.account_id));
    return state.session_meta.selected_character_account_ids.filter((accountId) => accountIdSet.has(accountId)).length;
  }, [state.character_accounts, state.session_meta.selected_character_account_ids]);
  const selectedBytes = useMemo(
    () => selectedRows.reduce((sum, row) => sum + (row.estimated_size_bytes ?? 0), 0),
    [selectedRows]
  );
  const allVisibleSelected = visibleDownloadableIds.length > 0 && selectedVisibleRowCount === visibleDownloadableIds.length;
  const isDownloading = state.phase === "downloading";
  const canBuildZip = !isDownloading && downloadableRowsCount > 0;
  const [creatorRouteInput, setCreatorRouteInput] = useState("");
  const [fetchDateModalOpen, setFetchDateModalOpen] = useState(false);
  const [fetchDatePresetDraft, setFetchDatePresetDraft] = useState<DateRangePreset>("all");
  const [fetchDateStartDraft, setFetchDateStartDraft] = useState("");
  const [fetchDateEndDraft, setFetchDateEndDraft] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const autoSelectAllDownloadableRef = useRef(true);
  const autoLoadCharacterAccountsRef = useRef(false);
  const autoSelectCharacterAccountsRef = useRef(false);

  useEffect(() => {
    void bootstrapAppState().catch((error) => {
      logger.error("bootstrap failed", error);
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(getUserFacingErrorMessage(error));
    });
  }, []);

  function setAppError(error: unknown): void {
    useAppStore.getState().setPhase("error");
    useAppStore.getState().setErrorMessage(getUserFacingErrorMessage(error));
  }

  useEffect(() => {
    void saveSessionMeta(state.session_meta);
  }, [state.session_meta]);

  useEffect(() => {
    const eligibleSelectedIds = state.selected_video_ids.filter((videoId) => downloadableVideoIdSet.has(videoId));
    void replaceDownloadQueue(eligibleSelectedIds);
  }, [downloadableVideoIdSet, state.selected_video_ids]);

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

  async function handleLoadCharacterAccounts(): Promise<void> {
    try {
      await loadCharacterAccountsIntoState();
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
    setFetchDateModalOpen(true);
  }

  async function handleFetchDateSubmit(): Promise<void> {
    if (!isFetchRangeConfigured(fetchDatePresetDraft, fetchDateStartDraft, fetchDateEndDraft)) {
      useAppStore.getState().setErrorMessage("Enter a valid custom date range to continue.");
      return;
    }

    state.setSessionMeta({
      ...state.session_meta,
      date_range_preset: fetchDatePresetDraft,
      custom_date_start: fetchDateStartDraft,
      custom_date_end: fetchDateEndDraft,
      fetch_range_confirmed: true
    });
    setFetchDateModalOpen(false);
    await handleFetch();
  }

  const showCreatorSidebar = state.session_meta.active_sources.creators;
  const showCharacterSidebar = state.session_meta.active_sources.characterAccounts;
  const hasSidebar = showCreatorSidebar || showCharacterSidebar;

  useEffect(() => {
    if (!hasSidebar && sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [hasSidebar, sidebarCollapsed]);

  useEffect(() => {
    if (!showCharacterSidebar) {
      autoLoadCharacterAccountsRef.current = false;
      return;
    }

    if (autoLoadCharacterAccountsRef.current || state.character_accounts.length > 0 || state.phase === "fetching") {
      return;
    }

    autoLoadCharacterAccountsRef.current = true;
    void loadCharacterAccountsIntoState().catch((error) => {
      setAppError(error);
    });
  }, [showCharacterSidebar, state.character_accounts.length, state.phase]);

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
            onLoadAccounts={() => void handleLoadCharacterAccounts()}
            onSetSelectedAccountIds={(accountIds) => state.setSelectedCharacterAccountIds([...new Set(accountIds)])}
            onToggleAccount={(accountId, checked) => {
              const selectedIds = checked
                ? [...state.session_meta.selected_character_account_ids, accountId]
                : state.session_meta.selected_character_account_ids.filter((selectedId) => selectedId !== accountId);
              state.setSelectedCharacterAccountIds([...new Set(selectedIds)]);
            }}
            selectedAccountIds={state.session_meta.selected_character_account_ids}
          />
        </div>
      ) : null}
    </Panel>
  ) : undefined;

  return (
    <AppShellTemplate
      sidebarCollapsed={sidebarCollapsed}
      sidebar={sidebar}
      header={
        <div className="ss-header-grid">
          <div>
            <h1>Save Sora v2.0.145</h1>
            <p className="ss-muted">Download anything on Sora, remove watermarks, export metadata and organized ZIP files.</p>
          </div>
          <div className="ss-inline-actions">
            <SourceMultiSelectDropdown
              disabled={state.phase === "fetching" || state.phase === "downloading"}
              onToggleSource={handleToggleSource}
              sourceSelections={state.session_meta.active_sources}
            />
            <Button disabled={state.phase === "fetching" || state.phase === "downloading"} onClick={openFetchDateModal} type="button">
              <RefreshCcw size={16} />
              Fetch Videos
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
          exportDisabled={isDownloading || state.video_rows.length === 0}
          hasSidebar={hasSidebar}
          hasRows={state.video_rows.length > 0}
          hasQuery={state.session_meta.query.trim().length > 0}
          phase={state.phase}
          onDownload={() => void handleDownload()}
          onExportCsv={exportSessionRowsToCsv}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          onSelectionPresetChange={handleSelectionPresetChange}
          onQueryChange={(value) => state.setFilters({ query: value })}
          onSortKeyChange={(value) => state.setFilters({ sort_key: value })}
          onGroupByChange={(value) => state.setFilters({ group_by: value })}
          onSetSelectedVideoIds={handleSetSelectedVideoIds}
          onToggleSelectedVideoId={handleToggleSelectedVideoId}
          groupBy={state.session_meta.group_by ?? "none"}
          query={state.session_meta.query}
          rows={filteredRows}
          selectableRowCount={visibleDownloadableIds.length}
          selectedDownloadableRowCount={selectedDownloadableRowCount}
          selectedBytes={selectedBytes}
          selectedVideoIds={state.selected_video_ids}
          selectedVisibleRowCount={selectedVisibleRowCount}
          sidebarCollapsed={sidebarCollapsed}
          sortKey={state.session_meta.sort_key}
          totalRowCount={state.video_rows.length}
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
    </AppShellTemplate>
  );
}

function isZipReadyRow(row: { is_downloadable: boolean; video_id: string }): boolean {
  return Boolean(row.is_downloadable && row.video_id);
}

function isFetchRangeConfigured(dateRangePreset: DateRangePreset, customDateStart: string, customDateEnd: string): boolean {
  if (dateRangePreset !== "custom") {
    return true;
  }
  if (!customDateStart.trim() || !customDateEnd.trim()) {
    return false;
  }
  return Date.parse(customDateStart) <= Date.parse(customDateEnd);
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
