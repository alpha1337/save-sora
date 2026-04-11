import type { VideoSortKey } from "types/domain";
import { Input } from "@components/atoms/input";
import { Select } from "@components/atoms/select";

interface ResultsToolbarProps {
  query: string;
  sortKey: VideoSortKey;
  onQueryChange: (value: string) => void;
  onSortKeyChange: (value: VideoSortKey) => void;
}

/**
 * Query and sort controls for the results surface.
 */
export function ResultsToolbar({ onQueryChange, onSortKeyChange, query, sortKey }: ResultsToolbarProps) {
  return (
    <div className="ss-toolbar">
      <Input onChange={(event) => onQueryChange(event.target.value)} placeholder="Search prompt, title, creator, character" value={query} />
      <Select
        onValueChange={(value) => onSortKeyChange(value as VideoSortKey)}
        options={[
          { label: "Published date", value: "published_at" },
          { label: "Created date", value: "created_at" },
          { label: "Title", value: "title" }
        ]}
        value={sortKey}
      />
    </div>
  );
}
