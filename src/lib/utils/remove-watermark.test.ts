import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBackgroundRequest } from "@lib/background/client";
import {
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
  });

  it("chains getSoraWatermarkTask -> getSoraWatermarkFreeVideo and returns the source URL", async () => {
    const videoId = "s_69e81416de6c8191a0fd3ee91461499c";
    const taskId = "f17ba846-0d21-4978-90f9-113311b7e095";
    const expectedUrl = "https://videos.openai.com/az/files/00000000-3318-7283-9725-360f90b6651e%2Fraw?se=2026-04-25T00%3A00%3A00Z&sp=r&sv=2026-02-06&sr=b&skoid=5e5fc900-07cf-43e7-ab5b-314c0d877bb0&sktid=a48cca56-e6da-484e-a814-9c849652bcb3&skt=2026-04-23T16%3A18%3A52Z&ske=2026-04-30T16%3A23%3A52Z&sks=b&skv=2026-02-06&sig=juodZCIw6eP6QB3E/d0sqqPCn2Jcl/EQlueZFVG5X7Q%3D&ac=oaisdsorprwestus2";

    vi.mocked(sendBackgroundRequest)
      .mockResolvedValueOnce({ ok: true, payload: taskId })
      .mockResolvedValueOnce({ ok: true, payload: expectedUrl });

    const result = await removeWatermark(videoId);

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
