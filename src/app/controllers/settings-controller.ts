import { useAppStore } from "@app/store/use-app-store";
import type { AppSettings } from "types/domain";
import { clearDownloadHistory, listDownloadHistoryIds } from "@lib/db/download-history-db";
import { clearFetchCacheDatabase } from "@lib/db/fetch-cache-db";
import { saveSettings } from "@lib/db/session-db";

/**
 * Settings-side persistence and the only destructive entrypoint for permanent
 * download history.
 */
export async function updateSettings(nextSettings: AppSettings): Promise<void> {
  await saveSettings(nextSettings);
  useAppStore.getState().setSettings(nextSettings);
}

export async function clearDownloadHistoryFromSettings(): Promise<void> {
  await clearDownloadHistory();
  const historyIds = await listDownloadHistoryIds();
  useAppStore.getState().replaceDownloadHistoryIds(historyIds);
}

export async function clearFetchCacheFromSettings(): Promise<void> {
  if (useAppStore.getState().phase === "fetching") {
    throw new Error("Stop the active fetch before clearing cached fetch data.");
  }
  await clearFetchCacheDatabase();
  const state = useAppStore.getState();
  useAppStore.setState({
    video_rows: [],
    selected_video_ids: [],
    session_meta: {
      ...state.session_meta,
      resume_fetch_available: false
    },
    fetch_progress: {
      ...state.fetch_progress,
      active_label: "",
      completed_jobs: 0,
      processed_batches: 0,
      processed_rows: 0,
      running_jobs: 0,
      total_jobs: 0,
      job_progress: []
    }
  });
}
