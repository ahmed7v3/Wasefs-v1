"use client";

import { t } from "@wasfa/shared/i18n";
import { personListResponseSchema, personSchema, type Person } from "@wasfa/shared/schemas/content";
import { Badge, Button, Checkbox, useToast } from "@wasfa/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { personBody } from "../../lib/content-people";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { PersonDialog } from "./content-person-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";

import type { ApiRequestError } from "../../lib/api-error";

export interface ContentPeopleViewProps {
  permissions: readonly string[];
}

export function ContentPeopleView({ permissions }: ContentPeopleViewProps) {
  const canManage = permissions.includes("content.manage");
  const resource = useResource("/admin/content/people", personListResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [editing, setEditing] = useState<{ person: Person | null } | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);
  const [toggleError, setToggleError] = useState<ApiRequestError | null>(null);

  const toggleActive = (person: Person, active: boolean) => {
    setToggleError(null);
    reauth
      .run(() =>
        api(`/admin/content/people/${person.id}`, {
          method: "PATCH",
          body: personBody(person, { active }),
          schema: personSchema,
        }),
      )
      .then(
        () => {
          resource.reload();
        },
        (failure: unknown) => {
          setToggleError(toApiError(failure));
        },
      );
  };

  const columns: DataTableColumn<Person>[] = [
    {
      id: "name",
      header: t("admin.content.person.col.name"),
      primary: true,
      cell: (person) => (
        <span className="flex min-w-0 flex-col">
          <span className="break-words">{person.nameAr}</span>
          <bdi dir="ltr" className="text-start text-sm font-normal text-text-muted">
            {person.slug}
          </bdi>
        </span>
      ),
    },
    {
      id: "role",
      header: t("admin.content.person.role"),
      cell: (person) => (
        <Badge tone={person.role === "author" ? "neutral" : "info"}>
          {t(`admin.content.person.role.${person.role}`)}
        </Badge>
      ),
    },
    {
      id: "credentials",
      header: t("admin.content.person.credentialsAr"),
      cell: (person) => person.credentialsAr || "—",
    },
    {
      id: "linked",
      header: t("admin.content.person.col.linked"),
      cell: (person) => (
        <Badge tone={person.userId ? "success" : "neutral"}>
          {t(person.userId ? "admin.content.person.linked" : "admin.content.person.notLinked")}
        </Badge>
      ),
    },
    { id: "items", header: t("admin.content.col.items"), cell: (person) => person.itemCount },
    {
      id: "active",
      header: t("admin.content.person.active"),
      cell: (person) =>
        canManage ? (
          <Checkbox
            name="active"
            label={
              <span className="sr-only">
                {t("admin.content.person.activeFor", { name: person.nameAr })}
              </span>
            }
            checked={person.active}
            onChange={(event) => {
              toggleActive(person, event.target.checked);
            }}
          />
        ) : (
          <Badge tone={person.active ? "success" : "neutral"}>
            {t(person.active ? "admin.content.person.active" : "admin.content.person.inactive")}
          </Badge>
        ),
    },
  ];

  const rowActions = canManage
    ? (person: Person): RowAction[] => [
        {
          id: "edit",
          label: t("admin.content.editVerb"),
          icon: Pencil,
          onSelect: () => {
            setEditing({ person });
          },
        },
        {
          id: "delete",
          label: t("admin.content.deleteVerb"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setDeleting(person);
          },
        },
      ]
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-text-muted">
          {t("admin.content.person.reviewNeedsLink")}
        </p>
        {canManage ? (
          <Button
            onClick={() => {
              setEditing({ person: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.content.person.new")}
          </Button>
        ) : null}
      </div>

      {toggleError ? <ErrorNotice error={toggleError} /> : null}

      <DataTable
        caption={t("admin.nav.content.people")}
        columns={columns}
        rows={resource.status === "ready" ? resource.data.items : []}
        rowKey={(person) => person.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canManage
            ? (person) => {
                setEditing({ person });
              }
            : undefined
        }
        openLabel={(person) => t("admin.content.edit", { name: person.nameAr })}
        rowActions={rowActions}
        actionsLabel={(person) => t("admin.table.actionsFor", { name: person.nameAr })}
        emptyTitle={t("admin.content.person.empty")}
        emptyDescription={t("admin.content.person.emptyHint")}
      />

      <PersonDialog
        open={editing !== null}
        person={editing?.person ?? null}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={resource.reload}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("admin.content.person.deleteTitle", { name: deleting?.nameAr ?? "" })}
        description={t("admin.content.person.deleteBody")}
        confirmLabel={t("admin.content.deleteVerb")}
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await api(`/admin/content/people/${deleting.id}`, { method: "DELETE" });
          toast({ tone: "success", title: t("admin.content.taxonomy.deleted") });
          resource.reload();
        }}
      />
    </div>
  );
}
