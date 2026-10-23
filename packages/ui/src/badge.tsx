import { t } from "@wasfa/shared/i18n/public";

import { cn } from "./cn";

import type { ComponentProps } from "react";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

// Status text on its -soft background sits near the AA limit (DESIGN-SYSTEM §3.2): never lighter
// or smaller than `text-sm font-semibold`.
const tones: Record<BadgeTone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-accent-soft text-primary",
  neutral: "bg-neutral-100 text-neutral-700",
};

export interface BadgeProps extends ComponentProps<"span"> {
  tone?: BadgeTone | undefined;
}

/** Status chip. Children are required content: colour is never the only signal. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** The "قريباً" badge for features that are not available yet (pair it with a disabled control). */
export function ComingSoonBadge({ className }: { className?: string | undefined }) {
  return (
    <Badge tone="info" className={className}>
      {t("ui.comingSoon")}
    </Badge>
  );
}
