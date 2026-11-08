"use client";

import {
  AD_CHANNELS,
  AD_STATUSES,
  adminCreativeListSchema,
  adminCreativeSchema,
  type AdStatus,
  type AdminCreative,
} from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Field, Select, useToast } from "@wasfa/ui";
import { Archive, CircleCheck, Pause, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { AdsCreativeForm } from "./ads-creative-form";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { DetailDrawer } from "./drawer";

import type { ApiRequestError } from "../../lib/api-error";

const STATUS_TONE = {
  draft: "neutral",
  approved: "success",
  paused: "warning",
  archived: "neutral",
} as const satisfies Record<AdStatus, "neutral" | "success" | "warning">;

/** Creatives: list with filters, row actions (edit, approve, pause, archive, delete a draft) and the editor drawer. */
export function AdsCreativesView({ canWrite }: { canWrite: boolean }) {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const query = buildQuery({ status, channel });
  const resource = useResource(
    query === "" ? "/admin/ads/creatives" : `/admin/ads/creatives?${query}`,
    adminCreativeListSchema,
  );
  const reauth = useReauth();
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ creative: AdminCreative | null } | null>(null);
  const [removing, setRemoving] = useState<AdminCreative | null>(null);
  const [actionError, setActionError] = useState<ApiRequestError | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];

  const changeStatus = (creative: AdminCreative, next: AdStatus): void => {
    setActionError(null);
    reauth
      .run(() =>
        api(`/admin/ads/creatives/${creative.id}/status`, {
          method: "POST",
          body: { status: next },
          schema: adminCreativeSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t(`admin.ads.creative.status.done.${next}`) });
          resource.reload();
        },
        (error: unknown) => {
          // The medicine refusal arrives here with its reason (AD_CATEGORY_FORBIDDEN).
          setActionError(toApiError(error));
        },
      );
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`/admin/ads/creatives/${removing.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.ads.creative.deleted") });
    resource.reload();
  };

  const columns: DataTableColumn<AdminCreative>[] = [
    {
      id: "title",
      header: t("admin.ads.col.creative"),
      primary: true,
      cell: (row) => (
        <span className="flex items-center gap-3">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin thumbnail of a CDN variant
            <img src={row.imageUrl} alt="" className="size-10 rounded object-cover" />
          ) : null}
          <span className="min-w-0 truncate">{row.title}</span>
        </span>
      ),
    },
    {
      id: "advertiser",
      header: t("admin.ads.col.advertiser"),
      cell: (row) => row.advertiserName ?? t("admin.ads.creative.house"),
    },
    {
      id: "category",
      header: t("admin.ads.col.category"),
      cell: (row) => t(`admin.ads.category.${row.category}`),
    },
    {
      id: "status",
      header: t("admin.ads.col.status"),
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>{t(`admin.ads.status.${row.status}`)}</Badge>
      ),
    },
    {
      id: "channels",
      header: t("admin.ads.col.channels"),
      cell: (row) => row.channels.map((value) => t(`admin.ads.channel.${value}`)).join("، "),
    },
    {
      id: "schedule",
      header: t("admin.ads.col.schedule"),
      cell: (row) =>
        row.startsAt || row.endsAt
          ? `${row.startsAt ? formatShortDate(row.startsAt) : "…"} – ${row.endsAt ? formatShortDate(row.endsAt) : "…"}`
          : t("admin.ads.creative.noSchedule"),
    },
    { id: "weight", header: t("admin.ads.col.weight"), cell: (row) => formatNumber(row.weight) },
  ];

  const rowActions = canWrite
    ? (row: AdminCreative): RowAction[] => {
        const actions: RowAction[] = [
          {
            id: "edit",
            label: t("admin.ads.creative.edit"),
            icon: Pencil,
            onSelect: () => {
              setEditor({ creative: row });
            },
          },
        ];
        if (row.status !== "approved") {
          actions.push({
            id: "approve",
            label: t("admin.ads.creative.approve"),
            icon: CircleCheck,
            onSelect: () => {
              changeStatus(row, "approved");
            },
          });
        }
        if (row.status === "approved") {
          actions.push({
            id: "pause",
            label: t("admin.ads.creative.pause"),
            icon: Pause,
            onSelect: () => {
              changeStatus(row, "paused");
            },
          });
        }
        if (row.status !== "archived") {
          actions.push({
            id: "archive",
            label: t("admin.ads.creative.archive"),
            icon: Archive,
            onSelect: () => {
              changeStatus(row, "archived");
            },
          });
        }
        if (row.status === "draft") {
          actions.push({
            id: "delete",
            label: t("admin.ads.creative.delete"),
            icon: Trash2,
            tone: "danger",
            onSelect: () => {
              setRemoving(row);
            },
          });
        }
        return actions;
      }
    : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("admin.ads.filter.status")} className="basis-44">
            {(control) => (
              <Select
                {...control}
                name="status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                }}
              >
                <option value="">{t("admin.ads.filter.allStatuses")}</option>
                {AD_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.ads.status.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.ads.filter.channel")} className="basis-44">
            {(control) => (
              <Select
                {...control}
                name="channel"
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value);
                }}
              >
                <option value="">{t("admin.ads.filter.allChannels")}</option>
                {AD_CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.ads.channel.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {canWrite ? (
          <Button
            name="new-creative"
            onClick={() => {
              setEditor({ creative: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.ads.creative.new")}
          </Button>
        ) : null}
      </div>

      {actionError ? <ErrorNotice error={actionError} /> : null}

      <DataTable
        caption={t("admin.nav.adsCreatives")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (row) => {
                setEditor({ creative: row });
              }
            : undefined
        }
        openLabel={(row) => t("admin.ads.creative.open", { name: row.title })}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.title })}
        filtersActive={status !== "" || channel !== ""}
        onClearFilters={() => {
          setStatus("");
          setChannel("");
        }}
        emptyTitle={t("admin.ads.creative.empty")}
        emptyDescription={t("admin.ads.creative.emptyBody")}
      />

      <DetailDrawer
        open={editor !== null}
        onClose={() => {
          setEditor(null);
        }}
        title={editor?.creative ? editor.creative.title : t("admin.ads.creative.newTitle")}
      >
        {editor ? (
          <AdsCreativeForm
            key={editor.creative?.id ?? "new"}
            creative={editor.creative}
            onSaved={resource.reload}
            onClose={() => {
              setEditor(null);
            }}
          />
        ) : null}
      </DetailDrawer>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.ads.creative.deleteTitle", { name: removing?.title ?? "" })}
        description={t("admin.ads.creative.deleteBody")}
        confirmLabel={t("admin.ads.creative.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </div>
  );
}
