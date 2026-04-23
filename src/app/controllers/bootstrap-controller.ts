import { useAppStore } from "@app/store/use-app-store";
import type { BackgroundResponse, ResolveViewerIdentityResponse } from "types/background";
import { sendBackgroundRequest } from "@lib/background/client";
import { listDownloadHistoryIds } from "@lib/db/download-history-db";
import { hasResumableLatestSelectionCheckpoint, loadLatestSelectionFetchRows, loadRecentFetchRows } from "@lib/db/fetch-cache-db";
import { migrateLegacyV1DataIfNeeded } from "@lib/db/legacy-v1-migration";
import { loadSessionState, loadSettings } from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";
import { stripRawPayloadFromRows } from "@lib/utils/video-row-utils";
import type { VideoRow } from "types/domain";

const logger = createLogger("bootstrap-controller");
const BOOTSTRAP_CACHED_ROWS_LIMIT = 1_000;

/**
 * Loads settings and permanent history into the global store before the React
 * app renders the working UI.
 */
export async function bootstrapAppState(): Promise<void> {
  await migrateLegacyV1DataIfNeeded();

  const [savedSettings, persistedSessionState, historyIds, viewerIdentity] = await Promise.all([
    loadSettings(),
    loadSessionState(),
    listDownloadHistoryIds(),
    resolveViewerIdentitySafe()
  ]);
  const resumeEnabled = savedSettings?.enable_fetch_resume === true;
  let cachedRows: VideoRow[] = [];
  let hasResumableFetch = false;
  if (resumeEnabled) {
    try {
      const [latestSelectionRows, hasResumableLatestSelection] = await Promise.all([
        loadLatestSelectionFetchRows(),
        hasResumableLatestSelectionCheckpoint()
      ]);
      hasResumableFetch = hasResumableLatestSelection;
      cachedRows = latestSelectionRows.length > 0
        ? stripRawPayloadFromRows(latestSelectionRows)
        : stripRawPayloadFromRows(await loadRecentFetchRows(BOOTSTRAP_CACHED_ROWS_LIMIT));
    } catch (error) {
      logger.warn("cached fetch row hydration failed", error);
    }
  }

  const existingSessionMeta = useAppStore.getState().session_meta;
  const viewerCanCameo = viewerIdentity?.can_cameo ?? existingSessionMeta.viewer_can_cameo ?? true;
  const activeSources = {
    ...existingSessionMeta.active_sources,
    characters: viewerCanCameo ? existingSessionMeta.active_sources.characters : false
  };
  const hydratedSessionMeta = {
    ...existingSessionMeta,
    active_sources: activeSources,
    viewer_user_id: viewerIdentity?.user_id ?? existingSessionMeta.viewer_user_id ?? "",
    viewer_username: viewerIdentity?.username ?? existingSessionMeta.viewer_username ?? "",
    viewer_profile_picture_url:
      viewerIdentity?.profile_picture_url ??
      existingSessionMeta.viewer_profile_picture_url ??
      "",
    viewer_can_cameo: viewerCanCameo,
    exclude_session_creator_only: existingSessionMeta.exclude_session_creator_only ?? false,
    fetch_range_confirmed: existingSessionMeta.fetch_range_confirmed ?? false,
    resume_fetch_available: hasResumableFetch,
    group_by: existingSessionMeta.group_by ?? "none",
    date_range_preset: existingSessionMeta.date_range_preset ?? "all",
    custom_date_start: existingSessionMeta.custom_date_start ?? "",
    custom_date_end: existingSessionMeta.custom_date_end ?? "",
    selected_character_account_ids: persistedSessionState?.selected_character_account_ids ?? existingSessionMeta.selected_character_account_ids ?? []
  };

  useAppStore.getState().hydrateState({
    settings: savedSettings ?? useAppStore.getState().settings,
    creator_profiles: persistedSessionState?.creator_profiles ?? useAppStore.getState().creator_profiles,
    session_meta: hydratedSessionMeta,
    download_history_ids: historyIds,
    video_rows: cachedRows
  });

  logger.info("bootstrap complete", {
    cachedRowCount: cachedRows.length,
    cachedRowFallbackLimit: resumeEnabled ? BOOTSTRAP_CACHED_ROWS_LIMIT : 0,
    historyCount: historyIds.length,
    viewerUsername: hydratedSessionMeta.viewer_username
  });
}

async function resolveViewerIdentitySafe(): Promise<ResolveViewerIdentityResponse["payload"] | null> {
  try {
    const response = await sendBackgroundRequest<ResolveViewerIdentityResponse>({
      type: "resolve-viewer-identity"
    });
    return response.payload;
  } catch (error) {
    logger.warn("viewer identity resolve failed", error);
    return null;
  } finally {
    try {
      await sendBackgroundRequest<BackgroundResponse>({ type: "cleanup-hidden-workers" });
    } catch (error) {
      logger.warn("hidden worker cleanup request failed", error);
    }
  }
}
