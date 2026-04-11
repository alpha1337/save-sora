import type { DownloadProgressState, DownloadWorkerProgress, FetchJobProgress, FetchProgressState } from "types/domain";
import { Badge } from "@components/atoms/badge";
import { SummaryStat } from "@components/atoms/summary-stat";
import { ProgressCardGrid, type ProgressCardItem } from "@components/molecules/progress-card-grid";
import { formatCount } from "@lib/utils/format-utils";

interface SessionProgressSummary {
  downloadableRows: number;
  totalRows: number;
}

interface ProgressBannerProps {
  downloadProgress: DownloadProgressState;
  fetchProgress: FetchProgressState;
  phase: string;
  sessionSummary: SessionProgressSummary;
}

/**
 * Runtime fetch and download progress with source-aware status details.
 */
export function ProgressBanner({ downloadProgress, fetchProgress, phase, sessionSummary }: ProgressBannerProps) {
  const isFetching = phase === "fetching";
  const isDownloading = phase === "downloading";
  const laggingJobs = isFetching ? fetchProgress.job_progress.filter((job) => isBelowExpectedCount(job)) : [];
  const nonDownloadableRows = Math.max(sessionSummary.totalRows - sessionSummary.downloadableRows, 0);
  const primaryLabel = isFetching ? fetchProgress.active_label : downloadProgress.active_label;
  const progressCards = isFetching ? buildFetchCards(fetchProgress) : isDownloading ? buildDownloadCards(downloadProgress) : [];
  const secondaryLabel = isFetching
    ? buildFetchSummary(fetchProgress)
    : buildDownloadSummary(downloadProgress);
  const statusTone = phase === "error" ? "warning" : phase === "ready" ? "success" : "default";
  const liveMode = isFetching || isDownloading ? "polite" : undefined;

  return (
    <div aria-atomic="true" aria-live={liveMode} className="ss-progress-banner ss-progress-banner--detailed" role={liveMode ? "status" : undefined}>
      <div className="ss-progress-summary">
        <div className="ss-progress-badges">
          <Badge tone={statusTone}>{getPhaseLabel(phase)}</Badge>
          {isFetching ? <Badge tone="default">{fetchProgress.running_jobs} active</Badge> : null}
          {isFetching ? <Badge tone="default">{fetchProgress.completed_jobs}/{fetchProgress.total_jobs} complete</Badge> : null}
          {isDownloading && downloadProgress.total_workers > 0 ? <Badge tone="default">{downloadProgress.running_workers} active</Badge> : null}
          {isDownloading && downloadProgress.total_items > 0 ? (
            <Badge tone="default">{downloadProgress.completed_items}/{downloadProgress.total_items} bundled</Badge>
          ) : null}
        </div>
        <div>
          <strong>{primaryLabel || "Idle"}</strong>
          <div className="ss-muted">{secondaryLabel}</div>
        </div>
      </div>
      <div className="ss-summary-stat-grid">
        {isFetching ? (
          <SummaryStat hint="New unique rows added to this session during fetch" label="Fetched" value={formatCount(fetchProgress.processed_rows)} />
        ) : null}
        {isDownloading ? (
          <SummaryStat hint="Finished ZIP entries" label="Bundled" value={formatCount(downloadProgress.completed_items)} />
        ) : null}
        {isDownloading ? <SummaryStat hint="Rows queued for this ZIP" label="Queued" value={formatCount(downloadProgress.total_items)} /> : null}
        <SummaryStat hint="Unique rows stored in this session" label="In Session" value={formatCount(sessionSummary.totalRows)} />
        <SummaryStat hint="Rows with final s_* ids now" label="ZIP-Ready" tone="success" value={formatCount(sessionSummary.downloadableRows)} />
        {nonDownloadableRows > 0 ? (
          <SummaryStat hint="Rows still missing final ZIP ids" label="Not ZIP-Ready" tone="warning" value={formatCount(nonDownloadableRows)} />
        ) : null}
      </div>
      <ProgressCardGrid items={progressCards} />
      {laggingJobs.length > 0 ? (
        <div className="ss-progress-footnote ss-muted">
          Finished below the profile&apos;s reported total: {laggingJobs.slice(0, 3).map((job) => job.label).join(", ")}
          {laggingJobs.length > 3 ? ` + ${laggingJobs.length - 3} more` : ""}
        </div>
      ) : null}
    </div>
  );
}

function buildFetchCards(fetchProgress: FetchProgressState): ProgressCardItem[] {
  const runningJobs = fetchProgress.job_progress.filter((job) => job.status === "running");
  const visibleJobs =
    runningJobs.length > 0 ? runningJobs : fetchProgress.job_progress.slice(-Math.min(3, fetchProgress.job_progress.length));

  return visibleJobs.map((job) => ({
    id: job.job_id,
    detail: getJobStatusLine(job),
    label: job.label,
    status: job.status,
    warning: isBelowExpectedCount(job) ? "Below expected profile count" : undefined
  }));
}

function buildDownloadCards(downloadProgress: DownloadProgressState): ProgressCardItem[] {
  return [...downloadProgress.worker_progress]
    .sort((left, right) => compareProgressStatus(left.status, right.status))
    .map((worker) => ({
      id: worker.worker_id,
      detail: getWorkerStatusLine(worker),
      label: worker.label,
      status: worker.status
    }));
}

function buildDownloadSummary(downloadProgress: DownloadProgressState): string {
  const itemSummary = `${formatCount(downloadProgress.completed_items)}/${formatCount(downloadProgress.total_items)} items`;

  if (downloadProgress.total_workers > 0) {
    return `${itemSummary} · ${downloadProgress.running_workers} active · ${downloadProgress.total_workers} workers`;
  }

  return itemSummary;
}

function buildFetchSummary(fetchProgress: FetchProgressState): string {
  return `${fetchProgress.completed_jobs}/${fetchProgress.total_jobs} complete · ${fetchProgress.running_jobs} active · ${formatCount(fetchProgress.processed_batches)} batches`;
}

function getPhaseLabel(phase: string): string {
  if (phase === "ready") {
    return "Ready";
  }
  if (phase === "error") {
    return "Error";
  }
  if (phase === "fetching") {
    return "Fetching";
  }
  if (phase === "downloading") {
    return "Downloading";
  }
  return "Idle";
}

function getJobStatusLine(job: FetchJobProgress): string {
  if (job.status === "running" && job.processed_batches === 0) {
    if (typeof job.expected_total_count === "number" && job.expected_total_count > 0) {
      return `${formatCount(job.fetched_rows)} of ${formatCount(job.expected_total_count)} reported rows · Waiting for first page`;
    }

    return `${formatCount(job.fetched_rows)} rows · Waiting for first page`;
  }

  if (typeof job.expected_total_count === "number" && job.expected_total_count > 0) {
    return `${formatCount(job.fetched_rows)} of ${formatCount(job.expected_total_count)} reported rows · ${formatJobPercent(job.fetched_rows, job.expected_total_count)} · ${job.processed_batches} batches`;
  }

  return `${formatCount(job.fetched_rows)} rows · ${job.processed_batches} batches`;
}

function getWorkerStatusLine(worker: DownloadWorkerProgress): string {
  const itemSummary = `${formatCount(worker.completed_items)} items`;

  if (worker.status === "running") {
    if (worker.active_item_label) {
      return `${itemSummary} · Bundling ${worker.active_item_label}`;
    }

    if (worker.last_completed_item_label) {
      return `${itemSummary} · Waiting for next item`;
    }
  }

  if (worker.status === "completed") {
    if (worker.last_completed_item_label) {
      return `${itemSummary} · Last bundled ${worker.last_completed_item_label}`;
    }

    return `${itemSummary} · Finished`;
  }

  return `${itemSummary} · Waiting for work`;
}

function compareProgressStatus(left: ProgressCardItem["status"], right: ProgressCardItem["status"]): number {
  return getProgressStatusRank(left) - getProgressStatusRank(right);
}

function getProgressStatusRank(status: ProgressCardItem["status"]): number {
  switch (status) {
    case "running":
      return 0;
    case "pending":
      return 1;
    case "completed":
      return 2;
    default:
      return 3;
  }
}

function formatJobPercent(fetchedRows: number, expectedTotalCount: number): string {
  const percent = Math.min(100, (fetchedRows / expectedTotalCount) * 100);
  const digits = percent > 0 && percent < 1 ? 1 : 0;
  return `${percent.toFixed(digits)}%`;
}

function isBelowExpectedCount(job: FetchJobProgress): boolean {
  return job.status === "completed" && typeof job.expected_total_count === "number" && job.expected_total_count > job.fetched_rows;
}
