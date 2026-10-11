"use client";

import { t } from "@wasfa/shared/i18n";
import { auditListResponseSchema, type AuditEntry } from "@wasfa/shared/schemas/admin";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { dayBoundary, formatDateTime } from "../../lib/admin-format";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { Code } from "./badges";
import { DataTable, type DataTableColumn } from "./data-table";
import { DetailSection } from "./detail-list";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { JsonView } from "./json-view";

const FILTER_NAMES = ["actorId", "action", "targetType", "targetId", "from", "to"] as const;

export function AuditView() {
  const url = useUrlParams();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const fields = useMemo<FilterField[]>(
    () => [
      { kind: "text", name: "actorId", label: t("admin.audit.filter.actorId"), ltr: true },
      {
        kind: "text",
        name: "action",
        label: t("admin.audit.filter.action"),
        placeholder: t("admin.audit.filter.actionHint"),
        ltr: true,
      },
      { kind: "text", name: "targetType", label: t("admin.audit.filter.targetType"), ltr: true },
      { kind: "text", name: "targetId", label: t("admin.audit.filter.targetId"), ltr: true },
      { kind: "date", name: "from", label: t("admin.audit.filter.from") },
      { kind: "date", name: "to", label: t("admin.audit.filter.to") },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);

  const from = dayBoundary(url.get("from"), "start");
  const to = dayBoundary(url.get("to"), "end");
  const query = buildQuery({
    actorId: url.get("actorId"),
    action: url.get("action"),
    targetType: url.get("targetType"),
    targetId: url.get("targetId"),
    from,
    to,
  });
  const list = useCursorList("/admin/audit", query, auditListResponseSchema);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns: DataTableColumn<AuditEntry>[] = [
    {
      id: "time",
      header: t("admin.audit.col.time"),
      primary: true,
      cell: (entry) => (
        <span className="inline-flex items-center gap-1">
          <ChevronDown
            aria-hidden
            className={`size-4 shrink-0 transition-transform duration-150 ${expanded.has(entry.id) ? "rotate-180" : ""}`}
          />
          {formatDateTime(entry.createdAt)}
        </span>
      ),
    },
    {
      id: "actor",
      header: t("admin.audit.col.actor"),
      cell: (entry) => entry.actorName ?? t("admin.audit.system"),
    },
    {
      id: "action",
      header: t("admin.audit.col.action"),
      cell: (entry) => <Code>{entry.action}</Code>,
    },
    {
      id: "target",
      header: t("admin.audit.col.target"),
      cell: (entry) => (
        <Code title={entry.targetId ?? undefined}>
          {entry.targetId ? `${entry.targetType}:${entry.targetId}` : entry.targetType}
        </Code>
      ),
    },
    {
      id: "ip",
      header: t("admin.audit.col.ip"),
      cell: (entry) => (entry.ip ? <Code>{entry.ip}</Code> : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.audit")}
        columns={columns}
        rows={list.items}
        rowKey={(entry) => entry.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(entry) => {
          toggle(entry.id);
        }}
        isExpanded={(entry) => expanded.has(entry.id)}
        renderExpanded={(entry) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <DetailSection title={t("admin.audit.before")}>
              <JsonView value={entry.before} label={t("admin.audit.before")} />
            </DetailSection>
            <DetailSection title={t("admin.audit.after")}>
              <JsonView value={entry.after} label={t("admin.audit.after")} />
            </DetailSection>
            {entry.userAgent ? (
              <p className="break-words text-sm text-text-muted lg:col-span-2" dir="ltr">
                {entry.userAgent}
              </p>
            ) : null}
          </div>
        )}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update(Object.fromEntries(FILTER_NAMES.map((name) => [name, null])));
        }}
        emptyTitle={t("admin.audit.emptyTitle")}
        emptyDescription={t("admin.audit.emptyBody")}
      />
    </div>
  );
}
