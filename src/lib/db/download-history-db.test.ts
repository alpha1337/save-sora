import { beforeEach, describe, expect, it } from "vitest";
import {
  appendDownloadHistoryId,
  appendDownloadHistoryRecord,
  clearDownloadHistory,
  listDownloadHistoryIds,
  listDownloadHistoryRecords
} from "./download-history-db";

describe("download-history-db", () => {
  beforeEach(async () => {
    await clearDownloadHistory();
  });

  it("appends video ids exactly once", async () => {
    await appendDownloadHistoryId("s_alpha123");
    await appendDownloadHistoryId("s_alpha123");
    await appendDownloadHistoryId("s_bravo456");

    await expect(listDownloadHistoryIds()).resolves.toEqual(["s_alpha123", "s_bravo456"]);
    await expect(listDownloadHistoryRecords()).resolves.toEqual([
      { video_id: "s_alpha123", no_watermark: null },
      { video_id: "s_bravo456", no_watermark: null }
    ]);
  });

  it("persists and preserves resolved no-watermark urls by video id", async () => {
    await appendDownloadHistoryRecord("s_alpha123", "https://videos.openai.com/no-watermark-alpha.mp4");
    await appendDownloadHistoryRecord("s_alpha123", null);
    await appendDownloadHistoryRecord("s_bravo456", null);

    await expect(listDownloadHistoryRecords()).resolves.toEqual([
      {
        video_id: "s_alpha123",
        no_watermark: "https://videos.openai.com/no-watermark-alpha.mp4"
      },
      {
        video_id: "s_bravo456",
        no_watermark: null
      }
    ]);
  });

  it("clears history only when the explicit clear helper is used", async () => {
    await appendDownloadHistoryId("s_charlie789");
    await clearDownloadHistory();

    await expect(listDownloadHistoryIds()).resolves.toEqual([]);
  });
});
