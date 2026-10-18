"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Card, buttonStyles } from "@wasfa/ui";
import { CalendarClock, Coins, Users } from "lucide-react";
import Link from "next/link";

import { formatNumber } from "../../lib/admin-format";
import { formatDate } from "../../lib/dates";
import { monthLabel } from "../../lib/org-format";

import { UsageExport } from "./usage-export";

import type { OrgDashboard } from "@wasfa/shared/schemas/org";

/** Seats as a native progress bar (no inline style): used of limit, or just the count when unlimited. */
function Seats({ seats }: { seats: OrgDashboard["seats"] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-heading text-3xl font-bold tabular-nums text-text">
        {seats.limit === null
          ? t("org.overview.seatsUnlimited", { used: formatNumber(seats.used) })
          : t("org.overview.seatsOf", {
              used: formatNumber(seats.used),
              limit: formatNumber(seats.limit),
            })}
      </p>
      {seats.limit !== null ? (
        <progress
          value={Math.min(seats.used, seats.limit)}
          max={seats.limit}
          aria-label={t("org.overview.seatsLabel")}
          className="h-2 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-neutral-100 [&::-webkit-progress-value]:bg-primary"
        />
      ) : null}
      {seats.pendingInvites > 0 ? (
        <p className="text-sm text-text-muted">
          {t("org.overview.pendingInvites", { count: seats.pendingInvites })}
        </p>
      ) : null}
    </div>
  );
}

export interface OverviewTabProps {
  orgId: string;
  dashboard: OrgDashboard;
}

/** Wallet, plan and renewal, seats and this month's usage. */
export function OverviewTab({ orgId, dashboard }: OverviewTabProps) {
  const { wallet, plan, subscription, seats, members, month } = dashboard;
  const usedThisMonth = members.reduce((sum, member) => sum + member.creditsUsed, 0);
  const renewHref = `/pricing?org=${orgId}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card elevation="card" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-text">
            <Coins aria-hidden className="size-5 text-primary" />
            {t("org.overview.wallet")}
          </h2>
          <p
            className="font-heading text-4xl font-bold tabular-nums text-primary"
            data-testid="org-balance"
          >
            {t("dashboard.credits.balance", { balance: formatNumber(wallet.balance) })}
          </p>
          <p className="text-base text-text-muted">
            {wallet.allowPersonalFallback
              ? t("org.overview.fallbackOn")
              : t("org.overview.fallbackOff")}
          </p>
        </Card>

        <Card elevation="card" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-text">
            <CalendarClock aria-hidden className="size-5 text-primary" />
            {t("org.overview.plan")}
          </h2>
          <p className="font-heading text-2xl font-bold text-text">{plan.nameAr}</p>
          {subscription ? (
            <div className="flex flex-wrap items-center gap-2 text-base text-text-muted">
              <Badge tone={subscription.status === "active" ? "success" : "warning"}>
                {t(`billing.account.status.${subscription.status}`)}
              </Badge>
              <span>
                {t("billing.account.periodEnd", {
                  date: formatDate(subscription.currentPeriodEnd),
                })}
              </span>
            </div>
          ) : (
            <p className="text-base text-text-muted">{t("org.overview.noSubscription")}</p>
          )}
          <Link
            href={renewHref}
            className={buttonStyles({ variant: "secondary", className: "self-start" })}
          >
            {subscription ? t("org.overview.renew") : t("org.overview.choosePlan")}
          </Link>
        </Card>

        <Card elevation="card" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-text">
            <Users aria-hidden className="size-5 text-primary" />
            {t("org.overview.seats")}
          </h2>
          <Seats seats={seats} />
        </Card>

        <Card elevation="card" className="flex flex-col gap-3">
          <h2 className="font-heading text-lg font-semibold text-text">
            {t("org.overview.usage", { month: monthLabel(month) })}
          </h2>
          <p className="font-heading text-3xl font-bold tabular-nums text-text">
            {t("org.overview.usageCredits", { credits: formatNumber(usedThisMonth) })}
          </p>
          <p className="text-sm text-text-muted">{t("org.overview.usageHint")}</p>
        </Card>
      </div>

      <UsageExport orgId={orgId} currentMonth={month} />
    </div>
  );
}
