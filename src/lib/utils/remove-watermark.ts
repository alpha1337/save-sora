import { sendBackgroundRequest } from "@lib/background/client";
import type {
  GetSoraWatermarkFreeVideoResponse,
  GetSoraWatermarkTaskResponse
} from "types/background";

const SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
const SORA_SHARE_URL_PREFIX = "https://sora.chatgpt.com/p/";
const KONTENAI_LINKS_ENDPOINT_PREFIX = "https://api.dyysy.com/links20260207/";

interface KontenAiLinksResponse {
  links?: {
    mp4_wm_source?: unknown;
  };
}

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
  const primarySourceUrl = await getKontenAiMp4WatermarkSource(video_id);
  if (primarySourceUrl) {
    return primarySourceUrl;
  }

  // Legacy fallback disabled for this build while the links endpoint is validated.
  // const taskId = await getSoraWatermarkTask(video_id);
  // return getSoraWatermarkFreeVideo(taskId);

  return null;
}

export async function getKontenAiMp4WatermarkSource(video_id: string): Promise<string | null> {
  const videoId = video_id.trim();
  if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("getKontenAiMp4WatermarkSource requires a valid s_* video id.");
  }

  const soraShareUrl = `${SORA_SHARE_URL_PREFIX}${videoId}`;
  const response = await fetch(`${KONTENAI_LINKS_ENDPOINT_PREFIX}${encodeURIComponent(soraShareUrl)}`, {
    cache: "no-store",
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    if (isTerminalKontenAiStatus(response.status)) {
      return null;
    }
    throw new Error(`KontenAI links endpoint failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as KontenAiLinksResponse;
  return normalizeOpenAiVideoUrl(payload.links?.mp4_wm_source);
}

function isTerminalKontenAiStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 410 || status === 422;
}

function normalizeOpenAiVideoUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "videos.openai.com" || hostname.endsWith(".videos.openai.com")) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}
