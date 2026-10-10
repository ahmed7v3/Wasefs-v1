import { cn } from "./cn";

import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `raised` is for the single hero/flagship surface on a screen. */
  elevation?: "flat" | "card" | "raised";
}

const elevations = {
  flat: "border border-border",
  card: "border border-border/60 shadow-card",
  raised: "border border-border/50 shadow-raised",
} as const;

export function Card({ elevation = "card", className, ...props }: CardProps) {
  return (
    <div
      className={cn("rounded-xl bg-surface p-6 text-text sm:p-8", elevations[elevation], className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("font-heading text-xl font-semibold text-text", className)} {...props} />
  );
}
