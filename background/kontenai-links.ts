import type { ResolveKontenAiLinksResponse } from "../src/types/background";

const SORA_SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
const SORA_SHARE_URL_PREFIX = "https://sora.chatgpt.com/p/";
const KONTENAI_LINKS_ENDPOINT_PREFIX = "https://api.dyysy.com/links20260207/";

interface KontenAiLinksResponse {
  links?: {
    mp4_source?: unknown;
    mp4_wm_source?: unknown;
  };
}

export async function resolveKontenAiLinks(video_id: string): Promise<ResolveKontenAiLinksResponse["payload"]> {
  const videoId = video_id.trim();
  if (!SORA_SHARED_VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error("resolve-kontenai-links requires a valid s_* video_id.");
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
  return normalizeOpenAiVideoUrl(payload.links?.mp4_source);
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
