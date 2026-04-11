import { useAppStore } from "@app/store/use-app-store";
import { listDownloadHistoryIds } from "@lib/db/download-history-db";
import { loadSessionDbSnapshot } from "@lib/db/session-db";
import { createLogger } from "@lib/logging/logger";

const logger = createLogger("bootstrap-controller");

/**
 * Loads the persisted session snapshot and permanent history into the global
 * store before the React app renders the working UI.
 */
export async function bootstrapAppState(): Promise<void> {
  const [sessionSnapshot, historyIds] = await Promise.all([loadSessionDbSnapshot(), listDownloadHistoryIds()]);

  useAppStore.getState().hydrateState({
    settings: sessionSnapshot.settings ?? useAppStore.getState().settings,
    session_meta: sessionSnapshot.session_meta ?? useAppStore.getState().session_meta,
    video_rows: sessionSnapshot.video_rows,
    selected_video_ids: sessionSnapshot.download_queue,
    download_history_ids: historyIds
  });

  logger.info("bootstrap complete", {
    historyCount: historyIds.length,
    rowCount: sessionSnapshot.video_rows.length
  });
}
