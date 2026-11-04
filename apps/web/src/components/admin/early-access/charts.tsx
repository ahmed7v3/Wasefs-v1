"use client";

import { useState } from "react";

import {
  demandCurve,
  formatPercent,
  funnelSteps,
  niceMax,
  percent,
  polyline,
  scaleLinear,
} from "./chart-math";
import { T, formatPrice } from "./labels";

import type { ReactNode } from "react";

/*
 * Inline SVG charts, no chart library. One accent hue: brand navy for the primary series, soft blue
 * for the secondary one. SVGs sit in a dir="ltr" wrapper (time and price axes read left to right);
 * the surrounding labels stay RTL.
 */

const NAVY = "#1E3A8A";
const SOFT = "#60A5FA";
const GRID = "#E5E7EB";
const INK = "#6B7280";

const nf = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

export function ChartCard({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-semibold text-text">{title}</h3>
        {action}
      </div>
      {hint ? <p className="text-sm text-text-muted">{hint}</p> : null}
      {children}
    </section>
  );
}

export function NoData() {
  return <p className="py-6 text-center text-sm text-text-muted">{T.chart.noData}</p>;
}

// ---------------------------------------------------------------------------------------------

export interface DailyPoint {
  date: string;
  views: number;
  signups: number;
}

/** Visits (soft area) vs sign-ups (navy line) per day, with a hover tooltip. */
export function DailyChart({ series }: { series: readonly DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (series.length === 0) return <NoData />;
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const max = niceMax(Math.max(...series.map((p) => Math.max(p.views, p.signups))));
  const x = scaleLinear([0, Math.max(series.length - 1, 1)], [pad.l, W - pad.r]);
  const y = scaleLinear([0, max], [H - pad.b, pad.t]);
  const viewPts = series.map((p, i) => [x(i), y(p.views)] as const);
  const signupPts = series.map((p, i) => [x(i), y(p.signups)] as const);
  const area = polyline([[pad.l, H - pad.b], ...viewPts, [x(series.length - 1), H - pad.b]]);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(series.length / 6));
  const active = hover === null ? undefined : series[hover];

  return (
    <div dir="ltr" className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={T.chart.daily}
        onMouseLeave={() => {
          setHover(null);
        }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * W;
          const index = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (series.length - 1));
          setHover(Math.min(series.length - 1, Math.max(0, index)));
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tick)} y2={y(tick)} stroke={GRID} />
            <text x={pad.l - 6} y={y(tick) + 4} fontSize="11" textAnchor="end" fill={INK}>
              {nf.format(tick)}
            </text>
          </g>
        ))}
        <polygon points={area} fill={SOFT} opacity="0.25" />
        <polyline points={polyline(viewPts)} fill="none" stroke={SOFT} strokeWidth="2" />
        <polyline points={polyline(signupPts)} fill="none" stroke={NAVY} strokeWidth="2.5" />
        {series.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill={INK}>
              {p.date.slice(5)}
            </text>
          ) : null,
        )}
        {hover !== null && active ? (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={H - pad.b}
              stroke={INK}
              strokeDasharray="3 3"
            />
            <circle cx={x(hover)} cy={y(active.views)} r="4" fill={SOFT} />
            <circle cx={x(hover)} cy={y(active.signups)} r="4" fill={NAVY} />
          </g>
        ) : null}
      </svg>
      <div
        className="mt-2 flex flex-wrap items-center gap-4 text-sm tabular-nums text-text-muted"
        dir="rtl"
      >
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-1 w-4 rounded" style={{ background: SOFT }} />
          {T.chart.views}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-1 w-4 rounded" style={{ background: NAVY }} />
          {T.chart.signups}
        </span>
        <span aria-live="polite" className="ms-auto text-text">
          {active
            ? `${active.date} · ${T.chart.views} ${nf.format(active.views)} · ${T.chart.signups} ${nf.format(active.signups)}`
            : ""}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Horizontal funnel bars with the step-to-step drop. */
export function FunnelBars({ steps }: { steps: readonly { label: string; sessions: number }[] }) {
  if (steps.length === 0 || steps.every((s) => s.sessions === 0)) return <NoData />;
  const computed = funnelSteps(steps.map((s) => s.sessions));
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const c = computed[index];
        if (!c) return null;
        return (
          <li key={step.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-text">{step.label}</span>
              <span className="tabular-nums text-text-muted">
                {nf.format(step.sessions)} · {formatPercent(c.ofFirst)}
                {index > 0 && c.drop > 0 ? ` · ${T.chart.drop} ${formatPercent(c.drop)}` : ""}
              </span>
            </div>
            <div className="h-3 rounded bg-primary-soft" dir="ltr">
              <div
                className="h-3 rounded"
                style={{
                  width: `${Math.max(c.ofFirst, step.sessions > 0 ? 1 : 0)}%`,
                  background: NAVY,
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------

export interface BarRow {
  key: string;
  label: string;
  count: number;
}

/** Direct-labelled bar list; rows are buttons when `onSelect` is given. */
export function BarList({
  rows,
  onSelect,
  selectedKey,
  limit = 10,
}: {
  rows: readonly BarRow[];
  onSelect?: (key: string) => void;
  selectedKey?: string | undefined;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const top = Math.max(...shown.map((r) => r.count), 1);
  if (shown.length === 0) return <NoData />;
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((row) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-text">{row.label}</span>
              <span className="shrink-0 tabular-nums text-text-muted">
                {nf.format(row.count)} · {formatPercent(percent(row.count, total))}
              </span>
            </span>
            <span className="block h-2.5 rounded bg-primary-soft" dir="ltr">
              <span
                className="block h-2.5 rounded"
                style={{
                  width: `${(row.count / top) * 100}%`,
                  background: row.key === selectedKey ? NAVY : SOFT,
                }}
              />
            </span>
          </>
        );
        return (
          <li key={row.key}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => {
                  onSelect(row.key);
                }}
                aria-pressed={row.key === selectedKey}
                className="flex w-full flex-col gap-1 rounded-md p-1 text-start hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                {body}
              </button>
            ) : (
              <div className="flex flex-col gap-1 p-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------

export interface CurveRow {
  priceMinor: number;
  answered: number;
  yes: number;
  maybe: number;
}

/** Demand curve of one currency: % yes and % yes+maybe by probe price, labelled with n. */
export function PriceCurve({ rows, currency }: { rows: readonly CurveRow[]; currency: string }) {
  const points = demandCurve(rows);
  if (points.length === 0) return <NoData />;
  const W = 520;
  const H = 240;
  const pad = { l: 40, r: 16, t: 20, b: 40 };
  const prices = points.map((p) => p.priceMinor);
  const x = scaleLinear([Math.min(...prices), Math.max(...prices)], [pad.l + 16, W - pad.r - 16]);
  const y = scaleLinear([0, 100], [H - pad.b, pad.t]);
  const yes = points.map((p) => [x(p.priceMinor), y(p.yesPct)] as const);
  const maybe = points.map((p) => [x(p.priceMinor), y(p.yesMaybePct)] as const);
  return (
    <div dir="ltr" className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={T.chart.priceCurve}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tick)} y2={y(tick)} stroke={GRID} />
            <text x={pad.l - 6} y={y(tick) + 4} fontSize="11" textAnchor="end" fill={INK}>
              {tick}%
            </text>
          </g>
        ))}
        <polyline points={polyline(maybe)} fill="none" stroke={SOFT} strokeWidth="2.5" />
        <polyline points={polyline(yes)} fill="none" stroke={NAVY} strokeWidth="2.5" />
        {points.map((p, i) => {
          const cx = x(p.priceMinor);
          const yesY = yes[i]?.[1] ?? 0;
          const maybeY = maybe[i]?.[1] ?? 0;
          return (
            <g key={p.priceMinor}>
              <circle cx={cx} cy={yesY} r="4" fill={NAVY} />
              <circle cx={cx} cy={maybeY} r="4" fill={SOFT} />
              <text x={cx} y={yesY + 16} fontSize="11" textAnchor="middle" fill={NAVY}>
                {formatPercent(p.yesPct)}
              </text>
              <text x={cx} y={maybeY - 8} fontSize="11" textAnchor="middle" fill={INK}>
                {formatPercent(p.yesMaybePct)}
              </text>
              <text x={cx} y={H - 20} fontSize="11" textAnchor="middle" fill={INK}>
                {formatPrice(p.priceMinor, currency)}
              </text>
              <text x={cx} y={H - 6} fontSize="10" textAnchor="middle" fill={INK}>
                n={p.answered}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-sm text-text-muted" dir="rtl">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-1 w-4 rounded" style={{ background: NAVY }} />
          {T.chart.yes}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-1 w-4 rounded" style={{ background: SOFT }} />
          {T.chart.yesMaybe}
        </span>
      </div>
    </div>
  );
}
