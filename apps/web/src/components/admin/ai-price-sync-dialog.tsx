"use client";

import { t } from "@wasfa/shared/i18n";
import {
  priceSyncApplyResultSchema,
  priceSyncPreviewSchema,
  type PriceSyncChange,
  type PriceSyncPreview,
} from "@wasfa/shared/schemas/admin-ai";
import { Button, Checkbox, Dialog, EmptyState, Spinner, useToast } from "@wasfa/ui";
import { ArrowRight, CircleCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatUsd } from "../../lib/ai-admin";
import { api } from "../../lib/api-client";
import { errorReason, type ApiRequestError } from "../../lib/api-error";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { Code } from "./badges";

interface ModelChanges {
  modelId: string;
  label: string;
  changes: PriceSyncChange[];
}

/** One row per model, in the order the preview listed them. */
function groupByModel(changes: readonly PriceSyncChange[]): ModelChanges[] {
  const groups = new Map<string, ModelChanges>();
  for (const change of changes) {
    const group = groups.get(change.modelId) ?? {
      modelId: change.modelId,
      label: `${change.providerKey} / ${change.model}`,
      changes: [],
    };
    group.changes.push(change);
    groups.set(change.modelId, group);
  }
  return [...groups.values()];
}

type Preview =
  | { status: "loading" }
  | { status: "error"; error: ApiRequestError }
  | { status: "ready"; preview: PriceSyncPreview };

function PriceSyncBody({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [state, setState] = useState<Preview>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    api("/admin/ai/models/price-sync/preview", {
      method: "POST",
      schema: priceSyncPreviewSchema,
      signal: controller.signal,
    }).then(
      (preview) => {
        setState({ status: "ready", preview });
        setSelected(new Set(preview.changes.map((change) => change.modelId)));
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: toApiError(error) });
      },
    );
    return () => {
      controller.abort();
    };
  }, [tick]);

  const groups = useMemo(
    () => (state.status === "ready" ? groupByModel(state.preview.changes) : []),
    [state],
  );

  const reload = () => {
    setApplyError(null);
    setTick((current) => current + 1);
  };

  const toggle = (modelId: string, on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(modelId);
      else next.delete(modelId);
      return next;
    });
  };

  const apply = () => {
    if (state.status !== "ready" || applying || selected.size === 0) return;
    const { token } = state.preview;
    const modelIds = groups.map((group) => group.modelId).filter((id) => selected.has(id));
    setApplying(true);
    setApplyError(null);
    reauth
      .run(() =>
        api("/admin/ai/models/price-sync/apply", {
          method: "POST",
          body: { token, modelIds },
          schema: priceSyncApplyResultSchema,
        }),
      )
      .then(
        (result) => {
          toast({
            tone: "success",
            title: t("admin.ai.sync.applied", { models: result.models, changes: result.changes }),
          });
          onApplied();
          onClose();
        },
        (error: unknown) => {
          setApplying(false);
          setApplyError(toApiError(error));
        },
      );
  };

  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-3 py-6 text-base text-text-muted">
        <Spinner decorative />
        {t("admin.ai.sync.loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNotice error={state.error} supportHref={null} />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" name="close" onClick={onClose}>
            {t("ui.close")}
          </Button>
          {errorReason(state.error) === "no_price_source" ? null : (
            <Button variant="secondary" name="reload" onClick={reload}>
              {t("admin.ai.sync.reload")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const { preview } = state;
  const allSelected = groups.length > 0 && groups.every((group) => selected.has(group.modelId));
  const expired = applyError !== null && errorReason(applyError) === "sync_expired";

  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <EmptyState icon={<CircleCheck />} title={t("admin.ai.sync.upToDate")} />
      ) : (
        <>
          <Checkbox
            name="select-all"
            label={t("admin.ai.sync.selectAll")}
            checked={allSelected}
            onChange={(event) => {
              setSelected(
                event.target.checked ? new Set(groups.map((group) => group.modelId)) : new Set(),
              );
            }}
          />
          {/* Scrolls inside its box, so a long diff never widens the page. */}
          <div className="max-h-[50dvh] overflow-auto rounded-md border border-border">
            <table className="w-full border-separate border-spacing-0 text-start text-base">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 h-12 w-14 border-b border-border bg-neutral-50 px-3"
                  >
                    <span className="sr-only">{t("admin.ai.sync.selectAll")}</span>
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 h-12 border-b border-border bg-neutral-50 px-3 text-start text-sm font-semibold text-text-muted"
                  >
                    {t("admin.ai.sync.col.model")}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 h-12 border-b border-border bg-neutral-50 px-3 text-start text-sm font-semibold text-text-muted"
                  >
                    {t("admin.ai.sync.col.changes")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.modelId}>
                    <td className="border-b border-border px-3 align-top">
                      <Checkbox
                        name={`select-${group.modelId}`}
                        label={
                          <span className="sr-only">
                            {t("admin.ai.sync.select", { name: group.label })}
                          </span>
                        }
                        checked={selected.has(group.modelId)}
                        onChange={(event) => {
                          toggle(group.modelId, event.target.checked);
                        }}
                      />
                    </td>
                    <td className="border-b border-border px-3 py-3 align-top">
                      <Code>{group.label}</Code>
                    </td>
                    <td className="border-b border-border px-3 py-3 align-top">
                      <ul className="flex flex-col gap-1">
                        {group.changes.map((change) => (
                          <li
                            key={change.field}
                            className="flex flex-wrap items-center gap-x-2 text-sm"
                          >
                            <span className="text-text-muted">
                              {t(`admin.ai.sync.field.${change.field}`)}
                            </span>
                            <span dir="ltr" className="inline-flex items-center gap-1 tabular-nums">
                              {change.before === null ? "—" : formatUsd(change.before)}
                              <ArrowRight aria-hidden className="size-4" />
                              <strong>{formatUsd(change.after)}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {preview.unmatched > 0 ? (
        <Notice tone="info">{t("admin.ai.sync.unmatched", { count: preview.unmatched })}</Notice>
      ) : null}
      {applyError ? <ErrorNotice error={applyError} supportHref={null} /> : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" name="close" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        {expired ? (
          <Button variant="secondary" name="reload" onClick={reload}>
            {t("admin.ai.sync.reload")}
          </Button>
        ) : null}
        {groups.length > 0 ? (
          <Button
            name="apply"
            loading={applying}
            disabled={selected.size === 0 || expired}
            onClick={apply}
          >
            {t("admin.ai.sync.apply", { count: selected.size })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface PriceSyncDialogProps {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

/**
 * Preview and apply OpenRouter prices. Opening the dialog fetches a fresh preview (the server keeps
 * it under a token for a few minutes); the admin picks models and only those are written.
 */
export function PriceSyncDialog({ open, onClose, onApplied }: PriceSyncDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.ai.sync.title")}
      description={t("admin.ai.sync.lead")}
      className="sm:max-w-3xl"
    >
      {open ? <PriceSyncBody onClose={onClose} onApplied={onApplied} /> : null}
    </Dialog>
  );
}
