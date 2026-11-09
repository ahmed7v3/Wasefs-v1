"use client";

import { t } from "@wasfa/shared/i18n";
import { Card, cn } from "@wasfa/ui";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { formatNumber } from "../../lib/admin-format";
import { percentText, sortRows, type SortDirection } from "../../lib/telegram-ads-admin";

export interface MetricRow {
  impressions: number;
  clicks: number;
  reactions: number;
  hides: number;
  reach: number;
  ctr: number;
  engagementRate: number;
}

type MetricKey = keyof MetricRow;

const COLUMNS: readonly { key: MetricKey; label: Parameters<typeof t>[0]; percent?: boolean }[] = [
  { key: "impressions", label: "admin.tgAds.kpi.impressions" },
  { key: "clicks", label: "admin.tgAds.kpi.clicks" },
  { key: "ctr", label: "admin.tgAds.kpi.ctr", percent: true },
  { key: "reactions", label: "admin.tgAds.kpi.reactions" },
  { key: "hides", label: "admin.tgAds.kpi.hides" },
  { key: "reach", label: "admin.tgAds.kpi.reach" },
  { key: "engagementRate", label: "admin.tgAds.kpi.engagement", percent: true },
];

/** A table of metric rows that sorts by any column (click the header again to flip). */
export function TelegramAdsStatsTable<T extends MetricRow>({
  title,
  nameHeader,
  rows,
  rowKey,
  name,
  nameText,
}: {
  title: string;
  nameHeader: string;
  rows: readonly T[];
  rowKey: (row: T) => string;
  name: (row: T) => ReactNode;
  /** The plain text of the name, for sorting by it. */
  nameText: (row: T) => string;
}) {
  const [sort, setSort] = useState<{ key: MetricKey | "name"; direction: SortDirection }>({
    key: "impressions",
    direction: "desc",
  });
  const sortKey = sort.key;
  const sorted = sortRows(
    rows,
    sortKey === "name" ? nameText : (row) => row[sortKey],
    sort.direction,
  );
  const toggle = (key: MetricKey | "name") => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: key === "name" ? "asc" : "desc" },
    );
  };
  const header = (key: MetricKey | "name", label: string) => {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
        className="whitespace-nowrap px-3 py-2 text-start font-semibold"
      >
        <button
          type="button"
          onClick={() => {
            toggle(key);
          }}
          className="inline-flex min-h-11 items-center gap-1 rounded-md focus-visible:outline-none focus-visible:shadow-focus"
        >
          {label}
          <Icon aria-hidden className={cn("size-4", active ? "text-primary" : "text-text-muted")} />
        </button>
      </th>
    );
  };

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="font-heading text-xl font-semibold text-text">{title}</h2>
      <Card elevation="flat" padding="none" className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text-muted" data-testid="tg-table-empty">
            {t("admin.tgAds.table.empty")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="bg-neutral-100 text-text-muted">
              <tr>
                {header("name", nameHeader)}
                {COLUMNS.map((column) => header(column.key, t(column.label)))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={rowKey(row)} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-start font-semibold">
                    {name(row)}
                  </th>
                  {COLUMNS.map((column) => (
                    <td key={column.key} className="px-3 py-2 tabular-nums">
                      {column.percent
                        ? percentText(row[column.key])
                        : formatNumber(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
