import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import type { DownloadProgressState, FetchProgressState, GroupByOption, VideoRow, VideoSortOption } from "types/domain";
import { Button } from "@components/atoms/button";
import { Checkbox } from "@components/atoms/checkbox";
import { Panel } from "@components/atoms/panel";
import { ResultsToolbar } from "@components/molecules/results-toolbar";
import { VideoMetadataCard } from "@components/molecules/video-metadata-card";
import { formatBytes, formatCount } from "@lib/utils/format-utils";

const FETCH_HEADLINE_PHRASES = [
    "Rendering pigeons with cinematic ambition...",
    "Teaching pixels to believe in themselves...",
    "Summoning director mode from the void...",
    "Loading one more dramatic camera pan...",
    "Bypassing content violations...",
    "Compiling pure main-character energy...",
    "Adding 12 percent more plot twist...",
    "Calibrating chaos to studio standards...",
    "Cue the slow-motion hair flip...",
    "Upgrading potato quality to prestige drama...",
    "Reticulating storyboards...",
    "The timeline is doing timeline things...",
    "Injecting extra cinematic nonsense...",
    "Making every frame legally iconic...",
    "This montage has no business going this hard...",
    "Finding the most dramatic frame possible...",
    "Converting vibes into video...",
    "Crunching clips and questionable decisions...",
    "Loading a suspiciously expensive transition...",
    "Stabilizing handheld chaos...",
    "Trying not to drop any lore...",
    "Rendering like its awards season...",
    "Assembling meme physics...",
    "Rehearsing the perfect reaction shot...",
    "Fine-tuning the boom wow ratio...",
    "Adding depth, drama, and a little delusion...",
    "Polishing frames until they sparkle...",
    "Applying cinematic tax...",
    "Putting the Sora in sorcery...",
    "Generating scenes the algorithm dreamed about...",
    "Bribing the compression goblins...",
    "Turning side quests into feature films...",
    "Syncing audio in spirit...",
    "Cooking at 4K energy levels...",
    "Rendering faster than your group chat rumors...",
    "Building the directors cut of this fetch...",
    "Finding continuity in absolute chaos...",
    "Deploying premium b-roll vibes...",
    "Loading dramatic pause...",
    "Teaching the camera to hit its mark...",
    "Collecting clips like infinity stones...",
    "Adjusting exposure and expectations...",
    "Preheating the render farm...",
    "Making every second trailer-worthy...",
    "Converting caffeine into frame rate...",
    "Queueing scenes with unreasonable confidence...",
    "Manifesting a clean export...",
    "Generating cinema, one questionable choice at a time...",
    "Hold my popcorn, this fetch is cooking...",
    "Digging through the cloud...",
    "Shaking the data tree...",
    "Bribing the servers with electricity...",
    "Asking nicely for your videos...",
    "Opening way too many boxes...",
    "Hunting for the good stuff...",
    "Dusting off old files...",
    "Convincing pixels to cooperate...",
    "Following the digital breadcrumbs...",
    "Knocking on Sora's door...",
    "Checking under the couch...",
    "Waking up sleepy servers...",
    "Looking everywhere except where it is...",
    "Making things less lost...",
    "Arguing with the internet...",
    "Counting... losing count... counting again...",
    "Speedrunning your archive...",
    "Politely stealing your data back...",
    "Asking 'are we there yet?'",
    "Turning chaos into results...",
    "Poking around suspicious folders...",
    "Negotiating with the algorithm...",
    "Translating computer nonsense...",
    "Grabbing things before they disappear...",
    "Doing important-looking work...",
    "Spinning in a loading circle...",
    "Definitely not stuck... probably...",
    "Sneaking past watermarks...",
    "Searching high and low...",
    "Pressing all the right buttons...",
    "Whispering to the cloud...",
    "Making sense of the mess...",
    "Running faster than your WiFi...",
    "Asking the server again, but louder...",
    "Gathering your digital memories...",
    "Doing the thing... you know... the thing...",
    "Pretending this is instant...",
    "Loading... but dramatically...",
    "Almost there™",
    "Still working, promise...",
    "Sending packets on a journey...",
    "Trying not to break anything...",
    "Pulling rabbits out of hats...",
    "Making downloads happen...",
    "Untangling the spaghetti...",
    "Checking one more place...",
    "This is taking longer than expected...",
    "Trust the process...",
    "Wrapping things up...",
    "Boom. There it is.",
] as const;
const RESUME_LOADING_STATUS_LABEL = "Loading cached rows and checkpoints...";
const RESUME_LOADING_HEADLINE = "Please wait patiently while the fetch resumes";
const RESULTS_PAGE_SIZE = 100;

interface ResultsPanelProps {
  allVisibleSelected: boolean;
  downloadableRowCount: number;
  downloadProgress: DownloadProgressState;
  fetchProgress: FetchProgressState;
  hasQuery: boolean;
  hiddenDownloadedRowCount?: number;
  phase: string;
  rows: VideoRow[];
  selectableRowCount: number;
  selectedDownloadableRowCount: number;
  selectedBytes: number;
  selectedVideoIds: string[];
  selectedVisibleRowCount: number;
  totalRowCount: number;
  query: string;
  hideDownloadedVideos?: boolean;
  sortKey: VideoSortOption;
  groupBy: GroupByOption;
  downloadDisabled?: boolean;
  hasSidebar?: boolean;
  sidebarCollapsed?: boolean;
  canClearResults?: boolean;
  showClearResults?: boolean;
  onDownload: () => void;
  onClearResults?: () => void;
  onToggleSidebar?: () => void;
  onSelectionPresetChange: (preset: "all_visible" | "mine" | "others" | "none") => void;
  onHideDownloadedVideosChange?: (value: boolean) => void;
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
  hasSidebar = false,
  hasQuery: _hasQuery,
  hiddenDownloadedRowCount = 0,
  phase,
  canClearResults = true,
  showClearResults = false,
  onClearResults = () => {},
  onDownload,
  onToggleSidebar,
  onSelectionPresetChange,
  onHideDownloadedVideosChange = () => {},
  onQueryChange,
  onSortKeyChange,
  onSetSelectedVideoIds,
  onToggleSelectedVideoId,
  query,
  hideDownloadedVideos = false,
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
  const [etaTickMs, setEtaTickMs] = useState(() => Date.now());
  const [fetchStartedAtMs, setFetchStartedAtMs] = useState<number | null>(null);
  const [fetchHeadline, setFetchHeadline] = useState("Fetching");
  const [currentResultsPage, setCurrentResultsPage] = useState(1);
  const fetchHeadlineQueueRef = useRef<string[]>([]);
  const wasShowingFetchProgressRef = useRef(false);
  const wasResumeLoadingRef = useRef(false);
  const hasZipSelection = selectedDownloadableRowCount > 0;
  const sidebarToggleLabel = sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar";
  const showFetchProgress = phase === "fetching";
  const showDownloadProgress = phase === "downloading" || downloadProgress.running_workers > 0;
  const runningFetchJobs = useMemo(
    () => fetchProgress.job_progress.filter((job) => job.status === "running"),
    [fetchProgress.job_progress]
  );
  const activeFetchJobs = useMemo(
    () => fetchProgress.job_progress.filter((job) => job.status !== "completed"),
    [fetchProgress.job_progress]
  );
  const activeFetchJob = useMemo(
    () =>
      fetchProgress.job_progress.find((job) => job.status === "running") ??
      fetchProgress.job_progress.find((job) => job.status !== "completed") ??
      null,
    [fetchProgress.job_progress]
  );
  const hasConcurrentFetchJobs = runningFetchJobs.length > 1;
  const currentBatchProgressPercent = useMemo(
    () => getCurrentBatchProgressPercent(activeFetchJob, fetchProgress),
    [activeFetchJob, fetchProgress]
  );
  const overallFetchCompletionPercent = useMemo(
    () => getOverallFetchCompletionPercent(fetchProgress),
    [fetchProgress]
  );
  const overallFetchPercentLabel = useMemo(
    () => formatFetchOverallPercentLabel(overallFetchCompletionPercent),
    [overallFetchCompletionPercent]
  );
  const fetchEtaLabel = useMemo(
    () => buildFetchEtaLabel(fetchProgress, activeFetchJobs, etaTickMs, fetchStartedAtMs),
    [activeFetchJobs, etaTickMs, fetchProgress, fetchStartedAtMs]
  );
  const fetchTimeLeftMetaLabel = useMemo(
    () => formatFetchTimeLeftMetaLabel(fetchEtaLabel),
    [fetchEtaLabel]
  );
  const overallPageProgressLabel = useMemo(
    () => (activeFetchJob ? formatOverallPageProgressLabel(activeFetchJob) : ""),
    [activeFetchJob]
  );
  const fetchProgressTrackPercent = useMemo(
    () => (hasConcurrentFetchJobs ? overallFetchCompletionPercent : currentBatchProgressPercent),
    [currentBatchProgressPercent, hasConcurrentFetchJobs, overallFetchCompletionPercent]
  );
  const fetchStatusLabel = useMemo(() => {
    if (hasConcurrentFetchJobs) {
      return `Fetching ${formatCount(runningFetchJobs.length)} sources in parallel · ${formatCount(fetchProgress.processed_rows)} new rows`;
    }
    return fetchProgress.active_label;
  }, [fetchProgress.active_label, fetchProgress.processed_rows, hasConcurrentFetchJobs, runningFetchJobs.length]);
  const shouldShowMultiJobCounter = fetchProgress.total_jobs > 1;
  const isResumeLoading = showFetchProgress && fetchProgress.active_label.trim() === RESUME_LOADING_STATUS_LABEL;
  const totalResultsPages = useMemo(
    () => Math.max(1, Math.ceil(rows.length / RESULTS_PAGE_SIZE)),
    [rows.length]
  );
  const safeCurrentResultsPage = useMemo(
    () => Math.min(totalResultsPages, Math.max(1, currentResultsPage)),
    [currentResultsPage, totalResultsPages]
  );
  const pagedRows = useMemo(() => {
    if (rows.length === 0) {
      return [];
    }
    const startIndex = (safeCurrentResultsPage - 1) * RESULTS_PAGE_SIZE;
    return rows.slice(startIndex, startIndex + RESULTS_PAGE_SIZE);
  }, [rows, safeCurrentResultsPage]);
  const currentResultsRange = useMemo(() => {
    if (rows.length === 0) {
      return { start: 0, end: 0 };
    }
    const start = (safeCurrentResultsPage - 1) * RESULTS_PAGE_SIZE + 1;
    const end = Math.min(rows.length, safeCurrentResultsPage * RESULTS_PAGE_SIZE);
    return { start, end };
  }, [rows.length, safeCurrentResultsPage]);
  const groupedRows = useMemo(
    () => (groupBy === "none" ? [] : buildGroupedRows(pagedRows, groupBy)),
    [groupBy, pagedRows]
  );

  useEffect(() => {
    if (currentResultsPage !== safeCurrentResultsPage) {
      setCurrentResultsPage(safeCurrentResultsPage);
    }
  }, [currentResultsPage, safeCurrentResultsPage]);

  useEffect(() => {
    setCurrentResultsPage(1);
  }, [groupBy, query, sortKey]);

  useEffect(() => {
    if (groupBy === "none") {
      setCollapsedGroupKeys([]);
      return;
    }

    setCollapsedGroupKeys((current) => current.filter((key) => groupedRows.some((group) => group.key === key)));
  }, [groupBy, groupedRows]);

  useEffect(() => {
    if (!showFetchProgress) {
      setFetchStartedAtMs(null);
      return;
    }
    setFetchStartedAtMs((currentValue) => currentValue ?? Date.now());
  }, [showFetchProgress]);

  useEffect(() => {
    const wasShowingFetchProgress = wasShowingFetchProgressRef.current;
    if (showFetchProgress && !wasShowingFetchProgress) {
      if (isResumeLoading) {
        fetchHeadlineQueueRef.current = [];
        setFetchHeadline(RESUME_LOADING_HEADLINE);
      } else {
        fetchHeadlineQueueRef.current = buildShuffledFetchHeadlineQueue();
        const initialHeadline = fetchHeadlineQueueRef.current.shift() ?? "Fetching";
        setFetchHeadline(initialHeadline);
      }
    }
    if (!showFetchProgress) {
      fetchHeadlineQueueRef.current = [];
    }
    wasShowingFetchProgressRef.current = showFetchProgress;
  }, [isResumeLoading, showFetchProgress]);

  useEffect(() => {
    if (!showFetchProgress) {
      wasResumeLoadingRef.current = false;
      return;
    }
    if (isResumeLoading) {
      fetchHeadlineQueueRef.current = [];
      setFetchHeadline(RESUME_LOADING_HEADLINE);
      wasResumeLoadingRef.current = true;
      return;
    }
    if (wasResumeLoadingRef.current) {
      fetchHeadlineQueueRef.current = buildShuffledFetchHeadlineQueue();
      const initialHeadline = fetchHeadlineQueueRef.current.shift() ?? "Fetching";
      setFetchHeadline(initialHeadline);
      wasResumeLoadingRef.current = false;
    }
  }, [isResumeLoading, showFetchProgress]);

  useEffect(() => {
    if (!showFetchProgress || isResumeLoading) {
      return;
    }
    const interval = window.setInterval(() => {
      setFetchHeadline((currentValue) => {
        if (fetchHeadlineQueueRef.current.length === 0) {
          fetchHeadlineQueueRef.current = buildShuffledFetchHeadlineQueue(currentValue);
        }
        return fetchHeadlineQueueRef.current.shift() ?? currentValue;
      });
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [isResumeLoading, showFetchProgress]);

  useEffect(() => {
    if (!showFetchProgress) {
      return;
    }
    const interval = window.setInterval(() => {
      setEtaTickMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [showFetchProgress]);

  return (
    <Panel className="ss-stack ss-panel--stretch">
      <div className="ss-section-heading">
        <div>
          <h2>Session Results</h2>
        </div>
        <div className="ss-inline-actions">
          {hasSidebar && onToggleSidebar ? (
            <Button
              aria-label={sidebarToggleLabel}
              className="ss-sidebar-toggle"
              onClick={onToggleSidebar}
              tone="secondary"
              type="button"
            >
              {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
              {sidebarToggleLabel}
            </Button>
          ) : null}
          {showClearResults ? (
            <Button disabled={!canClearResults} onClick={onClearResults} tone="danger" type="button">
              <Trash2 aria-hidden="true" size={16} />
              Clear Results
            </Button>
          ) : null}
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
      {showFetchProgress ? (
        <div className="ss-download-progress-panel">
          <div className="ss-download-progress-head">
            <div className="ss-download-progress-head-copy">
              <strong className="ss-download-progress-quote">{fetchHeadline}</strong>
              {fetchStatusLabel ? (
                <span className="ss-download-progress-status">{fetchStatusLabel}</span>
              ) : null}
            </div>
            <div className="ss-download-progress-head-actions">
              <span className="ss-fetch-progress-percent">{`${overallFetchPercentLabel} overall`}</span>
            </div>
          </div>
          <div className="ss-download-progress-track" aria-hidden="true">
            <div
              className="ss-download-progress-fill"
              style={{ width: `${fetchProgressTrackPercent}%` }}
            />
          </div>
          <div className="ss-fetch-progress-meta">
            <span className="ss-fetch-progress-pill">{fetchTimeLeftMetaLabel}</span>
            {!hasConcurrentFetchJobs && activeFetchJob
              ? <span className="ss-fetch-progress-pill">{formatCurrentBatchProgressLabel(activeFetchJob)}</span>
              : null}
            {!hasConcurrentFetchJobs && overallPageProgressLabel
              ? <span className="ss-fetch-progress-pill">{overallPageProgressLabel}</span>
              : null}
            {shouldShowMultiJobCounter ? (
              <span className="ss-fetch-progress-pill">
                {`${formatCount(fetchProgress.completed_jobs)}/${formatCount(fetchProgress.total_jobs)} jobs`}
              </span>
            ) : null}
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
        hideDownloadedVideos={hideDownloadedVideos}
        onHideDownloadedVideosChange={onHideDownloadedVideosChange}
        onSelectionPresetChange={onSelectionPresetChange}
        onGroupByChange={onGroupByChange}
        onQueryChange={onQueryChange}
        onSortKeyChange={onSortKeyChange}
        query={query}
        selectableRowCount={selectableRowCount}
        selectedVisibleRowCount={selectedVisibleRowCount}
        sortKey={sortKey}
      />
      {hideDownloadedVideos && hiddenDownloadedRowCount > 0 ? (
        <div className="ss-global-history-notice">
          <span>
            {`${formatCount(hiddenDownloadedRowCount)} videos are hidden by global download history. This can include downloads from other Sora accounts.`}
          </span>
          <Button onClick={() => onHideDownloadedVideosChange(false)} tone="secondary" type="button">
            Show downloaded rows
          </Button>
        </div>
      ) : null}
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
            pagedRows,
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
        {rows.length > RESULTS_PAGE_SIZE ? (
          <div className="ss-results-pagination" role="navigation" aria-label="Session results pagination">
            <span className="ss-results-pagination-summary">
              {`Showing ${formatCount(currentResultsRange.start)}-${formatCount(currentResultsRange.end)} of ${formatCount(rows.length)} videos`}
            </span>
            <div className="ss-results-pagination-actions">
              <Button
                disabled={safeCurrentResultsPage <= 1}
                onClick={() => setCurrentResultsPage((current) => Math.max(1, current - 1))}
                tone="secondary"
                type="button"
              >
                Previous
              </Button>
              <span className="ss-results-pagination-page">
                {`Page ${formatCount(safeCurrentResultsPage)} of ${formatCount(totalResultsPages)}`}
              </span>
              <Button
                disabled={safeCurrentResultsPage >= totalResultsPages}
                onClick={() => setCurrentResultsPage((current) => Math.min(totalResultsPages, current + 1))}
                tone="secondary"
                type="button"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
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

function buildFetchEtaLabel(
  fetchProgress: FetchProgressState,
  activeJobs: FetchProgressState["job_progress"],
  nowMs: number,
  fetchStartedAtMs: number | null
): string {
  if (activeJobs.length === 0) {
    return "Fetching";
  }

  if (fetchProgress.processed_batches <= 0) {
    return "Fetching · calculating time left…";
  }

  if (!fetchStartedAtMs) {
    return "Fetching · calculating time left…";
  }

  const estimatedRemainingPages = activeJobs.reduce((sum, job) => {
    if (typeof job.expected_total_count !== "number" || job.expected_total_count <= 0) {
      return sum;
    }
    const batchLimit = getEstimatedBatchLimitForSource(job.source);
    const totalPages = Math.max(1, Math.ceil(job.expected_total_count / batchLimit));
    const remainingPages = Math.max(0, totalPages - job.processed_batches);
    return sum + remainingPages;
  }, 0);

  if (estimatedRemainingPages <= 0) {
    return "Fetching · finishing…";
  }

  const elapsedPerBatchMs = Math.max(1, nowMs - fetchStartedAtMs) / Math.max(1, fetchProgress.processed_batches);
  const remainingMs = Math.max(1000, Math.round(estimatedRemainingPages * elapsedPerBatchMs));
  return `Fetching · ~${formatDurationMs(remainingMs)} left`;
}

function getEstimatedBatchLimitForSource(source: string): number {
  if (source === "sideCharacter" || source === "characterAccountAppearances" || source === "characters") {
    return 8;
  }
  return 100;
}

function formatDurationMs(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatFetchTimeLeftMetaLabel(fetchEtaLabel: string): string {
  const normalizedLabel = fetchEtaLabel.trim();
  if (!normalizedLabel || normalizedLabel === "Fetching") {
    return "Calculating time left…";
  }

  return normalizedLabel.replace(/^Fetching\s*·\s*/i, "");
}

function getCurrentBatchProgressPercent(
  activeJob: FetchProgressState["job_progress"][number] | null,
  fetchProgress: FetchProgressState
): number {
  if (!activeJob) {
    return formatProgressPercent(fetchProgress.completed_jobs, fetchProgress.total_jobs);
  }
  if (activeJob.status === "completed") {
    return 100;
  }
  const batchPageSize = getCurrentBatchPageSizeForSource(activeJob.source);
  const batchPagePosition = getCurrentBatchPagePosition(activeJob, batchPageSize);
  if (batchPagePosition > 0) {
    return Math.min(100, Math.max(0, (batchPagePosition / batchPageSize) * 100));
  }
  return 0;
}

function formatCurrentBatchProgressLabel(job: FetchProgressState["job_progress"][number]): string {
  const batchPageSize = getCurrentBatchPageSizeForSource(job.source);
  const totalPages = getTotalPagesForJob(job);
  const currentPage = resolveCurrentPageForJob(job, totalPages);
  const pageInBatch = currentPage > 0 ? normalizePageWithinBatch(currentPage, batchPageSize) : 0;
  const currentBatch = currentPage > 0 ? Math.ceil(currentPage / batchPageSize) : 0;

  if (typeof totalPages === "number" && totalPages > 0) {
    const totalBatches = Math.max(1, Math.ceil(totalPages / batchPageSize));
    return `Processing Batch ${formatCount(currentBatch)} of ${formatCount(totalBatches)} (Page ${pageInBatch}/${batchPageSize})`;
  }

  return `Processing Batch ${formatCount(currentBatch)} (Page ${pageInBatch}/${batchPageSize})`;
}

function formatOverallPageProgressLabel(job: FetchProgressState["job_progress"][number]): string {
  const totalPages = getTotalPagesForJob(job);
  if (typeof totalPages !== "number" || totalPages <= 0) {
    return "";
  }

  const currentPage = resolveCurrentPageForJob(job, totalPages);
  const pagePercent = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  return `Page ${formatCount(currentPage)}/${formatCount(totalPages)} (${formatPageProgressPercent(pagePercent)})`;
}

function formatPageProgressPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "0.000%";
  }
  if (percent < 1) {
    return `${percent.toFixed(3)}%`;
  }
  if (percent < 10) {
    return `${percent.toFixed(2)}%`;
  }
  if (percent < 100) {
    return `${percent.toFixed(1)}%`;
  }
  return "100%";
}

function getCurrentBatchPageSizeForSource(source: string): number {
  if (source === "sideCharacter" || source === "characterAccountAppearances") {
    return 24;
  }
  return 1;
}

function getCurrentBatchPagePosition(
  job: FetchProgressState["job_progress"][number],
  batchPageSize: number
): number {
  const requestedPage = extractPageNumberFromStatus(job.active_item_title ?? "");
  if (requestedPage != null) {
    return normalizePageWithinBatch(requestedPage, batchPageSize);
  }
  const inferredPageNumber = job.status === "running"
    ? Math.max(1, job.processed_batches + 1)
    : Math.max(0, job.processed_batches);
  if (inferredPageNumber <= 0) {
    return 0;
  }
  return normalizePageWithinBatch(inferredPageNumber, batchPageSize);
}

function extractPageNumberFromStatus(statusLabel: string): number | null {
  const match = statusLabel.match(/\bpage\s+(\d+)\b/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizePageWithinBatch(pageNumber: number, batchPageSize: number): number {
  if (batchPageSize <= 0 || pageNumber <= 0) {
    return 0;
  }
  const pageOffset = pageNumber % batchPageSize;
  return pageOffset === 0 ? batchPageSize : pageOffset;
}

function getTotalPagesForJob(job: FetchProgressState["job_progress"][number]): number | null {
  if (typeof job.expected_total_count !== "number" || job.expected_total_count <= 0) {
    return null;
  }
  const pageSize = getEstimatedBatchLimitForSource(job.source);
  return Math.max(1, Math.ceil(job.expected_total_count / pageSize));
}

function resolveCurrentPageForJob(job: FetchProgressState["job_progress"][number], totalPages: number | null): number {
  const requestedPage = extractPageNumberFromStatus(job.active_item_title ?? "");
  const fallbackPage = job.status === "running"
    ? Math.max(1, job.processed_batches + 1)
    : Math.max(0, job.processed_batches);
  const rawCurrentPage = Math.max(0, requestedPage ?? fallbackPage);

  if (typeof totalPages === "number" && totalPages > 0) {
    return Math.min(totalPages, rawCurrentPage);
  }

  return rawCurrentPage;
}

function buildShuffledFetchHeadlineQueue(previousHeadline = ""): string[] {
  const queue = [...FETCH_HEADLINE_PHRASES];
  for (let index = queue.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [queue[index], queue[swapIndex]] = [queue[swapIndex], queue[index]];
  }

  if (queue.length > 1 && queue[0] === previousHeadline) {
    const firstDifferentIndex = queue.findIndex((phrase) => phrase !== previousHeadline);
    if (firstDifferentIndex > 0) {
      [queue[0], queue[firstDifferentIndex]] = [queue[firstDifferentIndex], queue[0]];
    }
  }

  return queue;
}

function getOverallFetchCompletionPercent(fetchProgress: FetchProgressState): number {
  if (fetchProgress.job_progress.length === 0) {
    return formatProgressPercent(fetchProgress.completed_jobs, fetchProgress.total_jobs);
  }

  let weightedCompleted = 0;
  let weightedTotal = 0;

  fetchProgress.job_progress.forEach((job) => {
    const expectedTotal = typeof job.expected_total_count === "number" && job.expected_total_count > 0
      ? job.expected_total_count
      : 1;
    const completedUnits = typeof job.expected_total_count === "number" && job.expected_total_count > 0
      ? (job.status === "completed" ? expectedTotal : Math.max(0, Math.min(expectedTotal, job.fetched_rows)))
      : (job.status === "completed" ? 1 : 0);

    weightedCompleted += completedUnits;
    weightedTotal += expectedTotal;
  });

  if (weightedTotal <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (weightedCompleted / weightedTotal) * 100));
}

function formatFetchOverallPercentLabel(percent: number): string {
  if (percent >= 10) {
    return `${Math.round(percent)}%`;
  }
  if (percent >= 1) {
    return `${percent.toFixed(1)}%`;
  }
  return `${percent.toFixed(2)}%`;
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
