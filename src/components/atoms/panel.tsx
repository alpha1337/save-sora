import clsx from "clsx";
import type { HTMLAttributes, PropsWithChildren } from "react";

/**
 * Simple surface panel used as the base layout primitive.
 */
export function Panel({ children, className, ...props }: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section className={clsx("ss-panel", className)} {...props}>
      {children}
    </section>
  );
}
