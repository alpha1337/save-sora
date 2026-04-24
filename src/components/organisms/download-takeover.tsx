import { useEffect, useMemo, useState } from "react";
import { ChevronDown, HardDriveDownload } from "lucide-react";
import type { DownloadProgressState } from "types/domain";
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

const TAKEOVER_MESSAGES = [
  "Resolving archive sources",
  "Validating each file before packaging",
  "Streaming files into your download set",
  "Building folders and preserving order",
  "Finalizing archives for reliable extraction"
] as const;

const MAX_REJECTION_TEXT_LENGTH = 100;

export function DownloadTakeover({
  downloadProgress,
  onCloseSummary,
  onStartOver,
  selectedBytes,
  visible
}: DownloadTakeoverProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

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

  useEffect(() => {
    if (!visible) {
      return;
    }
    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % TAKEOVER_MESSAGES.length);
    }, 3200);
    return () => {
      window.clearInterval(interval);
    };
  }, [visible]);

  const progressPercent = useMemo(() => {
    const isPreflightStage = !downloadProgress.zip_completed &&
      downloadProgress.preflight_stage !== "zipping" &&
      downloadProgress.preflight_total_items > 0;
    const completedItems = isPreflightStage
      ? downloadProgress.preflight_completed_items
      : downloadProgress.completed_items;
    const totalItems = isPreflightStage
      ? downloadProgress.preflight_total_items
      : downloadProgress.total_items;
    if (totalItems <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round((completedItems / totalItems) * 100)));
  }, [
    downloadProgress.completed_items,
    downloadProgress.preflight_completed_items,
    downloadProgress.preflight_stage,
    downloadProgress.preflight_total_items,
    downloadProgress.total_items,
    downloadProgress.zip_completed
  ]);

  const isComplete = downloadProgress.zip_completed;
  const stageLabel = downloadProgress.preflight_stage_label || (isComplete ? "Summary" : "Archive");

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
              <h2 className="ss-download-takeover-title">{downloadProgress.active_label || "Preparing archive workflow…"}</h2>
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

        <div className="ss-download-takeover-meta">
          <span>{`${formatCount(downloadProgress.completed_items)} / ${formatCount(downloadProgress.total_items)} files`}</span>
          <span>{`${formatCount(downloadProgress.preflight_completed_items)} / ${formatCount(downloadProgress.preflight_total_items)} preflight`}</span>
          <span>{`Estimated selected size: ${formatBytes(selectedBytes)}`}</span>
        </div>

        <div className="ss-download-takeover-message" key={messageIndex}>
          {TAKEOVER_MESSAGES[messageIndex]}
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
                  <span title={entry.title}>{truncateRejectionText(entry.title)}</span>
                  <code title={entry.reason}>{truncateRejectionText(entry.reason)}</code>
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
                <strong title={entry.title}>{truncateRejectionText(entry.title)}</strong>
                <span title={`${entry.id} · ${entry.reason}`}>{truncateRejectionText(`${entry.id} · ${entry.reason}`)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function truncateRejectionText(value: string): string {
  if (value.length <= MAX_REJECTION_TEXT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_REJECTION_TEXT_LENGTH - 3)}...`;
}
