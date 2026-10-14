"use client";

import { t } from "@wasfa/shared/i18n";
import {
  evalCompareResponseSchema,
  evalRunListResponseSchema,
  type EvalRunSummary,
} from "@wasfa/shared/schemas/admin-evals";
import { Badge, Button, Card, Checkbox, EmptyState, Skeleton, useToast } from "@wasfa/ui";
import { ClipboardCheck, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import {
  formatRatio,
  formatUsdMicros,
  isActiveRun,
  statusLabel,
  statusTone,
} from "../../lib/eval-format";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { DetailDrawer } from "./drawer";
import { CompareTable } from "./evals-metrics-table";
import { EvalRunDetail } from "./evals-run-detail";
import { EvalsStartDialog } from "./evals-start-dialog";

const POLL_MS = 5_000;
const th = "px-3 py-2 text-start text-sm font-semibold text-text-muted";
const td = "px-3 py-2 text-base";

export const runName = (run: EvalRunSummary): string =>
  run.modelName ?? t("admin.evals.runs.routeAsIs");

function Compare({ aId, bId }: { aId: string; bId: string }) {
  const compared = useResource(
    `/admin/ai/evals/runs/compare?a=${aId}&b=${bId}`,
    evalCompareResponseSchema,
  );
  if (compared.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (compared.status === "error") {
    return <ErrorNotice error={compared.error} onRetry={compared.reload} />;
  }
  const { a, b, sameSet, differences } = compared.data;
  return (
    <div className="flex flex-col gap-4">
      {sameSet ? null : (
        <p role="alert" className="text-base text-warning">
          {t("admin.evals.compare.differentSets")}
        </p>
      )}
      {a.metrics && b.metrics ? (
        <CompareTable a={a.metrics} b={b.metrics} nameA={runName(a)} nameB={runName(b)} />
      ) : (
        <p className="text-base text-text-muted">{t("admin.evals.detail.notRun")}</p>
      )}
      <h3 className="font-heading text-lg font-semibold">{t("admin.evals.compare.differences")}</h3>
      {differences.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.evals.compare.noDifferences")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-base">
          {differences.map((difference) => (
            <li key={difference.itemId} className="tabular-nums">
              {t(`admin.evals.kind.${difference.kind}`)}: {runName(a)}{" "}
              {difference.aNameCorrect === null ? "—" : formatNumber(difference.aNameCorrect)} /{" "}
              {runName(b)}{" "}
              {difference.bNameCorrect === null ? "—" : formatNumber(difference.bNameCorrect)} (
              {formatNumber(difference.expected)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The runs list, the start dialog, the side-by-side comparison and the per-run drawer. */
export function EvalsRunsPanel() {
  const runs = useResource("/admin/ai/evals/runs", evalRunListResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState<[string, string] | null>(null);
  const [openRun, setOpenRun] = useState<EvalRunSummary | null>(null);

  const active = runs.status === "ready" && runs.data.items.some((run) => isActiveRun(run.status));
  const { reload } = runs;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(reload, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, reload]);

  const toggle = (id: string, on: boolean) => {
    setPicked((current) => (on ? [...current, id].slice(-2) : current.filter((x) => x !== id)));
  };

  const cancel = (run: EvalRunSummary) => {
    reauth
      .run(() => api(`/admin/ai/evals/runs/${run.id}/cancel`, { method: "POST" }))
      .then(
        () => {
          toast({ tone: "success", title: t("admin.evals.runs.cancelled") });
          reload();
        },
        (error: unknown) => {
          toast({ tone: "error", title: toApiError(error).message });
        },
      );
  };

  if (runs.status === "loading") return <Skeleton className="h-48 w-full" />;
  if (runs.status === "error") return <ErrorNotice error={runs.error} onRetry={runs.reload} />;

  const items = runs.data.items;
  const [first, second] = picked;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{t("admin.evals.runs.compareHint")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            name="compare"
            disabled={first === undefined || second === undefined}
            onClick={() => {
              if (first !== undefined && second !== undefined) setComparing([first, second]);
            }}
          >
            {t("admin.evals.runs.compare")}
          </Button>
          <Button
            name="start-run"
            onClick={() => {
              setStarting(true);
            }}
          >
            <Play aria-hidden className="size-5" />
            {t("admin.evals.runs.start")}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <Card elevation="flat">
          <EmptyState
            icon={<ClipboardCheck />}
            title={t("admin.evals.runs.empty")}
            description={t("admin.evals.runs.emptyHint")}
          />
        </Card>
      ) : (
        <Card elevation="flat" padding="none" className="overflow-x-auto">
          <table className="w-full min-w-3xl border-collapse">
            <caption className="sr-only">{t("admin.evals.runs.caption")}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.pick")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.model")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.set")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.status")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.score")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.progress")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.cost")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.when")}
                </th>
                <th scope="col" className={th}>
                  {t("admin.evals.runs.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((run) => (
                <tr key={run.id} className="border-b border-border/60">
                  <td className={td}>
                    <Checkbox
                      label={
                        <span className="sr-only">
                          {t("admin.evals.runs.pick", { name: runName(run) })}
                        </span>
                      }
                      checked={picked.includes(run.id)}
                      onChange={(event) => {
                        toggle(run.id, event.target.checked);
                      }}
                    />
                  </td>
                  <th scope="row" className={`${td} text-start font-semibold`}>
                    {runName(run)}
                  </th>
                  <td className={td}>{run.setName}</td>
                  <td className={td}>
                    <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {run.metrics?.score === null || run.metrics === null
                      ? "—"
                      : formatRatio(run.metrics.overall.nameAccuracy)}
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {t("admin.evals.runs.progress", {
                      done: formatNumber(run.itemsDone),
                      total: formatNumber(run.itemsTotal),
                    })}
                  </td>
                  <td className={`${td} tabular-nums`} dir="ltr">
                    {formatUsdMicros(run.costUsdMicros)}
                  </td>
                  <td className={td}>{formatDateTime(run.createdAt)}</td>
                  <td className={td}>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setOpenRun(run);
                        }}
                      >
                        {t("admin.evals.runs.open")}
                      </Button>
                      {isActiveRun(run.status) ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            cancel(run);
                          }}
                        >
                          {t("admin.evals.runs.cancel")}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <EvalsStartDialog
        open={starting}
        onOpenChange={setStarting}
        onStarted={() => {
          setStarting(false);
          reload();
        }}
      />

      <DetailDrawer
        open={comparing !== null}
        onClose={() => {
          setComparing(null);
        }}
        title={t("admin.evals.compare.title")}
      >
        <div className="p-5">
          {comparing ? <Compare aId={comparing[0]} bId={comparing[1]} /> : null}
        </div>
      </DetailDrawer>

      <DetailDrawer
        open={openRun !== null}
        onClose={() => {
          setOpenRun(null);
        }}
        title={openRun ? t("admin.evals.detail.title", { name: runName(openRun) }) : ""}
      >
        <div className="p-5">{openRun ? <EvalRunDetail runId={openRun.id} /> : null}</div>
      </DetailDrawer>
    </div>
  );
}
