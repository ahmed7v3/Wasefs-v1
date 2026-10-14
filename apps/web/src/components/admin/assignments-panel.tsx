"use client";

import { t } from "@wasfa/shared/i18n";
import {
  planAssignmentPageSchema,
  type PlanAssignmentView,
  type PlanView,
} from "@wasfa/shared/schemas/plans";
import { Badge, Button, useToast } from "@wasfa/ui";
import { CalendarX, Plus } from "lucide-react";
import { useState } from "react";

import { isAssignmentActive, ownerTypeLabel } from "../../lib/admin-billing";
import { formatDateTime } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useCursorList } from "../../lib/use-admin-data";

import { AssignPlanDialog } from "./assign-plan-dialog";
import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";

export interface AssignmentsPanelProps {
  plans: readonly PlanView[];
  canWrite: boolean;
  canSearchUsers: boolean;
}

/** Manual plan assignments: who has which plan, from when to when, and why. */
export function AssignmentsPanel({ plans, canWrite, canSearchUsers }: AssignmentsPanelProps) {
  const list = useCursorList("/admin/plans/assignments", "", planAssignmentPageSchema);
  const { toast } = useToast();
  const [assigning, setAssigning] = useState(false);
  const [ending, setEnding] = useState<PlanAssignmentView | null>(null);

  const columns: DataTableColumn<PlanAssignmentView>[] = [
    {
      id: "owner",
      header: t("admin.plans.assignments.col.owner"),
      primary: true,
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone="neutral">{ownerTypeLabel(row.owner.type)}</Badge>
          {row.ownerDisplay.name ? (
            <span className="font-medium text-text wrap-anywhere">{row.ownerDisplay.name}</span>
          ) : null}
          {row.ownerDisplay.email ? (
            <bdi dir="ltr" className="text-sm text-text-muted wrap-anywhere">
              {row.ownerDisplay.email}
            </bdi>
          ) : null}
          <span className="text-xs text-text-muted">
            <Code title={row.owner.id}>{row.owner.id}</Code>
          </span>
        </span>
      ),
    },
    {
      id: "plan",
      header: t("admin.plans.assignments.col.plan"),
      cell: (row) => row.plan.nameAr,
    },
    {
      id: "starts",
      header: t("admin.plans.assignments.col.starts"),
      cell: (row) => formatDateTime(row.startsAt),
    },
    {
      id: "ends",
      header: t("admin.plans.assignments.col.ends"),
      cell: (row) => (
        <span className="flex flex-col items-start gap-1">
          <span>
            {row.endsAt ? formatDateTime(row.endsAt) : t("admin.plans.assignments.noEnd")}
          </span>
          <Badge tone={isAssignmentActive(row.endsAt) ? "success" : "neutral"}>
            {t(
              isAssignmentActive(row.endsAt)
                ? "admin.plans.assignments.active"
                : "admin.plans.assignments.ended",
            )}
          </Badge>
        </span>
      ),
    },
    {
      id: "reason",
      header: t("admin.plans.assignments.col.reason"),
      cell: (row) => row.reason ?? "—",
    },
    {
      id: "by",
      header: t("admin.plans.assignments.col.by"),
      cell: (row) => {
        if (!row.assignedBy) return "—";
        const name = row.assignedByDisplay?.name;
        return name ? (
          <span title={row.assignedBy} className="wrap-anywhere">
            {name}
          </span>
        ) : (
          <Code title={row.assignedBy}>{row.assignedBy.slice(0, 8)}</Code>
        );
      },
    },
  ];

  const rowActions = canWrite
    ? (row: PlanAssignmentView): RowAction[] =>
        isAssignmentActive(row.endsAt)
          ? [
              {
                id: "end",
                label: t("admin.plans.assignments.endNow"),
                icon: CalendarX,
                tone: "danger",
                onSelect: () => {
                  setEnding(row);
                },
              },
            ]
          : []
    : undefined;

  const endNow = async (): Promise<void> => {
    if (!ending) return;
    await api(`/admin/plans/assignments/${ending.id}/end`, { method: "POST" });
    toast({ tone: "success", title: t("admin.plans.assignments.endedToast") });
    list.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-base text-text-muted">
          {t("admin.plans.assignments.lead")}
        </p>
        {canWrite ? (
          <Button
            name="assign-plan"
            onClick={() => {
              setAssigning(true);
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.plans.assign.title")}
          </Button>
        ) : null}
      </div>

      <DataTable
        caption={t("admin.plans.tab.assignments")}
        columns={columns}
        rows={list.items}
        rowKey={(row) => row.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.plan.nameAr })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        emptyTitle={t("admin.plans.assignments.empty")}
        emptyDescription={t("admin.plans.assignments.emptyBody")}
      />

      <AssignPlanDialog
        open={assigning}
        plans={plans}
        canSearchUsers={canSearchUsers}
        onClose={() => {
          setAssigning(false);
        }}
        onAssigned={list.reload}
      />

      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
        title={t("admin.plans.assignments.endTitle", { plan: ending?.plan.nameAr ?? "" })}
        description={t("admin.plans.assignments.endBody")}
        confirmLabel={t("admin.plans.assignments.endNow")}
        tone="danger"
        onConfirm={endNow}
      />
    </div>
  );
}
