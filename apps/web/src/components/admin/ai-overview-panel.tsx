"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { aiOverviewSchema, type AiOverview } from "@wasfa/shared/schemas/admin-ai";
import { Button, Card, CardTitle, Skeleton } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatUsd } from "../../lib/ai-admin";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

type Days = 7 | 30;

const percent = (value: number) => `${(Math.round(value * 1000) / 10).toString()}%`;
const ms = (value: number | null) =>
  value === null ? t("admin.ai.ov.none") : t("admin.ai.ov.ms", { value: formatNumber(value) });
const usd = (value: number | null) => (value === null ? t("admin.ai.ov.none") : formatUsd(value));

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-1">
      <p dir="ltr" className="font-heading text-2xl font-semibold tabular-nums text-text">
        {value}
      </p>
      <p className="text-sm text-text-muted">{label}</p>
      {note ? <p className="text-xs text-text-muted">{note}</p> : null}
    </Card>
  );
}

/** Today against the cap: a labelled meter. The state is also written (percent, alert text), never colour alone. */
function SpendMeter({ today }: { today: AiOverview["today"] }) {
  const { spendUsdMicros: spend, capUsdMicros: cap, alertPercent } = today;
  const ratio = cap === 0 ? 1 : spend / cap;
  const shown = Math.min(100, Math.round(ratio * 100));
  const alerting = cap === 0 || ratio * 100 >= alertPercent;
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <CardTitle>{t("admin.ai.ov.todayTitle")}</CardTitle>
      <p dir="ltr" className="text-start font-heading text-2xl font-semibold tabular-nums">
        {t("admin.ai.ov.todayOf", { spend: formatUsd(spend), cap: formatUsd(cap) })}
      </p>
      <div
        role="meter"
        aria-label={t("admin.ai.ov.todayTitle")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={t("admin.ai.ov.todayPercent", { percent: String(shown) })}
        className="h-3 w-full overflow-hidden rounded-full bg-neutral-100"
      >
        <div
          className={`h-full rounded-full ${alerting ? "bg-danger" : "bg-primary"}`}
          style={{ inlineSize: `${String(shown)}%` }}
        />
      </div>
      <p className="text-sm text-text-muted">
        {t("admin.ai.ov.todayPercent", { percent: String(shown) })}
      </p>
      {cap === 0 ? <Notice tone="warning">{t("admin.ai.ov.capZero")}</Notice> : null}
      {cap > 0 && alerting ? (
        <Notice tone="warning">{t("admin.ai.ov.alert", { percent: String(alertPercent) })}</Notice>
      ) : null}
      {today.source === "database" ? (
        <p className="text-xs text-text-muted">{t("admin.ai.ov.sourceDatabase")}</p>
      ) : null}
    </Card>
  );
}

interface BarRow {
  key: string;
  name: string;
  calls: number;
  costUsdMicros: number;
}

/**
 * Spend by name as a list of bars: the name and the exact amount are text on every row, the bar is
 * only a proportional extra, and the colour is one hue (no meaning carried by colour).
 */
function BarList({ title, rows }: { title: string; rows: readonly BarRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.costUsdMicros));
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t("admin.ai.ov.chartEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={title}>
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate" dir="auto">
                  {row.name}
                </span>
                <span dir="ltr" className="shrink-0 tabular-nums">
                  {formatUsd(row.costUsdMicros)} · {formatNumber(row.calls)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-neutral-100" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ inlineSize: `${String((row.costUsdMicros / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Daily spend as inline SVG columns with a text table behind a disclosure for exact values. */
function DailyChart({ days }: { days: AiOverview["byDay"] }) {
  const max = Math.max(1, ...days.map((day) => day.costUsdMicros));
  const width = 100;
  const height = 40;
  const step = width / days.length;
  const total = days.reduce((sum, day) => sum + day.costUsdMicros, 0);
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <CardTitle>{t("admin.ai.ov.byDay")}</CardTitle>
      {total === 0 ? (
        <p className="text-sm text-text-muted">{t("admin.ai.ov.chartEmpty")}</p>
      ) : (
        <svg
          role="img"
          aria-label={t("admin.ai.ov.byDay")}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          preserveAspectRatio="none"
          className="h-32 w-full text-primary"
          style={{ direction: "ltr" }}
        >
          {days.map((day, index) => {
            const barHeight = (day.costUsdMicros / max) * (height - 2);
            return (
              <rect
                key={day.day}
                x={index * step + step * 0.15}
                y={height - barHeight}
                width={step * 0.7}
                height={barHeight}
                fill="currentColor"
              >
                <title>{`${day.day}: ${formatUsd(day.costUsdMicros)}`}</title>
              </rect>
            );
          })}
        </svg>
      )}
      <details>
        <summary className="cursor-pointer text-sm text-primary">
          {t("admin.ai.ov.tableView")}
        </summary>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-start text-text-muted">
              <th className="text-start font-normal">{t("admin.ai.ov.col.name")}</th>
              <th className="text-start font-normal">{t("admin.ai.ov.col.calls")}</th>
              <th className="text-start font-normal">{t("admin.ai.ov.col.cost")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <td dir="ltr" className="text-start tabular-nums">
                  {day.day}
                </td>
                <td className="tabular-nums">{formatNumber(day.calls)}</td>
                <td dir="ltr" className="text-start tabular-nums">
                  {formatUsd(day.costUsdMicros)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

const taskName = (task: string) => t(`admin.ai.task.${task}` as MessageKey);

/** Spend, volume and quality of the AI layer (Task 2.4). Reads aggregates only. */
export function AiOverviewPanel() {
  const [days, setDays] = useState<Days>(7);
  const resource = useResource(`/admin/ai/overview?days=${String(days)}`, aiOverviewSchema);

  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  const data = resource.data;

  return (
    <section aria-label={t("admin.ai.ov.title")} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-xl font-semibold">{t("admin.ai.ov.title")}</h2>
        <div role="group" aria-label={t("admin.ai.ov.range")} className="flex gap-2">
          {([7, 30] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={days === value ? "primary" : "secondary"}
              aria-pressed={days === value}
              onClick={() => {
                setDays(value);
              }}
            >
              {t(value === 7 ? "admin.ai.ov.days7" : "admin.ai.ov.days30")}
            </Button>
          ))}
        </div>
      </div>

      <SpendMeter today={data.today} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={t("admin.ai.ov.calls")} value={formatNumber(data.totals.calls)} />
        <Metric label={t("admin.ai.ov.cost")} value={formatUsd(data.totals.costUsdMicros)} />
        <Metric label={t("admin.ai.ov.errorRate")} value={percent(data.totals.errorRate)} />
        <Metric label={t("admin.ai.ov.fallbackRate")} value={percent(data.totals.fallbackRate)} />
        <Metric label={t("admin.ai.ov.cacheRate")} value={percent(data.totals.cacheHitRate)} />
        <Metric
          label={t("admin.ai.ov.avgAnalysis")}
          value={usd(data.perAnalysis.avgUsdMicros)}
          note={t("admin.ai.ov.analysesNote", { count: formatNumber(data.perAnalysis.analyses) })}
        />
        <Metric label={t("admin.ai.ov.p95Analysis")} value={usd(data.perAnalysis.p95UsdMicros)} />
        <Metric label={t("admin.ai.ov.latencyP50")} value={ms(data.totals.latencyP50Ms)} />
        <Metric label={t("admin.ai.ov.latencyP95")} value={ms(data.totals.latencyP95Ms)} />
      </div>

      <DailyChart days={data.byDay} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BarList
          title={t("admin.ai.ov.byTask")}
          rows={data.byTask.map((row) => ({
            key: row.task,
            name: taskName(row.task),
            calls: row.calls,
            costUsdMicros: row.costUsdMicros,
          }))}
        />
        <BarList
          title={t("admin.ai.ov.byModel")}
          rows={data.byModel.map((row) => ({
            key: row.modelKey,
            name: row.modelKey,
            calls: row.calls,
            costUsdMicros: row.costUsdMicros,
          }))}
        />
      </div>
    </section>
  );
}
