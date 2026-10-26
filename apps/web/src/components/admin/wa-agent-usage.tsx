"use client";

import { t } from "@wasfa/shared/i18n";
import {
  waAgentUsageSchema,
  type WaAgentUsage,
  type WaAgentUsageDay,
} from "@wasfa/shared/schemas/admin-wa-agent";
import { Card, CardTitle, Field, Select, cn } from "@wasfa/ui";
import { useState } from "react";

import { formatNumber, formatShortDate, tOr } from "../../lib/admin-format";
import { useResource } from "../../lib/use-admin-data";
import { formatUsdMicros } from "../../lib/wa-agent-format";

import { DataTable, type DataTableColumn } from "./data-table";
import { ResourceBoundary } from "./resource-boundary";

const DAY_OPTIONS = [7, 30] as const;

function droppedText(dropped: Record<string, number>): string {
  const entries = Object.entries(dropped);
  if (entries.length === 0) return "0";
  return entries
    .map(
      ([reason, count]) => `${tOr(`admin.waAgent.drop.${reason}`, reason)}: ${formatNumber(count)}`,
    )
    .join("، ");
}

const COLUMNS: readonly DataTableColumn<WaAgentUsageDay>[] = [
  {
    id: "day",
    header: t("admin.waAgent.usage.col.day"),
    primary: true,
    cell: (row) => formatShortDate(`${row.day}T00:00:00Z`),
  },
  {
    id: "inbound",
    header: t("admin.waAgent.usage.col.inbound"),
    cell: (row) => formatNumber(row.inbound),
  },
  {
    id: "sent",
    header: t("admin.waAgent.usage.col.sent"),
    cell: (row) => formatNumber(row.outboundSent),
  },
  {
    id: "dropped",
    header: t("admin.waAgent.usage.col.dropped"),
    cell: (row) => droppedText(row.dropped),
  },
  {
    id: "conversations",
    header: t("admin.waAgent.usage.col.conversations"),
    cell: (row) => formatNumber(row.conversations),
  },
  {
    id: "split",
    header: t("admin.waAgent.usage.col.split"),
    cell: (row) =>
      t("admin.waAgent.usage.splitValue", {
        linked: formatNumber(row.linkedConversations),
        guests: formatNumber(row.guestConversations),
      }),
  },
  {
    id: "cost",
    header: t("admin.waAgent.usage.col.cost"),
    cell: (row) => <bdi dir="ltr">{formatUsdMicros(row.costUsdMicros)}</bdi>,
  },
];

/** Today's spend against the agent's own daily cap. A cap of 0 means the agent may not spend. */
function SpendBar({ today }: { today: WaAgentUsage["today"] }) {
  const { spendUsdMicros, spendCapUsdMicros } = today;
  const ratio =
    spendCapUsdMicros === 0 ? (spendUsdMicros > 0 ? 1 : 0) : spendUsdMicros / spendCapUsdMicros;
  const percent = Math.min(100, Math.round(ratio * 100));
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <CardTitle>{t("admin.waAgent.usage.today")}</CardTitle>
      <p className="text-base text-text">
        {t("admin.waAgent.usage.spendOfCap", {
          spend: formatUsdMicros(spendUsdMicros),
          cap: formatUsdMicros(spendCapUsdMicros),
        })}
      </p>
      <div
        role="progressbar"
        aria-label={t("admin.waAgent.usage.today")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-3 w-full overflow-hidden rounded-full bg-neutral-100"
      >
        <div
          className={cn(
            "h-full rounded-full",
            percent >= 100 ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-primary",
          )}
          style={{ inlineSize: `${percent}%` }}
        />
      </div>
      {percent >= 100 ? (
        <p className="text-sm font-semibold text-danger">{t("admin.waAgent.usage.capReached")}</p>
      ) : null}
    </Card>
  );
}

/** The Usage tab: today's spend against the cap, and one row per UTC day. */
export function WaAgentUsageTab() {
  const [days, setDays] = useState<number>(7);
  const resource = useResource(`/admin/wa-agent/usage?days=${days}`, waAgentUsageSchema);

  return (
    <div className="flex flex-col gap-5">
      <Field label={t("admin.waAgent.usage.range")} className="max-w-48">
        {(control) => (
          <Select
            {...control}
            name="days"
            value={String(days)}
            onChange={(event) => {
              setDays(Number(event.target.value));
            }}
          >
            {DAY_OPTIONS.map((value) => (
              <option key={value} value={String(value)}>
                {t("admin.waAgent.usage.rangeOption", { days: value })}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <ResourceBoundary resource={resource}>
        {(data) => (
          <>
            <SpendBar today={data.today} />
            <DataTable
              caption={t("admin.waAgent.usage.caption")}
              columns={COLUMNS}
              rows={[...data.days].reverse()}
              rowKey={(row) => row.day}
              status="ready"
              emptyTitle={t("admin.waAgent.usage.empty")}
            />
          </>
        )}
      </ResourceBoundary>
    </div>
  );
}
