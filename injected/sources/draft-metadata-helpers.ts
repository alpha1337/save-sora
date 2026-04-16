import { extractSharedVideoId, pickFirstString, resolveSharedVideoIdFromValue } from "../lib/shared";

const SHARED_VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;

export function getDraftKind(row: Record<string, unknown>): string {
  return pickFirstString([
    row.kind,
    (row.draft as Record<string, unknown> | undefined)?.kind,
    (row.item as Record<string, unknown> | undefined)?.kind,
    (row.data as Record<string, unknown> | undefined)?.kind,
    (row.output as Record<string, unknown> | undefined)?.kind
  ]);
}

export function isDraftOutputBlocked(row: Record<string, unknown>): boolean {
  return pickFirstBoolean([
    row.output_blocked,
    row.outputBlocked,
    (row.output as Record<string, unknown> | undefined)?.output_blocked,
    (row.output as Record<string, unknown> | undefined)?.outputBlocked,
    row.content_violation,
    row.contentViolation,
    (row.output as Record<string, unknown> | undefined)?.content_violation,
    (row.output as Record<string, unknown> | undefined)?.contentViolation
  ]);
}

export function hasDraftFailureState(row: Record<string, unknown>): boolean {
  const failureText = pickFirstString([
    row.status,
    row.state,
    row.error,
    row.error_code,
    row.errorCode,
    row.error_message,
    row.errorMessage,
    (row.output as Record<string, unknown> | undefined)?.status,
    (row.output as Record<string, unknown> | undefined)?.state,
    (row.output as Record<string, unknown> | undefined)?.error,
    (row.output as Record<string, unknown> | undefined)?.error_code,
    (row.output as Record<string, unknown> | undefined)?.errorCode,
    (row.output as Record<string, unknown> | undefined)?.error_message,
    (row.output as Record<string, unknown> | undefined)?.errorMessage
  ]).toLowerCase();
  return /error|failed|blocked|violation/.test(failureText);
}

export function extractEstimatedSizeBytesFromAnyRecord(record: Record<string, unknown>): number | null {
  const candidates: unknown[] = [
    record.size_bytes,
    record.sizeBytes,
    record.file_size,
    record.fileSize,
    record.filesize
  ];
  const attachments = getNestedObjectArrays(record);
  for (const attachment of attachments) {
    candidates.push(
      attachment.size_bytes,
      attachment.sizeBytes,
      attachment.file_size,
      attachment.fileSize,
      attachment.filesize
    );
    const encodings = attachment.encodings && typeof attachment.encodings === "object"
      ? attachment.encodings as Record<string, unknown>
      : null;
    const source = encodings?.source && typeof encodings.source === "object"
      ? encodings.source as Record<string, unknown>
      : null;
    const sourceWm = encodings?.source_wm && typeof encodings.source_wm === "object"
      ? encodings.source_wm as Record<string, unknown>
      : null;
    const md = encodings?.md && typeof encodings.md === "object"
      ? encodings.md as Record<string, unknown>
      : null;
    candidates.push(source?.size, sourceWm?.size, md?.size);
  }
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

export function extractThumbnailUrlFromAnyRecord(record: Record<string, unknown>): string {
  const directCandidates = [record.thumbnail_url, record.thumbnailUrl, record.preview_image_url, record.previewImageUrl, record.poster_url, record.posterUrl, record.image_url, record.imageUrl];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  const attachments = getNestedObjectArrays(record);
  for (const attachment of attachments) {
    const attachmentCandidates = [attachment.thumbnail_url, attachment.thumbnailUrl, attachment.preview_image_url, attachment.previewImageUrl, attachment.poster_url, attachment.posterUrl, attachment.image_url, attachment.imageUrl];
    for (const candidate of attachmentCandidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }
  }
  return "";
}

export function extractPlaybackUrlFromAnyRecord(record: Record<string, unknown>): string {
  const directPlayback = pickFirstString([
    record.resolved_playback_url,
    record.resolvedPlaybackUrl,
    record.downloadable_url,
    record.downloadableUrl
  ]);
  if (directPlayback) {
    return directPlayback;
  }

  const directDownloadUrls = record.download_urls && typeof record.download_urls === "object"
    ? record.download_urls as Record<string, unknown>
    : null;
  const directDownloadUrlsCamel = record.downloadUrls && typeof record.downloadUrls === "object"
    ? record.downloadUrls as Record<string, unknown>
    : null;
  const directDownloadPlayback = pickFirstString([
    directDownloadUrls?.no_watermark,
    directDownloadUrlsCamel?.no_watermark,
    directDownloadUrls?.watermark,
    directDownloadUrlsCamel?.watermark,
    directDownloadUrls?.endcard_watermark,
    directDownloadUrlsCamel?.endcard_watermark
  ]);
  if (directDownloadPlayback) {
    return directDownloadPlayback;
  }

  const directEncodings = record.encodings && typeof record.encodings === "object"
    ? record.encodings as Record<string, unknown>
    : null;
  const directSourceWm = directEncodings?.source_wm && typeof directEncodings.source_wm === "object"
    ? directEncodings.source_wm as Record<string, unknown>
    : null;
  const directSource = directEncodings?.source && typeof directEncodings.source === "object"
    ? directEncodings.source as Record<string, unknown>
    : null;
  const directMd = directEncodings?.md && typeof directEncodings.md === "object"
    ? directEncodings.md as Record<string, unknown>
    : null;
  const directLd = directEncodings?.ld && typeof directEncodings.ld === "object"
    ? directEncodings.ld as Record<string, unknown>
    : null;
  const directEncodingPlayback = pickFirstString([directSourceWm?.path, directSource?.path, directMd?.path, directLd?.path]);
  if (directEncodingPlayback) {
    return directEncodingPlayback;
  }

  const attachments = getNestedObjectArrays(record);
  for (const attachment of attachments) {
    const attachmentDownloadUrls = attachment.download_urls && typeof attachment.download_urls === "object"
      ? attachment.download_urls as Record<string, unknown>
      : null;
    const attachmentDownloadUrlsCamel = attachment.downloadUrls && typeof attachment.downloadUrls === "object"
      ? attachment.downloadUrls as Record<string, unknown>
      : null;
    const attachmentEncodings = attachment.encodings && typeof attachment.encodings === "object"
      ? attachment.encodings as Record<string, unknown>
      : null;
    const attachmentSourceWm = attachmentEncodings?.source_wm && typeof attachmentEncodings.source_wm === "object"
      ? attachmentEncodings.source_wm as Record<string, unknown>
      : null;
    const attachmentSource = attachmentEncodings?.source && typeof attachmentEncodings.source === "object"
      ? attachmentEncodings.source as Record<string, unknown>
      : null;
    const attachmentMd = attachmentEncodings?.md && typeof attachmentEncodings.md === "object"
      ? attachmentEncodings.md as Record<string, unknown>
      : null;
    const attachmentLd = attachmentEncodings?.ld && typeof attachmentEncodings.ld === "object"
      ? attachmentEncodings.ld as Record<string, unknown>
      : null;

    const attachmentPlayback = pickFirstString([
      attachment.resolved_playback_url,
      attachment.resolvedPlaybackUrl,
      attachment.downloadable_url,
      attachment.downloadableUrl,
      attachmentDownloadUrls?.no_watermark,
      attachmentDownloadUrlsCamel?.no_watermark,
      attachmentDownloadUrls?.watermark,
      attachmentDownloadUrlsCamel?.watermark,
      attachmentDownloadUrls?.endcard_watermark,
      attachmentDownloadUrlsCamel?.endcard_watermark,
      attachmentSourceWm?.path,
      attachmentSource?.path,
      attachment.url,
      attachmentMd?.path,
      attachmentLd?.path
    ]);
    if (attachmentPlayback) {
      return attachmentPlayback;
    }
  }

  return pickFirstString([record.url]);
}

export function resolveExistingDraftVideoId(row: Record<string, unknown>): string {
  const resolvedVideoId = pickFirstString([
    row.resolved_video_id,
    row.resolvedVideoId,
    extractSharedVideoId(row.resolved_share_url),
    extractSharedVideoId(row.resolvedShareUrl)
  ]);
  if (SHARED_VIDEO_ID_PATTERN.test(resolvedVideoId)) {
    return resolvedVideoId;
  }

  const draftRecord = row.draft && typeof row.draft === "object" ? row.draft as Record<string, unknown> : null;
  const postObject = row.post && typeof row.post === "object" ? row.post : null;
  const draftPostObject = draftRecord?.post && typeof draftRecord.post === "object" ? draftRecord.post : null;

  const directVideoId = pickFirstString([
    getDirectSharedVideoId(row),
    draftRecord ? getDirectSharedVideoId(draftRecord) : "",
    postObject ? resolveSharedVideoIdFromValue(postObject) : "",
    draftPostObject ? resolveSharedVideoIdFromValue(draftPostObject) : "",
    postObject && typeof (postObject as Record<string, unknown>).post === "object"
      ? resolveSharedVideoIdFromValue((postObject as Record<string, unknown>).post)
      : "",
    draftPostObject && typeof (draftPostObject as Record<string, unknown>).post === "object"
      ? resolveSharedVideoIdFromValue((draftPostObject as Record<string, unknown>).post)
      : "",
    getSharedVideoIdFromOutputArrays(row),
    draftRecord ? getSharedVideoIdFromOutputArrays(draftRecord) : ""
  ]);

  return SHARED_VIDEO_ID_PATTERN.test(directVideoId) ? directVideoId : "";
}

function getNestedObjectArrays(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const keys = ["attachments", "outputs", "media", "assets", "files", "videos", "entries", "nodes", "results", "clips"];
  const nested: Array<Record<string, unknown>> = [];
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (entry && typeof entry === "object") {
        nested.push(entry as Record<string, unknown>);
      }
    }
  }
  return nested;
}

function getDirectSharedVideoId(record: Record<string, unknown>): string {
  const recordId = typeof record.id === "string" ? record.id : "";
  return pickFirstString([
    record.shared_post_id,
    record.sharedPostId,
    record.post_id,
    record.postId,
    record.public_id,
    record.publicId,
    record.share_id,
    record.shareId,
    record.video_id,
    record.videoId,
    SHARED_VIDEO_ID_PATTERN.test(recordId) ? recordId : "",
    extractSharedVideoId(record.permalink),
    extractSharedVideoId(record.detail_url),
    extractSharedVideoId(record.detailUrl),
    extractSharedVideoId(record.share_url),
    extractSharedVideoId(record.shareUrl),
    extractSharedVideoId(record.public_url),
    extractSharedVideoId(record.publicUrl),
    extractSharedVideoId(record.url)
  ]);
}

function getSharedVideoIdFromOutputArrays(record: Record<string, unknown>): string {
  for (const key of ["attachments", "outputs", "media", "assets", "files", "videos", "entries", "nodes", "results", "clips"]) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }
    const match = resolveSharedVideoIdFromValue(value);
    if (SHARED_VIDEO_ID_PATTERN.test(match)) {
      return match;
    }
  }
  return "";
}

function pickFirstBoolean(candidates: unknown[]): boolean {
  for (const candidate of candidates) {
    if (typeof candidate === "boolean") {
      return candidate;
    }
  }
  return false;
}
