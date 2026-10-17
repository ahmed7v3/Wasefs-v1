import { Tag } from "lucide-react";

import { Badge, type BadgeTone } from "../badge";

import type { ReactNode } from "react";

export interface PromoBadgeProps {
  children: ReactNode;
  tone?: BadgeTone | undefined;
  className?: string | undefined;
}

/** The label of a real promotion or a plan highlight ("خصم 20%", "الأنسب لك"). Always carries text. */
export function PromoBadge({ children, tone = "success", className }: PromoBadgeProps) {
  return (
    <Badge tone={tone} className={className}>
      <Tag aria-hidden className="size-3.5" />
      {children}
    </Badge>
  );
}
