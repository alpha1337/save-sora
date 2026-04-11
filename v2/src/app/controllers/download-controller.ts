import { useAppStore } from "@app/store/use-app-store";
import { appendDownloadHistoryId } from "@lib/db/download-history-db";
import { buildArchiveWorkPlan } from "@lib/archive-organizer/build-archive-work-plan";
import { downloadBlob } from "@lib/utils/download-utils";
import { replaceDownloadQueue } from "@lib/db/session-db";
import { selectSelectedVideoRows } from "@app/store/selectors";
import { createLogger } from "@lib/logging/logger";
import type { DownloadProgressState } from "types/domain";

const logger = createLogger("download-controller");

interface ZipWorkerProgressMessage {
  type: "progress";
  payload: DownloadProgressState;
}

interface ZipWorkerCompleteMessage {
  type: "complete";
  payload: {
    archive_name: string;
    blob: Blob;
  };
}

interface ZipWorkerErrorMessage {
  type: "error";
  payload: {
    error: string;
  };
}

/**
 * Builds the archive in a page-owned worker, downloads the final ZIP, and only
 * then appends the resolved ids to permanent download history.
 */
export async function downloadSelectedRows(): Promise<void> {
  const state = useAppStore.getState();
  const selectedRows = selectSelectedVideoRows(state);
  const fallbackRows = state.video_rows.filter((row) => row.is_downloadable && row.video_id);
  const targetRows = (selectedRows.length > 0 ? selectedRows : fallbackRows).filter((row) => row.is_downloadable && row.video_id);

  if (targetRows.length === 0) {
    throw new Error("Select at least one downloadable row before building the ZIP.");
  }

  state.setPhase("downloading");
  state.setDownloadProgress({
    active_label: "Preparing archive",
    completed_items: 0,
    running_workers: 0,
    total_items: targetRows.length,
    total_workers: 0,
    worker_progress: []
  });
  await replaceDownloadQueue(targetRows.map((row) => row.video_id));

  const workPlan = buildArchiveWorkPlan(targetRows, state.settings.archive_name_template);
  const worker = new Worker(new URL("../../../workers/zip.worker.ts", import.meta.url), { type: "module" });

  const archiveBlob = await new Promise<Blob>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<ZipWorkerProgressMessage | ZipWorkerCompleteMessage | ZipWorkerErrorMessage>) => {
      if (event.data.type === "progress") {
        const currentCompletedItems = useAppStore.getState().download_progress.completed_items;
        state.setDownloadProgress({
          ...event.data.payload,
          completed_items: Math.max(currentCompletedItems, event.data.payload.completed_items)
        });
        return;
      }

      if (event.data.type === "complete") {
        resolve(event.data.payload.blob);
        return;
      }

      reject(new Error(event.data.payload.error));
    });

    worker.postMessage({
      type: "build-archive",
      payload: workPlan
    });
  }).finally(() => worker.terminate());

  downloadBlob(`${workPlan.archive_name}.zip`, archiveBlob);

  for (const row of targetRows) {
    await appendDownloadHistoryId(row.video_id);
    state.appendDownloadHistoryId(row.video_id);
  }

  state.setPhase("ready");
  state.setDownloadProgress({
    active_label: "Archive ready",
    completed_items: targetRows.length,
    running_workers: 0,
    total_items: targetRows.length
  });
  logger.info("archive built", { rowCount: targetRows.length });
}
