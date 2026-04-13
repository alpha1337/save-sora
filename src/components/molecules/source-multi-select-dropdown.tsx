import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown,
  FileText,
  Heart,
  Sparkles,
  User,
  Users
} from "lucide-react";
import type { SourceSelectionState, TopLevelSourceType } from "types/domain";
import { Checkbox } from "@components/atoms/checkbox";

interface SourceMultiSelectDropdownProps {
  disabled?: boolean;
  sourceSelections: SourceSelectionState;
  onToggleSource: (source: TopLevelSourceType, checked: boolean) => void;
}

const SOURCE_OPTIONS: Array<{ icon: ReactNode; label: string; source: TopLevelSourceType }> = [
  { source: "profile", label: "Published", icon: <FileText aria-hidden="true" size={14} /> },
  { source: "drafts", label: "Drafts", icon: <FileText aria-hidden="true" size={14} /> },
  { source: "likes", label: "Likes", icon: <Heart aria-hidden="true" size={14} /> },
  { source: "characters", label: "Cameos", icon: <Users aria-hidden="true" size={14} /> },
  { source: "characterAccounts", label: "Character Accounts", icon: <User aria-hidden="true" size={14} /> },
  { source: "creators", label: "Saved Creators", icon: <Sparkles aria-hidden="true" size={14} /> }
];

export function SourceMultiSelectDropdown({
  disabled = false,
  onToggleSource,
  sourceSelections
}: SourceMultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedCount = useMemo(
    () => SOURCE_OPTIONS.filter((option) => sourceSelections[option.source]).length,
    [sourceSelections]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="ss-source-dropdown" ref={rootRef}>
      <button
        aria-expanded={open}
        className="ss-source-dropdown-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selectedCount > 0 ? `${selectedCount} sources` : "Select sources"}</span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="ss-source-dropdown-menu">
          {SOURCE_OPTIONS.map((option) => (
            <div className="ss-source-dropdown-item" key={option.source}>
              <Checkbox
                checked={sourceSelections[option.source]}
                disabled={disabled}
                id={`header-source-${option.source}`}
                label={option.label}
                onCheckedChange={(checked) => onToggleSource(option.source, checked)}
              />
              <span className="ss-source-dropdown-icon">{option.icon}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
