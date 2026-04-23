import type { VideoRow } from "types/domain";
import type { AppStoreState } from "types/store";

export function selectFilteredVideoRows(state: AppStoreState): VideoRow[] {
  const query = state.session_meta.query.trim().toLowerCase();
  const excludeSessionCreatorOnly = Boolean(state.session_meta.exclude_session_creator_only);
  const viewerUsername = normalizeIdentity(state.session_meta.viewer_username ?? "");
  const historyIds = new Set(state.download_history_ids);

  const sortedRows = [...state.video_rows]
    .filter((row) => {
      if (excludeSessionCreatorOnly && viewerUsername) {
        const rowCreatorUsername = normalizeIdentity(row.creator_username);
        if (rowCreatorUsername && rowCreatorUsername === viewerUsername) {
          return false;
        }
      }

      if (!query) {
        return true;
      }

      const searchableText = [
        row.title,
        row.prompt,
        row.discovery_phrase,
        row.description,
        row.caption,
        row.creator_name,
        row.creator_username,
        row.character_name,
        row.character_username,
        ...row.character_names,
        ...row.category_tags
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    })
    .sort((left, right) => compareRows(left, right, state.session_meta.sort_key, historyIds));

  return dedupeCreatorSelfCastRows(sortedRows);
}

export function selectVisibleDownloadableVideoIds(state: AppStoreState): string[] {
  return selectFilteredVideoRows(state)
    .filter((row) => isZipReadyRow(row))
    .map((row) => row.video_id);
}

export function selectSelectedVideoRows(state: AppStoreState): VideoRow[] {
  const selectedIds = new Set(state.selected_video_ids);
  return state.video_rows.filter((row) => selectedIds.has(row.video_id));
}

function compareRows(
  left: VideoRow,
  right: VideoRow,
  sortKey: AppStoreState["session_meta"]["sort_key"],
  historyIds: Set<string>
): number {
  if (historyIds.has(left.video_id) !== historyIds.has(right.video_id)) {
    return historyIds.has(left.video_id) ? 1 : -1;
  }

  if (sortKey === "title_asc") {
    return compareTextAsc(left.title, right.title);
  }

  if (sortKey === "title_desc") {
    return compareTextDesc(left.title, right.title);
  }

  if (sortKey === "views_most") {
    return compareNumberDesc(left.view_count, right.view_count, left.title, right.title);
  }

  if (sortKey === "views_fewest") {
    return compareNumberAsc(left.view_count, right.view_count, left.title, right.title);
  }

  if (sortKey === "likes_most") {
    return compareNumberDesc(left.like_count, right.like_count, left.title, right.title);
  }

  if (sortKey === "likes_fewest") {
    return compareNumberAsc(left.like_count, right.like_count, left.title, right.title);
  }

  if (sortKey === "remixes_most") {
    return compareNumberDesc(left.remix_count, right.remix_count, left.title, right.title);
  }

  if (sortKey === "remixes_fewest") {
    return compareNumberAsc(left.remix_count, right.remix_count, left.title, right.title);
  }

  if (sortKey === "created_oldest") {
    return compareTimestampAsc(left.created_at, right.created_at, left.title, right.title);
  }

  if (sortKey === "published_oldest") {
    const likesOrderComparison = compareLikesSourceOrder(left, right, "oldest");
    if (likesOrderComparison != null) {
      return likesOrderComparison;
    }
    return compareTimestampAsc(left.published_at, right.published_at, left.title, right.title);
  }

  if (sortKey === "created_newest") {
    return compareTimestampDesc(left.created_at, right.created_at, left.title, right.title);
  }

  const likesOrderComparison = compareLikesSourceOrder(left, right, "newest");
  if (likesOrderComparison != null) {
    return likesOrderComparison;
  }
  return compareTimestampDesc(left.published_at, right.published_at, left.title, right.title);
}

function compareTextAsc(leftValue: string, rightValue: string, leftFallback = "", rightFallback = ""): number {
  const normalizedLeftValue = leftValue.trim().toLowerCase();
  const normalizedRightValue = rightValue.trim().toLowerCase();

  if (!normalizedLeftValue && !normalizedRightValue) {
    return leftFallback.localeCompare(rightFallback);
  }
  if (!normalizedLeftValue) {
    return 1;
  }
  if (!normalizedRightValue) {
    return -1;
  }

  const result = normalizedLeftValue.localeCompare(normalizedRightValue);
  return result !== 0 ? result : leftFallback.localeCompare(rightFallback);
}

function compareTextDesc(leftValue: string, rightValue: string, leftFallback = "", rightFallback = ""): number {
  return compareTextAsc(rightValue, leftValue, rightFallback, leftFallback);
}

function compareNumberDesc(leftValue: number | null, rightValue: number | null, leftFallback: string, rightFallback: string): number {
  const normalizedLeftValue = typeof leftValue === "number" ? leftValue : Number.NEGATIVE_INFINITY;
  const normalizedRightValue = typeof rightValue === "number" ? rightValue : Number.NEGATIVE_INFINITY;

  if (normalizedLeftValue !== normalizedRightValue) {
    return normalizedRightValue - normalizedLeftValue;
  }

  return leftFallback.localeCompare(rightFallback);
}

function compareNumberAsc(leftValue: number | null, rightValue: number | null, leftFallback: string, rightFallback: string): number {
  const descending = compareNumberDesc(leftValue, rightValue, leftFallback, rightFallback);
  return descending === 0 ? 0 : -descending;
}

function compareTimestampDesc(leftValue: string | null, rightValue: string | null, leftFallback: string, rightFallback: string): number {
  const leftTimestamp = Date.parse(leftValue ?? "") || 0;
  const rightTimestamp = Date.parse(rightValue ?? "") || 0;

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return leftFallback.localeCompare(rightFallback);
}

function compareTimestampAsc(leftValue: string | null, rightValue: string | null, leftFallback: string, rightFallback: string): number {
  const descending = compareTimestampDesc(leftValue, rightValue, leftFallback, rightFallback);
  return descending === 0 ? 0 : -descending;
}

function isZipReadyRow(row: VideoRow): row is VideoRow & { video_id: string } {
  return Boolean(row.is_downloadable && row.video_id);
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function compareLikesSourceOrder(left: VideoRow, right: VideoRow, direction: "newest" | "oldest"): number | null {
  if (left.source_type !== "likes" || right.source_type !== "likes") {
    return null;
  }

  const leftRank = typeof left.source_order === "number" ? left.source_order : null;
  const rightRank = typeof right.source_order === "number" ? right.source_order : null;
  if (leftRank == null || rightRank == null || leftRank === rightRank) {
    return null;
  }

  return direction === "newest" ? leftRank - rightRank : rightRank - leftRank;
}

function dedupeCreatorSelfCastRows(rows: VideoRow[]): VideoRow[] {
  const dedupedRows: VideoRow[] = [];
  const creatorVideoIdToIndex = new Map<string, number>();

  for (const row of rows) {
    if (!isCreatorVideoRow(row) || !row.video_id) {
      dedupedRows.push(row);
      continue;
    }

    const existingIndex = creatorVideoIdToIndex.get(row.video_id);
    if (existingIndex == null) {
      creatorVideoIdToIndex.set(row.video_id, dedupedRows.length);
      dedupedRows.push(row);
      continue;
    }

    const existingRow = dedupedRows[existingIndex];
    dedupedRows[existingIndex] = pickPreferredCreatorDuplicateRow(existingRow, row);
  }

  return dedupedRows;
}

function isCreatorVideoRow(row: VideoRow): boolean {
  return row.source_type === "creatorPublished" || row.source_type === "creatorCameos";
}

function pickPreferredCreatorDuplicateRow(left: VideoRow, right: VideoRow): VideoRow {
  const leftPriority = getCreatorDuplicatePriority(left);
  const rightPriority = getCreatorDuplicatePriority(right);
  if (rightPriority > leftPriority) {
    return right;
  }
  if (leftPriority > rightPriority) {
    return left;
  }

  if (right.is_downloadable && !left.is_downloadable) {
    return right;
  }
  if (left.is_downloadable && !right.is_downloadable) {
    return left;
  }

  const leftTimestamp = Date.parse(left.published_at ?? "") || 0;
  const rightTimestamp = Date.parse(right.published_at ?? "") || 0;
  if (rightTimestamp > leftTimestamp) {
    return right;
  }
  if (leftTimestamp > rightTimestamp) {
    return left;
  }

  return left;
}

function getCreatorDuplicatePriority(row: VideoRow): number {
  if (row.source_type === "creatorPublished") {
    return 2;
  }
  if (row.source_type === "creatorCameos") {
    return 1;
  }
  return 0;
}
