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
    return left.title.localeCompare(right.title);
  }

  const leftTimestamp = Date.parse((sortKey === "created_at" ? left.created_at : left.published_at) ?? "") || 0;
  const rightTimestamp = Date.parse((sortKey === "created_at" ? right.created_at : right.published_at) ?? "") || 0;
  return rightTimestamp - leftTimestamp;
}
