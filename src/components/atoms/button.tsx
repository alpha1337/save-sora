import { Slot } from "@radix-ui/react-slot";
import clsx from "clsx";
import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

interface ButtonProps extends PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>> {
  asChild?: boolean;
  tone?: "default" | "ghost" | "danger" | "secondary";
}

/**
 * Reusable button primitive with a minimal tone system.
 */
export function Button({ asChild = false, children, className, tone = "default", ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={clsx("ss-button", `ss-button--${tone}`, className)}
      {...props}
    >
      {children}
    </Component>
  );
}
