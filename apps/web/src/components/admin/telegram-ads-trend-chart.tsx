"use client";

import { t } from "@wasfa/shared/i18n";
import { Card, CardTitle, cn } from "@wasfa/ui";
import { useId } from "react";

import { formatNumber } from "../../lib/admin-format";

export interface TrendDay {
  day: string;
  impressions: number;
  clicks: number;
}

const W = 640;
const H = 150;
const PAD = { top: 12, bottom: 22, left: 8, right: 8 } as const;

/** A round top for the y axis (1, 2, 5 x 10^n) so the gridlines read as plain numbers. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

type Metric = "impressions" | "clicks";

function Panel({
  days,
  metric,
  tone,
  marker,
}: {
  days: readonly TrendDay[];
  metric: Metric;
  tone: string;
  marker: "circle" | "square";
}) {
  const titleId = useId();
  const total = days.reduce((sum, day) => sum + day[metric], 0);
  const peak = days.reduce(
    (best, day) => (day[metric] > best.value ? { value: day[metric], day: day.day } : best),
    {
      value: 0,
      day: "",
    },
  );
  const top = niceMax(peak.value);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (days.length <= 1 ? innerW / 2 : (index / (days.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;
  const points = days.map((day, index) => `${x(index).toFixed(1)},${y(day[metric]).toFixed(1)}`);
  const area = `${x(0).toFixed(1)},${String(PAD.top + innerH)} ${points.join(" ")} ${x(days.length - 1).toFixed(1)},${String(PAD.top + innerH)}`;
  const labelIndexes = [...new Set([0, Math.floor((days.length - 1) / 2), days.length - 1])];
  const showMarkers = days.length <= 31;
  const name = t(
    metric === "impressions" ? "admin.tgAds.kpi.impressions" : "admin.tgAds.kpi.clicks",
  );

  return (
    <div className="flex flex-col gap-1" data-testid={`tg-trend-${metric}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id={titleId} className={cn("flex items-center gap-2 text-sm font-semibold", tone)}>
          <svg
            aria-hidden
            width="12"
            height="12"
            viewBox="0 0 12 12"
            className="shrink-0 fill-current"
          >
            {marker === "circle" ? (
              <circle cx="6" cy="6" r="5" />
            ) : (
              <rect x="1" y="1" width="10" height="10" />
            )}
          </svg>
          <span className="text-text">{name}</span>
        </p>
        <p className="text-sm text-text-muted">
          {t("admin.tgAds.chart.summary", {
            total: formatNumber(total),
            peak: formatNumber(peak.value),
            day: peak.day,
          })}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-labelledby={titleId}
        className={cn("h-auto w-full", tone)}
      >
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(top * ratio)}
              y2={y(top * ratio)}
              className="stroke-border"
              strokeWidth="1"
            />
            <text x={PAD.left + 2} y={y(top * ratio) - 3} className="fill-text-muted text-[10px]">
              {formatNumber(top * ratio)}
            </text>
          </g>
        ))}
        <polygon points={area} className="fill-current" opacity="0.12" />
        <polyline
          points={points.join(" ")}
          fill="none"
          className="stroke-current"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeDasharray={metric === "clicks" ? "6 3" : undefined}
        />
        {showMarkers
          ? days.map((day, index) =>
              marker === "circle" ? (
                <circle
                  key={day.day}
                  cx={x(index)}
                  cy={y(day[metric])}
                  r="2.5"
                  className="fill-current"
                />
              ) : (
                <rect
                  key={day.day}
                  x={x(index) - 2.5}
                  y={y(day[metric]) - 2.5}
                  width="5"
                  height="5"
                  className="fill-current"
                />
              ),
            )
          : null}
        {labelIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={H - 6}
            textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
            className="fill-text-muted text-[10px]"
          >
            {days[index]?.day ?? ""}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * Daily trend of impressions and clicks as two stacked panels that share the day axis (small
 * multiples), because clicks are tiny next to impressions and one shared scale would flatten them.
 * Series are told apart by label, line style and marker, never by colour alone. The time axis stays
 * left to right (dates and numbers are LTR runs) even in the RTL page; a data table is one click away.
 */
export function TelegramAdsTrendChart({ days }: { days: readonly TrendDay[] }) {
  const empty = days.length === 0 || days.every((day) => day.impressions === 0 && day.clicks === 0);
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <CardTitle>{t("admin.tgAds.chart.title")}</CardTitle>
      {empty ? (
        <p className="text-sm text-text-muted" data-testid="tg-trend-empty">
          {t("admin.tgAds.chart.empty")}
        </p>
      ) : (
        <>
          <div dir="ltr" className="flex flex-col gap-4">
            <Panel days={days} metric="impressions" tone="text-primary" marker="circle" />
            <Panel days={days} metric="clicks" tone="text-success" marker="square" />
          </div>
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary">
              {t("admin.tgAds.chart.showTable")}
            </summary>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-start">
                <caption className="sr-only">{t("admin.tgAds.chart.title")}</caption>
                <thead>
                  <tr className="text-text-muted">
                    <th scope="col" className="py-1 text-start">
                      {t("admin.tgAds.col.day")}
                    </th>
                    <th scope="col" className="py-1 text-start">
                      {t("admin.tgAds.kpi.impressions")}
                    </th>
                    <th scope="col" className="py-1 text-start">
                      {t("admin.tgAds.kpi.clicks")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.day} className="border-t border-border">
                      <th scope="row" className="py-1 text-start font-normal">
                        <bdi dir="ltr">{day.day}</bdi>
                      </th>
                      <td className="py-1 tabular-nums">{formatNumber(day.impressions)}</td>
                      <td className="py-1 tabular-nums">{formatNumber(day.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}
