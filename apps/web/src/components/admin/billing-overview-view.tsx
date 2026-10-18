"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, CardTitle, Field, Input, Skeleton, cn, moneyText } from "@wasfa/ui";
import { Clock, Hourglass, RefreshCw, ShieldAlert, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";

import { overviewSchema, type KpiView, type OverviewView } from "../../lib/admin-billing-schemas";
import { dayBoundary, formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { deltaOf, percentText, type Delta } from "../../lib/admin-revenue";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";
import { ErrorNotice } from "../error-notice";

import { KpiCard } from "./kpi-card";
import { MoneyCell, MoneyMap } from "./money-cell";
import { NeedsAttentionCard } from "./needs-attention-card";

const RANGES = ["today", "7d", "30d", "custom"] as const;
type Range = (typeof RANGES)[number];

function isRange(value: string): value is Range {
  return (RANGES as readonly string[]).includes(value);
}

/** Delta of a per-currency map: compared in the currency with the most money, never across currencies. */
export function moneyDelta(
  current: Readonly<Record<string, number>>,
  previous: Readonly<Record<string, number>>,
): Delta {
  const currencies = Object.keys(current).length > 0 ? current : previous;
  const main = Object.entries(currencies).sort((left, right) => right[1] - left[1])[0]?.[0];
  return main ? deltaOf(current[main] ?? 0, previous[main] ?? 0) : deltaOf(0, 0);
}

/** The funnel steps overall (rows without a method), in the order the API lists them. */
export function funnelSteps(funnel: OverviewView["funnel"]): { step: string; sessions: number }[] {
  const totals = new Map<string, number>();
  const overall = funnel.filter((row) => row.methodKey === null);
  for (const row of overall.length > 0 ? overall : funnel) {
    totals.set(row.step, (totals.get(row.step) ?? 0) + row.sessions);
  }
  return [...totals].map(([step, sessions]) => ({ step, sessions }));
}

/** Sessions per step for each payment method (the API reports a step per method from method selection on). */
export function funnelByMethod(
  funnel: OverviewView["funnel"],
): { methodKey: string; steps: { step: string; sessions: number }[] }[] {
  const methods = new Map<string, { step: string; sessions: number }[]>();
  for (const row of funnel) {
    if (row.methodKey === null) continue;
    methods.set(row.methodKey, [
      ...(methods.get(row.methodKey) ?? []),
      { step: row.step, sessions: row.sessions },
    ]);
  }
  return [...methods].map(([methodKey, steps]) => ({ methodKey, steps }));
}

function RangeSwitch({ range }: { range: Range }) {
  const url = useUrlParams();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div
        role="group"
        aria-label={t("admin.revenue.range.label")}
        className="flex flex-wrap gap-2"
      >
        {RANGES.map((value) => (
          <Button
            key={value}
            variant={range === value ? "primary" : "secondary"}
            aria-pressed={range === value}
            name={`range-${value}`}
            onClick={() => {
              url.update({ range: value === "30d" ? null : value, from: null, to: null });
            }}
          >
            {t(`admin.revenue.range.${value}`)}
          </Button>
        ))}
      </div>
      {range === "custom" ? (
        <>
          <Field label={t("admin.revenue.range.from")}>
            {(control) => (
              <Input
                {...control}
                name="from"
                type="date"
                ltr
                value={url.get("from")}
                onChange={(event) => {
                  url.update({ from: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={t("admin.revenue.range.to")}>
            {(control) => (
              <Input
                {...control}
                name="to"
                type="date"
                ltr
                value={url.get("to")}
                onChange={(event) => {
                  url.update({ to: event.target.value });
                }}
              />
            )}
          </Field>
        </>
      ) : null}
    </div>
  );
}

function Attention({ data }: { data: OverviewView["attention"] }) {
  const manual = data.manualPaymentsWaiting;
  return (
    <section aria-labelledby="attention-title" className="flex flex-col gap-3">
      <h2 id="attention-title" className="font-heading text-xl font-semibold">
        {t("admin.revenue.attention.title")}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <NeedsAttentionCard
          icon={Wallet}
          title={t("admin.revenue.attention.manual")}
          count={manual.count}
          oldestSeconds={manual.oldestSeconds}
          overdue={manual.overdueCount > 0}
          href="/admin/billing/payments?view=review"
        />
        <NeedsAttentionCard
          icon={TriangleAlert}
          title={t("admin.revenue.attention.failed")}
          count={data.failedOrMismatchPayments24h}
          href="/admin/billing/payments?status=failed"
          actionLabel={t("admin.revenue.attention.openList")}
        />
        <NeedsAttentionCard
          icon={Clock}
          title={t("admin.revenue.attention.withdrawals")}
          count={data.withdrawalsWaiting.count}
          oldestSeconds={data.withdrawalsWaiting.oldestSeconds}
        />
        <NeedsAttentionCard
          icon={ShieldAlert}
          title={t("admin.revenue.attention.holds")}
          count={data.fraudHolds}
        />
        <NeedsAttentionCard
          icon={Hourglass}
          title={t("admin.revenue.attention.expiring")}
          count={data.subscriptionsEnding.length}
          href="/admin/billing/subscriptions?expiringWithinDays=3"
          actionLabel={t("admin.revenue.attention.openList")}
        >
          {data.subscriptionsEnding.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.subscriptionsEnding.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/billing/subscriptions?open=${row.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {row.ownerLabel} · {row.planKey}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </NeedsAttentionCard>
        <NeedsAttentionCard
          icon={Clock}
          title={t("admin.revenue.attention.promos")}
          count={data.promotionsEnding.length + data.couponsNearLimit.length}
          href="/admin/billing/promotions"
          actionLabel={t("admin.revenue.attention.openList")}
        >
          {data.promotionsEnding.length + data.couponsNearLimit.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.promotionsEnding.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/billing/promotions?open=${row.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t("admin.revenue.attention.promoEnds", { name: row.name })}
                  </Link>
                </li>
              ))}
              {data.couponsNearLimit.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/admin/billing/coupons?open=${row.id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {t("admin.revenue.attention.couponNear", {
                      code: row.code,
                      used: row.redeemed,
                      max: row.max ?? 0,
                    })}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </NeedsAttentionCard>
      </div>
    </section>
  );
}

function Kpis({
  kpis,
  previous,
  funnel,
}: {
  kpis: KpiView;
  previous: KpiView;
  funnel: OverviewView["funnel"];
}) {
  const steps = funnelSteps(funnel);
  const first = steps[0]?.sessions ?? 0;
  const last = steps.at(-1)?.sessions ?? 0;
  const conversionBps = first > 0 ? Math.round((last * 10_000) / first) : null;
  const aiCostMinor = Math.floor(kpis.aiCostUsdMicros / 10_000);
  return (
    <section aria-labelledby="kpi-title" className="flex flex-col gap-3">
      <h2 id="kpi-title" className="font-heading text-xl font-semibold">
        {t("admin.revenue.kpi.title")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={t("admin.revenue.kpi.revenue")}
          value={<MoneyMap values={kpis.revenueNetMinor} />}
          delta={moneyDelta(kpis.revenueNetMinor, previous.revenueNetMinor)}
          href="/admin/billing/orders?status=paid"
        />
        <KpiCard
          label={t("admin.revenue.kpi.orders")}
          value={formatNumber(kpis.orders)}
          delta={deltaOf(kpis.orders, previous.orders)}
          href="/admin/billing/orders"
        />
        <KpiCard
          label={t("admin.revenue.kpi.newSubscribers")}
          value={formatNumber(kpis.newPaidSubscribers)}
          delta={deltaOf(kpis.newPaidSubscribers, previous.newPaidSubscribers)}
          href="/admin/billing/subscriptions?source=paid"
        />
        <KpiCard
          label={t("admin.revenue.kpi.mrr")}
          value={<MoneyMap values={kpis.mrrMinor} />}
          delta={moneyDelta(kpis.mrrMinor, previous.mrrMinor)}
          href="/admin/billing/subscriptions?status=active"
        />
        <KpiCard
          label={t("admin.revenue.kpi.arpu")}
          value={<MoneyMap values={kpis.arpuMinor} />}
          delta={moneyDelta(kpis.arpuMinor, previous.arpuMinor)}
        />
        <KpiCard
          label={t("admin.revenue.kpi.conversion")}
          value={conversionBps === null ? t("admin.revenue.kpi.none") : percentText(conversionBps)}
          hint={t("admin.revenue.kpi.conversionHint")}
        />
        <KpiCard
          label={t("admin.revenue.kpi.refundRate")}
          value={percentText(kpis.refundRateBps)}
          delta={deltaOf(kpis.refundRateBps, previous.refundRateBps)}
          href="/admin/billing/refunds"
        />
        <KpiCard
          label={t("admin.revenue.kpi.aiCost")}
          value={<MoneyCell amountMinor={aiCostMinor} currency="USD" />}
          delta={deltaOf(kpis.aiCostUsdMicros, previous.aiCostUsdMicros)}
          hint={t("admin.revenue.kpi.aiCostHint")}
        />
        <KpiCard
          label={t("admin.revenue.kpi.credits")}
          value={`${formatNumber(kpis.creditsSold)} / ${formatNumber(kpis.creditsConsumed)}`}
          hint={t("admin.revenue.kpi.creditsHint")}
        />
        <KpiCard
          label={t("admin.revenue.kpi.rewards")}
          value={`${formatNumber(kpis.rewardsAccruedPoints)} / ${formatNumber(kpis.rewardsPaidPoints)}`}
          hint={t("admin.revenue.kpi.rewardsHint")}
        />
      </div>
    </section>
  );
}

function Breakdowns({ data }: { data: OverviewView }) {
  const steps = funnelSteps(data.funnel);
  const byMethod = funnelByMethod(data.funnel);
  const first = steps[0]?.sessions ?? 0;
  const mixTotals = new Map<string, number>();
  for (const row of data.planMix) {
    mixTotals.set(row.currency, (mixTotals.get(row.currency) ?? 0) + row.amountMinor);
  }
  const discounts = [
    ...data.topDiscounts.promotions.map((row) => ({ ...row, kind: "promotion" as const })),
    ...data.topDiscounts.coupons.map((row) => ({ ...row, kind: "coupon" as const })),
  ];
  const cell = "border-b border-border px-3 py-2 text-start tabular-nums";
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card elevation="flat" className="flex flex-col gap-3">
        <CardTitle>{t("admin.revenue.funnel.title")}</CardTitle>
        {steps.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.revenue.funnel.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{t("admin.revenue.funnel.title")}</caption>
            <tbody>
              {steps.map((row) => (
                <tr key={row.step}>
                  <th scope="row" className={cn(cell, "font-semibold")}>
                    {tOr(`admin.revenue.funnel.step.${row.step}`, row.step)}
                  </th>
                  <td className={cell}>{formatNumber(row.sessions)}</td>
                  <td className={cn(cell, "text-text-muted")}>
                    {first > 0 ? percentText(Math.round((row.sessions * 10_000) / first)) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {byMethod.length > 0 ? (
          <ul
            className="flex flex-col gap-1 text-sm text-text-muted"
            aria-label={t("admin.revenue.funnel.byMethod")}
          >
            {byMethod.map((method) => (
              <li key={method.methodKey}>
                <bdi dir="ltr">{method.methodKey}</bdi>
                {": "}
                {method.steps
                  .map(
                    (entry) =>
                      `${tOr(`admin.revenue.funnel.step.${entry.step}`, entry.step)} ${formatNumber(entry.sessions)}`,
                  )
                  .join(" · ")}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card elevation="flat" className="flex flex-col gap-3">
        <CardTitle>{t("admin.revenue.mix.title")}</CardTitle>
        {data.planMix.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.revenue.mix.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{t("admin.revenue.mix.title")}</caption>
            <tbody>
              {data.planMix.map((row) => {
                const total = mixTotals.get(row.currency) ?? 0;
                return (
                  <tr key={`${row.planKey ?? "none"}-${row.currency}`}>
                    <th scope="row" className={cn(cell, "font-semibold")}>
                      {row.planKey ?? t("admin.revenue.mix.packs")}
                    </th>
                    <td className={cell}>{moneyText(row.amountMinor, row.currency)}</td>
                    <td className={cn(cell, "text-text-muted")}>
                      {total > 0
                        ? percentText(Math.round((row.amountMinor * 10_000) / total))
                        : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card elevation="flat" className="flex flex-col gap-3">
        <CardTitle>{t("admin.revenue.discounts.title")}</CardTitle>
        {discounts.length === 0 ? (
          <p className="text-base text-text-muted">{t("admin.revenue.discounts.empty")}</p>
        ) : (
          <table className="w-full border-collapse text-base">
            <caption className="sr-only">{t("admin.revenue.discounts.title")}</caption>
            <tbody>
              {discounts.map((row) => (
                <tr key={`${row.kind}-${row.id}`}>
                  <th scope="row" className={cn(cell, "font-semibold")}>
                    <Link
                      href={`/admin/billing/${row.kind === "coupon" ? "coupons" : "promotions"}?open=${row.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </th>
                  <td className={cn(cell, "text-text-muted")}>
                    {t(`admin.revenue.discounts.${row.kind}`)}
                  </td>
                  <td className={cell}>{moneyText(row.revenueMinor, row.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** `/admin/billing`: what needs attention first, then the numbers of a selectable range. */
export function BillingOverviewView() {
  const url = useUrlParams();
  const rangeParam = url.get("range");
  const range: Range = isRange(rangeParam) ? rangeParam : "30d";
  const from = dayBoundary(url.get("from"), "start");
  const to = dayBoundary(url.get("to"), "end");
  const customReady = range !== "custom" || (from !== undefined && to !== undefined);
  const query = buildQuery({
    range,
    from: range === "custom" ? from : undefined,
    to: range === "custom" ? to : undefined,
  });
  const resource = useResource(
    customReady ? `/admin/billing/overview?${query}` : null,
    overviewSchema,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangeSwitch range={range} />
        {resource.status === "ready" ? (
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <span>
              {t("admin.revenue.updatedAt", { time: formatDateTime(resource.data.generatedAt) })}
            </span>
            <Button variant="ghost" onClick={resource.reload}>
              <RefreshCw aria-hidden className="size-4" />
              {t("admin.revenue.refresh")}
            </Button>
          </div>
        ) : null}
      </div>
      {!customReady ? (
        <p className="text-base text-text-muted">{t("admin.revenue.range.pickDates")}</p>
      ) : resource.status === "loading" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
      ) : resource.status === "error" ? (
        <ErrorNotice error={resource.error} onRetry={resource.reload} />
      ) : (
        <>
          <Attention data={resource.data.attention} />
          <Kpis
            kpis={resource.data.kpis}
            previous={resource.data.previous}
            funnel={resource.data.funnel}
          />
          <Breakdowns data={resource.data} />
        </>
      )}
    </div>
  );
}
