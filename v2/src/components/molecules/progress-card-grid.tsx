import { Badge } from "@components/atoms/badge";
import type { ProgressStatus } from "types/domain";

export interface ProgressCardItem {
  id: string;
  detail: string;
  label: string;
  status: ProgressStatus;
  warning?: string;
}

interface ProgressCardGridProps {
  items: ProgressCardItem[];
}

/**
 * Reusable status-card grid for multi-job and multi-worker progress.
 */
export function ProgressCardGrid({ items }: ProgressCardGridProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="ss-progress-job-grid">
      {items.map((item) => (
        <div className="ss-progress-job-card" key={item.id}>
          <div className="ss-progress-job-header">
            <strong>{item.label}</strong>
            <Badge tone={item.status === "completed" ? "success" : "default"}>{item.status}</Badge>
          </div>
          <div className="ss-muted">{item.detail}</div>
          {item.warning ? <div className="ss-progress-job-warning">{item.warning}</div> : null}
        </div>
      ))}
    </div>
  );
}
