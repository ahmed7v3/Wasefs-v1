import { Card, cn } from "@wasfa/ui";
import Link from "next/link";

import { formatNumber } from "../../lib/admin-format";

import type { LucideIcon } from "lucide-react";

const accents = {
  primary: { edge: "border-s-primary", chip: "bg-primary-soft text-primary" },
  success: { edge: "border-s-success", chip: "bg-success-soft text-success" },
  warning: { edge: "border-s-warning", chip: "bg-warning-soft text-warning" },
  danger: { edge: "border-s-danger", chip: "bg-danger-soft text-danger" },
} as const;

export interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  /** The colour is status only (a thin edge and the icon chip); the label always says what it is. */
  accent?: keyof typeof accents;
  /** Makes the whole card a link to the filtered list. */
  href?: string | undefined;
}

/** DESIGN-SYSTEM §5.3 stat card, from `1.png`: big number, small label, round icon chip, thin edge. */
export function StatCard({ label, value, icon: Icon, accent = "primary", href }: StatCardProps) {
  const style = accents[accent];
  const body = (
    <Card
      elevation="flat"
      padding="compact"
      className={cn(
        "flex items-center justify-between gap-4 border-s-4",
        style.edge,
        href && "transition-colors duration-150 hover:bg-primary-soft/40",
      )}
    >
      <div className="min-w-0">
        <p className="font-heading text-3xl font-semibold tabular-nums text-text">
          {formatNumber(value)}
        </p>
        <p className="text-sm text-text-muted">{label}</p>
      </div>
      <span
        aria-hidden
        className={cn(
          "inline-flex size-12 shrink-0 items-center justify-center rounded-lg",
          style.chip,
        )}
      >
        <Icon className="size-6" />
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:outline-none focus-visible:shadow-focus">
      {body}
    </Link>
  ) : (
    body
  );
}
