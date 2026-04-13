import clsx from "clsx";

interface SummaryStatProps {
  hint?: string;
  label: string;
  tone?: "default" | "success" | "warning";
  value: string;
}

/**
 * Compact metric tile used for progress and result summaries.
 */
export function SummaryStat({ hint, label, tone = "default", value }: SummaryStatProps) {
  return (
    <div className={clsx("ss-summary-stat", `ss-summary-stat--${tone}`)}>
      <span className="ss-summary-stat-label">{label}</span>
      <strong className="ss-summary-stat-value">{value}</strong>
      {hint ? <span className="ss-summary-stat-hint ss-muted">{hint}</span> : null}
    </div>
  );
}
