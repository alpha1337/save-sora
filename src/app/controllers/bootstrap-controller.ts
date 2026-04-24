import { useAppStore } from "@app/store/use-app-store";
import { loadCharacterAccountsIntoState } from "@features/fetch/fetch-controller";
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
const LOGIN_REQUIRED_ERROR_MESSAGE = "Unable to verify your Sora login. Sign in to Sora, then retry.";
type BootstrapStatusReporter = (statusText: string) => void;

/**
 * Loads settings and permanent history into the global store before the React
 * app renders the working UI.
 */
export async function bootstrapAppState(reportStatus?: BootstrapStatusReporter): Promise<void> {
  reportStatus?.("Loading user data…");
  await migrateLegacyV1DataIfNeeded();

  const viewerIdentity = await resolveViewerIdentityRequired();

  reportStatus?.("Loading character data…");
  try {
    await loadCharacterAccountsIntoState();
    if (useAppStore.getState().character_accounts.length === 0) {
      reportStatus?.("Loading character data… (none found, skipping)");
    }
  } catch (error) {
    logger.warn("character account preload failed", error);
    reportStatus?.("Loading character data… (skipped)");
  }

  reportStatus?.("Loading saved creators…");
  const [savedSettings, persistedSessionState] = await Promise.all([
    loadSettings(),
    loadSessionState()
  ]);
  const savedCreatorProfiles = persistedSessionState?.creator_profiles ?? [];
  if (savedCreatorProfiles.length === 0) {
    reportStatus?.("Loading saved creators… (none found, skipping)");
  }
  reportStatus?.("Loading saved characters…");
  const savedCharacterAccountIds = persistedSessionState?.selected_character_account_ids ?? [];
  if (savedCharacterAccountIds.length === 0) {
    reportStatus?.("Loading saved characters… (none found, skipping)");
  }
  const persistedViewerSession = persistedSessionState?.user?.find(
    (userSession) => userSession.user_id === viewerIdentity.user_id
  );

  const resumeEnabled = savedSettings?.enable_fetch_resume === true;
  let cachedRows: VideoRow[] = [];
  let hasResumableFetch = false;
  if (resumeEnabled) {
    reportStatus?.("Loading previous session…");
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
  reportStatus?.(cachedRows.length > 0 ? "Loading previous session…" : "Creating session…");

  const existingState = useAppStore.getState();
  const existingSessionMeta = existingState.session_meta;
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
    viewer_display_name: viewerIdentity?.display_name ?? existingSessionMeta.viewer_display_name ?? "",
    viewer_profile_picture_url:
      viewerIdentity?.profile_picture_url ??
      existingSessionMeta.viewer_profile_picture_url ??
      "",
    viewer_plan_type: viewerIdentity?.plan_type ?? existingSessionMeta.viewer_plan_type ?? null,
    viewer_permalink: viewerIdentity?.permalink ?? existingSessionMeta.viewer_permalink ?? "",
    viewer_created_at: viewerIdentity?.created_at ?? existingSessionMeta.viewer_created_at ?? "",
    viewer_character_count:
      viewerIdentity?.character_count ?? existingSessionMeta.viewer_character_count ?? null,
    viewer_can_cameo: viewerCanCameo,
    viewer_is_onboarded: persistedViewerSession?.isOnboarded === true,
    exclude_session_creator_only: existingSessionMeta.exclude_session_creator_only ?? false,
    hide_downloaded_videos: existingSessionMeta.hide_downloaded_videos ?? true,
    fetch_range_confirmed: existingSessionMeta.fetch_range_confirmed ?? false,
    resume_fetch_available: hasResumableFetch,
    group_by: existingSessionMeta.group_by ?? "none",
    date_range_preset: existingSessionMeta.date_range_preset ?? "all",
    custom_date_start: existingSessionMeta.custom_date_start ?? "",
    custom_date_end: existingSessionMeta.custom_date_end ?? "",
    selected_character_account_ids: savedCharacterAccountIds.length > 0
      ? savedCharacterAccountIds
      : existingSessionMeta.selected_character_account_ids ?? []
  };

  existingState.hydrateState({
    settings: savedSettings ?? existingState.settings,
    creator_profiles: savedCreatorProfiles.length > 0
      ? savedCreatorProfiles
      : existingState.creator_profiles,
    session_meta: hydratedSessionMeta,
    video_rows: cachedRows
  });
  reportStatus?.("Determining downloaded videos…");
  const historyIds = await listDownloadHistoryIds();
  const selectedIds = new Set(existingState.selected_video_ids);
  const downloadedIdSet = new Set(historyIds);
  const selectedUndownloadedIds = [...selectedIds].filter((videoId) => !downloadedIdSet.has(videoId));
  useAppStore.getState().hydrateState({
    download_history_ids: historyIds,
    selected_video_ids: selectedUndownloadedIds
  });
  reportStatus?.("Loaded");

  logger.info("bootstrap complete", {
    cachedRowCount: cachedRows.length,
    cachedDownloadedCount: cachedRows.filter((row) => row.video_id && downloadedIdSet.has(row.video_id)).length,
    cachedRowFallbackLimit: resumeEnabled ? BOOTSTRAP_CACHED_ROWS_LIMIT : 0,
    characterAccountCount: useAppStore.getState().character_accounts.length,
    historyCount: historyIds.length,
    viewerUsername: hydratedSessionMeta.viewer_username
  });
}

async function resolveViewerIdentityRequired(): Promise<ResolveViewerIdentityResponse["payload"]> {
  try {
    const response = await sendBackgroundRequest<ResolveViewerIdentityResponse>({
      type: "resolve-viewer-identity"
    });
    const viewerIdentity = response.payload;
    const hasViewerUserId = typeof viewerIdentity.user_id === "string" && viewerIdentity.user_id.trim().length > 0;
    if (!hasViewerUserId) {
      throw new Error(LOGIN_REQUIRED_ERROR_MESSAGE);
    }
    return viewerIdentity;
  } catch (error) {
    logger.warn("viewer identity resolve failed", error);
    throw new Error(LOGIN_REQUIRED_ERROR_MESSAGE);
  } finally {
    try {
      await sendBackgroundRequest<BackgroundResponse>({ type: "cleanup-hidden-workers" });
    } catch (error) {
      logger.warn("hidden worker cleanup request failed", error);
    }
  }
}
