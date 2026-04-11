import type { DownloadProgressState, FetchJobProgress, FetchProgressState } from "types/domain";
import { Badge } from "@components/atoms/badge";
import { formatCount } from "@lib/utils/format-utils";

interface ProgressBannerProps {
  downloadProgress: DownloadProgressState;
  fetchProgress: FetchProgressState;
  phase: string;
}

/**
 * Runtime fetch and download progress with source-aware status details.
 */
export function ProgressBanner({ downloadProgress, fetchProgress, phase }: ProgressBannerProps) {
  const isFetching = phase === "fetching";
  const runningJobs = fetchProgress.job_progress.filter((job) => job.status === "running");
  const laggingJobs = fetchProgress.job_progress.filter((job) => isBelowExpectedCount(job));
  const primaryLabel = isFetching ? fetchProgress.active_label : downloadProgress.active_label;
  const secondaryLabel = isFetching
    ? `${fetchProgress.completed_jobs}/${fetchProgress.total_jobs} complete · ${fetchProgress.running_jobs} active · ${formatCount(fetchProgress.processed_rows)} rows`
    : `${downloadProgress.completed_items}/${downloadProgress.total_items} items`;

  return (
    <div className="ss-progress-banner ss-progress-banner--detailed">
      <div className="ss-progress-summary">
        <div className="ss-progress-badges">
          <Badge tone={phase === "error" ? "warning" : phase === "ready" ? "success" : "default"}>{phase}</Badge>
          {isFetching ? <Badge tone="default">{fetchProgress.running_jobs} active</Badge> : null}
          {isFetching ? <Badge tone="default">{fetchProgress.completed_jobs}/{fetchProgress.total_jobs} complete</Badge> : null}
        </div>
        <div>
          <strong>{primaryLabel || "Idle"}</strong>
          <div className="ss-muted">{secondaryLabel}</div>
        </div>
      </div>
      {isFetching && fetchProgress.job_progress.length > 0 ? (
        <div className="ss-progress-job-grid">
          {(runningJobs.length > 0 ? runningJobs : fetchProgress.job_progress.slice(-Math.min(3, fetchProgress.job_progress.length))).map((job) => (
            <div className="ss-progress-job-card" key={job.job_id}>
              <div className="ss-progress-job-header">
                <strong>{job.label}</strong>
                <Badge tone={job.status === "completed" ? "success" : "default"}>{job.status}</Badge>
              </div>
              <div className="ss-muted">{getJobStatusLine(job)}</div>
              {isBelowExpectedCount(job) ? <div className="ss-progress-job-warning">Below expected profile count</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {isFetching && laggingJobs.length > 0 ? (
        <div className="ss-progress-footnote ss-muted">
          Completed below expected count: {laggingJobs.slice(0, 3).map((job) => job.label).join(", ")}
          {laggingJobs.length > 3 ? ` + ${laggingJobs.length - 3} more` : ""}
        </div>
      ) : null}
    </div>
  );
}

function getJobStatusLine(job: FetchJobProgress): string {
  if (typeof job.expected_total_count === "number" && job.expected_total_count > 0) {
    return `${formatCount(job.fetched_rows)} / ${formatCount(job.expected_total_count)} rows · ${formatJobPercent(job.fetched_rows, job.expected_total_count)} · ${job.processed_batches} batches`;
  }

  return `${formatCount(job.fetched_rows)} rows · ${job.processed_batches} batches`;
}

function formatJobPercent(fetchedRows: number, expectedTotalCount: number): string {
  const percent = Math.min(100, (fetchedRows / expectedTotalCount) * 100);
  const digits = percent > 0 && percent < 1 ? 1 : 0;
  return `${percent.toFixed(digits)}%`;
}

function isBelowExpectedCount(job: FetchJobProgress): boolean {
  return job.status === "completed" && typeof job.expected_total_count === "number" && job.expected_total_count > job.fetched_rows;
}
