import { cn } from "@wasfa/ui";
import { CircleCheck, Info, TriangleAlert } from "lucide-react";

import type { ReactNode } from "react";

const tones = {
  success: {
    icon: CircleCheck,
    style: "border-success/30 bg-success-soft",
    iconColor: "text-success",
  },
  info: { icon: Info, style: "border-primary/20 bg-primary-soft", iconColor: "text-primary" },
  // Needs attention but is not an error (e.g. draft legal text); the icon carries the meaning, not only the colour.
  warning: {
    icon: TriangleAlert,
    style: "border-warning/30 bg-warning-soft",
    iconColor: "text-warning",
  },
} as const;

export interface NoticeProps {
  tone?: keyof typeof tones;
  children: ReactNode;
  className?: string | undefined;
}

/** Calm, non-error message (a finished step, a hint). Announced politely (`role="status"`). */
export function Notice({ tone = "info", children, className }: NoticeProps) {
  const { icon: Icon, style, iconColor } = tones[tone];
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-md border p-4 text-base text-text",
        style,
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", iconColor)} />
      <div>{children}</div>
    </div>
  );
}
