import { t } from "@wasfa/shared/i18n";

import { formatNumber, tOr } from "./admin-format";

import type { EvalRunStatus } from "@wasfa/shared/ai";
import type { EvalGroupMetrics } from "@wasfa/shared/evals";

/** Display helpers of the accuracy evaluation page. Pure, so the numbers shown are table-tested. */

const NONE = "—";

/** `0.9487` as `94.9%`; no data is a dash, never `NaN%`. */
export function formatRatio(ratio: number | null): string {
  if (ratio === null) return NONE;
  return `${formatNumber(Math.round(ratio * 1000) / 10)}%`;
}

/** Integer USD micros as dollars with enough digits for a fraction of a cent. */
export function formatUsdMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

export function formatSeconds(ms: number | null): string {
  if (ms === null) return NONE;
  return t("admin.evals.metric.seconds", { value: formatNumber(Math.round(ms / 100) / 10) });
}

/** The change from `a` to `b` in percentage points (`+2.5`), or a dash when either side has no data. */
export function formatDeltaPoints(a: number | null, b: number | null): string {
  if (a === null || b === null) return NONE;
  const points = Math.round((b - a) * 1000) / 10;
  if (points === 0) return "0";
  return `${points > 0 ? "+" : "−"}${formatNumber(Math.abs(points))}`;
}

const STATUS_TONES: Record<EvalRunStatus, "neutral" | "info" | "success" | "danger" | "warning"> = {
  queued: "neutral",
  running: "info",
  done: "success",
  failed: "danger",
  cancelled: "warning",
};

export const statusTone = (status: EvalRunStatus) => STATUS_TONES[status];

export function statusLabel(status: EvalRunStatus): string {
  switch (status) {
    case "queued":
      return t("admin.evals.status.queued");
    case "running":
      return t("admin.evals.status.running");
    case "done":
      return t("admin.evals.status.done");
    case "failed":
      return t("admin.evals.status.failed");
    case "cancelled":
      return t("admin.evals.status.cancelled");
  }
}

/** A run still moving: the page polls while one exists. */
export const isActiveRun = (status: EvalRunStatus): boolean =>
  status === "queued" || status === "running";

export interface MetricRow {
  id: string;
  label: string;
  /** The value of each column (overall, printed, handwritten) as text. */
  values: (group: EvalGroupMetrics) => string;
  /** Raw ratio for deltas; `null` rows (counts, cost) have no delta in points. */
  ratio: ((group: EvalGroupMetrics) => number | null) | null;
}

/** The rows of the metrics table, in the order the Targets table lists them. */
export function metricRows(): MetricRow[] {
  return [
    {
      id: "nameAccuracy",
      label: t("admin.evals.metric.nameAccuracy"),
      values: (g) => formatRatio(g.nameAccuracy),
      ratio: (g) => g.nameAccuracy,
    },
    {
      id: "recall",
      label: t("admin.evals.metric.recall"),
      values: (g) => formatRatio(g.recall),
      ratio: (g) => g.recall,
    },
    {
      id: "strength",
      label: t("admin.evals.metric.strength"),
      values: (g) => formatRatio(g.strength.accuracy),
      ratio: (g) => g.strength.accuracy,
    },
    {
      id: "frequency",
      label: t("admin.evals.metric.frequency"),
      values: (g) => formatRatio(g.frequency.accuracy),
      ratio: (g) => g.frequency.accuracy,
    },
    {
      id: "duration",
      label: t("admin.evals.metric.duration"),
      values: (g) => formatRatio(g.duration.accuracy),
      ratio: (g) => g.duration.accuracy,
    },
    {
      id: "fabricated",
      label: t("admin.evals.metric.fabricated"),
      values: (g) => formatNumber(g.fabricated),
      ratio: null,
    },
    {
      id: "fabricationRate",
      label: t("admin.evals.metric.fabricationRate"),
      values: (g) => formatRatio(g.fabricationRate),
      ratio: (g) => g.fabricationRate,
    },
    {
      id: "latencyP50",
      label: t("admin.evals.metric.latencyP50"),
      values: (g) => formatSeconds(g.latencyP50Ms),
      ratio: null,
    },
    {
      id: "latencyP95",
      label: t("admin.evals.metric.latencyP95"),
      values: (g) => formatSeconds(g.latencyP95Ms),
      ratio: null,
    },
    {
      id: "cost",
      label: t("admin.evals.metric.cost"),
      values: (g) => formatUsdMicros(g.costUsdMicros),
      ratio: null,
    },
    {
      id: "items",
      label: t("admin.evals.metric.items"),
      values: (g) => formatNumber(g.items),
      ratio: null,
    },
    {
      id: "failed",
      label: t("admin.evals.metric.failed"),
      values: (g) => formatNumber(g.failed),
      ratio: null,
    },
  ];
}

/** Text for an API `details.reason` of the evaluation endpoints, with a generic fallback. */
export function evalReasonText(prefix: "start" | "import" | "review", reason: string | undefined) {
  const fallback = t("form.invalid");
  if (reason === undefined) return fallback;
  return tOr(`admin.evals.${prefix}.reason.${reason}`, fallback);
}
