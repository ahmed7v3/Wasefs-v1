"use client";

import { t } from "@wasfa/shared/i18n";
import { PERMISSION_KEYS } from "@wasfa/shared/permissions";
import { roleListResponseSchema, type AdminRole } from "@wasfa/shared/schemas/admin";
import { Badge, Button, useToast } from "@wasfa/ui";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { RoleDialog } from "./role-dialog";

const WILDCARD_ROLE = "super_admin";

export interface RolesViewProps {
  /** Only a `super_admin` creates, edits or deletes roles; everyone else with `roles.read` views them. */
  isSuperAdmin: boolean;
}

type Editor = { role: AdminRole | null; readOnly: boolean };

export function RolesView({ isSuperAdmin }: RolesViewProps) {
  const resource = useResource("/admin/roles", roleListResponseSchema);
  const { toast } = useToast();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removing, setRemoving] = useState<AdminRole | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];
  const canEdit = (role: AdminRole) => isSuperAdmin && role.key !== WILDCARD_ROLE;
  const view = (role: AdminRole) => {
    setEditor({ role, readOnly: !canEdit(role) });
  };

  const columns: DataTableColumn<AdminRole>[] = [
    {
      id: "name",
      header: t("admin.roles.col.name"),
      primary: true,
      cell: (role) => (
        <span className="flex flex-col">
          <span>{role.nameAr}</span>
          <span className="text-sm font-normal text-text-muted" dir="ltr">
            {role.nameEn}
          </span>
        </span>
      ),
    },
    { id: "key", header: t("admin.roles.col.key"), cell: (role) => <Code>{role.key}</Code> },
    {
      id: "kind",
      header: t("admin.roles.col.kind"),
      cell: (role) => (
        <Badge tone={role.isSystem ? "info" : "neutral"}>
          {t(role.isSystem ? "admin.roles.system" : "admin.roles.custom")}
        </Badge>
      ),
    },
    {
      id: "permissions",
      header: t("admin.roles.col.permissions"),
      cell: (role) =>
        formatNumber(role.key === WILDCARD_ROLE ? PERMISSION_KEYS.length : role.permissions.length),
    },
    {
      id: "holders",
      header: t("admin.roles.col.holders"),
      cell: (role) => formatNumber(role.holders),
    },
  ];

  const rowActions = (role: AdminRole): RowAction[] => {
    const actions: RowAction[] = [
      {
        id: "open",
        label: canEdit(role) ? t("admin.roles.edit") : t("admin.table.details"),
        icon: canEdit(role) ? Pencil : Eye,
        onSelect: () => {
          view(role);
        },
      },
    ];
    // System roles have no delete button at all (the API refuses it too).
    if (isSuperAdmin && !role.isSystem) {
      actions.push({
        id: "delete",
        label: t("admin.roles.delete"),
        icon: Trash2,
        tone: "danger",
        onSelect: () => {
          setRemoving(role);
        },
      });
    }
    return actions;
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`/admin/roles/${encodeURIComponent(removing.key)}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.roles.deleted", { name: removing.nameAr }) });
    resource.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      {isSuperAdmin ? (
        <div className="flex justify-end">
          <Button
            name="new-role"
            onClick={() => {
              setEditor({ role: null, readOnly: false });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.roles.create")}
          </Button>
        </div>
      ) : (
        <p className="text-base text-text-muted">{t("admin.roles.readOnlyNote")}</p>
      )}

      <DataTable
        caption={t("admin.nav.roles")}
        columns={columns}
        rows={rows}
        rowKey={(role) => role.key}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={view}
        rowActions={rowActions}
        actionsLabel={(role) => t("admin.table.actionsFor", { name: role.nameAr })}
        emptyTitle={t("admin.roles.empty")}
      />

      <RoleDialog
        open={editor !== null}
        role={editor?.role ?? null}
        readOnly={editor?.readOnly ?? true}
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
        title={t("admin.roles.deleteTitle", { name: removing?.nameAr ?? "" })}
        description={t("admin.roles.deleteBody")}
        confirmLabel={t("admin.roles.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
