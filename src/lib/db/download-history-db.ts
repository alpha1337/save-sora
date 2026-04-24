import { DOWNLOAD_HISTORY_STORE, openSaveSoraV3Db } from "./save-sora-v3-db";
import type { DownloadHistoryRecord } from "types/domain";

/**
 * Permanent append-only history store keyed by downloaded video ids.
 */
export async function openDownloadHistoryDb() {
  return openSaveSoraV3Db();
}

export async function listDownloadHistoryIds(): Promise<string[]> {
  const rows = await listDownloadHistoryRecords();
  return rows.map((row) => row.video_id);
}

export async function listDownloadHistoryRecords(): Promise<DownloadHistoryRecord[]> {
  const database = await openDownloadHistoryDb();
  const rows = await database.getAll(DOWNLOAD_HISTORY_STORE);
  return rows.map((row) => normalizeDownloadHistoryRecord(row)).filter((row): row is DownloadHistoryRecord => Boolean(row));
}

export async function appendDownloadHistoryId(videoId: string): Promise<void> {
  await appendDownloadHistoryRecord(videoId, null);
}

export async function appendDownloadHistoryRecord(videoId: string, noWatermarkUrl: string | null): Promise<void> {
  const database = await openDownloadHistoryDb();
  const normalizedVideoId = videoId.trim();
  if (!normalizedVideoId) {
    return;
  }
  const existingRecord = normalizeDownloadHistoryRecord(await database.get(DOWNLOAD_HISTORY_STORE, normalizedVideoId));
  const normalizedNoWatermarkUrl = normalizeOptionalUrl(noWatermarkUrl);
  await database.put(DOWNLOAD_HISTORY_STORE, {
    video_id: normalizedVideoId,
    no_watermark: normalizedNoWatermarkUrl ?? existingRecord?.no_watermark ?? null
  });
}

export async function clearDownloadHistory(): Promise<void> {
  const database = await openDownloadHistoryDb();
  await database.clear(DOWNLOAD_HISTORY_STORE);
}

function normalizeDownloadHistoryRecord(value: unknown): DownloadHistoryRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.video_id !== "string" || !record.video_id.trim()) {
    return null;
  }
  return {
    video_id: record.video_id.trim(),
    no_watermark: normalizeOptionalUrl(record.no_watermark)
  };
}

function normalizeOptionalUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
