"use client";

import { AI_OUTCOMES, AI_TASKS } from "@wasfa/shared/ai";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  aiUsagePageSchema,
  aiUsageTotalsSchema,
  type AiUsageRow,
} from "@wasfa/shared/schemas/admin-ai";
import { Badge, Card, buttonStyles, type BadgeTone } from "@wasfa/ui";
import { Download } from "lucide-react";
import { useMemo } from "react";

import { formatDateTime, formatNumber } from "../../lib/admin-format";
import { formatUsd } from "../../lib/ai-admin";
import { publicEnv } from "../../lib/env";
import { buildQuery, useCursorList, useResource } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

const OUTCOME_TONE: Record<AiUsageRow["outcome"], BadgeTone> = {
  ok: "success",
  error: "danger",
  timeout: "danger",
  cancelled: "neutral",
  refused: "warning",
  cache_hit: "info",
};

const FILTER_NAMES = ["task", "outcome", "model", "userId", "orgId", "from", "to"] as const;

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dd dir="ltr" className="text-start font-heading text-xl font-semibold tabular-nums">
        {value}
      </dd>
      <dt className="text-sm text-text-muted">{label}</dt>
    </div>
  );
}

/** The usage explorer (Task 2.4): filters, totals over them, a keyset table and a CSV export. Never content. */
export function AiUsageView() {
  const url = useUrlParams();
  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "select",
        name: "task",
        label: t("admin.ai.usage.filter.task"),
        allLabel: t("admin.ai.usage.filter.allTasks"),
        options: AI_TASKS.map((value) => ({
          value,
          label: t(`admin.ai.task.${value}` as MessageKey),
        })),
      },
      {
        kind: "select",
        name: "outcome",
        label: t("admin.ai.usage.filter.outcome"),
        allLabel: t("admin.ai.usage.filter.allOutcomes"),
        options: AI_OUTCOMES.map((value) => ({
          value,
          label: t(`admin.ai.outcome.${value}` as MessageKey),
        })),
      },
      { kind: "text", name: "model", label: t("admin.ai.usage.filter.model"), ltr: true },
      { kind: "text", name: "userId", label: t("admin.ai.usage.filter.user"), ltr: true },
      { kind: "text", name: "orgId", label: t("admin.ai.usage.filter.org"), ltr: true },
      { kind: "date", name: "from", label: t("admin.ai.usage.filter.from") },
      { kind: "date", name: "to", label: t("admin.ai.usage.filter.to") },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const query = buildQuery(Object.fromEntries(FILTER_NAMES.map((name) => [name, url.get(name)])));
  const list = useCursorList("/admin/ai/usage", query, aiUsagePageSchema);
  const totals = useResource(
    `/admin/ai/usage/totals${query ? `?${query}` : ""}`,
    aiUsageTotalsSchema,
  );

  const columns: DataTableColumn<AiUsageRow>[] = [
    {
      id: "date",
      header: t("admin.ai.usage.col.date"),
      primary: true,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: "task",
      header: t("admin.ai.usage.col.task"),
      cell: (row) => t(`admin.ai.task.${row.task}` as MessageKey),
    },
    {
      id: "model",
      header: t("admin.ai.usage.col.model"),
      cell: (row) => (
        <span dir="ltr" className="inline-block">
          {row.modelKey}
        </span>
      ),
    },
    {
      id: "outcome",
      header: t("admin.ai.usage.col.outcome"),
      cell: (row) => (
        <Badge tone={OUTCOME_TONE[row.outcome]}>
          {t(`admin.ai.outcome.${row.outcome}` as MessageKey)}
        </Badge>
      ),
    },
    {
      id: "tokens",
      header: t("admin.ai.usage.col.tokens"),
      cell: (row) => (
        <span dir="ltr" className="inline-block tabular-nums">
          {formatNumber(row.inputTokens)} / {formatNumber(row.outputTokens)}
        </span>
      ),
    },
    {
      id: "cost",
      header: t("admin.ai.usage.col.cost"),
      cell: (row) => (
        <span dir="ltr" className="inline-block tabular-nums">
          {formatUsd(row.costUsdMicros)}
        </span>
      ),
    },
    {
      id: "latency",
      header: t("admin.ai.usage.col.latency"),
      cell: (row) =>
        row.latencyMs === null
          ? "—"
          : t("admin.ai.ov.ms", { value: formatNumber(row.latencyMs) }),
    },
    {
      id: "credits",
      header: t("admin.ai.usage.col.credits"),
      cell: (row) => formatNumber(row.creditsCharged),
    },
  ];

  const exportHref = `${publicEnv.NEXT_PUBLIC_API_URL}/admin/ai/usage/export.csv${query ? `?${query}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-text-muted">{t("admin.ai.usage.noContent")}</p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-96">
          <FilterBar fields={fields} />
        </div>
        <a href={exportHref} download className={buttonStyles({ variant: "secondary" })}>
          <Download aria-hidden className="size-5" />
          {t("admin.ai.usage.export")}
        </a>
      </div>

      {totals.status === "ready" ? (
        <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
          <p className="text-sm font-semibold">{t("admin.ai.usage.totals")}</p>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Total label={t("admin.ai.usage.total.calls")} value={formatNumber(totals.data.calls)} />
            <Total
              label={t("admin.ai.usage.total.cost")}
              value={formatUsd(totals.data.costUsdMicros)}
            />
            <Total
              label={t("admin.ai.usage.total.tokens")}
              value={`${formatNumber(totals.data.inputTokens)} / ${formatNumber(totals.data.outputTokens)}`}
            />
            <Total
              label={t("admin.ai.usage.total.errors")}
              value={formatNumber(totals.data.errors)}
            />
            <Total
              label={t("admin.ai.usage.total.cache")}
              value={formatNumber(totals.data.cacheHits)}
            />
            <Total
              label={t("admin.ai.usage.total.latency")}
              value={
                totals.data.avgLatencyMs === null
                  ? "—"
                  : t("admin.ai.ov.ms", { value: formatNumber(totals.data.avgLatencyMs) })
              }
            />
          </dl>
        </Card>
      ) : null}

      <DataTable
        caption={t("admin.ai.usage.title")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update(Object.fromEntries(FILTER_NAMES.map((name) => [name, null])));
        }}
        emptyTitle={t("admin.ai.usage.empty")}
      />
    </div>
  );
}
