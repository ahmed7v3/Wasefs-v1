"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  experimentResultsResponseSchema,
  experimentViewSchema,
  type ExperimentView,
} from "@wasfa/shared/schemas/growth";
import { Button, Dialog, Field, Input, useToast } from "@wasfa/ui";
import { Split } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { EmptyHint } from "./empty-hint";
import { ResourceBoundary } from "./resource-boundary";
import { StatusChip } from "./status-chip";

const listSchema = z.object({ items: z.array(experimentViewSchema) });
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function Results({ id }: { id: string }) {
  const results = useResource(`/admin/growth/experiments/${id}/results`, experimentResultsResponseSchema);
  return (
    <ResourceBoundary resource={results}>
      {(data) => (
        <div className="flex flex-col gap-3">
          {data.minSampleReached ? null : (
            <Notice tone="info">{t("admin.experiments.sampleNotReached", { min: formatNumber(data.minSampleSize) })}</Notice>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-start text-sm">
              <caption className="sr-only">{t("admin.experiments.results")}</caption>
              <thead className="text-text-muted">
                <tr>
                  {(["variant", "exposures", "conversion", "refunds", "support", "dismissals", "unsubscribes", "guardrail"] as const).map((key) => (
                    <th key={key} scope="col" className="p-2 text-start">{t(`admin.experiments.col.${key}` as MessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.variants.map((row) => (
                  <tr key={row.variant} className={row.flaggedRed ? "bg-danger-soft" : "border-t border-border/60"} data-flagged={row.flaggedRed ? "true" : "false"}>
                    <td className="p-2 font-semibold">{row.variant === data.controlVariant ? `${row.variant} (${t("admin.experiments.control")})` : row.variant}</td>
                    <td className="p-2 tabular-nums">{formatNumber(row.exposures)}</td>
                    <td className="p-2 tabular-nums">{percent(row.conversionBps)}</td>
                    <td className="p-2 tabular-nums">{percent(row.guardrails.refundBps)}</td>
                    <td className="p-2 tabular-nums">{percent(row.guardrails.supportBps)}</td>
                    <td className="p-2 tabular-nums">{percent(row.guardrails.dismissalBps)}</td>
                    <td className="p-2 tabular-nums">{percent(row.guardrails.unsubscribeBps)}</td>
                    <td className="p-2">
                      {row.flaggedRed
                        ? row.flaggedReasons.map((reason) => t(`admin.experiments.guardrail.${reason}` as MessageKey)).join("، ")
                        : t("admin.experiments.guardrailOk")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ResourceBoundary>
  );
}

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [split, setSplit] = useState("50");
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const share = /^\d{1,2}$/.test(split) ? Number(split) : null;
  const ready = key.trim() !== "" && name.trim() !== "" && flagKey.trim() !== "" && share !== null && share > 0 && share < 100;
  const create = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    try {
      await api("/admin/growth/experiments", {
        method: "POST",
        body: {
          key: key.trim(),
          name: name.trim(),
          flagKey: flagKey.trim(),
          variants: [
            { key: "a", weight: 100 - (share ?? 50) },
            { key: "b", weight: share ?? 50 },
          ],
        },
        schema: experimentViewSchema,
      });
      onCreated();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={t("admin.experiments.new")} description={t("admin.experiments.newLead")}>
      <form noValidate className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <Field label={t("admin.experiments.key")} hint={t("admin.experiments.keyHint")}>
          {(control) => <Input {...control} name="experiment-key" ltr value={key} onChange={(event) => { setKey(event.target.value); }} />}
        </Field>
        <Field label={t("admin.experiments.name")}>
          {(control) => <Input {...control} name="experiment-name" value={name} onChange={(event) => { setName(event.target.value); }} />}
        </Field>
        <Field label={t("admin.experiments.flag")}>
          {(control) => <Input {...control} name="experiment-flag" ltr value={flagKey} onChange={(event) => { setFlagKey(event.target.value); }} />}
        </Field>
        <Field label={t("admin.experiments.split")} hint={t("admin.experiments.splitHint")}>
          {(control) => <Input {...control} name="experiment-split" inputMode="numeric" ltr value={split} onChange={(event) => { setSplit(event.target.value); }} />}
        </Field>
        {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" name="create-experiment" loading={busy} disabled={!ready}>{t("admin.experiments.create")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ExperimentRow({ experiment, canWrite, onChanged }: { experiment: ExperimentView; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const move = async (action: "start" | "stop" | "complete") => {
    setFailure(null);
    try {
      await api(`/admin/growth/experiments/${experiment.id}/${action}`, { method: "POST", body: {} });
      toast({ tone: "success", title: t(`admin.experiments.moved.${action}` as MessageKey) });
      onChanged();
    } catch (error) {
      setFailure(error);
    }
  };
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="font-semibold text-text">{experiment.name}</span>
          <bdi dir="ltr" className="text-sm text-text-muted">{experiment.key}</bdi>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip kind="experiment" status={experiment.status} />
          <span className="text-sm text-text-muted">{experiment.variants.map((variant) => `${variant.key} ${String(variant.weight)}%`).join(" / ")}</span>
          {experiment.startedAt ? <span className="text-sm text-text-muted">{formatDateTime(experiment.startedAt)}</span> : null}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setOpen((value) => !value); }} aria-expanded={open}>{t("admin.experiments.showResults")}</Button>
        {canWrite && experiment.status === "draft" ? <Button onClick={() => { void move("start"); }}>{t("admin.experiments.start")}</Button> : null}
        {canWrite && experiment.status === "running" ? <Button variant="secondary" onClick={() => { void move("stop"); }}>{t("admin.experiments.stop")}</Button> : null}
        {canWrite && (experiment.status === "running" || experiment.status === "stopped") ? <Button variant="ghost" onClick={() => { void move("complete"); }}>{t("admin.experiments.complete")}</Button> : null}
      </div>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {open ? <Results id={experiment.id} /> : null}
    </li>
  );
}

/**
 * `/admin/growth/experiments` (ADMIN-CONSOLE-SPEC §6.5): experiments with their arms, start / stop /
 * complete, and the results with conversion and the guardrails. A variant that hurts a guardrail
 * beyond the setting is flagged red so it is never promoted on conversion alone.
 */
export function GrowthExperimentsView({ canWrite }: { canWrite: boolean }) {
  const list = useResource("/admin/growth/experiments", listSchema);
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div>
          <Button name="new-experiment" onClick={() => { setCreating(true); }}>
            <Split aria-hidden className="size-4" />
            {t("admin.experiments.new")}
          </Button>
        </div>
      ) : null}
      <ResourceBoundary resource={list}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyHint icon={<Split />} title={t("admin.experiments.empty")} hint={t("admin.experiments.emptyHint")} />
          ) : (
            <ul className="flex flex-col gap-3">
              {data.items.map((experiment) => (
                <ExperimentRow key={experiment.id} experiment={experiment} canWrite={canWrite} onChanged={list.reload} />
              ))}
            </ul>
          )
        }
      </ResourceBoundary>
      <CreateDialog open={creating} onClose={() => { setCreating(false); }} onCreated={list.reload} />
    </div>
  );
}
