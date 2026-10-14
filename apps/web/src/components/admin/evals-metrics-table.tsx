import { t } from "@wasfa/shared/i18n";

import { formatNumber } from "../../lib/admin-format";
import { formatDeltaPoints, formatRatio, metricRows } from "../../lib/eval-format";

import type { EvalGroupMetrics, EvalRunMetrics } from "@wasfa/shared/evals";

const th = "px-3 py-2 text-start text-sm font-semibold text-text-muted";
const td = "px-3 py-2 text-base tabular-nums";

const GROUPS = ["overall", "printed", "handwritten"] as const;

function groupLabel(group: (typeof GROUPS)[number]): string {
  switch (group) {
    case "overall":
      return t("admin.evals.metric.overall");
    case "printed":
      return t("admin.evals.metric.printed");
    case "handwritten":
      return t("admin.evals.metric.handwritten");
  }
}

/** One run's metrics: every row split into all / printed / handwritten. */
export function MetricsTable({ metrics }: { metrics: EvalRunMetrics }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-96 border-collapse">
        <caption className="sr-only">{t("admin.evals.detail.metrics")}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>
              {t("admin.evals.metric.metric")}
            </th>
            {GROUPS.map((group) => (
              <th key={group} scope="col" className={th}>
                {groupLabel(group)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metricRows().map((row) => (
            <tr key={row.id} className="border-b border-border/60">
              <th scope="row" className="px-3 py-2 text-start text-base font-normal">
                {row.label}
              </th>
              {GROUPS.map((group) => (
                <td key={group} className={td}>
                  {row.values(metrics[group])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two runs side by side, with the difference in points for the ratio rows (overall column). */
export function CompareTable({
  a,
  b,
  nameA,
  nameB,
}: {
  a: EvalRunMetrics;
  b: EvalRunMetrics;
  nameA: string;
  nameB: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-xl border-collapse">
        <caption className="sr-only">{t("admin.evals.compare.title")}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" rowSpan={2} className={th}>
              {t("admin.evals.metric.metric")}
            </th>
            {GROUPS.map((group) => (
              <th key={group} scope="colgroup" colSpan={3} className={`${th} text-center`}>
                {groupLabel(group)}
              </th>
            ))}
          </tr>
          <tr className="border-b border-border">
            {GROUPS.flatMap((group) => [
              <th key={`${group}-a`} scope="col" className={th}>
                {nameA}
              </th>,
              <th key={`${group}-b`} scope="col" className={th}>
                {nameB}
              </th>,
              <th key={`${group}-d`} scope="col" className={th}>
                {t("admin.evals.compare.delta")}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {metricRows().map((row) => (
            <tr key={row.id} className="border-b border-border/60">
              <th scope="row" className="px-3 py-2 text-start text-base font-normal">
                {row.label}
              </th>
              {GROUPS.flatMap((group) => {
                const left: EvalGroupMetrics = a[group];
                const right: EvalGroupMetrics = b[group];
                return [
                  <td key={`${group}-a`} className={td}>
                    {row.values(left)}
                  </td>,
                  <td key={`${group}-b`} className={td}>
                    {row.values(right)}
                  </td>,
                  <td key={`${group}-d`} className={td} dir="ltr">
                    {row.ratio ? formatDeltaPoints(row.ratio(left), row.ratio(right)) : ""}
                  </td>,
                ];
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Accuracy per confidence band: where the confidence can and cannot be trusted. */
export function CalibrationTable({ group }: { group: EvalGroupMetrics }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-80 border-collapse">
        <caption className="sr-only">{t("admin.evals.detail.calibration")}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={th}>
              {t("admin.evals.detail.col.band")}
            </th>
            <th scope="col" className={th}>
              {t("admin.evals.detail.col.total")}
            </th>
            <th scope="col" className={th}>
              {t("admin.evals.detail.col.correct")}
            </th>
            <th scope="col" className={th}>
              {t("admin.evals.detail.col.accuracy")}
            </th>
          </tr>
        </thead>
        <tbody>
          {group.calibration.map((band) => (
            <tr key={band.band} className="border-b border-border/60">
              <th scope="row" className="px-3 py-2 text-start text-base font-normal" dir="ltr">
                {band.band}%
              </th>
              <td className={td}>{formatNumber(band.total)}</td>
              <td className={td}>{formatNumber(band.correct)}</td>
              <td className={td}>{formatRatio(band.accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
