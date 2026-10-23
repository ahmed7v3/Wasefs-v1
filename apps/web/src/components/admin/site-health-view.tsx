"use client";

import { t } from "@wasfa/shared/i18n";
import {
  WEB_VITAL_BUCKETS,
  siteHealthSchema,
  type SiteHealth,
} from "@wasfa/shared/schemas/public-site";
import { Badge, Button } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { rateVital, vitalValue, type VitalRating } from "../../lib/site-health";
import { useResource } from "../../lib/use-admin-data";

import { DataTable, type DataTableColumn } from "./data-table";

type VitalRow = SiteHealth["vitals"][number];
type BotRow = SiteHealth["bots"][number];

const RANGES = [1, 7, 30] as const;

const RATING_TONE = {
  good: "success",
  needsImprovement: "warning",
  poor: "danger",
} as const satisfies Record<VitalRating, "success" | "warning" | "danger">;

function p75Label(row: VitalRow): string {
  if (row.p75 !== null) return vitalValue(row.name, row.p75);
  const last = WEB_VITAL_BUCKETS[row.name].at(-1) ?? 0;
  return t("admin.siteHealth.p75.over", { value: vitalValue(row.name, last) });
}

const vitalColumns: readonly DataTableColumn<VitalRow>[] = [
  {
    id: "route",
    header: t("admin.siteHealth.col.route"),
    primary: true,
    cell: (row) => <bdi dir="ltr">{row.route}</bdi>,
  },
  { id: "metric", header: t("admin.siteHealth.col.metric"), cell: (row) => row.name },
  {
    id: "samples",
    header: t("admin.siteHealth.col.samples"),
    cell: (row) => <span className="tabular-nums">{formatNumber(row.samples)}</span>,
  },
  {
    id: "p75",
    header: t("admin.siteHealth.col.p75"),
    cell: (row) => (
      <bdi dir="ltr" className="tabular-nums">
        {p75Label(row)}
      </bdi>
    ),
  },
  {
    id: "rating",
    header: t("admin.siteHealth.col.rating"),
    cell: (row) => {
      const rating = rateVital(row.name, row.p75);
      return <Badge tone={RATING_TONE[rating]}>{t(`admin.siteHealth.rating.${rating}`)}</Badge>;
    },
  },
];

const botColumns: readonly DataTableColumn<BotRow>[] = [
  {
    id: "bot",
    header: t("admin.siteHealth.col.bot"),
    primary: true,
    cell: (row) => <bdi dir="ltr">{row.bot}</bdi>,
  },
  {
    id: "route",
    header: t("admin.siteHealth.col.route"),
    cell: (row) => <bdi dir="ltr">{row.route}</bdi>,
  },
  {
    id: "hits",
    header: t("admin.siteHealth.col.hits"),
    cell: (row) => <span className="tabular-nums">{formatNumber(row.hits)}</span>,
  },
];

/** `/admin/site-health`: first-party page speed (p75 per page and metric) and crawler visits. */
export function SiteHealthView() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const resource = useResource(`/admin/site-health?days=${days}`, siteHealthSchema);
  const status = resource.status;
  const data = resource.status === "ready" ? resource.data : null;
  const error = resource.status === "error" ? resource.error : undefined;

  return (
    <div className="flex flex-col gap-8">
      <div role="group" aria-label={t("admin.siteHealth.range")} className="flex flex-wrap gap-2">
        {RANGES.map((range) => (
          <Button
            key={range}
            name={`range-${range}`}
            variant={range === days ? "primary" : "secondary"}
            aria-pressed={range === days}
            onClick={() => {
              setDays(range);
            }}
          >
            {t("admin.siteHealth.range.option", { days: range })}
          </Button>
        ))}
      </div>

      <section aria-labelledby="site-vitals-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="site-vitals-title" className="font-heading text-xl font-semibold text-text">
            {t("admin.siteHealth.vitals.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("admin.siteHealth.vitals.lead")}</p>
        </div>
        <DataTable
          caption={t("admin.siteHealth.vitals.caption")}
          columns={vitalColumns}
          rows={data?.vitals ?? []}
          rowKey={(row) => `${row.route}|${row.name}`}
          status={status}
          error={error}
          onRetry={resource.reload}
          emptyTitle={t("admin.siteHealth.vitals.empty")}
          emptyDescription={t("admin.siteHealth.vitals.emptyHint")}
        />
      </section>

      <section aria-labelledby="site-bots-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="site-bots-title" className="font-heading text-xl font-semibold text-text">
            {t("admin.siteHealth.bots.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("admin.siteHealth.bots.lead")}</p>
        </div>
        <DataTable
          caption={t("admin.siteHealth.bots.caption")}
          columns={botColumns}
          rows={data?.bots ?? []}
          rowKey={(row) => `${row.bot}|${row.route}`}
          status={status}
          error={error}
          onRetry={resource.reload}
          emptyTitle={t("admin.siteHealth.bots.empty")}
          emptyDescription={t("admin.siteHealth.bots.emptyHint")}
        />
      </section>
    </div>
  );
}
