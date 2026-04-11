import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCcw } from "lucide-react";
import { useAppStore } from "@app/store/use-app-store";
import { selectFilteredVideoRows } from "@app/store/selectors";
import { bootstrapAppState } from "@app/controllers/bootstrap-controller";
import { downloadSelectedRows } from "@app/controllers/download-controller";
import { exportSessionRowsToCsv } from "@app/controllers/export-controller";
import { clearDownloadHistoryFromSettings, updateSettings } from "@app/controllers/settings-controller";
import { Button } from "@components/atoms/button";
import { Panel } from "@components/atoms/panel";
import { ProgressBanner } from "@components/molecules/progress-banner";
import { ResultsPanel } from "@components/organisms/results-panel";
import { SettingsPanel } from "@components/organisms/settings-panel";
import { SourcePanel } from "@components/organisms/source-panel";
import { AppShellTemplate } from "@components/templates/app-shell-template";
import { createLogger } from "@lib/logging/logger";
import { clearWorkingSessionData, replaceDownloadQueue, saveSessionMeta } from "@lib/db/session-db";
import { fetchSelectedSources, loadCharacterAccountsIntoState, resolveAndAddCreatorProfile } from "@features/fetch/fetch-controller";

const logger = createLogger("app");

/**
 * App container that binds dumb components to store selectors and controllers.
 */
export function App() {
  const state = useAppStore();
  const filteredRows = useMemo(() => selectFilteredVideoRows(state), [state]);
  const visibleDownloadableIds = useMemo(
    () => filteredRows.filter((row) => row.is_downloadable && row.video_id).map((row) => row.video_id),
    [filteredRows]
  );
  const selectedVisibleRowCount = useMemo(
    () => visibleDownloadableIds.filter((videoId) => state.selected_video_ids.includes(videoId)).length,
    [state.selected_video_ids, visibleDownloadableIds]
  );
  const allVisibleSelected = visibleDownloadableIds.length > 0 && selectedVisibleRowCount === visibleDownloadableIds.length;
  const [creatorRouteInput, setCreatorRouteInput] = useState("");

  useEffect(() => {
    void bootstrapAppState().catch((error) => {
      logger.error("bootstrap failed", error);
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(() => {
    void saveSessionMeta(state.session_meta);
  }, [state.session_meta]);

  useEffect(() => {
    void replaceDownloadQueue(state.selected_video_ids);
  }, [state.selected_video_ids]);

  async function handleFetch(): Promise<void> {
    try {
      await fetchSelectedSources();
    } catch (error) {
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDownload(): Promise<void> {
    try {
      await downloadSelectedRows();
    } catch (error) {
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleAddCreatorProfile(): Promise<void> {
    try {
      await resolveAndAddCreatorProfile(creatorRouteInput.trim());
      setCreatorRouteInput("");
    } catch (error) {
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleLoadCharacterAccounts(): Promise<void> {
    try {
      await loadCharacterAccountsIntoState();
    } catch (error) {
      useAppStore.getState().setPhase("error");
      useAppStore.getState().setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleResetSession(): Promise<void> {
    await clearWorkingSessionData();
    useAppStore.getState().clearWorkingSessionState();
  }

  function handleToggleSelectAllVisibleRows(checked: boolean): void {
    if (checked) {
      state.setSelectedVideoIds([...new Set([...state.selected_video_ids, ...visibleDownloadableIds])]);
      return;
    }

    const visibleIdSet = new Set(visibleDownloadableIds);
    state.setSelectedVideoIds(state.selected_video_ids.filter((videoId) => !visibleIdSet.has(videoId)));
  }

  return (
    <AppShellTemplate
      header={
        <div className="ss-header-grid">
          <div>
            <h1>Save Sora v2</h1>
            <p className="ss-muted">Fullscreen library, normalized metadata rows, CSV export, and organizer ZIP output.</p>
          </div>
          <div className="ss-inline-actions">
            <Button disabled={state.phase === "fetching" || state.phase === "downloading"} onClick={handleFetch} type="button">
              <RefreshCcw size={16} />
              Fetch Videos
            </Button>
            <Button disabled={state.phase === "fetching" || state.phase === "downloading"} onClick={handleDownload} type="button">
              <Download size={16} />
              Build ZIP
            </Button>
          </div>
        </div>
      }
      settings={
        <SettingsPanel
          onArchiveNameTemplateChange={(value) => void updateSettings({ ...state.settings, archive_name_template: value })}
          onClearDownloadHistory={() => void clearDownloadHistoryFromSettings()}
          onResetSession={() => void handleResetSession()}
          settings={state.settings}
        />
      }
      sidebar={
        <SourcePanel
          characterAccounts={state.character_accounts}
          creatorProfiles={state.creator_profiles}
          creatorRouteInput={creatorRouteInput}
          disabled={state.phase === "fetching" || state.phase === "downloading"}
          onAddCreatorProfile={() => void handleAddCreatorProfile()}
          onCreatorRouteInputChange={setCreatorRouteInput}
          onLoadCharacterAccounts={() => void handleLoadCharacterAccounts()}
          onRemoveCreatorProfile={(profileId) => state.removeCreatorProfile(profileId)}
          onToggleCharacterAccount={(accountId, checked) => {
            const selectedIds = checked
              ? [...state.session_meta.selected_character_account_ids, accountId]
              : state.session_meta.selected_character_account_ids.filter((selectedId) => selectedId !== accountId);
            state.setSelectedCharacterAccountIds([...new Set(selectedIds)]);
          }}
          onToggleSource={(source, checked) => state.setSourceSelections({ ...state.session_meta.active_sources, [source]: checked })}
          selectedCharacterAccountIds={state.session_meta.selected_character_account_ids}
          sourceSelections={state.session_meta.active_sources}
        />
      }
    >
      <div className="ss-stack ss-stack--stretch">
        <ProgressBanner downloadProgress={state.download_progress} fetchProgress={state.fetch_progress} phase={state.phase} />
        {state.error_message ? <Panel className="ss-error-panel">{state.error_message}</Panel> : null}
        <ResultsPanel
          allVisibleSelected={allVisibleSelected}
          onDownload={() => void handleDownload()}
          onExportCsv={exportSessionRowsToCsv}
          onQueryChange={(value) => state.setFilters({ query: value })}
          onSelectAllToggle={handleToggleSelectAllVisibleRows}
          onSortKeyChange={(value) => state.setFilters({ sort_key: value })}
          onToggleSelectedVideoId={(videoId) => state.toggleSelectedVideoId(videoId)}
          query={state.session_meta.query}
          rows={filteredRows}
          selectableRowCount={visibleDownloadableIds.length}
          selectedVideoIds={state.selected_video_ids}
          selectedVisibleRowCount={selectedVisibleRowCount}
          sortKey={state.session_meta.sort_key}
        />
      </div>
    </AppShellTemplate>
  );
}
