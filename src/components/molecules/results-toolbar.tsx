import { useEffect, useState } from "react";
import type { GroupByOption, VideoSortOption } from "types/domain";
import { Input } from "@components/atoms/input";
import { Select } from "@components/atoms/select";

type SortField = "published" | "created" | "title" | "views" | "likes" | "remixes";
type SortDirection = "asc" | "desc";
type SelectionPreset = "all_visible" | "mine" | "others" | "none";
type SelectionDisplayValue = SelectionPreset | "custom";

interface ResultsToolbarProps {
  allVisibleSelected: boolean;
  selectableRowCount: number;
  selectedVisibleRowCount: number;
  query: string;
  hideDownloadedVideos: boolean;
  sortKey: VideoSortOption;
  groupBy: GroupByOption;
  onSelectionPresetChange: (preset: SelectionPreset) => void;
  onHideDownloadedVideosChange: (value: boolean) => void;
  onQueryChange: (value: string) => void;
  onSortKeyChange: (value: VideoSortOption) => void;
  onGroupByChange: (value: GroupByOption) => void;
}

/**
 * Query and sort controls for the results surface.
 */
export function ResultsToolbar({
  allVisibleSelected,
  onQueryChange,
  onSelectionPresetChange,
  onHideDownloadedVideosChange,
  onSortKeyChange,
  onGroupByChange,
  query,
  hideDownloadedVideos,
  selectableRowCount,
  selectedVisibleRowCount,
  sortKey,
  groupBy
}: ResultsToolbarProps) {
  const [selectionPreset, setSelectionPreset] = useState<SelectionDisplayValue>(
    resolveSelectionPreset(allVisibleSelected, selectedVisibleRowCount)
  );
  const { direction, field } = getSortControls(sortKey);
  const selectionOptions = [
    ...(selectionPreset === "custom" ? [{ label: "Custom selection", value: "custom" }] : []),
    { label: "Select all videos", value: "all_visible" },
    { label: "Videos made by you", value: "mine" },
    { label: "Videos made by others", value: "others" },
    { label: "Select none", value: "none" }
  ];

  useEffect(() => {
    setSelectionPreset(resolveSelectionPreset(allVisibleSelected, selectedVisibleRowCount));
  }, [allVisibleSelected, selectedVisibleRowCount]);

  return (
    <div className="ss-toolbar">
      <div className="ss-toolbar-control">
        <span className="ss-toolbar-control-label">Select</span>
        <Select
          aria-label="Selection preset"
          disabled={selectableRowCount === 0}
          onValueChange={(value) => {
            if (value === "custom") {
              return;
            }
            const preset = value as SelectionPreset;
            setSelectionPreset(preset);
            onSelectionPresetChange(preset);
          }}
          options={selectionOptions}
          value={selectionPreset}
        />
      </div>
      <div className="ss-toolbar-control">
        <span className="ss-toolbar-control-label">Sort By</span>
        <Select
          aria-label="Sort Field"
          onValueChange={(value) => onSortKeyChange(buildSortKey(value as SortField, direction))}
          options={[
            { label: "Published date", value: "published" },
            { label: "Created date", value: "created" },
            { label: "Title", value: "title" },
            { label: "Views", value: "views" },
            { label: "Likes", value: "likes" },
            { label: "Remixes", value: "remixes" }
          ]}
          value={field}
        />
      </div>
      <div className="ss-toolbar-control">
        <span className="ss-toolbar-control-label">Order</span>
        <Select
          aria-label="Sort Direction"
          onValueChange={(value) => onSortKeyChange(buildSortKey(field, value as SortDirection))}
          options={[
            { label: "Ascending", value: "asc" },
            { label: "Descending", value: "desc" }
          ]}
          value={direction}
        />
      </div>
      <div className="ss-toolbar-control">
        <span className="ss-toolbar-control-label">Group By</span>
        <Select
          aria-label="Group Session Results"
          onValueChange={(value) => onGroupByChange(value as GroupByOption)}
          options={[
            { label: "No grouping", value: "none" },
            { label: "Group by creator", value: "creator" },
            { label: "Group by character", value: "character" }
          ]}
          value={groupBy}
        />
      </div>
      <div className="ss-toolbar-control">
        <span className="ss-toolbar-control-label">Hide global downloads?</span>
        <Select
          aria-label="Hide globally downloaded videos"
          onValueChange={(value) => onHideDownloadedVideosChange(value === "true")}
          options={[
            { label: "True", value: "true" },
            { label: "False", value: "false" }
          ]}
          value={hideDownloadedVideos ? "true" : "false"}
        />
      </div>
      <Input
        aria-label="Search Session Results"
        autoComplete="off"
        name="results-search"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search title, prompt, creator, character…"
        spellCheck={false}
        value={query}
      />
    </div>
  );
}

function resolveSelectionPreset(allVisibleSelected: boolean, selectedVisibleRowCount: number): SelectionDisplayValue {
  if (allVisibleSelected) {
    return "all_visible";
  }
  return selectedVisibleRowCount === 0 ? "none" : "custom";
}

function getSortControls(sortKey: VideoSortOption): { field: SortField; direction: SortDirection } {
  if (sortKey === "published_oldest") {
    return { direction: "asc", field: "published" };
  }
  if (sortKey === "created_newest") {
    return { direction: "desc", field: "created" };
  }
  if (sortKey === "created_oldest") {
    return { direction: "asc", field: "created" };
  }
  if (sortKey === "title_asc") {
    return { direction: "asc", field: "title" };
  }
  if (sortKey === "title_desc") {
    return { direction: "desc", field: "title" };
  }
  if (sortKey === "views_most") {
    return { direction: "desc", field: "views" };
  }
  if (sortKey === "views_fewest") {
    return { direction: "asc", field: "views" };
  }
  if (sortKey === "likes_most") {
    return { direction: "desc", field: "likes" };
  }
  if (sortKey === "likes_fewest") {
    return { direction: "asc", field: "likes" };
  }
  if (sortKey === "remixes_most") {
    return { direction: "desc", field: "remixes" };
  }
  if (sortKey === "remixes_fewest") {
    return { direction: "asc", field: "remixes" };
  }
  return { direction: "desc", field: "published" };
}

function buildSortKey(field: SortField, direction: SortDirection): VideoSortOption {
  if (field === "published") {
    return direction === "asc" ? "published_oldest" : "published_newest";
  }
  if (field === "created") {
    return direction === "asc" ? "created_oldest" : "created_newest";
  }
  if (field === "title") {
    return direction === "asc" ? "title_asc" : "title_desc";
  }
  if (field === "views") {
    return direction === "asc" ? "views_fewest" : "views_most";
  }
  if (field === "likes") {
    return direction === "asc" ? "likes_fewest" : "likes_most";
  }
  return direction === "asc" ? "remixes_fewest" : "remixes_most";
}
