import { t, type MessageKey } from "@wasfa/shared/i18n";
import { cn, periodLabel } from "@wasfa/ui";
import { CalendarCheck, CalendarClock, Check, Repeat, Tag, X } from "lucide-react";

import { formatDate } from "../../lib/dates";
import { Notice } from "../notice";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { MeCreditsResponse } from "@wasfa/shared/schemas/credits";
import type { SubscriptionView } from "@wasfa/shared/schemas/subscriptions";
import type { ReactNode } from "react";

const DAY_MS = 24 * 60 * 60 * 1000;
/** From this many days before the end, the card says the plan is about to end. */
export const ENDING_SOON_DAYS = 7;

/** The tasks a person recognizes (the same ones the dashboard shows). */
const SHOWN_TASKS: ReadonlyArray<{
  task: MeCreditsResponse["today"][number]["task"];
  label: MessageKey;
}> = [
  { task: "rx_extract", label: "dashboard.credits.task.rx_extract" },
  { task: "chat", label: "dashboard.credits.task.chat" },
  { task: "deep_think", label: "dashboard.credits.task.deep_think" },
  { task: "web_search", label: "dashboard.credits.task.web_search" },
];

export interface PlanTimeline {
  /** When access ends: the grace deadline while in grace, else the period end. */
  endsAt: Date;
  /** Whole days left, rounded up; 0 once the end has passed. */
  daysLeft: number;
  /** Share of the current period already used, 0–100. */
  elapsedPercent: number;
  endingSoon: boolean;
}

/** Days left and how far into the period the subscription is, from its own dates. */
export function planTimeline(subscription: SubscriptionView, now: Date): PlanTimeline {
  const start = new Date(subscription.currentPeriodStart).getTime();
  const end = new Date(
    subscription.status === "grace" && subscription.graceUntil
      ? subscription.graceUntil
      : subscription.currentPeriodEnd,
  );
  const remaining = end.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(remaining / DAY_MS));
  const length = new Date(subscription.currentPeriodEnd).getTime() - start;
  const elapsedPercent =
    length > 0 ? Math.min(100, Math.max(0, ((now.getTime() - start) / length) * 100)) : 100;
  return {
    endsAt: end,
    daysLeft,
    elapsedPercent: Math.round(elapsedPercent),
    endingSoon: subscription.status === "grace" || daysLeft <= ENDING_SOON_DAYS,
  };
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
      <span aria-hidden className="mt-0.5 text-primary [&>svg]:size-5">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <dt className="text-sm text-text-muted">{label}</dt>
        <dd className="text-base font-semibold text-text">{children}</dd>
      </div>
    </div>
  );
}

/** The dates of a subscription: start, end, days left with a bar, how it was obtained, renewal. */
function Timeline({ subscription, now }: { subscription: SubscriptionView; now: Date }) {
  const timeline = planTimeline(subscription, now);
  const renewal = subscription.cancelAtPeriodEnd
    ? t("billing.account.details.renewal.ends")
    : subscription.status === "trialing"
      ? t("billing.account.details.renewal.trial")
      : t("billing.account.details.renewal.manual");
  return (
    <div className="flex flex-col gap-4">
      {timeline.endingSoon ? (
        <Notice tone="warning">
          {timeline.daysLeft === 0
            ? t("billing.account.details.endedToday")
            : t("billing.account.details.endingSoon", {
                days: timeline.daysLeft,
                date: formatDate(timeline.endsAt),
              })}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-semibold text-text" data-testid="plan-days-left">
            {t("billing.account.details.daysLeft", { days: timeline.daysLeft })}
          </p>
          <p className="text-sm text-text-muted">
            {t("billing.account.details.elapsed", { percent: timeline.elapsedPercent })}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label={t("billing.account.details.progressLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={timeline.elapsedPercent}
          className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100"
        >
          <div
            className={cn("h-full rounded-full", timeline.endingSoon ? "bg-warning" : "bg-primary")}
            style={{ width: `${String(timeline.elapsedPercent)}%` }}
          />
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact icon={<CalendarCheck />} label={t("billing.account.details.started")}>
          {formatDate(subscription.currentPeriodStart)}
        </Fact>
        <Fact icon={<CalendarClock />} label={t("billing.account.details.ends")}>
          <span data-testid="plan-ends-at">{formatDate(timeline.endsAt)}</span>
        </Fact>
        <Fact icon={<Tag />} label={t("billing.account.details.source")}>
          {t(`billing.account.details.source.${subscription.source}`)}
          {subscription.monthsPaid > 0 ? ` · ${periodLabel(subscription.monthsPaid)}` : ""}
        </Fact>
        <Fact icon={<Repeat />} label={t("billing.account.details.renewal")}>
          {renewal}
        </Fact>
      </dl>
    </div>
  );
}

/** What the plan gives: monthly credits, the monthly and daily limits with use, and the plan's features. */
function Includes({
  credits,
  plan,
  nextGrantAt,
}: {
  credits: MeCreditsResponse;
  plan: CatalogResponse["plans"][number] | undefined;
  nextGrantAt: string;
}) {
  const limits = SHOWN_TASKS.flatMap(({ task, label }) => {
    const month = credits.thisMonth?.find((entry) => entry.task === task);
    const day = credits.today.find((entry) => entry.task === task);
    if (!month && !day) return [];
    return [{ task, label, month, day }];
  });
  const deep = credits.chat.modes.includes("deep");
  return (
    <div className="flex flex-col gap-4">
      <h3 className="font-heading text-lg font-bold text-text">
        {t("billing.account.details.includes")}
      </h3>
      <ul className="flex flex-col gap-2 text-base text-text">
        <li className="flex items-start gap-2">
          <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
          <span>
            {t("billing.account.monthlyCredits", { count: credits.monthlyCredits })} ·{" "}
            <span className="text-text-muted">
              {t("billing.account.nextGrant", { date: formatDate(nextGrantAt) })}
            </span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          {deep ? (
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
          ) : (
            <X aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />
          )}
          <span className={deep ? undefined : "text-text-muted"}>
            {t(deep ? "billing.account.details.deepOn" : "billing.account.details.deepOff")}
          </span>
        </li>
        <li className="flex items-start gap-2">
          {credits.chat.webSearch ? (
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
          ) : (
            <X aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />
          )}
          <span className={credits.chat.webSearch ? undefined : "text-text-muted"}>
            {t(
              credits.chat.webSearch
                ? "billing.account.details.webOn"
                : "billing.account.details.webOff",
            )}
          </span>
        </li>
        {(plan?.features ?? []).map((feature) => (
          <li key={feature.textAr} className="flex items-start gap-2">
            {feature.included ? (
              <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
            ) : (
              <X aria-hidden className="mt-1 size-4 shrink-0 text-text-muted" />
            )}
            <span className={feature.included ? undefined : "text-text-muted"}>
              {feature.textAr}
            </span>
          </li>
        ))}
      </ul>
      {limits.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-base font-semibold text-text">
            {t("billing.account.details.limits")}
          </h4>
          <dl className="grid gap-2 sm:grid-cols-2">
            {limits.map(({ task, label, month, day }) => (
              <div
                key={task}
                className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 text-sm"
              >
                <dt className="font-semibold text-text">{t(label)}</dt>
                <dd className="flex flex-col gap-0.5 text-text-muted tabular-nums">
                  <span>
                    {month && month.monthlyCap !== null
                      ? t("billing.account.details.monthUse", {
                          used: month.used,
                          cap: month.monthlyCap,
                        })
                      : t("billing.account.details.monthNoCap", { used: month?.used ?? 0 })}
                  </span>
                  <span>
                    {day && day.dailyCap !== null
                      ? t("billing.account.details.dayUse", { used: day.used, cap: day.dailyCap })
                      : t("billing.account.details.dayNoCap", { used: day?.used ?? 0 })}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export interface PlanDetailsProps {
  subscription: SubscriptionView | null;
  credits: MeCreditsResponse;
  /** The plan as the catalog shows it, for its feature list (absent when the plan is not on sale). */
  plan: CatalogResponse["plans"][number] | undefined;
  now?: Date;
}

/**
 * The detail of "your current plan" on /billing: for a subscriber, the period dates, days left and
 * a warning near the end; for everyone, what the plan includes and how much of its limits is used.
 */
export function PlanDetails({ subscription, credits, plan, now = new Date() }: PlanDetailsProps) {
  return (
    <div className="flex flex-col gap-6">
      {subscription ? <Timeline subscription={subscription} now={now} /> : null}
      <Includes
        credits={credits}
        plan={plan}
        nextGrantAt={subscription?.nextCreditGrantAt ?? credits.nextGrantAt}
      />
    </div>
  );
}
