import type {
  ArchiveVariant,
  ArchiveWorkPlan,
  ArchiveWorkPlanRow,
  DownloadQueueItem,
  VideoRow,
  ZipWorkerWorkPlan
} from "types/domain";
import { sanitizeFileNamePart } from "@lib/utils/string-utils";

/**
 * Builds a ZIP work plan with deterministic folder paths.
 */
export function buildArchiveWorkPlan(
  rows: VideoRow[],
  archiveName: string,
  queueDecisions: DownloadQueueItem[] = []
): ArchiveWorkPlan {
  const archiveRootFolder = sanitizePathSegment(archiveName, "save-sora-library");
  const queueDecisionById = new Map(queueDecisions.map((item) => [item.id, item]));
  const plannedRows = rows
    .filter((row) => row.video_id && row.is_downloadable)
    .map((row) => buildArchiveRow(row, archiveRootFolder, queueDecisionById.get(row.video_id)))
    .filter((row): row is ArchiveWorkPlanRow => Boolean(row));
  const downloadableRows = dedupeRowsByVideoId(plannedRows);

  return {
    rows: downloadableRows,
    organizer_rows: [],
    supplemental_entries: [],
    archive_name: archiveRootFolder
  };
}

export function buildZipWorkerWorkPlan(
  workPlan: Pick<ArchiveWorkPlan, "archive_name" | "rows" | "supplemental_entries">
): ZipWorkerWorkPlan {
  return {
    archive_name: workPlan.archive_name,
    supplemental_entries: workPlan.supplemental_entries,
    rows: workPlan.rows.map((row) => ({
      video_id: row.video_id,
      title: row.title,
      source_bucket: row.source_bucket,
      archive_path: row.archive_path,
      archive_download_url: row.archive_download_url
    }))
  };
}

function buildArchiveRow(
  row: VideoRow,
  archiveRootFolder: string,
  queueDecision?: DownloadQueueItem
): ArchiveWorkPlanRow | null {
  const variantUrls = resolveArchiveVariantUrls(row, queueDecision);
  const archiveDownloadUrl = variantUrls.noWatermark || variantUrls.watermark;
  if (!archiveDownloadUrl) {
    return null;
  }

  const archiveVariant: ArchiveVariant = variantUrls.noWatermark ? "no-watermark" : "watermark";
  const archivePath = [archiveRootFolder, ...resolveArchiveFolder(row, archiveVariant), sanitizePathSegment(row.video_id, "video")].join("/");
  return {
    ...row,
    archive_path: archivePath,
    archive_variant: archiveVariant,
    archive_download_url: archiveDownloadUrl
  };
}

function resolveArchiveVariantUrls(
  row: VideoRow,
  queueDecision?: DownloadQueueItem
): { noWatermark: string; watermark: string } {
  const rowVariantUrls = resolveVideoVariantUrls(row);
  if (!queueDecision) {
    return rowVariantUrls;
  }

  return {
    noWatermark: normalizeOptionalDownloadUrl(queueDecision.no_watermark) || rowVariantUrls.noWatermark,
    watermark: normalizeOptionalDownloadUrl(queueDecision.watermark) || rowVariantUrls.watermark
  };
}

function resolveArchiveFolder(row: VideoRow, variant: ArchiveVariant): string[] {
  const characterName = resolveCharacterFolderName(row);
  const variantFolder = sanitizePathSegment(variant, "watermark");

  switch (row.source_type) {
    case "profile":
      return ["me", "published", "posts", variantFolder];
    case "drafts":
      return ["me", "drafts", "posts", variantFolder];
    case "likes":
      return ["liked", variantFolder];
    case "characters":
      return ["me", "published", "cameo", characterName, variantFolder];
    case "characterDrafts":
      return ["me", "drafts", "character", characterName, variantFolder];
    case "characterAccountAppearances":
      return ["me", "published", "characters", variantFolder, characterName];
    case "characterAccountDrafts":
      return ["me", "drafts", "character", characterName, variantFolder];
    case "sideCharacter":
      return ["side-characters", characterName, variantFolder];
    case "creatorPublished":
    case "creatorCameos":
      return ["creators", variantFolder];
    default:
      return resolveArchiveFolderFromBucket(row, variantFolder, characterName);
  }
}

function resolveArchiveFolderFromBucket(
  row: VideoRow,
  variantFolder: string,
  characterName: string
): string[] {
  if (row.source_bucket === "liked") {
    return ["liked", variantFolder];
  }
  if (row.source_bucket === "drafts") {
    return ["me", "drafts", "posts", variantFolder];
  }
  if (row.source_bucket === "published") {
    return ["me", "published", "posts", variantFolder];
  }
  if (row.source_bucket === "creators") {
    return ["creators", variantFolder];
  }
  if (row.source_bucket === "characters") {
    return ["me", "published", "characters", variantFolder, characterName];
  }
  if (row.source_bucket === "character-account") {
    return ["side-characters", characterName, variantFolder];
  }
  return ["me", "published", "cameo", characterName, variantFolder];
}

function resolveCharacterFolderName(row: VideoRow): string {
  return sanitizePathSegment(
    row.character_name ||
      row.character_names.find((value) => value.trim()) ||
      row.character_username ||
      row.creator_name ||
      row.creator_username,
    "unknown-character"
  );
}

export function resolveVideoVariantUrls(row: VideoRow): { noWatermark: string; watermark: string } {
  const payload = parsePayload(row.raw_payload_json);
  const payloadUrls = extractDownloadUrls(payload);
  const inferredNoWatermark = inferNoWatermarkFromRow(row);
  const inferredWatermark = inferWatermarkFromRow(row, inferredNoWatermark);

  return {
    noWatermark: pickFirstOpenAiVideoUrl([payloadUrls.noWatermark, inferredNoWatermark]),
    watermark: pickFirstOpenAiVideoUrl([payloadUrls.watermark, inferredWatermark])
  };
}

function parsePayload(rawPayloadJson: string): unknown {
  if (!rawPayloadJson.trim()) {
    return null;
  }
  try {
    return JSON.parse(rawPayloadJson);
  } catch {
    return null;
  }
}

function extractDownloadUrls(payload: unknown): { noWatermark: string; watermark: string } {
  if (!payload || typeof payload !== "object") {
    return { noWatermark: "", watermark: "" };
  }

  const seen = new Set<Record<string, unknown>>();
  const queue: unknown[] = [payload];
  const noWatermarkUrls: string[] = [];
  const watermarkUrls: string[] = [];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") {
      continue;
    }
    const record = next as Record<string, unknown>;
    if (seen.has(record)) {
      continue;
    }
    seen.add(record);

    const snakeCaseDownloadUrls =
      record.download_urls && typeof record.download_urls === "object"
        ? (record.download_urls as Record<string, unknown>)
        : null;
    const camelCaseDownloadUrls =
      record.downloadUrls && typeof record.downloadUrls === "object"
        ? (record.downloadUrls as Record<string, unknown>)
        : null;

    noWatermarkUrls.push(
      pickFirstOpenAiVideoUrl([
        snakeCaseDownloadUrls?.no_watermark,
        camelCaseDownloadUrls?.no_watermark,
        camelCaseDownloadUrls?.noWatermark
      ])
    );
    watermarkUrls.push(
      pickFirstOpenAiVideoUrl([
        snakeCaseDownloadUrls?.watermark,
        camelCaseDownloadUrls?.watermark
      ])
    );

    for (const value of Object.values(record)) {
      if (!value) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === "object") {
            queue.push(entry);
          }
        }
        continue;
      }
      if (typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return {
    noWatermark: pickFirstOpenAiVideoUrl(noWatermarkUrls),
    watermark: pickFirstOpenAiVideoUrl(watermarkUrls)
  };
}

function inferNoWatermarkFromRow(row: VideoRow): string {
  if (!row.download_url) {
    return "";
  }
  if (!row.playback_url) {
    return row.download_url;
  }
  return normalizeOpenAiVideoUrl(row.download_url) !== normalizeOpenAiVideoUrl(row.playback_url) ? row.download_url : "";
}

function inferWatermarkFromRow(row: VideoRow, inferredNoWatermark: string): string {
  if (row.playback_url) {
    return row.playback_url;
  }
  if (!row.download_url || row.download_url === inferredNoWatermark) {
    return "";
  }
  return row.download_url;
}

function pickFirstOpenAiVideoUrl(candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeOpenAiVideoUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeOpenAiVideoUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    const parsed = new URL(value);
    const normalizedHostname = parsed.hostname.toLowerCase();
    if (normalizedHostname === "videos.openai.com" || normalizedHostname.endsWith(".videos.openai.com")) {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeOptionalDownloadUrl(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitizePathSegment(value: string, fallback: string): string {
  const sanitized = sanitizeFileNamePart(value, fallback).trim().replace(/[\\/]+/g, "-");
  return sanitized || fallback;
}

function dedupeRowsByVideoId(rows: ArchiveWorkPlanRow[]): ArchiveWorkPlanRow[] {
  const rowByVideoId = new Map<string, ArchiveWorkPlanRow>();
  for (const row of rows) {
    const existing = rowByVideoId.get(row.video_id);
    if (!existing) {
      rowByVideoId.set(row.video_id, row);
      continue;
    }

    const shouldReplaceWithCurrent =
      existing.archive_variant !== "no-watermark" &&
      row.archive_variant === "no-watermark";
    if (shouldReplaceWithCurrent) {
      rowByVideoId.set(row.video_id, row);
    }
  }
  return [...rowByVideoId.values()];
}
