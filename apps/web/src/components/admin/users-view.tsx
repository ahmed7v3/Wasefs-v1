"use client";

import { t } from "@wasfa/shared/i18n";
import { USER_STATUSES } from "@wasfa/shared/identity";
import { adminUserListResponseSchema, type AdminUser } from "@wasfa/shared/schemas/admin";
import { useToast } from "@wasfa/ui";
import { Eye, UserCheck, UserRoundX } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";

import { formatDateTime, formatRelativeTime, formatShortDate, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { buildQuery, useCursorList } from "../../lib/use-admin-data";
import { useAdminRoles } from "../../lib/use-admin-roles";
import { useUrlParams } from "../../lib/use-url-params";

import { RoleChips, UserStatusBadge } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { FilterBar, useFiltersActive, type FilterField } from "./filter-bar";
import { UserDrawer } from "./user-drawer";
import { ProviderChips, UserCell } from "./user-identity";

const idSchema = z.uuid();

export interface UsersViewProps {
  meId: string;
  permissions: readonly string[];
}

interface StatusTarget {
  id: string;
  name: string;
  status: string;
}

export function UsersView({ meId, permissions }: UsersViewProps) {
  const url = useUrlParams();
  const { toast } = useToast();
  const canSuspend = permissions.includes("users.suspend");
  const canWriteRoles = permissions.includes("users.roles.write");
  const { roles, names } = useAdminRoles(permissions.includes("roles.read"));
  const [statusTarget, setStatusTarget] = useState<StatusTarget | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const fields = useMemo<FilterField[]>(
    () => [
      {
        kind: "search",
        name: "q",
        label: t("admin.users.filter.q"),
        placeholder: t("admin.users.filter.qHint"),
      },
      {
        kind: "select",
        name: "status",
        label: t("admin.users.filter.status"),
        allLabel: t("admin.filters.all"),
        options: USER_STATUSES.map((status) => ({
          value: status,
          label: tOr(`admin.user.status.${status}`, status),
        })),
      },
      ...(roles
        ? [
            {
              kind: "select" as const,
              name: "role",
              label: t("admin.users.filter.role"),
              allLabel: t("admin.filters.all"),
              options: roles.map((role) => ({ value: role.key, label: role.nameAr })),
            },
          ]
        : []),
    ],
    [roles],
  );
  const filtersActive = useFiltersActive(fields);

  const query = buildQuery({
    q: url.get("q"),
    status: url.get("status"),
    role: url.get("role"),
  });
  const list = useCursorList("/admin/users", query, adminUserListResponseSchema);

  const selected = idSchema.safeParse(url.get("user"));
  const openUser = (id: string) => {
    url.update({ user: id });
  };

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: "name",
      header: t("admin.users.col.name"),
      primary: true,
      cell: (user) => (
        <UserCell name={user.name} email={user.email} phone={user.phone} image={user.image} />
      ),
    },
    {
      id: "signIn",
      header: t("admin.users.col.signIn"),
      cell: (user) => <ProviderChips providers={user.providers} />,
    },
    {
      id: "status",
      header: t("admin.users.col.status"),
      cell: (user) => <UserStatusBadge status={user.status} />,
    },
    {
      id: "roles",
      header: t("admin.users.col.roles"),
      cell: (user) => <RoleChips roles={user.roles} names={names} />,
    },
    {
      id: "lastLogin",
      header: t("admin.users.col.lastLogin"),
      cell: (user) =>
        user.lastLoginAt ? (
          <span title={formatDateTime(user.lastLoginAt)}>
            {formatRelativeTime(user.lastLoginAt)}
          </span>
        ) : (
          <span className="text-text-muted">{t("admin.users.neverSignedIn")}</span>
        ),
    },
    {
      id: "created",
      header: t("admin.users.col.created"),
      cell: (user) => formatShortDate(user.createdAt),
    },
  ];

  const rowActions = (user: AdminUser): RowAction[] => {
    const actions: RowAction[] = [
      {
        id: "details",
        label: t("admin.table.details"),
        icon: Eye,
        onSelect: () => {
          openUser(user.id);
        },
      },
    ];
    if (canSuspend && user.id !== meId && user.status !== "deleted") {
      const suspending = user.status === "active";
      actions.push({
        id: suspending ? "suspend" : "unsuspend",
        label: t(suspending ? "admin.users.suspend" : "admin.users.unsuspend"),
        icon: suspending ? UserRoundX : UserCheck,
        ...(suspending ? { tone: "danger" as const } : {}),
        onSelect: () => {
          setStatusTarget({ id: user.id, name: user.name, status: user.status });
        },
      });
    }
    return actions;
  };

  const suspending = statusTarget?.status === "active";

  const changeStatus = async (reason: string): Promise<void> => {
    if (!statusTarget) return;
    await api(`/admin/users/${statusTarget.id}/${suspending ? "suspend" : "unsuspend"}`, {
      method: "POST",
      body: { reason },
    });
    toast({
      tone: "success",
      title: t(suspending ? "admin.users.suspended" : "admin.users.unsuspended", {
        name: statusTarget.name,
      }),
    });
    list.reload();
    setRefreshSignal((current) => current + 1);
  };

  return (
    <div className="flex flex-col gap-5">
      <FilterBar fields={fields} />
      <DataTable
        caption={t("admin.nav.users")}
        columns={columns}
        rows={list.items}
        rowKey={(user) => user.id}
        status={list.status}
        error={list.error}
        onRetry={list.reload}
        onOpenRow={(user) => {
          openUser(user.id);
        }}
        // The name alone: the e-mail under it is context, not part of what the button is called.
        openLabel={(user) => user.name}
        rowActions={rowActions}
        actionsLabel={(user) => t("admin.table.actionsFor", { name: user.name })}
        nextCursor={list.nextCursor}
        loadingMore={list.loadingMore}
        loadMoreError={list.loadMoreError}
        onLoadMore={list.loadMore}
        filtersActive={filtersActive}
        onClearFilters={() => {
          url.update({ q: null, status: null, role: null });
        }}
        emptyTitle={t("admin.users.empty")}
      />

      {selected.success ? (
        <UserDrawer
          userId={selected.data}
          meId={meId}
          canSuspend={canSuspend}
          canWriteRoles={canWriteRoles}
          roles={roles}
          roleNames={names}
          refreshSignal={refreshSignal}
          onClose={() => {
            url.update({ user: null });
          }}
          onSuspendToggle={(user) => {
            setStatusTarget({ id: user.id, name: user.name, status: user.status });
          }}
          onRolesChanged={list.reload}
        />
      ) : null}

      <ConfirmDialog
        open={statusTarget !== null}
        onOpenChange={(open) => {
          if (!open) setStatusTarget(null);
        }}
        title={
          statusTarget
            ? t(suspending ? "admin.users.suspendTitle" : "admin.users.unsuspendTitle", {
                name: statusTarget.name,
              })
            : ""
        }
        description={t(suspending ? "admin.users.suspendBody" : "admin.users.unsuspendBody")}
        confirmLabel={t(suspending ? "admin.users.suspend" : "admin.users.unsuspend")}
        tone={suspending ? "danger" : "primary"}
        withReason
        onConfirm={changeStatus}
      />
    </div>
  );
}
