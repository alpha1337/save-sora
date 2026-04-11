import type { LowLevelSourceType, SourceBucket, VideoRow } from "types/domain";
import { compactWhitespace, sanitizeFileNamePart, slugify, uniqueStrings } from "@lib/utils/string-utils";

const VIDEO_ID_PATTERN = /^s_[A-Za-z0-9_-]+$/;
const GENERATION_ID_PATTERN = /^gen_[A-Za-z0-9_-]+$/;

/**
 * Generic extraction helpers used by the per-source normalizers.
 */
export function pickFirstString(candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

export function pickFirstNumber(candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    const numericValue = Number(candidate);
    if (Number.isFinite(numericValue)) {
      return numericValue;
    }
  }

  return null;
}

export function pickFirstArray<T>(candidates: unknown[]): T[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as T[];
    }
  }

  return [];
}

export function getCandidateObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const row = value as Record<string, unknown>;
  return [
    row.post,
    row.item,
    row.data,
    row.output,
    row.result,
    row.generation,
    row.asset,
    row.entry,
    row.content,
    row.payload,
    row.object,
    row.target,
    row.entity,
    row.node,
    row.card,
    row
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object");
}

export function getNestedArrays(value: Record<string, unknown>): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const arrayCandidates = [
    value.attachments,
    value.outputs,
    value.media,
    value.assets,
    value.files,
    value.videos,
    value.entries,
    value.nodes,
    value.results,
    value.clips
  ];

  for (const candidate of arrayCandidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const entry of candidate) {
      if (entry && typeof entry === "object") {
        entries.push(entry as Record<string, unknown>);
      }
    }
  }

  return entries;
}

export function normalizeAbsoluteUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    return new URL(value, window.location.origin).toString();
  } catch (_error) {
    return "";
  }
}

export function extractPostIdFromUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmedValue = value.trim();
  const match = trimmedValue.match(/\/(?:p|video)\/(s_[A-Za-z0-9_-]+)/i) ?? trimmedValue.match(/\/(gen_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}

export function getVideoIdFromValue(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = getCandidateObjects(record);
  const directId = pickFirstString([
    record.shared_post_id,
    record.sharedPostId,
    record.post_id,
    record.postId,
    record.public_id,
    record.publicId,
    record.share_id,
    record.shareId,
    extractPostIdFromUrl(record.permalink),
    extractPostIdFromUrl(record.detail_url),
    extractPostIdFromUrl(record.detailUrl),
    extractPostIdFromUrl(record.public_url),
    extractPostIdFromUrl(record.publicUrl),
    extractPostIdFromUrl(record.share_url),
    extractPostIdFromUrl(record.shareUrl),
    extractPostIdFromUrl(record.url),
    record.id,
    ...candidateObjects.flatMap((candidate) => [
      candidate.shared_post_id,
      candidate.sharedPostId,
      candidate.post_id,
      candidate.postId,
      candidate.public_id,
      candidate.publicId,
      candidate.share_id,
      candidate.shareId,
      extractPostIdFromUrl(candidate.permalink),
      extractPostIdFromUrl(candidate.detail_url),
      extractPostIdFromUrl(candidate.detailUrl),
      extractPostIdFromUrl(candidate.public_url),
      extractPostIdFromUrl(candidate.publicUrl),
      extractPostIdFromUrl(candidate.share_url),
      extractPostIdFromUrl(candidate.shareUrl),
      extractPostIdFromUrl(candidate.url),
      candidate.id
    ]),
    ...getAttachmentObjects(record).flatMap((attachment) => [
      extractPostIdFromUrl(attachment.permalink),
      extractPostIdFromUrl(attachment.detail_url),
      extractPostIdFromUrl(attachment.detailUrl),
      extractPostIdFromUrl(attachment.public_url),
      extractPostIdFromUrl(attachment.publicUrl),
      extractPostIdFromUrl(attachment.share_url),
      extractPostIdFromUrl(attachment.shareUrl),
      extractPostIdFromUrl(attachment.downloadable_url),
      extractPostIdFromUrl(attachment.downloadableUrl),
      extractPostIdFromUrl(attachment.url)
    ])
  ]);

  return VIDEO_ID_PATTERN.test(directId) ? directId : "";
}

export function getDraftGenerationId(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const generationId = pickFirstString([
    record.generation_id,
    record.generationId,
    record.id,
    record.task_id,
    record.taskId,
    getDraftGenerationId(record.generation),
    getDraftGenerationId(record.output),
    getDraftGenerationId(record.result),
    getDraftGenerationId(record.draft),
    getDraftGenerationId(record.item),
    getDraftGenerationId(record.data)
  ]);

  return GENERATION_ID_PATTERN.test(generationId) ? generationId : "";
}

export function getRowPostId(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = getCandidateObjects(record);
  return pickFirstString([
    getVideoIdFromValue(record),
    record.id,
    record.post_id,
    record.postId,
    record.public_id,
    record.publicId,
    getDraftGenerationId(record),
    extractPostIdFromUrl(record.permalink),
    extractPostIdFromUrl(record.detail_url),
    extractPostIdFromUrl(record.detailUrl),
    extractPostIdFromUrl(record.url),
    ...candidateObjects.flatMap((candidate) => [
      candidate.id,
      candidate.post_id,
      candidate.postId,
      candidate.public_id,
      candidate.publicId,
      getDraftGenerationId(candidate),
      extractPostIdFromUrl(candidate.permalink),
      extractPostIdFromUrl(candidate.detail_url),
      extractPostIdFromUrl(candidate.detailUrl),
      extractPostIdFromUrl(candidate.url)
    ])
  ]);
}

function normalizeTimestampValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date((value > 1e12 ? value : value * 1000)).toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmedValue = value.trim();
  const numericValue = Number(trimmedValue);
  if (Number.isFinite(numericValue)) {
    return new Date((numericValue > 1e12 ? numericValue : numericValue * 1000)).toISOString();
  }

  const parsedValue = Date.parse(trimmedValue);
  if (Number.isFinite(parsedValue)) {
    return new Date(parsedValue).toISOString();
  }

  return trimmedValue;
}

function pickFirstTimestamp(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const normalizedTimestamp = normalizeTimestampValue(candidate);
    if (normalizedTimestamp) {
      return normalizedTimestamp;
    }
  }

  return null;
}

export function getTextValue(value: unknown, fieldNames: string[]): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = getCandidateObjects(record);
  const nestedCandidateObjects = candidateObjects.flatMap((candidate) => getCandidateObjects(candidate));
  const attachmentObjects = getAttachmentObjects(record);
  const candidates = fieldNames.flatMap((fieldName) => [
    record[fieldName],
    ...candidateObjects.map((candidate) => candidate[fieldName]),
    ...nestedCandidateObjects.map((candidate) => candidate[fieldName]),
    ...attachmentObjects.map((attachment) => attachment[fieldName])
  ]);

  return compactWhitespace(pickFirstString(candidates));
}

export function getDescription(value: unknown): string {
  return getTextValue(value, ["description"]);
}

export function getCaption(value: unknown): string {
  return getTextValue(value, ["caption"]);
}

export function getPrompt(value: unknown): string {
  return getTextValue(value, ["prompt", "text"]);
}

export function getDiscoveryPhrase(value: unknown): string {
  return getTextValue(value, ["discovery_phrase", "discoveryPhrase"]);
}

export function getCreatorName(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidates = collectIdentityCandidates(value);
  return compactWhitespace(
    pickFirstString(
      candidates.flatMap((candidate) => [
        candidate.display_name,
        candidate.displayName,
        candidate.full_name,
        candidate.fullName,
        candidate.name,
        candidate.username
      ])
    )
  );
}

export function getCreatorUsername(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidates = collectIdentityCandidates(value);
  return pickFirstString(
    candidates.flatMap((candidate) => [candidate.username, candidate.user_name, candidate.userName, candidate.handle])
  );
}

export function getCharacterNames(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.character_account_display_name,
    record.characterAccountDisplayName,
    record.character_display_name,
    record.characterDisplayName,
    record.character_name,
    record.characterName,
    record.side_character_name,
    record.sideCharacterName
  ];

  for (const candidate of getCandidateObjects(record)) {
    candidates.push(
      candidate.character_account_display_name,
      candidate.characterAccountDisplayName,
      candidate.character_display_name,
      candidate.characterDisplayName,
      candidate.character_name,
      candidate.characterName,
      candidate.side_character_name,
      candidate.sideCharacterName
    );
  }

  return uniqueStrings(candidates.filter((candidate): candidate is string => typeof candidate === "string").map(compactWhitespace));
}

export function getCharacterUsername(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  return pickFirstString([
    record.character_account_username,
    record.characterAccountUsername,
    record.character_username,
    record.characterUsername,
    ...getCandidateObjects(record).flatMap((candidate) => [
      candidate.character_account_username,
      candidate.characterAccountUsername,
      candidate.character_username,
      candidate.characterUsername
    ])
  ]);
}

export function getThumbnailUrl(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  return normalizeAbsoluteUrl(
    pickFirstString([
      record.thumbnail_url,
      record.thumbnailUrl,
      record.preview_image_url,
      record.previewImageUrl,
      record.cover_photo_url,
      record.coverPhotoUrl,
      record.poster_url,
      record.posterUrl,
      record.image_url,
      record.imageUrl,
      ...getCandidateObjects(record).flatMap((candidate) => [
        candidate.thumbnail_url,
        candidate.thumbnailUrl,
        candidate.preview_image_url,
        candidate.previewImageUrl,
        candidate.cover_photo_url,
        candidate.coverPhotoUrl,
        candidate.poster_url,
        candidate.posterUrl,
        candidate.image_url,
        candidate.imageUrl
      ])
    ])
  );
}

export function getDurationSeconds(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const attachmentObjects = getAttachmentObjects(record);
  return pickFirstNumber([
    record.duration_s,
    record.durationSecs,
    record.duration_secs,
    record.durationSeconds,
    ...getCandidateObjects(record).flatMap((candidate) => [
      candidate.duration_s,
      candidate.durationSecs,
      candidate.duration_secs,
      candidate.durationSeconds
    ]),
    ...attachmentObjects.flatMap((attachment) => [
      attachment.duration_s,
      attachment.durationSecs,
      attachment.duration_secs,
      attachment.durationSeconds
    ])
  ]);
}

export function getDimensions(value: unknown): { height: number | null; width: number | null } {
  if (!value || typeof value !== "object") {
    return { width: null, height: null };
  }

  const record = value as Record<string, unknown>;
  const attachmentObjects = getAttachmentObjects(record);
  return {
    width: pickFirstNumber([
      record.width,
      record.video_width,
      record.videoWidth,
      ...getCandidateObjects(record).flatMap((candidate) => [candidate.width, candidate.video_width, candidate.videoWidth]),
      ...attachmentObjects.flatMap((attachment) => [attachment.width, attachment.video_width, attachment.videoWidth])
    ]),
    height: pickFirstNumber([
      record.height,
      record.video_height,
      record.videoHeight,
      ...getCandidateObjects(record).flatMap((candidate) => [candidate.height, candidate.video_height, candidate.videoHeight]),
      ...attachmentObjects.flatMap((attachment) => [attachment.height, attachment.video_height, attachment.videoHeight])
    ])
  };
}

export function getMetrics(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      like_count: null,
      view_count: null,
      share_count: null,
      repost_count: null,
      remix_count: null
    };
  }

  const record = value as Record<string, unknown>;
  return {
    like_count: pickFirstNumber([record.like_count, record.likeCount, ...getCandidateObjects(record).flatMap((candidate) => [candidate.like_count, candidate.likeCount])]),
    view_count: pickFirstNumber([record.view_count, record.viewCount, ...getCandidateObjects(record).flatMap((candidate) => [candidate.view_count, candidate.viewCount])]),
    share_count: pickFirstNumber([record.share_count, record.shareCount, ...getCandidateObjects(record).flatMap((candidate) => [candidate.share_count, candidate.shareCount])]),
    repost_count: pickFirstNumber([record.repost_count, record.repostCount, ...getCandidateObjects(record).flatMap((candidate) => [candidate.repost_count, candidate.repostCount])]),
    remix_count: pickFirstNumber([record.remix_count, record.remixCount, ...getCandidateObjects(record).flatMap((candidate) => [candidate.remix_count, candidate.remixCount])])
  };
}

export function getPublishedAt(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return pickFirstTimestamp([
    record.posted_at,
    record.postedAt,
    record.published_at,
    record.publishedAt,
    record.created_at,
    record.createdAt,
    ...getCandidateObjects(record).flatMap((candidate) => [
      candidate.posted_at,
      candidate.postedAt,
      candidate.published_at,
      candidate.publishedAt,
      candidate.created_at,
      candidate.createdAt
    ])
  ]);
}

export function getCreatedAt(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return pickFirstTimestamp([
    record.created_at,
    record.createdAt,
    record.updated_at,
    record.updatedAt,
    ...getCandidateObjects(record).flatMap((candidate) => [candidate.created_at, candidate.createdAt, candidate.updated_at, candidate.updatedAt])
  ]);
}

export function getDetailUrl(value: unknown, fallbackId = ""): string {
  if (!value || typeof value !== "object") {
    return fallbackId ? `${window.location.origin}/p/${fallbackId}` : "";
  }

  const record = value as Record<string, unknown>;
  const directUrl = normalizeAbsoluteUrl(
    pickFirstString([
      record.permalink,
      record.detail_url,
      record.detailUrl,
      record.public_url,
      record.publicUrl,
      record.share_url,
      record.shareUrl,
      record.url,
      ...getCandidateObjects(record).flatMap((candidate) => [
        candidate.permalink,
        candidate.detail_url,
        candidate.detailUrl,
        candidate.public_url,
        candidate.publicUrl,
        candidate.share_url,
        candidate.shareUrl,
        candidate.url
      ])
    ])
  );

  return directUrl || (fallbackId ? `${window.location.origin}/p/${fallbackId}` : "");
}

export function getAttachmentObjects(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const attachments: Record<string, unknown>[] = [];
  for (const candidate of getCandidateObjects(value)) {
    attachments.push(...getNestedArrays(candidate));
  }

  const deduped = new Map<string, Record<string, unknown>>();
  for (const attachment of attachments) {
    const key = pickFirstString([
      getVideoIdFromValue(attachment),
      getDraftGenerationId(attachment),
      extractPostIdFromUrl(attachment.url),
      attachment.id,
      attachment.task_id,
      attachment.taskId
    ]) || JSON.stringify(attachment).slice(0, 200);
    deduped.set(key, attachment);
  }

  return [...deduped.values()];
}

export function resolveSourceBucket(source: LowLevelSourceType): SourceBucket {
  if (source === "drafts") {
    return "drafts";
  }
  if (source === "likes") {
    return "liked";
  }
  if (source === "characters" || source === "characterDrafts") {
    return "characters";
  }
  if (source.startsWith("characterAccount")) {
    return "character-account";
  }
  if (source.startsWith("creator")) {
    return "creators";
  }
  if (source === "profile") {
    return "published";
  }
  return "cameos";
}

export function buildRowId(source: LowLevelSourceType, primaryId: string, fallbackText: string): string {
  const resolvedPrimaryId = primaryId || slugify(fallbackText) || crypto.randomUUID();
  return `${source}:${resolvedPrimaryId}`;
}

export function getRowTitle(value: unknown, fallbackId: string): string {
  const title = compactWhitespace(
    pickFirstString([
      getDiscoveryPhrase(value),
      getPrompt(value),
      getCaption(value),
      getDescription(value),
      fallbackId
    ])
  );
  return sanitizeFileNamePart(title, fallbackId || "video");
}

export function stringifyRawPayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return "{}";
  }
}

export function createSkippedRow(input: {
  detail_url: string;
  fallback_text: string;
  fetched_at: string;
  raw_value: unknown;
  reason: string;
  source: LowLevelSourceType;
}): VideoRow {
  return {
    row_id: buildRowId(input.source, "", `${input.reason}-${input.fallback_text}`),
    video_id: "",
    source_type: input.source,
    source_bucket: resolveSourceBucket(input.source),
    title: input.fallback_text,
    prompt: getPrompt(input.raw_value),
    discovery_phrase: getDiscoveryPhrase(input.raw_value),
    description: getDescription(input.raw_value),
    caption: getCaption(input.raw_value),
    creator_name: getCreatorName(input.raw_value),
    creator_username: getCreatorUsername(input.raw_value),
    character_name: getCharacterNames(input.raw_value)[0] ?? "",
    character_username: getCharacterUsername(input.raw_value),
    character_names: getCharacterNames(input.raw_value),
    category_tags: [resolveSourceBucket(input.source)],
    created_at: getCreatedAt(input.raw_value),
    published_at: getPublishedAt(input.raw_value),
    like_count: getMetrics(input.raw_value).like_count,
    view_count: getMetrics(input.raw_value).view_count,
    share_count: getMetrics(input.raw_value).share_count,
    repost_count: getMetrics(input.raw_value).repost_count,
    remix_count: getMetrics(input.raw_value).remix_count,
    detail_url: input.detail_url,
    thumbnail_url: getThumbnailUrl(input.raw_value),
    duration_seconds: getDurationSeconds(input.raw_value),
    width: getDimensions(input.raw_value).width,
    height: getDimensions(input.raw_value).height,
    raw_payload_json: stringifyRawPayload(input.raw_value),
    is_downloadable: false,
    skip_reason: input.reason,
    fetched_at: input.fetched_at
  };
}

function collectIdentityCandidates(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.user,
    record.owner,
    record.author,
    record.creator,
    record.account,
    record.profile,
    record.owner_profile,
    record.ownerProfile,
    record.profile_owner,
    record.profileOwner,
    record.actor,
    ...getCandidateObjects(record).flatMap((candidate) => [
      candidate.user,
      candidate.owner,
      candidate.author,
      candidate.creator,
      candidate.account,
      candidate.profile,
      candidate.owner_profile,
      candidate.ownerProfile,
      candidate.profile_owner,
      candidate.profileOwner,
      candidate.actor
    ])
  ];

  return candidates.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object");
}
