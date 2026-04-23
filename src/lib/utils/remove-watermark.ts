import { sendBackgroundRequest } from "@lib/background/client";
import type {
  GetSoraWatermarkFreeVideoResponse,
  GetSoraWatermarkTaskResponse
} from "types/background";

const SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;

/**
 * Requests a watermark-removal task id for a shared Sora post id.
 */
export async function getSoraWatermarkTask(video_id: string): Promise<string> {
  const videoId = video_id.trim();
  if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("getSoraWatermarkTask requires a valid s_* video id.");
  }

  const response = await sendBackgroundRequest<GetSoraWatermarkTaskResponse>({
    type: "get-sora-watermark-task",
    video_id: videoId
  });

  const taskId = response.payload.trim();
  if (!taskId) {
    throw new Error("getSoraWatermarkTask returned an empty task id.");
  }

  return taskId;
}

/**
 * Queries the watermark-removal task and returns the source URL when available.
 */
export async function getSoraWatermarkFreeVideo(task_id: string): Promise<string | null> {
  const taskId = task_id.trim();
  if (!taskId) {
    throw new Error("getSoraWatermarkFreeVideo requires a non-empty task id.");
  }

  const response = await sendBackgroundRequest<GetSoraWatermarkFreeVideoResponse>({
    type: "get-sora-watermark-free-video",
    task_id: taskId
  });

  if (typeof response.payload !== "string") {
    return null;
  }

  const resolvedUrl = response.payload.trim();
  return resolvedUrl.length > 0 ? resolvedUrl : null;
}

/**
 * Universal utility: resolve a no-watermark source URL from an s_* post id.
 */
export async function removeWatermark(video_id: string): Promise<string | null> {
  const taskId = await getSoraWatermarkTask(video_id);
  return getSoraWatermarkFreeVideo(taskId);
}
