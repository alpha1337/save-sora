import clsx from "clsx";
import type { PropsWithChildren } from "react";

interface BadgeProps extends PropsWithChildren {
  tone?: "default" | "success" | "warning";
}

/**
 * Compact status badge primitive.
 */
export function Badge({ children, tone = "default" }: BadgeProps) {
  return <span className={clsx("ss-badge", `ss-badge--${tone}`)}>{children}</span>;
}
