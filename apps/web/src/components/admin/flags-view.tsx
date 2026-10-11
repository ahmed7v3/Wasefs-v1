"use client";

import { t } from "@wasfa/shared/i18n";
import { adminFlagListResponseSchema, type AdminFlag } from "@wasfa/shared/schemas/admin";
import { flagRulesSchema } from "@wasfa/shared/settings";
import { Badge, Button, useToast } from "@wasfa/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { FlagDialog } from "./flag-dialog";

/** One short sentence for who a flag applies to ("10% of users", "3 users"). */
export function ruleSummary(rules: unknown): string {
  const parsed = flagRulesSchema.safeParse(rules);
  if (!parsed.success) return t("admin.flags.rule.unknown");
  const rule = parsed.data;
  switch (rule.type) {
    case "all":
      return t("admin.flags.rule.all");
    case "user":
      return t("admin.flags.rule.user", { count: formatNumber(rule.userIds.length) });
    case "org":
      return t("admin.flags.rule.org", { count: formatNumber(rule.orgIds.length) });
    case "percentage":
      return t("admin.flags.rule.percentage", { percentage: formatNumber(rule.percentage) });
    case "plan":
      return t("admin.flags.rule.plan", { plans: rule.plans.join("، ") });
  }
}

export function FlagsView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/flags", adminFlagListResponseSchema);
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ flag: AdminFlag | null } | null>(null);
  const [removing, setRemoving] = useState<AdminFlag | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];

  const columns: DataTableColumn<AdminFlag>[] = [
    {
      id: "key",
      header: t("admin.flags.col.key"),
      primary: true,
      cell: (flag) => <Code>{flag.key}</Code>,
    },
    {
      id: "enabled",
      header: t("admin.flags.col.enabled"),
      cell: (flag) => (
        <Badge tone={flag.enabled ? "success" : "neutral"}>
          {t(flag.enabled ? "admin.flags.on" : "admin.flags.off")}
        </Badge>
      ),
    },
    { id: "rules", header: t("admin.flags.col.rules"), cell: (flag) => ruleSummary(flag.rules) },
    {
      id: "updated",
      header: t("admin.flags.col.updated"),
      cell: (flag) => formatShortDate(flag.updatedAt),
    },
  ];

  const rowActions = canWrite
    ? (flag: AdminFlag): RowAction[] => [
        {
          id: "edit",
          label: t("admin.flags.edit"),
          icon: Pencil,
          onSelect: () => {
            setEditor({ flag });
          },
        },
        {
          id: "delete",
          label: t("admin.flags.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(flag);
          },
        },
      ]
    : undefined;

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`/admin/flags/${encodeURIComponent(removing.key)}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.flags.deleted", { key: removing.key }) });
    resource.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            name="new-flag"
            onClick={() => {
              setEditor({ flag: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.flags.create")}
          </Button>
        </div>
      ) : null}

      <DataTable
        caption={t("admin.nav.flags")}
        columns={columns}
        rows={rows}
        rowKey={(flag) => flag.key}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (flag) => {
                setEditor({ flag });
              }
            : undefined
        }
        rowActions={rowActions}
        actionsLabel={(flag) => t("admin.table.actionsFor", { name: flag.key })}
        emptyTitle={t("admin.flags.empty")}
        emptyDescription={t("admin.flags.emptyBody")}
      />

      <FlagDialog
        open={editor !== null}
        flag={editor?.flag ?? null}
        onClose={() => {
          setEditor(null);
        }}
        onSaved={resource.reload}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.flags.deleteTitle", { key: removing?.key ?? "" })}
        description={t("admin.flags.deleteBody")}
        confirmLabel={t("admin.flags.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
