import { Card, cn } from "@wasfa/ui";

import type { ReactNode } from "react";

export interface DashboardPanelProps {
  /** Id of the heading, so the region is named by it. */
  id: string;
  title: ReactNode;
  /** A link or button at the inline-end of the heading row. */
  action?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * One dashboard card: a named region with a heading row. Cards of the same row stretch to the same
 * height and each section sets a `min-h`, so loading, empty and loaded states take the same room
 * (no layout shift). Elevation is `card`: the one `shadow-raised` of the screen is the shell panel.
 */
export function DashboardPanel({ id, title, action, className, children }: DashboardPanelProps) {
  return (
    <Card
      role="region"
      aria-labelledby={id}
      padding="compact"
      className={cn("flex h-full flex-col gap-4", className)}
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={id} className="font-heading text-xl font-semibold text-text">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
