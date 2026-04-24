import { formatBytes, formatCount } from "@lib/utils/format-utils";

interface SelectionDownloadSummaryProps {
  selectedBytes: number;
  selectedCount: number;
  totalCount: number;
}

/**
 * Single source of truth for the selected-download summary shown in the app chrome.
 */
export function SelectionDownloadSummary({
  selectedBytes,
  selectedCount,
  totalCount
}: SelectionDownloadSummaryProps) {
  if (selectedCount <= 0) {
    return null;
  }

  return (
    <div aria-label="Selection summary" className="ss-selection-summary">
      <span className="ss-selection-summary-label">Selected</span>
      <strong className="ss-selection-summary-value">
        {`${formatCount(selectedCount)} of ${formatCount(totalCount)} (${formatBytes(selectedBytes)})`}
      </strong>
      <span className="ss-selection-summary-hint">This is what will be downloaded.</span>
    </div>
  );
}
