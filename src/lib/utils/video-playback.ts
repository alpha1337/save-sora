import type { VideoRow } from "types/domain";

const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;

export function buildWatermarkFreePlaybackUrl(videoId: string): string {
  const trimmedVideoId = videoId.trim();
  if (!SHARED_VIDEO_ID_PATTERN.test(trimmedVideoId)) {
    return "";
  }

  return `https://soravdl.com/api/proxy/video/${encodeURIComponent(trimmedVideoId)}`;
}

export function resolvePreviewPlaybackUrl(row: Pick<VideoRow, "video_id" | "playback_url">): string {
  const watermarkFreeUrl = buildWatermarkFreePlaybackUrl(row.video_id);
  if (watermarkFreeUrl) {
    return watermarkFreeUrl;
  }

  return row.playback_url;
}
