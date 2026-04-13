import clsx from "clsx";
import type { InputHTMLAttributes } from "react";

/**
 * Shared text input primitive.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("ss-input", className)} {...props} />;
}
