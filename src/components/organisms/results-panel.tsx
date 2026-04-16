import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { DownloadProgressState, FetchProgressState, GroupByOption, VideoRow, VideoSortOption } from "types/domain";
import { Button } from "@components/atoms/button";
import { Checkbox } from "@components/atoms/checkbox";
import { Panel } from "@components/atoms/panel";
import { SummaryStat } from "@components/atoms/summary-stat";
import { ResultsToolbar } from "@components/molecules/results-toolbar";
import { VideoMetadataCard } from "@components/molecules/video-metadata-card";
import { getFetchJobStatusLabel } from "@lib/utils/fetch-status";
import { formatBytes, formatCount } from "@lib/utils/format-utils";

interface ResultsPanelProps {
  allVisibleSelected: boolean;
  downloadableRowCount: number;
  downloadProgress: DownloadProgressState;
  fetchProgress: FetchProgressState;
  hasRows: boolean;
  hasQuery: boolean;
  phase: string;
  rows: VideoRow[];
  selectableRowCount: number;
  selectedDownloadableRowCount: number;
  selectedBytes: number;
  selectedVideoIds: string[];
  selectedVisibleRowCount: number;
  totalRowCount: number;
  query: string;
  sortKey: VideoSortOption;
  groupBy: GroupByOption;
  downloadDisabled?: boolean;
  exportDisabled?: boolean;
  hasSidebar?: boolean;
  sidebarCollapsed?: boolean;
  onDownload: () => void;
  onExportCsv: () => void;
  onToggleSidebar?: () => void;
  onSelectionPresetChange: (preset: "all_visible" | "mine" | "others" | "none") => void;
  onQueryChange: (value: string) => void;
  onSortKeyChange: (value: VideoSortOption) => void;
  onGroupByChange: (value: GroupByOption) => void;
  onSetSelectedVideoIds: (videoIds: string[]) => void;
  onToggleSelectedVideoId: (videoId: string) => void;
}

/**
 * Main results surface, rendered from normalized rows only.
 */
export function ResultsPanel({
  allVisibleSelected,
  downloadableRowCount,
  downloadProgress,
  fetchProgress,
  downloadDisabled = false,
  exportDisabled = false,
  hasSidebar = false,
  hasRows,
  hasQuery,
  phase,
  onDownload,
  onExportCsv,
  onToggleSidebar,
  onSelectionPresetChange,
  onQueryChange,
  onSortKeyChange,
  onSetSelectedVideoIds,
  onToggleSelectedVideoId,
  query,
  rows,
  selectableRowCount,
  selectedDownloadableRowCount,
  selectedBytes,
  selectedVideoIds,
  selectedVisibleRowCount,
  totalRowCount,
  sortKey,
  groupBy,
  sidebarCollapsed = false,
  onGroupByChange
}: ResultsPanelProps) {
  const [activePreviewRowId, setActivePreviewRowId] = useState("");
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<string[]>([]);
  const hasZipSelection = selectedDownloadableRowCount > 0;
  const showFetchProgress = phase === "fetching" || fetchProgress.running_jobs > 0;
  const showDownloadProgress = phase === "downloading" || downloadProgress.running_workers > 0;
  const activeFetchJobs = useMemo(
    () => fetchProgress.job_progress.filter((job) => job.status !== "completed"),
    [fetchProgress.job_progress]
  );
  const groupedRows = useMemo(
    () => (groupBy === "none" ? [] : buildGroupedRows(rows, groupBy)),
    [groupBy, rows]
  );

  useEffect(() => {
    if (groupBy === "none") {
      setCollapsedGroupKeys([]);
      return;
    }

    setCollapsedGroupKeys((current) => current.filter((key) => groupedRows.some((group) => group.key === key)));
  }, [groupBy, groupedRows]);
  return (
    <Panel className="ss-stack ss-panel--stretch">
      <div className="ss-section-heading">
        <div>
          <h2>Session Results</h2>
        </div>
        <div className="ss-inline-actions">
          {hasSidebar && onToggleSidebar ? (
            <Button className="ss-sidebar-toggle" onClick={onToggleSidebar} tone="secondary" type="button">
              {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
            </Button>
          ) : null}
          <Button disabled={exportDisabled} onClick={onExportCsv} tone="secondary" type="button">
            <FileSpreadsheet aria-hidden="true" size={16} />
            Export CSV
          </Button>
          <Button disabled={downloadDisabled} onClick={onDownload} type="button">
            <Download aria-hidden="true" size={16} />
            {hasZipSelection
              ? `Build ZIP (${selectedDownloadableRowCount} · ${formatBytes(selectedBytes)})`
              : downloadableRowCount > 0
                ? `Build ZIP (${formatCount(downloadableRowCount)} ready)`
                : "Select videos to build ZIP"}
          </Button>
        </div>
      </div>
      {hasRows ? (
        <div className="ss-summary-stat-grid">
          <SummaryStat
            hint="Ready videos selected for ZIP"
            label="Selected"
            value={`${formatCount(selectedDownloadableRowCount)} of ${formatCount(downloadableRowCount)}`}
          />
          <SummaryStat hint="Combined estimated size of selected rows" label="Selected Size" value={formatBytes(selectedBytes)} />
        </div>
      ) : null}
      {showFetchProgress ? (
        <div className="ss-download-progress-panel">
          <div className="ss-download-progress-head">
            <strong>{fetchProgress.active_label || "Fetching rows"}</strong>
            <span className="ss-muted">
              {formatCount(fetchProgress.completed_jobs)}/{formatCount(fetchProgress.total_jobs)} jobs
            </span>
          </div>
          <div className="ss-download-progress-track" aria-hidden="true">
            <div
              className="ss-download-progress-fill"
              style={{ width: `${formatProgressPercent(fetchProgress.completed_jobs, fetchProgress.total_jobs)}%` }}
            />
          </div>
          <div className="ss-download-worker-list">
            {activeFetchJobs.length > 0 ? (
              activeFetchJobs.map((job) => (
                <div className="ss-download-worker-row" key={job.job_id}>
                  <div className="ss-download-worker-main">
                    <strong>{job.label}</strong>
                    <span className="ss-muted">{getFetchJobStatusLabel(job)}</span>
                    <div className="ss-download-worker-progress-track" aria-hidden="true">
                      <div
                        className="ss-download-worker-progress-fill"
                        style={{ width: `${formatFetchJobProgressPercent(job)}%` }}
                      />
                    </div>
                  </div>
                  <span className="ss-download-worker-meta">{`${formatFetchJobProgressPercent(job)}%`}</span>
                </div>
              ))
            ) : (
              <div className="ss-muted">No active jobs in queue.</div>
            )}
          </div>
        </div>
      ) : null}
      {showDownloadProgress ? (
        <div className="ss-download-progress-panel">
          <div className="ss-download-progress-head">
            <strong>{downloadProgress.active_label || "Building ZIP archive"}</strong>
            <span className="ss-muted">
              {formatCount(downloadProgress.completed_items)}/{formatCount(downloadProgress.total_items)} files
            </span>
          </div>
          <div className="ss-download-progress-track" aria-hidden="true">
            <div
              className="ss-download-progress-fill"
              style={{ width: `${formatProgressPercent(downloadProgress.completed_items, downloadProgress.total_items)}%` }}
            />
          </div>
          <div className="ss-download-worker-list">
            {downloadProgress.worker_progress.length > 0 ? (
              downloadProgress.worker_progress.map((worker) => (
                <div className="ss-download-worker-row" key={worker.worker_id}>
                  <div className="ss-download-worker-main">
                    <strong>{worker.label}</strong>
                    <span className="ss-muted">
                      {worker.active_item_label
                        ? worker.active_item_label
                        : worker.last_completed_item_label
                          ? `Last: ${worker.last_completed_item_label}`
                          : "Queued"}
                    </span>
                    <div className="ss-download-worker-progress-track" aria-hidden="true">
                      <div
                        className="ss-download-worker-progress-fill"
                        style={{ width: `${formatWorkerProgressPercent(worker.completed_items, downloadProgress)}%` }}
                      />
                    </div>
                  </div>
                  <span className="ss-download-worker-meta">{`${formatWorkerProgressPercent(worker.completed_items, downloadProgress)}%`}</span>
                </div>
              ))
            ) : (
              <div className="ss-muted">Starting workers…</div>
            )}
          </div>
        </div>
      ) : null}
      <ResultsToolbar
        allVisibleSelected={allVisibleSelected}
        groupBy={groupBy}
        onSelectionPresetChange={onSelectionPresetChange}
        onGroupByChange={onGroupByChange}
        onQueryChange={onQueryChange}
        onSortKeyChange={onSortKeyChange}
        query={query}
        selectableRowCount={selectableRowCount}
        selectedVisibleRowCount={selectedVisibleRowCount}
        sortKey={sortKey}
      />
      <div className="ss-table-shell">
        {rows.length === 0 ? (
          <div className="ss-empty-state">
            <strong>{query.trim() ? "No rows match your filters." : "No rows in this session yet."}</strong>
            <div className="ss-muted">
              {query.trim()
                ? `Clear or change search to see the other ${formatCount(totalRowCount)} rows in this session.`
                : phase === "fetching"
                  ? "Fetch is running. Rows appear here as accepted result pages are stored."
                  : "Choose sources, fetch results, and downloadable rows will appear here."}
            </div>
          </div>
        ) : (
          renderRowsWithGrouping(
            rows,
            groupBy,
            selectedVideoIds,
            activePreviewRowId,
            collapsedGroupKeys,
            (groupKey) =>
              setCollapsedGroupKeys((current) =>
                current.includes(groupKey)
                  ? current.filter((key) => key !== groupKey)
                  : [...current, groupKey]
              ),
            (rowId) => setActivePreviewRowId((currentRowId) => (currentRowId === rowId ? "" : rowId)),
            onSetSelectedVideoIds,
            onToggleSelectedVideoId
          )
        )}
      </div>
    </Panel>
  );
}

function formatProgressPercent(completedItems: number, totalItems: number): number {
  if (totalItems <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((completedItems / totalItems) * 100)));
}

function formatWorkerProgressPercent(completedItems: number, downloadProgress: DownloadProgressState): number {
  const workerCount = Math.max(1, downloadProgress.total_workers);
  const estimatedItemsPerWorker = Math.max(1, Math.ceil(downloadProgress.total_items / workerCount));
  return Math.min(100, Math.max(0, Math.round((completedItems / estimatedItemsPerWorker) * 100)));
}

function formatFetchJobProgressPercent(job: FetchProgressState["job_progress"][number]): number {
  if (typeof job.expected_total_count === "number" && job.expected_total_count > 0) {
    return Math.min(100, Math.max(0, Math.round((job.fetched_rows / job.expected_total_count) * 100)));
  }
  const draftResolutionProgressMatch = (job.active_item_title ?? "").match(/Resolving draft IDs\s+(\d+)\/(\d+)\s+processed/i);
  if (draftResolutionProgressMatch) {
    const processed = Number(draftResolutionProgressMatch[1]);
    const total = Number(draftResolutionProgressMatch[2]);
    if (Number.isFinite(processed) && Number.isFinite(total) && total > 0) {
      return Math.min(95, Math.max(5, Math.round((processed / total) * 95)));
    }
  }
  if (job.status === "completed") {
    return 100;
  }
  if (job.status === "running") {
    return Math.min(95, Math.max(5, job.processed_batches * 20));
  }
  return 0;
}

function formatSkipReasonLabel(reason: string): string {
  if (!reason) {
    return "";
  }
  if (reason === "unresolved_draft_video_id") {
    return "Draft not published/shared yet";
  }
  if (reason === "draft_error") {
    return "Draft failed to generate";
  }
  if (reason === "draft_content_violation") {
    return "Draft blocked (content policy)";
  }
  if (reason === "draft_edit_or_remix") {
    return "Edited/remix draft is not shareable";
  }
  if (reason === "missing_video_id") {
    return "Final video ID not resolved";
  }
  if (reason === "multi_attachment_unsupported") {
    return "Multiple attachments not yet supported";
  }
  return reason.replaceAll("_", " ");
}

function renderRowsWithGrouping(
  rows: VideoRow[],
  groupBy: GroupByOption,
  selectedVideoIds: string[],
  activePreviewRowId: string,
  collapsedGroupKeys: string[],
  onGroupToggle: (groupKey: string) => void,
  onPreviewToggle: (rowId: string) => void,
  onSetSelectedVideoIds: (videoIds: string[]) => void,
  onToggleSelectedVideoId: (videoId: string) => void
) {
  if (groupBy === "none") {
    return (
      <div className="ss-results-card-grid">
        {rows.map((row) => (
          <VideoMetadataCard
            key={row.row_id}
            onPreviewToggle={onPreviewToggle}
            onToggleSelectedVideoId={onToggleSelectedVideoId}
            previewActive={activePreviewRowId === row.row_id}
            row={row}
            selected={selectedVideoIds.includes(row.video_id)}
            skipReasonLabel={formatSkipReasonLabel(row.skip_reason)}
          />
        ))}
      </div>
    );
  }

  const groupedRows = buildGroupedRows(rows, groupBy);
  return (
    <div className="ss-results-group-list">
      {groupedRows.map((group) => (
        <section className="ss-results-group" key={group.key}>
          {(() => {
            const selectableGroupVideoIds = group.rows
              .filter((row) => row.is_downloadable && row.video_id)
              .map((row) => row.video_id);
            const selectedGroupCount = selectableGroupVideoIds.filter((videoId) => selectedVideoIds.includes(videoId)).length;
            const groupCheckboxState = selectedGroupCount === 0
              ? false
              : selectedGroupCount === selectableGroupVideoIds.length
                ? true
                : "indeterminate";

            return (
              <div className="ss-results-group-head">
                <div className="ss-results-group-header">
                  <Checkbox
                    checked={groupCheckboxState}
                    disabled={selectableGroupVideoIds.length === 0}
                    id={`group-select-${group.key.replaceAll(":", "-")}`}
                    label={group.label}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onSetSelectedVideoIds([...new Set([...selectedVideoIds, ...selectableGroupVideoIds])]);
                        return;
                      }
                      const groupIdSet = new Set(selectableGroupVideoIds);
                      onSetSelectedVideoIds(selectedVideoIds.filter((videoId) => !groupIdSet.has(videoId)));
                    }}
                  />
                  <span className="ss-muted">
                    {selectedGroupCount}/{selectableGroupVideoIds.length} selected · {group.rows.length} videos
                  </span>
                </div>
                <button
                  aria-expanded={!collapsedGroupKeys.includes(group.key)}
                  aria-label={`Toggle ${group.label} group`}
                  className="ss-results-group-collapse"
                  onClick={() => onGroupToggle(group.key)}
                  type="button"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`ss-results-group-chevron ${collapsedGroupKeys.includes(group.key) ? "is-collapsed" : ""}`}
                    size={16}
                  />
                </button>
              </div>
            );
          })()}
          {!collapsedGroupKeys.includes(group.key) ? (
            <div className="ss-results-card-grid">
              {group.rows.map((row) => (
                <VideoMetadataCard
                  key={row.row_id}
                  onPreviewToggle={onPreviewToggle}
                  onToggleSelectedVideoId={onToggleSelectedVideoId}
                  previewActive={activePreviewRowId === row.row_id}
                  row={row}
                  selected={selectedVideoIds.includes(row.video_id)}
                  skipReasonLabel={formatSkipReasonLabel(row.skip_reason)}
                />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function buildGroupedRows(rows: VideoRow[], groupBy: Exclude<GroupByOption, "none">): Array<{ key: string; label: string; rows: VideoRow[] }> {
  const groupMap = new Map<string, VideoRow[]>();

  for (const row of rows) {
    const label = resolveGroupLabel(row, groupBy);
    if (!groupMap.has(label)) {
      groupMap.set(label, []);
    }
    groupMap.get(label)?.push(row);
  }

  return [...groupMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, groupedRows]) => ({ key: `${groupBy}:${label}`, label, rows: groupedRows }));
}

function resolveGroupLabel(row: VideoRow, groupBy: Exclude<GroupByOption, "none">): string {
  if (groupBy === "creator") {
    return row.creator_name?.trim() || row.creator_username?.trim() || "Unknown creator";
  }
  const firstCharacter = row.character_names.find((name) => name?.trim());
  return firstCharacter?.trim() || row.character_name?.trim() || row.character_username?.trim() || "No character";
}
