import type { DownloadProgressState, FetchProgressState } from "types/domain";
import { Badge } from "@components/atoms/badge";

interface ProgressBannerProps {
  downloadProgress: DownloadProgressState;
  fetchProgress: FetchProgressState;
  phase: string;
}

/**
 * Compact runtime progress summary.
 */
export function ProgressBanner({ downloadProgress, fetchProgress, phase }: ProgressBannerProps) {
  const isFetching = phase === "fetching";
  const primaryLabel = isFetching ? fetchProgress.active_label : downloadProgress.active_label;
  const secondaryLabel = isFetching
    ? `${fetchProgress.completed_jobs}/${fetchProgress.total_jobs} jobs · ${fetchProgress.processed_rows} rows`
    : `${downloadProgress.completed_items}/${downloadProgress.total_items} items`;

  return (
    <div className="ss-progress-banner">
      <Badge tone={phase === "error" ? "warning" : phase === "ready" ? "success" : "default"}>{phase}</Badge>
      <div>
        <strong>{primaryLabel || "Idle"}</strong>
        <div className="ss-muted">{secondaryLabel}</div>
      </div>
    </div>
  );
}
