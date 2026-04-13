import type { SourceSelectionState, TopLevelSourceType } from "types/domain";
import { Checkbox } from "@components/atoms/checkbox";

interface SourceSelectorProps {
  disabled?: boolean;
  sourceSelections: SourceSelectionState;
  onToggleSource: (source: TopLevelSourceType, checked: boolean) => void;
}

const SOURCE_LABELS: Record<TopLevelSourceType, string> = {
  profile: "Published",
  drafts: "Drafts",
  likes: "Likes",
  characters: "Cameos",
  characterAccounts: "Character Accounts",
  creators: "Saved Creators"
};

/**
 * Source selection list kept intentionally dumb and prop-driven.
 */
export function SourceSelector({ disabled = false, onToggleSource, sourceSelections }: SourceSelectorProps) {
  return (
    <div className="ss-stack">
      {(Object.keys(SOURCE_LABELS) as TopLevelSourceType[]).map((source) => (
        <Checkbox
          checked={sourceSelections[source]}
          disabled={disabled}
          id={`source-${source}`}
          key={source}
          label={SOURCE_LABELS[source]}
          onCheckedChange={(checked) => onToggleSource(source, checked)}
        />
      ))}
    </div>
  );
}
