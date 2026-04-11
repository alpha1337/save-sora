import type { VideoRow } from "types/domain";
import type { AppStoreState } from "types/store";

export function selectFilteredVideoRows(state: AppStoreState): VideoRow[] {
  const query = state.session_meta.query.trim().toLowerCase();
  const historyIds = new Set(state.download_history_ids);

  return [...state.video_rows]
    .filter((row) => {
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
}

export function selectVisibleDownloadableVideoIds(state: AppStoreState): string[] {
  return selectFilteredVideoRows(state)
    .filter((row) => row.is_downloadable && row.video_id)
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

  if (sortKey === "title") {
    return compareText(left.title, right.title);
  }

  if (sortKey === "creator_name") {
    return compareText(left.creator_name, right.creator_name, left.title, right.title);
  }

  if (sortKey === "character_name") {
    return compareText(getPrimaryCharacterName(left), getPrimaryCharacterName(right), left.title, right.title);
  }

  if (sortKey === "source_type") {
    return compareText(left.source_type, right.source_type, left.title, right.title);
  }

  if (sortKey === "view_count") {
    return compareNumber(left.view_count, right.view_count, left.title, right.title);
  }

  if (sortKey === "like_count") {
    return compareNumber(left.like_count, right.like_count, left.title, right.title);
  }

  if (sortKey === "duration_seconds") {
    return compareNumber(left.duration_seconds, right.duration_seconds, left.title, right.title);
  }

  if (sortKey === "fetched_at") {
    return compareTimestamp(left.fetched_at, right.fetched_at, left.title, right.title);
  }

  return compareTimestamp(sortKey === "created_at" ? left.created_at : left.published_at, sortKey === "created_at" ? right.created_at : right.published_at, left.title, right.title);
}

function compareText(leftValue: string, rightValue: string, leftFallback = "", rightFallback = ""): number {
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

function compareNumber(leftValue: number | null, rightValue: number | null, leftFallback: string, rightFallback: string): number {
  const normalizedLeftValue = typeof leftValue === "number" ? leftValue : Number.NEGATIVE_INFINITY;
  const normalizedRightValue = typeof rightValue === "number" ? rightValue : Number.NEGATIVE_INFINITY;

  if (normalizedLeftValue !== normalizedRightValue) {
    return normalizedRightValue - normalizedLeftValue;
  }

  return leftFallback.localeCompare(rightFallback);
}

function compareTimestamp(leftValue: string | null, rightValue: string | null, leftFallback: string, rightFallback: string): number {
  const leftTimestamp = Date.parse(leftValue ?? "") || 0;
  const rightTimestamp = Date.parse(rightValue ?? "") || 0;

  if (leftTimestamp !== rightTimestamp) {
    return rightTimestamp - leftTimestamp;
  }

  return leftFallback.localeCompare(rightFallback);
}

function getPrimaryCharacterName(row: VideoRow): string {
  return row.character_names[0] ?? row.character_name;
}
