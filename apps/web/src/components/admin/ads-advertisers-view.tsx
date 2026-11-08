"use client";

import {
  AD_CATEGORIES,
  adminAdvertiserListSchema,
  adminAdvertiserSchema,
  advertiserInputSchema,
  isForbiddenCategory,
  type AdminAdvertiser,
} from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Checkbox, Dialog, Field, Input, Select, useToast } from "@wasfa/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

const ADVERTISER_CATEGORIES = AD_CATEGORIES.filter((category) => !isForbiddenCategory(category));

function AdvertiserForm({
  advertiser,
  onSaved,
  onClose,
}: {
  advertiser: AdminAdvertiser | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [name, setName] = useState(advertiser?.name ?? "");
  const [category, setCategory] = useState<string>(advertiser?.category ?? "other");
  const [contact, setContact] = useState(advertiser?.contact ?? "");
  const [active, setActive] = useState(advertiser?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const parsed = advertiserInputSchema.safeParse({
      name,
      category,
      contact: contact.trim() === "" ? null : contact,
      active,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            t("admin.ads.invalid.generic"),
          ]),
        ),
      );
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        advertiser
          ? api(`/admin/ads/advertisers/${advertiser.id}`, {
              method: "PATCH",
              body: parsed.data,
              schema: adminAdvertiserSchema,
            })
          : api("/admin/ads/advertisers", {
              method: "POST",
              body: parsed.data,
              schema: adminAdvertiserSchema,
            }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t("admin.ads.advertiser.saved") });
          onSaved();
          onClose();
        },
        (error: unknown) => {
          setSubmitting(false);
          setFormError(toApiError(error));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field label={t("admin.ads.advertiser.name")} required error={errors["name"]}>
        {(control) => (
          <Input
            {...control}
            name="name"
            maxLength={120}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t("admin.ads.advertiser.category")} error={errors["category"]}>
        {(control) => (
          <Select
            {...control}
            name="category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            {ADVERTISER_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.ads.category.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t("admin.ads.advertiser.contact")}
        hint={t("admin.ads.advertiser.contactHint")}
        error={errors["contact"]}
      >
        {(control) => (
          <Input
            {...control}
            name="contact"
            maxLength={300}
            value={contact}
            onChange={(event) => {
              setContact(event.target.value);
            }}
          />
        )}
      </Field>
      <Checkbox
        name="active"
        label={t("admin.ads.advertiser.active")}
        checked={active}
        onChange={(event) => {
          setActive(event.target.checked);
        }}
      />
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

/** Advertisers: the direct-sold accounts a creative can belong to (no advertiser = a house creative). */
export function AdsAdvertisersView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/ads/advertisers", adminAdvertiserListSchema);
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ advertiser: AdminAdvertiser | null } | null>(null);
  const [removing, setRemoving] = useState<AdminAdvertiser | null>(null);
  const rows = resource.status === "ready" ? resource.data.items : [];

  const columns: DataTableColumn<AdminAdvertiser>[] = [
    { id: "name", header: t("admin.ads.advertiser.name"), primary: true, cell: (row) => row.name },
    {
      id: "category",
      header: t("admin.ads.col.category"),
      cell: (row) => t(`admin.ads.category.${row.category}`),
    },
    {
      id: "active",
      header: t("admin.ads.col.status"),
      cell: (row) => (
        <Badge tone={row.active ? "success" : "neutral"}>
          {t(row.active ? "admin.ads.advertiser.activeOn" : "admin.ads.advertiser.activeOff")}
        </Badge>
      ),
    },
    {
      id: "creatives",
      header: t("admin.ads.col.creatives"),
      cell: (row) => formatNumber(row.creativeCount),
    },
    { id: "contact", header: t("admin.ads.advertiser.contact"), cell: (row) => row.contact ?? "—" },
  ];

  const rowActions = canWrite
    ? (row: AdminAdvertiser): RowAction[] => [
        {
          id: "edit",
          label: t("admin.ads.advertiser.edit"),
          icon: Pencil,
          onSelect: () => {
            setEditor({ advertiser: row });
          },
        },
        {
          id: "delete",
          label: t("admin.ads.advertiser.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(row);
          },
        },
      ]
    : undefined;

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`/admin/ads/advertisers/${removing.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.ads.advertiser.deleted") });
    resource.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            name="new-advertiser"
            onClick={() => {
              setEditor({ advertiser: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.ads.advertiser.new")}
          </Button>
        </div>
      ) : null}
      <DataTable
        caption={t("admin.nav.adsAdvertisers")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (row) => {
                setEditor({ advertiser: row });
              }
            : undefined
        }
        openLabel={(row) => t("admin.ads.advertiser.open", { name: row.name })}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.name })}
        emptyTitle={t("admin.ads.advertiser.empty")}
        emptyDescription={t("admin.ads.advertiser.emptyBody")}
      />
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={editor?.advertiser ? editor.advertiser.name : t("admin.ads.advertiser.newTitle")}
      >
        {editor ? (
          <AdvertiserForm
            advertiser={editor.advertiser}
            onSaved={resource.reload}
            onClose={() => {
              setEditor(null);
            }}
          />
        ) : null}
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.ads.advertiser.deleteTitle", { name: removing?.name ?? "" })}
        description={t("admin.ads.advertiser.deleteBody")}
        confirmLabel={t("admin.ads.advertiser.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
