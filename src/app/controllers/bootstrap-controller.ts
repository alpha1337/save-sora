import { useAppStore } from "@app/store/use-app-store";
import type { BackgroundResponse, ResolveViewerIdentityResponse } from "types/background";
import { sendBackgroundRequest } from "@lib/background/client";
import { listDownloadHistoryIds } from "@lib/db/download-history-db";
import { migrateLegacyV1DataIfNeeded } from "@lib/db/legacy-v1-migration";
import { loadSessionDbSnapshot } from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";
import { stripRawPayloadFromRows } from "@lib/utils/video-row-utils";
import type { VideoSortOption } from "types/domain";

const logger = createLogger("bootstrap-controller");

/**
 * Loads the persisted session snapshot and permanent history into the global
 * store before the React app renders the working UI.
 */
export async function bootstrapAppState(): Promise<void> {
  await migrateLegacyV1DataIfNeeded();

  const [sessionSnapshot, historyIds, viewerIdentity] = await Promise.all([
    loadSessionDbSnapshot(),
    listDownloadHistoryIds(),
    resolveViewerIdentitySafe()
  ]);

  const existingSessionMeta = sessionSnapshot.session_meta ?? useAppStore.getState().session_meta;
  const hydratedSessionMeta = {
    ...existingSessionMeta,
    viewer_user_id: viewerIdentity?.user_id ?? existingSessionMeta.viewer_user_id ?? "",
    viewer_username: viewerIdentity?.username ?? existingSessionMeta.viewer_username ?? "",
    exclude_session_creator_only: existingSessionMeta.exclude_session_creator_only ?? false,
    fetch_range_confirmed: existingSessionMeta.fetch_range_confirmed ?? false,
    sort_key: normalizeSortOption(existingSessionMeta.sort_key),
    group_by: existingSessionMeta.group_by ?? "none",
    date_range_preset: existingSessionMeta.date_range_preset ?? "all",
    custom_date_start: existingSessionMeta.custom_date_start ?? "",
    custom_date_end: existingSessionMeta.custom_date_end ?? ""
  };

  const strippedRows = stripRawPayloadFromRows(sessionSnapshot.video_rows);
  const eligibleVideoIdSet = new Set(
    strippedRows
      .filter((row) => Boolean(row.is_downloadable && row.video_id))
      .map((row) => row.video_id)
  );
  const hydratedDownloadQueue = [...new Set(sessionSnapshot.download_queue.filter((videoId) => eligibleVideoIdSet.has(videoId)))];

  useAppStore.getState().hydrateState({
    settings: sessionSnapshot.settings ?? useAppStore.getState().settings,
    session_meta: hydratedSessionMeta,
    video_rows: strippedRows,
    selected_video_ids: hydratedDownloadQueue,
    download_history_ids: historyIds
  });

  logger.info("bootstrap complete", {
    historyCount: historyIds.length,
    rowCount: sessionSnapshot.video_rows.length,
    viewerUsername: hydratedSessionMeta.viewer_username
  });
}

function normalizeSortOption(value: unknown): VideoSortOption {
  if (value === "published_oldest" || value === "created_newest" || value === "created_oldest" ||
    value === "title_asc" || value === "title_desc" || value === "views_most" || value === "views_fewest" ||
    value === "likes_most" || value === "likes_fewest" || value === "remixes_most" || value === "remixes_fewest") {
    return value;
  }

  // v2 legacy sort_key compatibility
  if (value === "published_at") {
    return "published_newest";
  }
  if (value === "created_at") {
    return "created_newest";
  }
  if (value === "title") {
    return "title_asc";
  }
  if (value === "view_count") {
    return "views_most";
  }
  if (value === "like_count") {
    return "likes_most";
  }

  return "published_newest";
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
