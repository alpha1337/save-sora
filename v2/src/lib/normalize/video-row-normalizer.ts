import type { CharacterAccount, CreatorProfile, LowLevelSourceType, VideoRow } from "types/domain";
import {
  buildRowId,
  getCaption,
  createSkippedRow,
  getAttachmentObjects,
  getCharacterNames,
  getCharacterUsername,
  getCreatedAt,
  getCreatorName,
  getCreatorUsername,
  getDescription,
  getDetailUrl,
  getDimensions,
  getDiscoveryPhrase,
  getDraftGenerationId,
  getDurationSeconds,
  getMetrics,
  getPublishedAt,
  getPrompt,
  getRowPostId,
  getRowTitle,
  getThumbnailUrl,
  getVideoIdFromValue,
  normalizeAbsoluteUrl,
  pickFirstString,
  resolveSourceBucket,
  stringifyRawPayload
} from "./shared";

/**
 * Normalizers that convert raw endpoint rows into one stable app-side row shape.
 */
export function normalizePostRows(source: LowLevelSourceType, rows: unknown[], fetchedAt: string): VideoRow[] {
  const normalizedRows: VideoRow[] = [];

  for (const row of rows) {
    const postId = getRowPostId(row);
    const videoId = getVideoIdFromValue(row);
    const detailUrl = getDetailUrl(row, postId);
    const attachments = getAttachmentObjects(row);
    const title = getRowTitle(row, postId || videoId || "post");

    if (attachments.length > 1) {
      normalizedRows.push(
        createSkippedRow({
          detail_url: detailUrl,
          fallback_text: title,
          fetched_at: fetchedAt,
          raw_value: row,
          reason: "multi_attachment_unsupported",
          source
        })
      );
      continue;
    }

    const metrics = getMetrics(row);
    const dimensions = getDimensions(row);
    const characterNames = getCharacterNames(row);

    normalizedRows.push({
      row_id: buildRowId(source, videoId || postId, title),
      video_id: videoId,
      source_type: source,
      source_bucket: resolveSourceBucket(source),
      title,
      prompt: getPrompt(row),
      discovery_phrase: getDiscoveryPhrase(row),
      description: getDescription(row),
      caption: getCaption(row),
      creator_name: getCreatorName(row),
      creator_username: getCreatorUsername(row),
      character_name: characterNames[0] ?? "",
      character_username: getCharacterUsername(row),
      character_names: characterNames,
      category_tags: [resolveSourceBucket(source)],
      created_at: getCreatedAt(row),
      published_at: getPublishedAt(row),
      like_count: metrics.like_count,
      view_count: metrics.view_count,
      share_count: metrics.share_count,
      repost_count: metrics.repost_count,
      remix_count: metrics.remix_count,
      detail_url: detailUrl,
      thumbnail_url: getThumbnailUrl(row),
      duration_seconds: getDurationSeconds(row),
      width: dimensions.width,
      height: dimensions.height,
      raw_payload_json: stringifyRawPayload(row),
      is_downloadable: Boolean(videoId),
      skip_reason: videoId ? "" : "missing_video_id",
      fetched_at: fetchedAt
    });
  }

  return normalizedRows;
}

export function normalizeDraftRows(source: LowLevelSourceType, rows: unknown[], fetchedAt: string): VideoRow[] {
  return rows.map((row) => {
    const rowRecord = row as Record<string, unknown>;
    const generationId = getDraftGenerationId(row);
    const resolvedVideoId = pickFirstString([
      rowRecord.resolved_video_id,
      rowRecord.resolvedVideoId,
      getVideoIdFromValue(row)
    ]);
    const title = getRowTitle(row, generationId || resolvedVideoId || "draft");
    const detailUrl = normalizeAbsoluteUrl(
      pickFirstString([rowRecord.resolved_share_url, rowRecord.resolvedShareUrl])
    ) || getDetailUrl(row, resolvedVideoId || generationId);
    const dimensions = getDimensions(row);
    const characterNames = getCharacterNames(row);

    return {
      row_id: buildRowId(source, resolvedVideoId || generationId, title),
      video_id: resolvedVideoId,
      source_type: source,
      source_bucket: resolveSourceBucket(source),
      title,
      prompt: getPrompt(row),
      discovery_phrase: getDiscoveryPhrase(row),
      description: getDescription(row),
      caption: getCaption(row),
      creator_name: getCreatorName(row),
      creator_username: getCreatorUsername(row),
      character_name: characterNames[0] ?? "",
      character_username: getCharacterUsername(row),
      character_names: characterNames,
      category_tags: [resolveSourceBucket(source)],
      created_at: getCreatedAt(row),
      published_at: getPublishedAt(row),
      like_count: null,
      view_count: null,
      share_count: null,
      repost_count: null,
      remix_count: null,
      detail_url: detailUrl,
      thumbnail_url: getThumbnailUrl(row),
      duration_seconds: getDurationSeconds(row),
      width: dimensions.width,
      height: dimensions.height,
      raw_payload_json: stringifyRawPayload(row),
      is_downloadable: Boolean(resolvedVideoId),
      skip_reason: resolvedVideoId ? "" : "unresolved_draft_video_id",
      fetched_at: fetchedAt
    };
  });
}

export function normalizeCharacterAccounts(rows: unknown[]): CharacterAccount[] {
  const accountMap = new Map<string, CharacterAccount>();

  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const record = row as Record<string, unknown>;
    const accountId = pickFirstString([
      record.id,
      record.character_id,
      record.characterId,
      record.user_id,
      record.userId
    ]);
    if (!accountId) {
      continue;
    }

    accountMap.set(accountId, {
      account_id: accountId,
      username: pickFirstString([record.username, record.user_name, record.userName, record.handle]),
      display_name: pickFirstString([record.display_name, record.displayName, record.name, accountId]),
      profile_picture_url: normalizeAbsoluteUrl(
        pickFirstString([record.profile_picture_url, record.profilePictureUrl, record.avatar_url, record.avatarUrl])
      ) || null
    });
  }

  return [...accountMap.values()].sort((left, right) => left.display_name.localeCompare(right.display_name));
}

export function normalizeCreatorProfile(profile: unknown, routeUrl: string): CreatorProfile | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const record = profile as Record<string, unknown>;
  const characterUserId = pickFirstString([record.character_user_id, record.characterUserId]);
  const canonicalUserId = pickFirstString([record.user_id, record.userId, record.ownerUserId]);
  const userId = characterUserId || canonicalUserId;
  const username = pickFirstString([record.username, record.user_name, record.userName, record.handle]);
  const profileId = pickFirstString([record.profile_id, record.profileId, userId, username, routeUrl]);

  if (!profileId) {
    return null;
  }

  return {
    profile_id: profileId,
    user_id: userId,
    username,
    display_name: pickFirstString([record.display_name, record.displayName, record.name, username, profileId]),
    permalink: normalizeAbsoluteUrl(pickFirstString([record.permalink, record.url, routeUrl])) || routeUrl,
    profile_picture_url:
      normalizeAbsoluteUrl(
        pickFirstString([record.profile_picture_url, record.profilePictureUrl, record.avatar_url, record.avatarUrl])
      ) || null,
    is_character_profile:
      Boolean(record.is_character_profile) ||
      Boolean(characterUserId) ||
      userId.startsWith("ch_"),
    created_at: new Date().toISOString()
  };
}

export function extractVideoIdFromDetailHtml(detailHtml: string): string {
  const match = detailHtml.match(/\/p\/(s_[A-Za-z0-9_-]+)/i) ?? detailHtml.match(/\/video\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}
