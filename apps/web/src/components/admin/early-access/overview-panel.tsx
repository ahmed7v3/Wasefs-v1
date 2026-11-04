"use client";

import {
  adminEarlyOverviewSchema,
  type AdminEarlyOverview,
  type EarlyPriceCurrency,
} from "@wasfa/shared/schemas/early-access";
import { Button, Card, Skeleton } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber } from "../../../lib/admin-format";
import { useResource } from "../../../lib/use-admin-data";
import { useUrlParams } from "../../../lib/use-url-params";
import { ErrorNotice } from "../../error-notice";

import { formatPercent, percent } from "./chart-math";
import { BarList, ChartCard, DailyChart, FunnelBars, NoData, PriceCurve } from "./charts";
import {
  DEVICE_LABEL,
  EVENT_LABEL,
  FEATURE_LABEL,
  ROLE_LABEL,
  T,
  VARIANT_LABEL,
  countryName,
  formatPrice,
  labelOf,
} from "./labels";

import type { EarlyFilters } from "./filters";

type Row = { key: string; label: string | null; count: number };

const toBars = (rows: readonly Row[], label: (row: Row) => string) =>
  rows.map((row) => ({ key: row.key, label: label(row), count: row.count }));

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-1">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="font-heading text-3xl font-bold tabular-nums text-primary">{value}</p>
    </Card>
  );
}

function CurrencySwitch({
  currencies,
  value,
  onChange,
}: {
  currencies: readonly EarlyPriceCurrency[];
  value: EarlyPriceCurrency;
  onChange: (currency: EarlyPriceCurrency) => void;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label="currency">
      {currencies.map((currency) => (
        <Button
          key={currency}
          size="md"
          variant={currency === value ? "primary" : "secondary"}
          aria-pressed={currency === value}
          onClick={() => {
            onChange(currency);
          }}
        >
          {currency}
        </Button>
      ))}
    </div>
  );
}

function Pricing({ data }: { data: AdminEarlyOverview }) {
  const currencies = [
    ...new Set([...data.priceCurve.map((r) => r.currency), ...data.fairPrice.map((r) => r.currency)]),
  ];
  const [picked, setPicked] = useState<EarlyPriceCurrency | null>(null);
  const first = currencies[0];
  if (!first) {
    return (
      <>
        <ChartCard title={T.chart.priceCurve}>
          <NoData />
        </ChartCard>
        <ChartCard title={T.chart.fairPrice}>
          <NoData />
        </ChartCard>
      </>
    );
  }
  const currency = picked && currencies.includes(picked) ? picked : first;
  const switcher = (
    <CurrencySwitch currencies={currencies} value={currency} onChange={setPicked} />
  );
  const fair = data.fairPrice
    .filter((r) => r.currency === currency)
    .sort((a, b) => (a.priceMinor ?? -1) - (b.priceMinor ?? -1))
    .map((r) => ({
      key: String(r.priceMinor),
      label: r.priceMinor === null ? T.chart.freeOnly : formatPrice(r.priceMinor, currency),
      count: r.count,
    }));
  return (
    <>
      <ChartCard title={T.chart.priceCurve} hint={T.chart.priceCurveHint} action={switcher}>
        <PriceCurve rows={data.priceCurve.filter((r) => r.currency === currency)} currency={currency} />
      </ChartCard>
      <ChartCard title={T.chart.fairPrice} action={switcher}>
        <BarList rows={fair} limit={12} />
      </ChartCard>
    </>
  );
}

export function OverviewPanel({ filters }: { filters: EarlyFilters }) {
  const url = useUrlParams();
  const resource = useResource(
    `/admin/early-access/overview${filters.query ? `?${filters.query}` : ""}`,
    adminEarlyOverviewSchema,
  );

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {T.loading}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const data = resource.data;
  const k = data.kpis;
  const funnelOrder = data.funnel.map((step) => ({
    label: EVENT_LABEL[step.type],
    sessions: step.sessions,
  }));
  const countryRows = toBars(data.countries, (r) => r.label ?? countryName(r.key));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label={T.kpi.views} value={formatNumber(k.views)} />
        <Kpi label={T.kpi.uniqueVisitors} value={formatNumber(k.uniqueVisitors)} />
        <Kpi label={T.kpi.phoneSubmits} value={formatNumber(k.phoneSubmits)} />
        <Kpi label={T.kpi.completed} value={formatNumber(k.completed)} />
        <Kpi label={T.kpi.conversionRate} value={formatPercent(k.conversionRate * 100)} />
        <Kpi label={T.kpi.today} value={formatNumber(k.today)} />
        <Kpi label={T.kpi.invitedJoins} value={formatNumber(k.invitedJoins)} />
      </div>

      <ChartCard title={T.chart.daily}>
        <DailyChart series={data.series} />
      </ChartCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title={T.chart.funnel}>
          <FunnelBars steps={funnelOrder} />
        </ChartCard>
        <ChartCard
          title={T.chart.countries}
          action={
            filters.country ? (
              <Button
                variant="ghost"
                onClick={() => {
                  url.update({ country: null, city: null });
                }}
              >
                {T.chart.clearCountry}
              </Button>
            ) : undefined
          }
        >
          <BarList
            rows={countryRows}
            selectedKey={filters.country || undefined}
            onSelect={(key) => {
              url.update({ country: key === filters.country ? null : key, city: null });
            }}
          />
        </ChartCard>
        {filters.country ? (
          <ChartCard title={`${T.chart.cities} ${countryName(filters.country)}`}>
            <BarList rows={toBars(data.cities, (r) => r.label ?? r.key)} />
          </ChartCard>
        ) : null}
        <ChartCard title={T.chart.roles}>
          <BarList rows={toBars(data.roles, (r) => labelOf(ROLE_LABEL, r.key))} />
        </ChartCard>
        <ChartCard title={T.chart.devices}>
          <BarList rows={toBars(data.devices, (r) => labelOf(DEVICE_LABEL, r.key))} />
        </ChartCard>
        <ChartCard title={T.chart.sources}>
          <BarList rows={toBars(data.sources, (r) => r.label ?? r.key)} />
        </ChartCard>
        <ChartCard title={T.chart.features}>
          <BarList rows={toBars(data.features, (r) => labelOf(FEATURE_LABEL, r.key))} />
        </ChartCard>
        <Pricing data={data} />
      </div>

      <ChartCard title={T.chart.variants}>
        {data.variants.length === 0 ? (
          <NoData />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-base tabular-nums">
              <thead>
                <tr className="text-sm text-text-muted">
                  <th className="py-2 text-start font-semibold">{T.chart.variantCol}</th>
                  <th className="py-2 text-start font-semibold">{T.chart.viewsCol}</th>
                  <th className="py-2 text-start font-semibold">{T.chart.signupsCol}</th>
                  <th className="py-2 text-start font-semibold">{T.chart.crCol}</th>
                </tr>
              </thead>
              <tbody>
                {data.variants.map((row) => (
                  <tr key={row.variant} className="border-t border-border">
                    <td className="py-2">{labelOf(VARIANT_LABEL, row.variant)}</td>
                    <td className="py-2">{formatNumber(row.views)}</td>
                    <td className="py-2">{formatNumber(row.signups)}</td>
                    <td className="py-2">{formatPercent(percent(row.signups, row.views))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
