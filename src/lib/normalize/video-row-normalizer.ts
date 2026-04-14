import type { CharacterAccount, CreatorProfile, LowLevelSourceType, VideoRow } from "types/domain";
import {
  buildRowId,
  buildRowIdFromPayload,
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
  getEstimatedSizeBytes,
  getMetrics,
  getPublishedAt,
  getPrompt,
  getRowPostId,
  getRowTitle,
  getThumbnailUrl,
  getVideoIdFromValue,
  normalizeAbsoluteUrl,
  pickFirstNumber,
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
    const title = getRowTitle(row, "video");

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
      row_id: videoId || postId
        ? buildRowId(source, videoId || postId, title)
        : buildRowIdFromPayload(source, "", title, row),
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
      thumbnail_url: getPreferredThumbnailUrl(row),
      playback_url: getPlaybackUrlFromRow(row),
      duration_seconds: getDurationSeconds(row),
      estimated_size_bytes: getEstimatedSizeBytes(row),
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
    const resolvedVideoIdCandidate = pickFirstString([
      rowRecord.resolved_video_id,
      rowRecord.resolvedVideoId,
      getVideoIdFromValue(row)
    ]);
    const resolvedVideoId = isSourceResolvedDraftId(row, resolvedVideoIdCandidate) ? "" : resolvedVideoIdCandidate;
    const fallbackDraftId = pickFirstString([generationId, getRowPostId(row)]);
    const playbackUrl = getDraftPlaybackUrlFromRow(row, generationId, resolvedVideoId);
    const effectiveVideoId = resolvedVideoId || (playbackUrl ? fallbackDraftId : "");
    const isDownloadable = Boolean(resolvedVideoId || playbackUrl);
    const title = getRowTitle(row, "draft");
    const sharedDetailUrl = normalizeAbsoluteUrl(
      pickFirstString([rowRecord.resolved_share_url, rowRecord.resolvedShareUrl])
    );
    const fallbackDetailUrl = getDetailUrl(row, effectiveVideoId || generationId);
    const detailUrl = sanitizeDraftDetailUrl(sharedDetailUrl || fallbackDetailUrl, generationId, resolvedVideoId);
    const dimensions = getDimensions(row);
    const characterNames = getCharacterNames(row);

    return {
      row_id: effectiveVideoId || generationId
        ? buildRowId(source, effectiveVideoId || generationId, title)
        : buildRowIdFromPayload(source, "", title, row),
      video_id: effectiveVideoId,
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
      thumbnail_url: getPreferredThumbnailUrl(row),
      playback_url: playbackUrl,
      duration_seconds: getDurationSeconds(row),
      estimated_size_bytes: getEstimatedSizeBytes(row),
      width: dimensions.width,
      height: dimensions.height,
      raw_payload_json: stringifyRawPayload(row),
      is_downloadable: isDownloadable,
      skip_reason: isDownloadable ? "" : "unresolved_draft_video_id",
      fetched_at: fetchedAt
    };
  });
}

function isSourceResolvedDraftId(value: unknown, resolvedVideoId: string): boolean {
  if (!resolvedVideoId || typeof value !== "object" || value == null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  let sawResolvedId = false;
  for (const candidate of [record, ...getAttachmentObjects(record)]) {
    const candidateId = pickFirstString([
      candidate.id,
      candidate.post_id,
      candidate.postId,
      candidate.public_id,
      candidate.publicId,
      candidate.share_id,
      candidate.shareId
    ]);
    if (candidateId !== resolvedVideoId) {
      continue;
    }

    sawResolvedId = true;
    const typeHint = pickFirstString([
      candidate.kind,
      candidate.type,
      candidate.role,
      candidate.asset_type,
      candidate.assetType,
      candidate.media_type,
      candidate.mediaType
    ]).toLowerCase();
    if (!typeHint.includes("source") && !typeHint.includes("reference") && !typeHint.includes("input")) {
      return false;
    }
  }

  return sawResolvedId;
}

function sanitizeDraftDetailUrl(detailUrl: string, generationId: string, resolvedVideoId: string): string {
  if (resolvedVideoId) {
    return `https://sora.chatgpt.com/p/${resolvedVideoId}`;
  }

  if (!detailUrl) {
    return generationId ? `https://sora.chatgpt.com/d/${generationId}` : "";
  }

  if (detailUrl.includes("/backend/")) {
    return generationId ? `https://sora.chatgpt.com/d/${generationId}` : "";
  }

  return detailUrl;
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
      ) || null,
      appearance_count: pickFirstNumber([record.cameo_count, record.cameoCount, record.appearance_count, record.appearanceCount]),
      draft_count: pickFirstNumber([record.draft_count, record.draftCount])
    });
  }

  return [...accountMap.values()].sort((left, right) => left.display_name.localeCompare(right.display_name));
}

function getPreferredThumbnailUrl(row: unknown): string {
  const attachments = getAttachmentObjects(row);
  for (const attachment of attachments) {
    const thumbnail = getThumbnailUrl(attachment);
    if (thumbnail) {
      return thumbnail;
    }
  }

  return getThumbnailUrl(row);
}

function getPlaybackUrlFromRow(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = [record, ...getAttachmentObjects(record)];
  for (const candidate of candidateObjects) {
    const encodings = candidate.encodings && typeof candidate.encodings === "object"
      ? candidate.encodings as Record<string, unknown>
      : null;
    const sourceEncoding = encodings?.source && typeof encodings.source === "object"
      ? encodings.source as Record<string, unknown>
      : null;
    const mdEncoding = encodings?.md && typeof encodings.md === "object"
      ? encodings.md as Record<string, unknown>
      : null;
    const resolved = normalizeAbsoluteUrl(
      pickFirstString([candidate.downloadable_url, candidate.downloadableUrl, candidate.url, sourceEncoding?.path, mdEncoding?.path])
    );
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function getDraftPlaybackUrlFromRow(value: unknown, generationId: string, resolvedVideoId: string): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = [record, ...getAttachmentObjects(record)];
  const candidates = candidateObjects.map((candidate) => {
    const encodings = candidate.encodings && typeof candidate.encodings === "object"
      ? candidate.encodings as Record<string, unknown>
      : null;
    const sourceEncoding = encodings?.source && typeof encodings.source === "object"
      ? encodings.source as Record<string, unknown>
      : null;
    const mdEncoding = encodings?.md && typeof encodings.md === "object"
      ? encodings.md as Record<string, unknown>
      : null;
    const url = normalizeAbsoluteUrl(
      pickFirstString([candidate.downloadable_url, candidate.downloadableUrl, candidate.url, sourceEncoding?.path, mdEncoding?.path])
    );
    const candidateId = pickFirstString([
      candidate.id,
      candidate.post_id,
      candidate.postId,
      candidate.public_id,
      candidate.publicId,
      candidate.generation_id,
      candidate.generationId
    ]);
    const candidateGenerationId = pickFirstString([candidate.generation_id, candidate.generationId]);
    const typeHint = pickFirstString([
      candidate.kind,
      candidate.type,
      candidate.role,
      candidate.asset_type,
      candidate.assetType,
      candidate.media_type,
      candidate.mediaType
    ]).toLowerCase();

    return {
      candidateGenerationId,
      candidateId,
      typeHint,
      url
    };
  }).filter((entry) => entry.url);

  let bestScore = Number.NEGATIVE_INFINITY;
  let bestUrl = "";
  for (const candidate of candidates) {
    let score = 0;
    if (resolvedVideoId && candidate.candidateId === resolvedVideoId) {
      score += 100;
    }
    if (generationId && candidate.candidateGenerationId === generationId) {
      score += 90;
    }
    if (generationId && candidate.candidateId === generationId) {
      score += 80;
    }
    if (candidate.typeHint.includes("output") || candidate.typeHint.includes("generated") || candidate.typeHint.includes("result")) {
      score += 50;
    }
    if (candidate.typeHint.includes("source") || candidate.typeHint.includes("reference") || candidate.typeHint.includes("input")) {
      score -= 80;
    }
    if (!resolvedVideoId && generationId && /^s_[A-Za-z0-9_-]+$/i.test(candidate.candidateId)) {
      score -= 40;
    }

    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidate.url;
    }
  }

  if (bestUrl) {
    return bestUrl;
  }

  return getPlaybackUrlFromRow(value);
}

export function normalizeCreatorProfile(profile: unknown, routeUrl: string): CreatorProfile | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const record = profile as Record<string, unknown>;
  const ownerProfile =
    record.owner_profile && typeof record.owner_profile === "object"
      ? record.owner_profile as Record<string, unknown>
      : record.ownerProfile && typeof record.ownerProfile === "object"
        ? record.ownerProfile as Record<string, unknown>
        : null;
  const characterUserId = pickFirstString([record.character_user_id, record.characterUserId]);
  const canonicalUserId = pickFirstString([
    record.user_id,
    record.userId,
    record.ownerUserId,
    ownerProfile?.user_id,
    ownerProfile?.userId
  ]);
  const userId = canonicalUserId || characterUserId;
  const username = pickFirstString([
    record.username,
    record.user_name,
    record.userName,
    record.handle,
    ownerProfile?.username,
    ownerProfile?.user_name,
    ownerProfile?.userName,
    ownerProfile?.handle
  ]);
  const profileId = pickFirstString([record.profile_id, record.profileId, userId, username, routeUrl]);

  if (!profileId) {
    return null;
  }

  return {
    profile_id: profileId,
    user_id: userId,
    owner_user_id: canonicalUserId || (!userId.startsWith("ch_") ? userId : ""),
    character_user_id: characterUserId || (userId.startsWith("ch_") ? userId : ""),
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
    published_count: pickFirstNumber([record.post_count, record.postCount]),
    appearance_count: pickFirstNumber([
      record.cameo_count,
      record.cameoCount,
      record.appearance_count,
      record.appearanceCount,
      ownerProfile?.cameo_count,
      ownerProfile?.cameoCount,
      ownerProfile?.appearance_count,
      ownerProfile?.appearanceCount
    ]),
    draft_count: pickFirstNumber([record.draft_count, record.draftCount, ownerProfile?.draft_count, ownerProfile?.draftCount]),
    created_at: new Date().toISOString()
  };
}

export function extractVideoIdFromDetailHtml(detailHtml: string): string {
  const match = detailHtml.match(/\/p\/(s_[A-Za-z0-9_-]+)/i) ?? detailHtml.match(/\/video\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}
