import { Heart, Settings } from "lucide-react";
import { Button } from "@components/atoms/button";
import { SelectionDownloadSummary } from "@components/molecules/selection-download-summary";

interface AppHeaderProps {
  appVersion: string;
  disabledSettings: boolean;
  onOpenSettings: () => void;
  selectedBytes: number;
  selectedCount: number;
  sessionMessage: string;
  totalCount: number;
  viewerPlanTypeBadge: string;
  viewerProfilePictureUrl: string;
  viewerUsername: string;
}

/**
 * Product header with account identity, selection summary, and global actions.
 */
export function AppHeader({
  appVersion,
  disabledSettings,
  onOpenSettings,
  selectedBytes,
  selectedCount,
  sessionMessage,
  totalCount,
  viewerPlanTypeBadge,
  viewerProfilePictureUrl,
  viewerUsername
}: AppHeaderProps) {
  return (
    <div className="ss-header-grid">
      <div className="ss-header-identity">
        <div className="ss-header-title-row">
          <h1>Save Sora</h1>
          <span aria-label={`Version ${appVersion}`} className="ss-header-version">{`v${appVersion}`}</span>
        </div>
        <div className="ss-header-session ss-muted">
          {viewerProfilePictureUrl ? (
            <img alt={`${viewerUsername} profile`} className="ss-header-session-avatar" src={viewerProfilePictureUrl} />
          ) : null}
          <div className="ss-header-session-meta">
            <span>{sessionMessage}</span>
            <span className="ss-badge ss-badge--default ss-header-plan-badge">{viewerPlanTypeBadge}</span>
          </div>
        </div>
      </div>
      <SelectionDownloadSummary selectedBytes={selectedBytes} selectedCount={selectedCount} totalCount={totalCount} />
      <div className="ss-inline-actions ss-header-actions">
        <Button asChild tone="info">
          <a href="https://ko-fi.com/savesora" rel="noreferrer noopener" target="_blank">
            <Heart size={16} />
            Donate
          </a>
        </Button>
        <Button disabled={disabledSettings} onClick={onOpenSettings} tone="secondary" type="button">
          <Settings size={16} />
          Settings
        </Button>
      </div>
    </div>
  );
}
