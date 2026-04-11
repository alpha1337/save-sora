import { useAppStore } from "@app/store/use-app-store";
import type { AppSettings } from "types/domain";
import { clearDownloadHistory, listDownloadHistoryIds } from "@lib/db/download-history-db";
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
