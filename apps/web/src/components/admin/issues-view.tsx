"use client";

import { t } from "@wasfa/shared/i18n";
import { ISSUE_STATUSES, issueListResponseSchema, type Issue } from "@wasfa/shared/schemas/admin";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useUrlParams } from "../../lib/use-url-params";

import { Code, IssueStatusBadge } from "./badges";
import { DataTable, type DataTableColumn } from "./data-table";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";

export function IssuesView() {
  const url = useUrlParams();
  const router = useRouter();
  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "select",
        name: "status",
        label: t("admin.issues.filter.status"),
        allLabel: t("admin.filters.all"),
        options: ISSUE_STATUSES.map((status) => ({
          value: status,
          label: t(`admin.issue.status.${status}`),
        })),
      },
    ],
    [],
  );
  const filtersActive = useFiltersActive(fields);
  const list = useCursorList(
    "/admin/issues",
    buildQuery({ status: url.get("status") }),
    issueListResponseSchema,
  );

  const open = (issue: Issue) => {
    router.push(`/admin/issues/${issue.fingerprint}`);
  };

  const columns: DataTableColumn<Issue>[] = [
    {
      id: "code",
      header: t("admin.issues.col.code"),
      primary: true,
      cell: (issue) => <Code>{issue.code}</Code>,
    },
    {
      id: "route",
      header: t("admin.issues.col.route"),
      cell: (issue) =>
        issue.route ? <Code>{`${issue.method ?? ""} ${issue.route}`.trim()}</Code> : "—",
    },
    {
      id: "count",
      header: t("admin.issues.col.count"),
      cell: (issue) => formatNumber(issue.count),
    },
    {
      id: "users",
      header: t("admin.issues.col.users"),
      cell: (issue) => formatNumber(issue.affectedUsers),
    },
    {
      id: "first",
      header: t("admin.issues.col.firstSeen"),
      cell: (issue) => formatShortDate(issue.firstSeen),
    },
    {
      id: "last",
      header: t("admin.issues.col.lastSeen"),
      cell: (issue) => formatShortDate(issue.lastSeen),
    },
    {
      id: "status",
      header: t("admin.issues.col.status"),
      cell: (issue) => <IssueStatusBadge status={issue.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.issues")}
        columns={columns}
        rows={list.items}
        rowKey={(issue) => issue.fingerprint}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={open}
        rowActions={(issue) => [
          {
            id: "details",
            label: t("admin.table.details"),
            icon: Eye,
            onSelect: () => {
              open(issue);
            },
          },
        ]}
        actionsLabel={(issue) => t("admin.table.actionsFor", { name: issue.code })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ status: null });
        }}
        emptyTitle={t("admin.issues.empty")}
        emptyDescription={t("admin.issues.emptyBody")}
      />
    </div>
  );
}
