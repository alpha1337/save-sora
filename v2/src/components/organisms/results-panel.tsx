import { Download, FileSpreadsheet } from "lucide-react";
import type { VideoRow, VideoSortKey } from "types/domain";
import { Badge } from "@components/atoms/badge";
import { Button } from "@components/atoms/button";
import { Checkbox } from "@components/atoms/checkbox";
import { Panel } from "@components/atoms/panel";
import { ResultsToolbar } from "@components/molecules/results-toolbar";
import { formatCount, formatDate, formatDuration } from "@lib/utils/format-utils";

interface ResultsPanelProps {
  allVisibleSelected: boolean;
  downloadableRowCount: number;
  hasRows: boolean;
  rows: VideoRow[];
  selectableRowCount: number;
  selectedDownloadableRowCount: number;
  selectedVideoIds: string[];
  selectedVisibleRowCount: number;
  query: string;
  sortKey: VideoSortKey;
  downloadDisabled?: boolean;
  exportDisabled?: boolean;
  onDownload: () => void;
  onExportCsv: () => void;
  onQueryChange: (value: string) => void;
  onSelectAllToggle: (checked: boolean) => void;
  onSortKeyChange: (value: VideoSortKey) => void;
  onToggleSelectedVideoId: (videoId: string) => void;
}

/**
 * Main results surface, rendered from normalized rows only.
 */
export function ResultsPanel({
  allVisibleSelected,
  downloadableRowCount,
  downloadDisabled = false,
  exportDisabled = false,
  hasRows,
  onDownload,
  onExportCsv,
  onQueryChange,
  onSelectAllToggle,
  onSortKeyChange,
  onToggleSelectedVideoId,
  query,
  rows,
  selectableRowCount,
  selectedDownloadableRowCount,
  selectedVideoIds,
  selectedVisibleRowCount,
  sortKey
}: ResultsPanelProps) {
  const downloadCountLabel = selectedDownloadableRowCount > 0 ? selectedDownloadableRowCount : downloadableRowCount;

  return (
    <Panel className="ss-stack ss-panel--stretch">
      <div className="ss-section-heading">
        <div>
          <h2>Session Results</h2>
          <p className="ss-muted">
            {hasRows
              ? `${rows.length} visible rows · ${downloadableRowCount} downloadable · ${selectedDownloadableRowCount} selected`
              : "Normalized video rows with queueable `s_*` ids only."}
          </p>
        </div>
        <div className="ss-inline-actions">
          <Button disabled={exportDisabled} onClick={onExportCsv} tone="secondary" type="button">
            <FileSpreadsheet size={16} />
            Export CSV
          </Button>
          <Button disabled={downloadDisabled} onClick={onDownload} type="button">
            <Download size={16} />
            {downloadCountLabel > 0 ? `Build ZIP (${downloadCountLabel})` : "Build ZIP"}
          </Button>
        </div>
      </div>
      <ResultsToolbar
        allVisibleSelected={allVisibleSelected}
        onQueryChange={onQueryChange}
        onSelectAllToggle={onSelectAllToggle}
        onSortKeyChange={onSortKeyChange}
        query={query}
        selectableRowCount={selectableRowCount}
        selectedVisibleRowCount={selectedVisibleRowCount}
        sortKey={sortKey}
      />
      <div className="ss-table-shell">
        {rows.length === 0 ? (
          <div className="ss-empty-state">
            <strong>{query.trim() ? "No rows match your search." : "No rows in this session yet."}</strong>
            <div className="ss-muted">
              {query.trim()
                ? "Clear or change the search text to see more results."
                : "Choose sources, fetch results, and downloadable rows will appear here."}
            </div>
          </div>
        ) : (
          <table className="ss-table">
            <thead>
              <tr>
                <th>Select</th>
                <th>Video</th>
                <th>Source</th>
                <th>Creator</th>
                <th>Character</th>
                <th>Published</th>
                <th>Duration</th>
                <th>Views</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.row_id}>
                  <td>
                    <Checkbox
                      checked={selectedVideoIds.includes(row.video_id)}
                      disabled={!row.is_downloadable || !row.video_id}
                      id={`row-${row.row_id}`}
                      label=""
                      onCheckedChange={() => onToggleSelectedVideoId(row.video_id)}
                    />
                  </td>
                  <td>
                    <div className="ss-video-title">{row.title}</div>
                    <div className="ss-muted">{row.video_id || row.skip_reason || row.row_id}</div>
                    {row.is_downloadable ? <Badge tone="success">downloadable</Badge> : <Badge tone="warning">{row.skip_reason}</Badge>}
                  </td>
                  <td>{row.source_type}</td>
                  <td>{row.creator_name || "-"}</td>
                  <td>{row.character_names.join(", ") || row.character_name || "-"}</td>
                  <td>{formatDate(row.published_at)}</td>
                  <td>{formatDuration(row.duration_seconds)}</td>
                  <td>{formatCount(row.view_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
