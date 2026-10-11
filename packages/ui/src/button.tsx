import { cn } from "./cn";
import { Spinner } from "./spinner";

import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-heading font-semibold " +
  "transition-colors duration-150 select-none " +
  "focus-visible:outline-none focus-visible:shadow-focus " +
  "disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-primary border border-border hover:bg-primary-soft",
  ghost: "text-primary hover:bg-primary-soft",
  // The verb button of a destructive confirmation (delete account, end every session).
  danger: "bg-danger text-on-primary hover:bg-danger/90",
};

// 44px minimum touch target (WCAG 2.5.8 / Lighthouse tap targets).
const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-base",
  lg: "min-h-12 px-7 text-lg",
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  className?: string | undefined;
}

/** Class names of a button, for rendering links (`<a>`, `next/link`) that must look like one. */
export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, Omit<ButtonStyleOptions, "className"> {
  /** Shows a spinner and blocks clicks while the action runs (prevents double submit, DESIGN-SYSTEM §6.5). */
  loading?: boolean | undefined;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner decorative /> : null}
      {children}
    </button>
  );
}
