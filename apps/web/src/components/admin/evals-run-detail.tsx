"use client";

import { t } from "@wasfa/shared/i18n";
import {
  evalItemDetailSchema,
  evalRunDetailSchema,
  type EvalItemDetail,
} from "@wasfa/shared/schemas/admin-evals";
import { Badge, Button, Skeleton } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { formatSeconds, formatUsdMicros } from "../../lib/eval-format";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { CalibrationTable, MetricsTable } from "./evals-metrics-table";

const th = "px-3 py-2 text-start text-sm font-semibold text-text-muted";
const td = "px-3 py-2 text-base align-top";

function resultLabel(pair: NonNullable<EvalItemDetail["scores"]>["pairs"][number]): string {
  if (pair.predicted === null) return t("admin.evals.item.missed");
  return pair.nameCorrect ? t("admin.evals.item.ok") : t("admin.evals.item.wrong");
}

/** One prescription against its label: the expected lines, what was read, and how each line scored. */
function ItemDrilldown({ runId, itemId }: { runId: string; itemId: string }) {
  const item = useResource(`/admin/ai/evals/runs/${runId}/items/${itemId}`, evalItemDetailSchema);
  if (item.status === "loading") return <Skeleton className="h-32 w-full" />;
  if (item.status === "error") return <ErrorNotice error={item.error} onRetry={item.reload} />;
  const { expected, output, scores } = item.data;
  const mark = (ok: boolean | null | undefined) =>
    ok === null || ok === undefined ? "" : ok ? " ✓" : " ✗";

  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-heading text-lg font-semibold">{t("admin.evals.item.title")}</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-96 border-collapse">
          <caption className="text-start font-semibold">{t("admin.evals.item.expected")}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={th}>
                {t("admin.evals.item.col.name")}
              </th>
              <th scope="col" className={th}>
                {t("admin.evals.item.col.strength")}
              </th>
              <th scope="col" className={th}>
                {t("admin.evals.item.col.frequency")}
              </th>
              <th scope="col" className={th}>
                {t("admin.evals.item.col.duration")}
              </th>
              <th scope="col" className={th}>
                {t("admin.evals.item.col.result")}
              </th>
            </tr>
          </thead>
          <tbody>
            {expected.items.map((line, index) => {
              const pair = scores?.pairs.find((p) => p.expected === index);
              return (
                <tr key={`${line.name}-${String(index)}`} className="border-b border-border/60">
                  <th scope="row" className={`${td} text-start font-semibold`} dir="auto">
                    {line.name}
                  </th>
                  <td className={td} dir="auto">
                    {line.strength ?? "—"}
                    {mark(pair?.strength)}
                  </td>
                  <td className={td} dir="auto">
                    {line.frequency ?? "—"}
                    {mark(pair?.frequency)}
                  </td>
                  <td className={td} dir="auto">
                    {line.duration ?? "—"}
                    {mark(pair?.duration)}
                  </td>
                  <td className={td}>{pair ? resultLabel(pair) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {output === null ? (
        <p className="text-base text-text-muted">{t("admin.evals.item.noOutput")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 border-collapse">
            <caption className="text-start font-semibold">{t("admin.evals.item.read")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.name")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.strength")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.frequency")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.duration")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.confidence")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.item.col.result")}
                </th>
              </tr>
            </thead>
            <tbody>
              {output.items.map((line, index) => {
                const extra = scores?.extras.find((e) => e.predicted === index);
                return (
                  <tr
                    key={`${line.rawText}-${String(index)}`}
                    className="border-b border-border/60"
                  >
                    <th scope="row" className={`${td} text-start font-semibold`} dir="auto">
                      {line.name ?? "—"}
                    </th>
                    <td className={td} dir="auto">
                      {line.strength ?? "—"}
                    </td>
                    <td className={td} dir="auto">
                      {line.frequency ?? "—"}
                    </td>
                    <td className={td} dir="auto">
                      {line.duration ?? "—"}
                    </td>
                    <td className={`${td} tabular-nums`}>
                      {formatNumber(Math.round(line.confidence * 100))}%
                    </td>
                    <td className={td}>{extra ? t("admin.evals.item.extra") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A finished (or running) run: snapshot, metrics split by kind, calibration, and every prescription. */
export function EvalRunDetail({ runId }: { runId: string }) {
  const run = useResource(`/admin/ai/evals/runs/${runId}`, evalRunDetailSchema);
  const [inspected, setInspected] = useState<string | null>(null);

  if (run.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (run.status === "error") return <ErrorNotice error={run.error} onRetry={run.reload} />;
  const { snapshot, metrics, items } = run.data;

  return (
    <div className="flex flex-col gap-6">
      {snapshot ? (
        <p className="text-sm text-text-muted">
          {t("admin.evals.detail.snapshot", {
            version: formatNumber(snapshot.routeVersion),
            models: snapshot.models.map((m) => m.displayName).join("، "),
          })}
        </p>
      ) : null}

      {metrics ? (
        <>
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              {t("admin.evals.detail.metrics")}
            </h3>
            <MetricsTable metrics={metrics} />
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-heading text-lg font-semibold">
              {t("admin.evals.detail.calibration")}
            </h3>
            <p className="text-sm text-text-muted">{t("admin.evals.detail.calibrationHint")}</p>
            <CalibrationTable group={metrics.overall} />
          </section>
        </>
      ) : (
        <p className="text-base text-text-muted">{t("admin.evals.detail.notRun")}</p>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-heading text-lg font-semibold">{t("admin.evals.detail.items")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 border-collapse">
            <caption className="sr-only">{t("admin.evals.detail.items")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.detail.col.kind")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.detail.col.nameCorrect")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.detail.col.fabricated")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.detail.col.latency")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.cost")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.detail.col.error")}
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">{t("admin.evals.detail.inspect")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.itemId} className="border-b border-border/60">
                  <th scope="row" className={`${td} text-start font-normal`}>
                    {t(`admin.evals.kind.${item.kind}`)}
                  </th>
                  <td className={`${td} tabular-nums`}>
                    {item.scores
                      ? `${formatNumber(item.scores.nameCorrect)} / ${formatNumber(item.scores.expected)}`
                      : item.done
                        ? "—"
                        : t("admin.evals.detail.notRun")}
                  </td>
                  <td className={td}>
                    {item.scores && item.scores.fabricated > 0 ? (
                      <Badge tone="danger">{formatNumber(item.scores.fabricated)}</Badge>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className={`${td} tabular-nums`}>{formatSeconds(item.latencyMs)}</td>
                  <td className={`${td} tabular-nums`} dir="ltr">
                    {formatUsdMicros(item.costUsdMicros)}
                  </td>
                  <td className={td} dir="ltr">
                    {item.error ?? ""}
                  </td>
                  <td className={td}>
                    {item.done ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setInspected(inspected === item.itemId ? null : item.itemId);
                        }}
                      >
                        {t("admin.evals.detail.inspect")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {inspected ? <ItemDrilldown runId={runId} itemId={inspected} /> : null}
    </div>
  );
}
