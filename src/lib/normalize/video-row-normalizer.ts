import type { CharacterAccount, CreatorProfile, LowLevelSourceType, VideoRow } from "types/domain";
import {
  buildRowId,
  buildRowIdFromPayload,
  getCandidateObjects,
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
  getLikedAt,
  getLikeRank,
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
    const videoId = source === "sideCharacter"
      ? resolveSideCharacterVideoId(row)
      : getVideoIdFromValue(row);
    const detailUrl = getDetailUrl(row, postId);
    const attachments = getAttachmentObjects(row);
    const title = getRowTitle(row, "video");

    if (attachments.length > 1 && !videoId) {
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
    const likedAt = source === "likes" ? getLikedAt(row) : null;
    const likeRank = source === "likes" ? getLikeRank(row) : null;
    const createdAt = likedAt || getCreatedAt(row);
    const publishedAt = likedAt || getPublishedAt(row);
    const playbackUrl = getPlaybackUrlFromRow(row);
    const downloadUrl = getDownloadUrlFromRow(row) || playbackUrl;
    const isDownloadable = Boolean(videoId && downloadUrl);
    const skipReason = !videoId
      ? "missing_video_id"
      : downloadUrl
        ? ""
        : "missing_download_url";

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
      created_at: createdAt,
      published_at: publishedAt,
      like_count: metrics.like_count,
      view_count: metrics.view_count,
      share_count: metrics.share_count,
      repost_count: metrics.repost_count,
      remix_count: metrics.remix_count,
      detail_url: detailUrl,
      thumbnail_url: getPreferredThumbnailUrl(row),
      gif_url: getGifUrlFromRow(row),
      playback_url: playbackUrl,
      download_url: downloadUrl,
      duration_seconds: getDurationSeconds(row),
      estimated_size_bytes: getEstimatedSizeBytes(row),
      width: dimensions.width,
      height: dimensions.height,
      raw_payload_json: stringifyRawPayload(row),
      source_order: likeRank,
      is_downloadable: isDownloadable,
      skip_reason: skipReason,
      fetched_at: fetchedAt
    });
  }

  return normalizedRows;
}

function resolveSideCharacterVideoId(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const postRecord = record.post && typeof record.post === "object" ? record.post as Record<string, unknown> : null;
  if (!postRecord) {
    return "";
  }
  const postId = pickFirstString([
    postRecord.id,
    postRecord.post_id,
    postRecord.postId,
    postRecord.shared_post_id,
    postRecord.sharedPostId
  ]);
  return /^s_[A-Za-z0-9_-]+$/.test(postId) ? postId : "";
}

export function normalizeDraftRows(source: LowLevelSourceType, rows: unknown[], fetchedAt: string): VideoRow[] {
  const normalizedRows: VideoRow[] = [];

  for (const row of rows) {
    const rowRecord = asRecord(row);
    const draftRecord = resolveNestedDraftRecord(rowRecord);
    const draftKind = extractDraftRowKind(rowRecord, draftRecord);
    const rawDetailUrl = getDetailUrl(draftRecord) || getDetailUrl(row);
    if (shouldSkipDraftRow(rowRecord, draftRecord, draftKind, rawDetailUrl)) {
      continue;
    }
    const metadataRecord = buildDraftMetadataRecord(rowRecord, draftRecord);
    const generationId = pickFirstString([getDraftGenerationId(draftRecord), getDraftGenerationId(row)]);
    const resolvedVideoIdCandidate = pickFirstString([
      draftRecord.resolved_video_id,
      draftRecord.resolvedVideoId,
      rowRecord.resolved_video_id,
      rowRecord.resolvedVideoId,
      getVideoIdFromValue(draftRecord),
      getVideoIdFromValue(row)
    ]);
    const resolvedVideoId = isSourceResolvedDraftId(draftRecord, resolvedVideoIdCandidate) ? "" : resolvedVideoIdCandidate;
    const fallbackDraftId = pickFirstString([generationId, getRowPostId(draftRecord), getRowPostId(row)]);
    const playbackUrl = getDraftPlaybackUrlFromRow(draftRecord, generationId, resolvedVideoId);
    const downloadUrl = getDraftDownloadUrlFromRow(draftRecord, generationId, resolvedVideoId) || playbackUrl;
    const effectiveVideoId = resolvedVideoId || (downloadUrl ? fallbackDraftId : "");
    const isDownloadable = Boolean(resolvedVideoId || downloadUrl);
    const title = getRowTitle(draftRecord, "draft");
    const sharedDetailUrl = normalizeAbsoluteUrl(
      pickFirstString([
        draftRecord.resolved_share_url,
        draftRecord.resolvedShareUrl,
        rowRecord.resolved_share_url,
        rowRecord.resolvedShareUrl
      ])
    );
    const fallbackDetailUrl = getDetailUrl(draftRecord, effectiveVideoId || generationId) || getDetailUrl(row, effectiveVideoId || generationId);
    const detailUrl = sanitizeDraftDetailUrl(sharedDetailUrl || fallbackDetailUrl, generationId, resolvedVideoId);
    const dimensions = getDimensions(draftRecord);
    const characterNames = getCharacterNames(metadataRecord);

    normalizedRows.push({
      row_id: effectiveVideoId || generationId
        ? buildRowId(source, effectiveVideoId || generationId, title)
        : buildRowIdFromPayload(source, "", title, row),
      video_id: effectiveVideoId,
      source_type: source,
      source_bucket: resolveSourceBucket(source),
      title,
      prompt: getPrompt(draftRecord),
      discovery_phrase: getDiscoveryPhrase(draftRecord),
      description: getDescription(draftRecord),
      caption: getCaption(draftRecord),
      creator_name: getCreatorName(metadataRecord),
      creator_username: getCreatorUsername(metadataRecord),
      character_name: characterNames[0] ?? "",
      character_username: getCharacterUsername(metadataRecord),
      character_names: characterNames,
      category_tags: [resolveSourceBucket(source)],
      created_at: getCreatedAt(draftRecord) || getCreatedAt(row),
      published_at: getPublishedAt(draftRecord) || getPublishedAt(row),
      like_count: null,
      view_count: null,
      share_count: null,
      repost_count: null,
      remix_count: null,
      detail_url: detailUrl,
      thumbnail_url: getPreferredThumbnailUrl(draftRecord) || getPreferredThumbnailUrl(row),
      gif_url: getGifUrlFromRow(draftRecord) || getGifUrlFromRow(row),
      playback_url: playbackUrl,
      download_url: downloadUrl,
      duration_seconds: getDurationSeconds(draftRecord),
      estimated_size_bytes: getEstimatedSizeBytes(draftRecord),
      width: dimensions.width,
      height: dimensions.height,
      raw_payload_json: stringifyRawPayload(row),
      source_order: null,
      is_downloadable: isDownloadable,
      skip_reason: isDownloadable ? "" : "unresolved_draft_video_id",
      fetched_at: fetchedAt
    });
  }

  return normalizedRows;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resolveNestedDraftRecord(rowRecord: Record<string, unknown>): Record<string, unknown> {
  return rowRecord.draft && typeof rowRecord.draft === "object"
    ? rowRecord.draft as Record<string, unknown>
    : rowRecord;
}

function buildDraftMetadataRecord(
  rowRecord: Record<string, unknown>,
  draftRecord: Record<string, unknown>
): Record<string, unknown> {
  const nestedCameoProfiles = extractCreationConfigCameoProfiles(draftRecord);
  return {
    ...draftRecord,
    profile: rowRecord.profile ?? draftRecord.profile,
    creator: rowRecord.creator ?? draftRecord.creator,
    user: rowRecord.user ?? draftRecord.user,
    owner: rowRecord.owner ?? draftRecord.owner,
    cameo_profiles: draftRecord.cameo_profiles ?? rowRecord.cameo_profiles ?? nestedCameoProfiles
  };
}

function extractDraftRowKind(
  rowRecord: Record<string, unknown>,
  draftRecord: Record<string, unknown>
): string {
  const rowOutputRecord = getNestedRecord(rowRecord, "output");
  const draftOutputRecord = getNestedRecord(draftRecord, "output");
  return pickFirstString([
    rowRecord.kind,
    draftRecord.kind,
    getNestedRecord(rowRecord, "draft").kind,
    getNestedRecord(rowRecord, "item").kind,
    getNestedRecord(rowRecord, "data").kind,
    rowOutputRecord.kind,
    draftOutputRecord.kind
  ]).toLowerCase();
}

function shouldSkipDraftRow(
  rowRecord: Record<string, unknown>,
  draftRecord: Record<string, unknown>,
  draftKind: string,
  detailUrl: string
): boolean {
  return shouldSkipDraftKind(draftKind) || isEditedDraftRow(rowRecord, draftRecord, draftKind, detailUrl);
}

function shouldSkipDraftKind(kind: string): boolean {
  const normalized = kind.trim().toLowerCase();
  return normalized === "sora_error" || normalized === "sora_content_violation";
}

function isEditedDraftRow(
  rowRecord: Record<string, unknown>,
  draftRecord: Record<string, unknown>,
  draftKind: string,
  detailUrl: string
): boolean {
  const normalizedKind = draftKind.trim().toLowerCase();
  if (normalizedKind.includes("edit") || normalizedKind.includes("snapshot")) {
    return true;
  }

  if (isEditedDraftDetailUrl(detailUrl)) {
    return true;
  }

  const creationConfig = resolveDraftCreationConfig(draftRecord) ?? resolveDraftCreationConfig(rowRecord);
  if (!creationConfig) {
    return false;
  }

  return (
    creationConfig.editing_config != null ||
    creationConfig.editingConfig != null ||
    creationConfig.inpaint_image != null ||
    creationConfig.inpaintImage != null ||
    creationConfig.reference_inpaint_items != null ||
    creationConfig.referenceInpaintItems != null
  );
}

function isEditedDraftDetailUrl(detailUrl: string): boolean {
  if (!detailUrl) {
    return false;
  }

  try {
    const pathname = new URL(detailUrl).pathname.toLowerCase();
    return pathname.startsWith("/de/");
  } catch (_error) {
    return detailUrl.toLowerCase().includes("/de/");
  }
}

function resolveDraftCreationConfig(record: Record<string, unknown>): Record<string, unknown> | null {
  if (record.creation_config && typeof record.creation_config === "object") {
    return record.creation_config as Record<string, unknown>;
  }
  if (record.creationConfig && typeof record.creationConfig === "object") {
    return record.creationConfig as Record<string, unknown>;
  }
  return null;
}

function extractCreationConfigCameoProfiles(draftRecord: Record<string, unknown>): unknown[] {
  const creationConfig = resolveDraftCreationConfig(draftRecord);
  return Array.isArray(creationConfig?.cameo_profiles) ? creationConfig.cameo_profiles : [];
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

function getGifUrlFromRow(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = [record, ...getCandidateObjects(record), ...getAttachmentObjects(record)];
  for (const candidate of candidateObjects) {
    const encodings = candidate.encodings && typeof candidate.encodings === "object"
      ? candidate.encodings as Record<string, unknown>
      : null;
    const gifEncoding = encodings?.gif && typeof encodings.gif === "object"
      ? encodings.gif as Record<string, unknown>
      : null;
    const resolvedGifUrl = normalizeAbsoluteUrl(
      pickFirstString([
        candidate.resolved_gif_url,
        candidate.resolvedGifUrl,
        candidate.gif_url,
        candidate.gifUrl,
        gifEncoding?.path
      ])
    );
    if (resolvedGifUrl) {
      return resolvedGifUrl;
    }
  }

  return "";
}

function getPlaybackUrlFromRow(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = [record, ...getAttachmentObjects(record)];
  for (const candidate of candidateObjects) {
    const downloadUrls = candidate.download_urls && typeof candidate.download_urls === "object"
      ? candidate.download_urls as Record<string, unknown>
      : null;
    const downloadUrlsCamel = candidate.downloadUrls && typeof candidate.downloadUrls === "object"
      ? candidate.downloadUrls as Record<string, unknown>
      : null;
    const resolved = pickFirstOpenAiVideoUrl([
      downloadUrls?.watermark,
      downloadUrlsCamel?.watermark,
    ]);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function getDownloadUrlFromRow(value: unknown): string {
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
    const sourceWmEncoding = encodings?.source_wm && typeof encodings.source_wm === "object"
      ? encodings.source_wm as Record<string, unknown>
      : null;
    const mdEncoding = encodings?.md && typeof encodings.md === "object"
      ? encodings.md as Record<string, unknown>
      : null;
    const ldEncoding = encodings?.ld && typeof encodings.ld === "object"
      ? encodings.ld as Record<string, unknown>
      : null;
    const downloadUrls = candidate.download_urls && typeof candidate.download_urls === "object"
      ? candidate.download_urls as Record<string, unknown>
      : null;
    const downloadUrlsCamel = candidate.downloadUrls && typeof candidate.downloadUrls === "object"
      ? candidate.downloadUrls as Record<string, unknown>
      : null;
    const resolved = pickFirstOpenAiVideoUrl([
      candidate.resolved_download_url,
      candidate.resolvedDownloadUrl,
      downloadUrls?.no_watermark,
      downloadUrlsCamel?.no_watermark,
      downloadUrlsCamel?.noWatermark,
      downloadUrls?.watermark,
      downloadUrlsCamel?.watermark,
      candidate.resolved_playback_url,
      candidate.resolvedPlaybackUrl,
      candidate.downloadable_url,
      candidate.downloadableUrl,
      sourceWmEncoding?.path,
      sourceEncoding?.path,
      candidate.url,
      mdEncoding?.path,
      ldEncoding?.path
    ]);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

function getDraftPlaybackUrlFromRow(value: unknown, generationId: string, resolvedVideoId: string): string {
  return resolveDraftUrlFromRow(value, generationId, resolvedVideoId, getDraftPlaybackUrlSourceScore, getPlaybackUrlFromRow);
}

function getDraftDownloadUrlFromRow(value: unknown, generationId: string, resolvedVideoId: string): string {
  return resolveDraftUrlFromRow(value, generationId, resolvedVideoId, getDraftDownloadUrlSourceScore, getDownloadUrlFromRow);
}

function resolveDraftUrlFromRow(
  value: unknown,
  generationId: string,
  resolvedVideoId: string,
  getSourceScore: (urlSource: string) => number,
  getFallbackUrl: (value: unknown) => string
): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const candidateObjects = dedupeDraftPlaybackCandidates([
    record,
    ...getCandidateObjects(record),
    ...getAttachmentObjects(record)
  ]);
  const sourceOperationGenerationIds = extractSourceOperationGenerationIds(record);
  const candidates = candidateObjects.flatMap((candidate) =>
    collectDraftPlaybackCandidates(candidate)
  );

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
      score -= 160;
    }
    if (candidate.candidateGenerationId && sourceOperationGenerationIds.has(candidate.candidateGenerationId)) {
      score -= 140;
    }
    if (!resolvedVideoId && generationId && /^s_[A-Za-z0-9_-]+$/i.test(candidate.candidateId)) {
      score -= 40;
    }
    score += getSourceScore(candidate.urlSource);

    if (score > bestScore) {
      bestScore = score;
      bestUrl = candidate.url;
    }
  }

  if (bestUrl) {
    return bestUrl;
  }

  return getFallbackUrl(value);
}

function dedupeDraftPlaybackCandidates(candidates: Record<string, unknown>[]): Record<string, unknown>[] {
  const deduped: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    deduped.push(candidate);
  }
  return deduped;
}

interface DraftPlaybackCandidate {
  candidateGenerationId: string;
  candidateId: string;
  typeHint: string;
  url: string;
  urlSource: string;
}

function collectDraftPlaybackCandidates(candidate: Record<string, unknown>): DraftPlaybackCandidate[] {
  const encodings = candidate.encodings && typeof candidate.encodings === "object"
    ? candidate.encodings as Record<string, unknown>
    : null;
  const sourceEncoding = encodings?.source && typeof encodings.source === "object"
    ? encodings.source as Record<string, unknown>
    : null;
  const sourceWmEncoding = encodings?.source_wm && typeof encodings.source_wm === "object"
    ? encodings.source_wm as Record<string, unknown>
    : null;
  const mdEncoding = encodings?.md && typeof encodings.md === "object"
    ? encodings.md as Record<string, unknown>
    : null;
  const ldEncoding = encodings?.ld && typeof encodings.ld === "object"
    ? encodings.ld as Record<string, unknown>
    : null;
  const downloadUrls = candidate.download_urls && typeof candidate.download_urls === "object"
    ? candidate.download_urls as Record<string, unknown>
    : null;
  const downloadUrlsCamel = candidate.downloadUrls && typeof candidate.downloadUrls === "object"
    ? candidate.downloadUrls as Record<string, unknown>
    : null;
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

  const urlCandidates: Array<{ source: string; value: unknown }> = [
    { source: "download_urls_no_watermark", value: downloadUrls?.no_watermark },
    { source: "download_urls_no_watermark", value: downloadUrlsCamel?.no_watermark },
    { source: "download_urls_no_watermark", value: downloadUrlsCamel?.noWatermark },
    { source: "download_urls_watermark", value: downloadUrls?.watermark },
    { source: "download_urls_watermark", value: downloadUrlsCamel?.watermark },
    { source: "downloadable_url", value: candidate.downloadable_url },
    { source: "downloadable_url", value: candidate.downloadableUrl },
    { source: "resolved_download_url", value: candidate.resolved_download_url },
    { source: "resolved_download_url", value: candidate.resolvedDownloadUrl },
    { source: "resolved_playback_url", value: candidate.resolved_playback_url },
    { source: "resolved_playback_url", value: candidate.resolvedPlaybackUrl },
    { source: "source_wm_encoding", value: sourceWmEncoding?.path },
    { source: "source_encoding", value: sourceEncoding?.path },
    { source: "direct_url", value: candidate.url },
    { source: "md_encoding", value: mdEncoding?.path },
    { source: "ld_encoding", value: ldEncoding?.path }
  ];

  return urlCandidates
    .map((entry) => ({ ...entry, url: normalizeOpenAiVideoUrl(entry.value) }))
    .filter((entry) => entry.url)
    .map((entry) => ({
      candidateGenerationId,
      candidateId,
      typeHint,
      url: entry.url,
      urlSource: entry.source
    }));
}

function getDraftPlaybackUrlSourceScore(urlSource: string): number {
  switch (urlSource) {
    case "download_urls_watermark":
      return 200;
    default:
      return 0;
  }
}

function getDraftDownloadUrlSourceScore(urlSource: string): number {
  switch (urlSource) {
    case "download_urls_no_watermark":
      return 220;
    case "download_urls_watermark":
      return 200;
    case "resolved_download_url":
      return 180;
    case "downloadable_url":
      return 160;
    case "source_wm_encoding":
      return 150;
    case "resolved_playback_url":
      return 140;
    case "source_encoding":
      return 130;
    case "direct_url":
      return 90;
    case "md_encoding":
      return 80;
    case "ld_encoding":
      return 70;
    default:
      return 0;
  }
}

function pickFirstOpenAiVideoUrl(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalizedUrl = normalizeOpenAiVideoUrl(candidate);
    if (normalizedUrl) {
      return normalizedUrl;
    }
  }

  return "";
}

function normalizeOpenAiVideoUrl(value: unknown): string {
  const normalizedUrl = normalizeAbsoluteUrl(value);
  if (!normalizedUrl) {
    return "";
  }

  try {
    const hostname = new URL(normalizedUrl).hostname.toLowerCase();
    if (hostname === "videos.openai.com" || hostname.endsWith(".videos.openai.com")) {
      return normalizedUrl;
    }
  } catch (_error) {
    return "";
  }

  return "";
}

function extractSourceOperationGenerationIds(record: Record<string, unknown>): Set<string> {
  const operationArrays = [
    record.operations,
    record.operation_history,
    record.operationHistory,
    getNestedRecord(record, "draft").operations
  ];

  const sourceGenerationIds = new Set<string>();
  for (const operationArray of operationArrays) {
    if (!Array.isArray(operationArray)) {
      continue;
    }
    for (const operationEntry of operationArray) {
      if (!operationEntry || typeof operationEntry !== "object") {
        continue;
      }
      const operation = operationEntry as Record<string, unknown>;
      const operationType = pickFirstString([operation.operation, operation.type, operation.kind]).toLowerCase();
      if (operationType && !operationType.includes("extend") && !operationType.includes("remix")) {
        continue;
      }
      const sourceGenerationId = pickFirstString([operation.generation_id, operation.generationId]);
      if (sourceGenerationId) {
        sourceGenerationIds.add(sourceGenerationId);
      }
    }
  }

  return sourceGenerationIds;
}

export function normalizeCreatorProfile(profile: unknown, routeUrl: string): CreatorProfile | null {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const rootRecord = profile as Record<string, unknown>;
  const routeUsername = resolveProfileUsernameFromRoute(routeUrl);
  const record =
    rootRecord.profile && typeof rootRecord.profile === "object"
      ? rootRecord.profile as Record<string, unknown>
      : rootRecord;
  const ownerProfile =
    record.owner_profile && typeof record.owner_profile === "object"
      ? record.owner_profile as Record<string, unknown>
      : record.ownerProfile && typeof record.ownerProfile === "object"
        ? record.ownerProfile as Record<string, unknown>
        : rootRecord.owner_profile && typeof rootRecord.owner_profile === "object"
          ? rootRecord.owner_profile as Record<string, unknown>
        : rootRecord.ownerProfile && typeof rootRecord.ownerProfile === "object"
            ? rootRecord.ownerProfile as Record<string, unknown>
        : null;
  const explicitAccountType = pickFirstString([
    record.account_type,
    record.accountType,
    rootRecord.account_type,
    rootRecord.accountType
  ]).toLowerCase();
  const resolvedCharacterUserId = pickFirstString([
    record.character_user_id,
    record.characterUserId,
    record.profile_id,
    record.profileId,
    record.id,
    rootRecord.character_user_id,
    rootRecord.characterUserId,
    rootRecord.profile_id,
    rootRecord.profileId,
    rootRecord.id
  ]);
  const characterUserId = resolvedCharacterUserId.startsWith("ch_") ? resolvedCharacterUserId : "";
  const explicitOwnerUserId = pickFirstString([
    record.owner_user_id,
    record.ownerUserId,
    rootRecord.owner_user_id,
    rootRecord.ownerUserId,
    ownerProfile?.user_id,
    ownerProfile?.userId
  ]);
  const directUserId = pickFirstString([
    record.user_id,
    record.userId,
    rootRecord.user_id,
    rootRecord.userId
  ]);
  const canonicalUserId = pickFirstString([
    directUserId,
    explicitOwnerUserId
  ]);
  const userId = canonicalUserId || characterUserId;
  const username = pickFirstString([
    record.username,
    record.user_name,
    record.userName,
    record.handle,
    rootRecord.username,
    rootRecord.user_name,
    rootRecord.userName,
    rootRecord.handle,
    routeUsername,
    ownerProfile?.username,
    ownerProfile?.user_name,
    ownerProfile?.userName,
    ownerProfile?.handle
  ]);
  const profileId = pickFirstString([
    record.profile_id,
    record.profileId,
    record.id,
    rootRecord.profile_id,
    rootRecord.profileId,
    rootRecord.id,
    userId,
    username,
    routeUrl
  ]);

  if (!profileId) {
    return null;
  }

  const publishedCount = pickFirstNumber([record.post_count, record.postCount, rootRecord.post_count, rootRecord.postCount]);
  const appearanceCount = pickFirstNumber([
    record.cameo_count,
    record.cameoCount,
    record.appearance_count,
    record.appearanceCount,
    rootRecord.cameo_count,
    rootRecord.cameoCount,
    rootRecord.appearance_count,
    rootRecord.appearanceCount,
    ownerProfile?.cameo_count,
    ownerProfile?.cameoCount,
    ownerProfile?.appearance_count,
    ownerProfile?.appearanceCount
  ]);
  const draftCount = pickFirstNumber([
    record.draft_count,
    record.draftCount,
    rootRecord.draft_count,
    rootRecord.draftCount,
    ownerProfile?.draft_count,
    ownerProfile?.draftCount
  ]);
  const ownerUsername = pickFirstString([
    ownerProfile?.username,
    ownerProfile?.user_name,
    ownerProfile?.userName,
    ownerProfile?.handle
  ]).toLowerCase();
  const ownerUserId = pickFirstString([
    ownerProfile?.user_id,
    ownerProfile?.userId
  ]);
  const normalizedUsername = username.toLowerCase();
  const hasDistinctOwnerIdentity = Boolean(
    (ownerUserId && userId && ownerUserId !== userId) ||
    (ownerUsername && normalizedUsername && ownerUsername !== normalizedUsername)
  );
  const hasExplicitSideCharacterType = explicitAccountType === "sidecharacter";
  const isCharacterProfile =
    hasExplicitSideCharacterType ||
    Boolean(record.is_character_profile) ||
    Boolean(rootRecord.is_character_profile) ||
    Boolean(characterUserId) ||
    userId.startsWith("ch_") ||
    profileId.startsWith("ch_") ||
    hasDistinctOwnerIdentity ||
    (publishedCount === 0 && typeof appearanceCount === "number" && appearanceCount > 0);

  return {
    profile_id: profileId,
    user_id: userId,
    owner_user_id: explicitOwnerUserId || (!userId.startsWith("ch_") ? userId : ""),
    character_user_id: characterUserId || (userId.startsWith("ch_") ? userId : ""),
    username,
    display_name: pickFirstString([record.display_name, record.displayName, record.name, username, profileId]),
    permalink: normalizeAbsoluteUrl(pickFirstString([record.permalink, record.url, rootRecord.permalink, rootRecord.url, routeUrl])) || routeUrl,
    profile_picture_url:
      normalizeAbsoluteUrl(
        pickFirstString([
          record.profile_picture_url,
          record.profilePictureUrl,
          record.avatar_url,
          record.avatarUrl,
          rootRecord.profile_picture_url,
          rootRecord.profilePictureUrl,
          rootRecord.avatar_url,
          rootRecord.avatarUrl
        ])
      ) || null,
    account_type: isCharacterProfile ? "sideCharacter" : "creator",
    is_character_profile: isCharacterProfile,
    published_count: publishedCount,
    appearance_count: appearanceCount,
    draft_count: draftCount,
    created_at: new Date().toISOString()
  };
}

function resolveProfileUsernameFromRoute(routeUrl: string): string {
  const trimmed = routeUrl.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const pathname = new URL(trimmed).pathname;
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "profile" && segments[1]) {
      return decodeURIComponent(segments[1]).replace(/^@+/, "");
    }
    if (segments[0]) {
      return decodeURIComponent(segments[0]).replace(/^@+/, "");
    }
    return "";
  } catch {
    return trimmed.replace(/^@+/, "");
  }
}

export function extractVideoIdFromDetailHtml(detailHtml: string): string {
  const match = detailHtml.match(/\/p\/(s_[A-Za-z0-9_-]+)/i) ?? detailHtml.match(/\/video\/(s_[A-Za-z0-9_-]+)/i);
  return match?.[1] ?? "";
}
