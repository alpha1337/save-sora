import { useEffect, useMemo, useState } from "react";
import { ChevronDown, HardDriveDownload } from "lucide-react";
import type { DownloadPreflightStage, DownloadProgressState } from "types/domain";
import { Button } from "@components/atoms/button";
import { formatBytes, formatCount } from "@lib/utils/format-utils";
import "./download-takeover.css";

interface DownloadTakeoverProps {
  downloadProgress: DownloadProgressState;
  onCloseSummary: () => void;
  onStartOver: () => void;
  selectedBytes: number;
  visible: boolean;
}

const MAX_TAKEOVER_TITLE_LENGTH = 40;
const MAX_REJECTION_TEXT_LENGTH = 100;
const TOTAL_TAKEOVER_PHASES = 5;
const ACTIVE_ZIP_PROGRESS_FLOOR = 1;
const TAKEOVER_PHASE_BY_STAGE: Record<DownloadPreflightStage, number> = {
  idle: 1,
  building_queue: 1,
  sharing_drafts: 2,
  resolving_sources: 3,
  zip_handoff: 4,
  zipping: 5,
  completed: 5
};

export function DownloadTakeover({
  downloadProgress,
  onCloseSummary,
  onStartOver,
  selectedBytes,
  visible
}: DownloadTakeoverProps) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [visible]);

  const progressPercent = useMemo(() => {
    const isPreflightStage = !downloadProgress.zip_completed &&
      downloadProgress.preflight_stage !== "zipping" &&
      downloadProgress.preflight_total_items > 0;
    const isZipStage = !downloadProgress.zip_completed &&
      downloadProgress.preflight_stage === "zipping" &&
      downloadProgress.zip_part_total_items > 0;
    const completedItems = isPreflightStage
      ? downloadProgress.preflight_completed_items
      : isZipStage
        ? downloadProgress.zip_part_completed_items
      : downloadProgress.completed_items;
    const totalItems = isPreflightStage
      ? downloadProgress.preflight_total_items
      : isZipStage
        ? downloadProgress.zip_part_total_items
      : downloadProgress.total_items;
    if (totalItems <= 0) {
      return 0;
    }
    const rawPercent = Math.round((completedItems / totalItems) * 100);
    if (
      rawPercent === 0 &&
      downloadProgress.preflight_stage === "zipping" &&
      !downloadProgress.zip_completed
    ) {
      return ACTIVE_ZIP_PROGRESS_FLOOR;
    }
    return Math.min(100, Math.max(0, rawPercent));
  }, [
    downloadProgress.completed_items,
    downloadProgress.preflight_completed_items,
    downloadProgress.preflight_stage,
    downloadProgress.preflight_total_items,
    downloadProgress.total_items,
    downloadProgress.zip_completed,
    downloadProgress.zip_part_completed_items,
    downloadProgress.zip_part_total_items
  ]);

  const isComplete = downloadProgress.zip_completed;
  const stageLabel = downloadProgress.preflight_stage_label || (isComplete ? "Summary" : "Archive");
  const takeoverTitle = downloadProgress.active_label || "Preparing archive workflow…";
  const takeoverSubtitle = formatTakeoverSubtitle(
    downloadProgress.preflight_stage,
    downloadProgress.active_subtitle
  );
  const takeoverMessage = formatTakeoverMessage(downloadProgress);
  const isZipStage = downloadProgress.preflight_stage === "zipping" && !downloadProgress.zip_completed;

  if (!visible) {
    return null;
  }

  return (
    <div className="ss-download-takeover" role="status" aria-live="polite">
      <div className="ss-download-takeover-backdrop" aria-hidden="true">
        <div className="ss-download-takeover-grid" />
      </div>
      <div className="ss-download-takeover-panel">
        <div className="ss-download-takeover-heading">
          <div className="ss-download-takeover-title-wrap">
            <span className="ss-download-takeover-icon"><HardDriveDownload size={20} /></span>
            <div>
              <h2 className="ss-download-takeover-title" title={takeoverTitle}>
                {truncateText(takeoverTitle, MAX_TAKEOVER_TITLE_LENGTH)}
              </h2>
              {takeoverSubtitle ? (
                <p className="ss-download-takeover-subtitle">{takeoverSubtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="ss-download-takeover-stage">
            <span>{stageLabel}</span>
            <strong>{progressPercent}%</strong>
          </div>
        </div>

        <div className="ss-download-takeover-progress-track" aria-hidden="true">
          <div className="ss-download-takeover-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        {isZipStage ? (
          <div className="ss-download-takeover-meta">
            <span>{`${formatZipPartLabel(downloadProgress)}: ${formatCount(downloadProgress.zip_part_completed_items)} / ${formatCount(downloadProgress.zip_part_total_items)} files`}</span>
            <span>{`${formatCount(downloadProgress.completed_items)} / ${formatCount(downloadProgress.total_items)} total packaged`}</span>
            <span>{`Estimated selected size: ${formatBytes(selectedBytes)}`}</span>
          </div>
        ) : (
          <div className="ss-download-takeover-meta">
            <span>{`${formatCount(downloadProgress.completed_items)} / ${formatCount(downloadProgress.total_items)} files`}</span>
            <span>{`${formatCount(downloadProgress.preflight_completed_items)} / ${formatCount(downloadProgress.preflight_total_items)} preflight`}</span>
            <span>{`Estimated selected size: ${formatBytes(selectedBytes)}`}</span>
          </div>
        )}

        <div className="ss-download-takeover-message">
          {takeoverMessage}
        </div>

        {downloadProgress.swimlanes.length > 0 ? (
          <div className="ss-download-takeover-swimlanes" aria-label="Download queue swimlanes">
            {downloadProgress.swimlanes.map((lane) => (
              <section className="ss-download-takeover-lane" key={lane.id}>
                <div className="ss-download-takeover-lane-heading">
                  <span>{lane.label}</span>
                  <strong>{formatCount(lane.items.length)}</strong>
                </div>
                <div className="ss-download-takeover-lane-items">
                  {lane.items.length > 0 ? lane.items.map((item) => (
                    <div className="ss-download-takeover-lane-item" key={`${lane.id}:${item.id}`}>
                      <span>{item.title}</span>
                      <small>{item.reason ? `${item.id} · ${item.reason}` : item.id}</small>
                    </div>
                  )) : (
                    <span className="ss-download-takeover-lane-empty">Empty</span>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {downloadProgress.rejection_entries.length > 0 ? (
          <div className="ss-download-takeover-rejections" aria-label="Rejection summary">
            <strong>Rejection Summary</strong>
            <div className="ss-download-takeover-rejection-list" role="list">
              {downloadProgress.rejection_entries.map((entry) => (
                <div className="ss-download-takeover-rejection" key={`${entry.id}:${entry.reason}`} role="listitem">
                  <span title={entry.title}>{truncateText(entry.title, MAX_REJECTION_TEXT_LENGTH)}</span>
                  <code title={entry.reason}>{truncateText(entry.reason, MAX_REJECTION_TEXT_LENGTH)}</code>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="ss-download-takeover-actions">
          <Button onClick={() => setShowDetails((current) => !current)} tone="secondary" type="button">
            <ChevronDown className={showDetails ? "ss-download-takeover-chevron is-open" : "ss-download-takeover-chevron"} size={16} />
            {showDetails ? "Hide Build Details" : "Show Build Details"}
          </Button>
          {isComplete ? (
            <>
              <Button onClick={onCloseSummary} tone="secondary" type="button">
                Close Summary
              </Button>
              <Button onClick={onStartOver} tone="danger" type="button">
                Start Over
              </Button>
            </>
          ) : null}
        </div>

        {showDetails ? (
          <div className="ss-download-takeover-details">
            {downloadProgress.worker_progress.length > 0 ? (
              downloadProgress.worker_progress.map((worker) => (
                <div className="ss-download-takeover-worker" key={worker.worker_id}>
                  <strong>{worker.label}</strong>
                  <span>
                    {worker.active_item_label
                      ? worker.active_item_label
                      : worker.last_completed_item_label
                        ? `Last: ${worker.last_completed_item_label}`
                        : "Queued"}
                  </span>
                </div>
              ))
            ) : (
              <span className="ss-download-takeover-empty">Initializing archive workers…</span>
            )}
            {downloadProgress.rejection_entries.map((entry) => (
              <div className="ss-download-takeover-worker" key={`detail:${entry.id}:${entry.reason}`}>
                <strong title={entry.title}>{truncateText(entry.title, MAX_REJECTION_TEXT_LENGTH)}</strong>
                <span title={`${entry.id} · ${entry.reason}`}>{truncateText(`${entry.id} · ${entry.reason}`, MAX_REJECTION_TEXT_LENGTH)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function formatTakeoverSubtitle(stage: DownloadPreflightStage, subtitle: string): string {
  const normalizedSubtitle = subtitle.trim();
  if (!normalizedSubtitle) {
    return "";
  }

  return `Phase ${TAKEOVER_PHASE_BY_STAGE[stage]} of ${TOTAL_TAKEOVER_PHASES}: ${normalizedSubtitle}`;
}

function formatTakeoverMessage(downloadProgress: DownloadProgressState): string {
  const total = formatCount(downloadProgress.preflight_total_items || downloadProgress.total_items);
  const preflightCompleted = formatCount(downloadProgress.preflight_completed_items);
  const currentPart = formatCount(downloadProgress.zip_part_number);
  const totalParts = formatCount(downloadProgress.zip_total_parts);
  const partCompleted = formatCount(downloadProgress.zip_part_completed_items);
  const partTotalCount = downloadProgress.zip_part_total_items || downloadProgress.total_items;
  const partTotal = formatCount(partTotalCount);
  const totalCompleted = formatCount(downloadProgress.completed_items);
  const totalItems = formatCount(downloadProgress.total_items);

  switch (downloadProgress.preflight_stage) {
    case "building_queue":
      return `Building the download queue from ${total} selected files and removing duplicate video IDs.`;
    case "sharing_drafts":
      return `Checking draft share status before ZIP handoff. Shared drafts move forward; failed shares keep the watermarked fallback.`;
    case "resolving_sources":
      return `Resolving source URLs before packaging. ${preflightCompleted} of ${total} files are ready for ZIP handoff.`;
    case "zip_handoff":
      return `Source selection is complete. Watermarked fallbacks and no-watermark files are assigned to their archive folders.`;
    case "zipping":
      if (downloadProgress.zip_total_parts > 1) {
        return `Packaging ZIP part ${currentPart} of ${totalParts}: ${partCompleted} of ${partTotal} files downloaded for this part.`;
      }
      return `Packaging ZIP: ${partCompleted} of ${partTotal} files downloaded into the archive.`;
    case "completed":
      return `Archive build complete. ${totalCompleted} of ${totalItems} files were packaged; review any rejections before closing.`;
    case "idle":
    default:
      return "Waiting for the download workflow to start.";
  }
}

function formatZipPartLabel(downloadProgress: DownloadProgressState): string {
  if (downloadProgress.zip_total_parts > 1) {
    return `Part ${formatCount(downloadProgress.zip_part_number)} / ${formatCount(downloadProgress.zip_total_parts)}`;
  }

  return "ZIP";
}
