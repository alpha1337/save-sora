import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBackgroundRequest } from "@lib/background/client";
import {
  getKontenAiMp4WatermarkSource,
  getSoraWatermarkFreeVideo,
  getSoraWatermarkTask,
  removeWatermark
} from "./remove-watermark";

vi.mock("@lib/background/client", () => ({
  sendBackgroundRequest: vi.fn()
}));

describe("remove-watermark utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks the background worker for the KontenAI mp4_wm_source", async () => {
    const videoId = "s_69e81416de6c8191a0fd3ee91461499c";
    const expectedUrl = "https://videos.openai.com/az/files/00000000-539c-7284-80ec-07117587445a%2Fraw?se=2026-04-30T03%3A00%3A00Z";

    vi.mocked(sendBackgroundRequest).mockResolvedValueOnce({ ok: true, payload: expectedUrl });

    const result = await removeWatermark(videoId);

    expect(result).toBe(expectedUrl);
    expect(sendBackgroundRequest).toHaveBeenCalledWith({
      type: "resolve-kontenai-links",
      video_id: videoId
    });
  });

  it("keeps legacy getSoraWatermarkTask -> getSoraWatermarkFreeVideo contract available", async () => {
    const videoId = "s_69e81416de6c8191a0fd3ee91461499c";
    const taskId = "f17ba846-0d21-4978-90f9-113311b7e095";
    const expectedUrl = "https://videos.openai.com/az/files/00000000-3318-7283-9725-360f90b6651e%2Fraw?se=2026-04-25T00%3A00%3A00Z";

    vi.mocked(sendBackgroundRequest)
      .mockResolvedValueOnce({ ok: true, payload: taskId })
      .mockResolvedValueOnce({ ok: true, payload: expectedUrl });

    const result = await getSoraWatermarkFreeVideo(await getSoraWatermarkTask(videoId));

    expect(result).toBe(expectedUrl);
    expect(sendBackgroundRequest).toHaveBeenNthCalledWith(1, {
      type: "get-sora-watermark-task",
      video_id: videoId
    });
    expect(sendBackgroundRequest).toHaveBeenNthCalledWith(2, {
      type: "get-sora-watermark-free-video",
      task_id: taskId
    });
  });

  it("returns null when the background worker has no KontenAI mp4_wm_source", async () => {
    vi.mocked(sendBackgroundRequest).mockResolvedValueOnce({ ok: true, payload: null });

    await expect(getKontenAiMp4WatermarkSource("s_missing_source")).resolves.toBeNull();
  });

  it("returns null without throwing for quiet background KontenAI misses", async () => {
    vi.mocked(sendBackgroundRequest).mockResolvedValueOnce({ ok: true, payload: null });

    await expect(getKontenAiMp4WatermarkSource("s_unavailable_source")).resolves.toBeNull();
  });

  it("returns null when queryTask has not produced a URL yet", async () => {
    vi.mocked(sendBackgroundRequest).mockResolvedValueOnce({ ok: true, payload: null });

    const result = await getSoraWatermarkFreeVideo("task-pending");

    expect(result).toBeNull();
    expect(sendBackgroundRequest).toHaveBeenCalledWith({
      type: "get-sora-watermark-free-video",
      task_id: "task-pending"
    });
  });

  it("rejects invalid non-s_* post ids", async () => {
    await expect(getSoraWatermarkTask("gen_01invalid")).rejects.toThrow(
      "getSoraWatermarkTask requires a valid s_* video id."
    );
    expect(sendBackgroundRequest).not.toHaveBeenCalled();
  });
});
