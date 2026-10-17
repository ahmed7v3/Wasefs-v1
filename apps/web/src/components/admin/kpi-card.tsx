import { t } from "@wasfa/shared/i18n";
import { Card, cn } from "@wasfa/ui";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";

import { percentText, type Delta } from "../../lib/admin-revenue";

import type { ReactNode } from "react";

export interface KpiCardProps {
  label: string;
  /** The figure: a number, or one money line per currency. */
  value: ReactNode;
  /** Change versus the prior period; left out when the metric has no prior value. */
  delta?: Delta | undefined;
  /** Where the filtered list behind this number lives. */
  href?: string | undefined;
  hint?: string | undefined;
}

function DeltaText({ delta }: { delta: Delta }) {
  const Icon =
    delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const text =
    delta.bps === null
      ? t("admin.revenue.kpi.new")
      : delta.direction === "flat"
        ? t("admin.revenue.kpi.unchanged")
        : `${percentText(Math.abs(delta.bps))} ${t(delta.direction === "up" ? "admin.revenue.kpi.up" : "admin.revenue.kpi.down")}`;
  return (
    <span className="inline-flex items-center gap-1 text-sm text-text-muted">
      <Icon aria-hidden className="size-4" />
      {text}
      <span className="sr-only"> {t("admin.revenue.kpi.vsPrior")}</span>
    </span>
  );
}

/** A KPI: big tabular figure, label, and the change versus the prior period; links to its list. */
export function KpiCard({ label, value, delta, href, hint }: KpiCardProps) {
  const body = (
    <Card
      elevation="flat"
      padding="compact"
      className={cn(
        "flex h-full flex-col gap-1",
        href && "transition-colors duration-150 hover:bg-primary-soft/40",
      )}
    >
      <p className="text-sm text-text-muted">{label}</p>
      <div className="font-heading text-2xl font-semibold tabular-nums text-text">{value}</div>
      {delta ? <DeltaText delta={delta} /> : null}
      {hint ? <p className="text-sm text-text-muted">{hint}</p> : null}
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
