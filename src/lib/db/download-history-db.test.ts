import { beforeEach, describe, expect, it } from "vitest";
import { appendDownloadHistoryId, clearDownloadHistory, listDownloadHistoryIds } from "./download-history-db";

describe("download-history-db", () => {
  beforeEach(async () => {
    await clearDownloadHistory();
  });

  it("appends video ids exactly once", async () => {
    await appendDownloadHistoryId("s_alpha123");
    await appendDownloadHistoryId("s_alpha123");
    await appendDownloadHistoryId("s_bravo456");

    await expect(listDownloadHistoryIds()).resolves.toEqual(["s_alpha123", "s_bravo456"]);
  });

  it("clears history only when the explicit clear helper is used", async () => {
    await appendDownloadHistoryId("s_charlie789");
    await clearDownloadHistory();

    await expect(listDownloadHistoryIds()).resolves.toEqual([]);
  });
});
