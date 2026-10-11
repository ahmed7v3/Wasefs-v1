import { cn } from "./cn";

import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `raised` is for the single hero/flagship surface on a screen. */
  elevation?: "flat" | "card" | "raised";
  /** `compact` and `none` are for dense admin areas (stat cards, tables that own their cell padding). */
  padding?: "default" | "compact" | "none";
}

const paddings = {
  default: "p-6 sm:p-8",
  compact: "p-4 sm:p-5",
  none: "p-0",
} as const;

const elevations = {
  flat: "border border-border",
  card: "border border-border/60 shadow-card",
  raised: "border border-border/50 shadow-raised",
} as const;

export function Card({ elevation = "card", padding = "default", className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl bg-surface text-text",
        paddings[padding],
        elevations[elevation],
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("font-heading text-xl font-semibold text-text", className)} {...props} />
  );
}
