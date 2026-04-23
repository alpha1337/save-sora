import { useEffect, useMemo, useState } from "react";
import { ChevronDown, HardDriveDownload } from "lucide-react";
import type { DownloadProgressState } from "types/domain";
import { Button } from "@components/atoms/button";
import { formatBytes, formatCount } from "@lib/utils/format-utils";
import "./download-takeover.css";

interface DownloadTakeoverProps {
  downloadProgress: DownloadProgressState;
  selectedBytes: number;
  visible: boolean;
}

const TAKEOVER_MESSAGES = [
  "Assembling your archive parts",
  "Validating each file before packaging",
  "Streaming files into your download set",
  "Building folders and preserving order",
  "Finalizing archives for reliable extraction"
] as const;

export function DownloadTakeover({ downloadProgress, selectedBytes, visible }: DownloadTakeoverProps) {
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
    if (downloadProgress.total_items <= 0) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round((downloadProgress.completed_items / downloadProgress.total_items) * 100)));
  }, [downloadProgress.completed_items, downloadProgress.total_items]);

  if (!visible) {
    return null;
  }

  return (
    <div className="ss-download-takeover" role="status" aria-live="polite">
      <div className="ss-download-takeover-backdrop" aria-hidden="true">
        <div className="ss-download-takeover-orb ss-download-takeover-orb--one" />
        <div className="ss-download-takeover-orb ss-download-takeover-orb--two" />
        <div className="ss-download-takeover-grid" />
      </div>
      <div className="ss-download-takeover-panel">
        <div className="ss-download-takeover-heading">
          <div className="ss-download-takeover-title-wrap">
            <span className="ss-download-takeover-icon"><HardDriveDownload size={20} /></span>
            <div>
              <h2 className="ss-download-takeover-title">Building Your Archive</h2>
              <p className="ss-download-takeover-subtitle">{downloadProgress.active_label || "Preparing archive workflow…"}</p>
            </div>
          </div>
          <span className="ss-download-takeover-percent">{progressPercent}%</span>
        </div>

        <div className="ss-download-takeover-progress-track" aria-hidden="true">
          <div className="ss-download-takeover-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="ss-download-takeover-meta">
          <span>{`${formatCount(downloadProgress.completed_items)} / ${formatCount(downloadProgress.total_items)} files`}</span>
          <span>{`Estimated selected size: ${formatBytes(selectedBytes)}`}</span>
        </div>

        <div className="ss-download-takeover-message" key={messageIndex}>
          {TAKEOVER_MESSAGES[messageIndex]}
        </div>

        <div className="ss-download-takeover-actions">
          <Button onClick={() => setShowDetails((current) => !current)} tone="secondary" type="button">
            <ChevronDown className={showDetails ? "ss-download-takeover-chevron is-open" : "ss-download-takeover-chevron"} size={16} />
            {showDetails ? "Hide Build Details" : "Show Build Details"}
          </Button>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
