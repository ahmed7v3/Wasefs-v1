import { t } from "@wasfa/shared/i18n";
import { Card, buttonStyles, cn } from "@wasfa/ui";
import Link from "next/link";

import { durationText } from "../../lib/admin-revenue";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface NeedsAttentionCardProps {
  icon: LucideIcon;
  title: string;
  count: number;
  /** Age of the oldest waiting item; shown only when something waits. */
  oldestSeconds?: number | undefined;
  /** True when the oldest item is past its deadline: the card says so in words, not only colour. */
  overdue?: boolean | undefined;
  /** Left out for a queue that has no page yet: the card then only informs. */
  href?: string | undefined;
  actionLabel?: string | undefined;
  children?: ReactNode;
}

/** One card of the "needs attention" inbox: how many, how long the oldest has waited, open the queue. */
export function NeedsAttentionCard({
  icon: Icon,
  title,
  count,
  oldestSeconds,
  overdue = false,
  href,
  actionLabel,
  children,
}: NeedsAttentionCardProps) {
  return (
    <Card
      elevation="flat"
      padding="compact"
      className={cn(
        "flex flex-col gap-3 border-s-4",
        overdue ? "border-s-danger" : count > 0 ? "border-s-warning" : "border-s-success",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-lg",
            overdue ? "bg-danger-soft text-danger" : "bg-primary-soft text-primary",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-text">{title}</p>
          <p className="text-sm text-text-muted">
            {count === 0
              ? t("admin.revenue.attention.none")
              : oldestSeconds !== undefined
                ? t("admin.revenue.attention.oldest", { age: durationText(oldestSeconds) })
                : null}
            {overdue ? (
              <span className="font-semibold text-danger">
                {" "}
                {t("admin.revenue.attention.overdue")}
              </span>
            ) : null}
          </p>
        </div>
        <p className="ms-auto font-heading text-3xl font-semibold tabular-nums text-text">
          {count}
        </p>
      </div>
      {children}
      {href ? (
        <Link
          href={href}
          className={buttonStyles({
            variant: count > 0 ? "primary" : "secondary",
            className: "self-start",
          })}
        >
          {actionLabel ?? t("admin.revenue.attention.openQueue")}
        </Link>
      ) : null}
    </Card>
  );
}
