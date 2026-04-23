import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@components/atoms/button";
import takeoverIcon from "../../../assets/icon-48.png";
import takeoverBackgroundVideo from "../../../assets/update-takeover-bg.mp4";
import "./session-bootstrap-takeover.css";

interface SessionBootstrapTakeoverProps {
  visible: boolean;
  statusText: string;
  errorMessage: string;
  onRetry: () => void;
}

export function SessionBootstrapTakeover({
  visible,
  statusText,
  errorMessage,
  onRetry
}: SessionBootstrapTakeoverProps) {
  useEffect(() => {
    if (!visible) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const hasError = Boolean(errorMessage.trim());

  return (
    <div aria-live="polite" className="ss-session-takeover" role="status">
      <div className="ss-session-takeover-backdrop" aria-hidden="true">
        <video
          autoPlay
          className="ss-session-takeover-video"
          loop
          muted
          playsInline
          preload="auto"
          src={takeoverBackgroundVideo}
        />
        <div className="ss-session-takeover-video-overlay" />
      </div>
      <div className="ss-session-takeover-panel">
        <div className="ss-session-takeover-heading">
          <img alt="" aria-hidden="true" className="ss-session-takeover-icon" src={takeoverIcon} />
          <div>
            <h2>Preparing your workspace</h2>
          </div>
        </div>

        <div className="ss-session-takeover-status">
          <LoaderCircle className="ss-session-takeover-spinner" size={16} />
          <span>{statusText || "Starting session checks…"}</span>
        </div>

        {hasError ? (
          <div className="ss-session-takeover-error">
            <p>{errorMessage}</p>
            <ul>
              <li>Confirm you are signed in at sora.chatgpt.com.</li>
              <li>Keep that Sora tab open, then retry.</li>
            </ul>
            <Button onClick={onRetry} tone="default" type="button">
              Retry Session Check
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
