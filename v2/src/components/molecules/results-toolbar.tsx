import type { VideoSortKey } from "types/domain";
import { Checkbox } from "@components/atoms/checkbox";
import { Input } from "@components/atoms/input";
import { Select } from "@components/atoms/select";

interface ResultsToolbarProps {
  allVisibleSelected: boolean;
  selectableRowCount: number;
  selectedVisibleRowCount: number;
  query: string;
  sortKey: VideoSortKey;
  onSelectAllToggle: (checked: boolean) => void;
  onQueryChange: (value: string) => void;
  onSortKeyChange: (value: VideoSortKey) => void;
}

/**
 * Query and sort controls for the results surface.
 */
export function ResultsToolbar({
  allVisibleSelected,
  onQueryChange,
  onSelectAllToggle,
  onSortKeyChange,
  query,
  selectableRowCount,
  selectedVisibleRowCount,
  sortKey
}: ResultsToolbarProps) {
  const checkboxState =
    selectedVisibleRowCount === 0 ? false : allVisibleSelected ? true : "indeterminate";

  return (
    <div className="ss-toolbar">
      <Input onChange={(event) => onQueryChange(event.target.value)} placeholder="Search prompt, title, creator, character" value={query} />
      <Checkbox
        checked={checkboxState}
        disabled={selectableRowCount === 0}
        id="select-all-visible"
        label={`Select visible rows (${selectedVisibleRowCount}/${selectableRowCount})`}
        onCheckedChange={onSelectAllToggle}
      />
      <Select
        onValueChange={(value) => onSortKeyChange(value as VideoSortKey)}
        options={[
          { label: "Published date", value: "published_at" },
          { label: "Created date", value: "created_at" },
          { label: "Fetched date", value: "fetched_at" },
          { label: "Title", value: "title" },
          { label: "Creator", value: "creator_name" },
          { label: "Character", value: "character_name" },
          { label: "Source", value: "source_type" },
          { label: "Views", value: "view_count" },
          { label: "Likes", value: "like_count" },
          { label: "Duration", value: "duration_seconds" }
        ]}
        value={sortKey}
      />
    </div>
  );
}
