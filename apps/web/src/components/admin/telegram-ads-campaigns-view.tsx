"use client";

import { t } from "@wasfa/shared/i18n";
import {
  telegramAdCampaignListSchema,
  type TelegramAdCampaign,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { Badge, Button, useToast } from "@wasfa/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber, formatShortDate } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ADS_BASE } from "../../lib/telegram-ads-admin";
import { useResource } from "../../lib/use-admin-data";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { TelegramAdsCampaignDialog } from "./telegram-ads-campaign-dialog";
import { TelegramAdsShell } from "./telegram-ads-shell";

const STATUS_TONE = {
  draft: "neutral",
  active: "success",
  paused: "warning",
  ended: "neutral",
} as const satisfies Record<TelegramAdCampaign["status"], "neutral" | "success" | "warning">;

const capText = (value: number | null) =>
  value === null ? t("admin.tgAds.limit.offLabel") : formatNumber(value);

/** `/admin/telegram/ads/campaigns`: the campaigns with status, dates, caps and results. */
export function TelegramAdsCampaignsView({ canWrite }: { canWrite: boolean }) {
  const resource = useResource(`${ADS_BASE}/campaigns`, telegramAdCampaignListSchema);
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ campaign: TelegramAdCampaign | null } | null>(null);
  const [removing, setRemoving] = useState<TelegramAdCampaign | null>(null);
  const rows = resource.status === "ready" ? resource.data.items : [];

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`${ADS_BASE}/campaigns/${removing.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.tgAds.campaign.deleted") });
    resource.reload();
  };

  const columns: DataTableColumn<TelegramAdCampaign>[] = [
    {
      id: "name",
      header: t("admin.tgAds.campaign.name"),
      primary: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{row.name}</span>
          {row.advertiser === "" ? null : (
            <span className="truncate text-sm text-text-muted">{row.advertiser}</span>
          )}
        </span>
      ),
    },
    {
      id: "status",
      header: t("admin.tgAds.campaign.status"),
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>
          {t(`admin.tgAds.campaignStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      id: "dates",
      header: t("admin.tgAds.campaign.dates"),
      cell: (row) =>
        row.startsAt || row.endsAt
          ? `${row.startsAt ? formatShortDate(row.startsAt) : "…"} – ${row.endsAt ? formatShortDate(row.endsAt) : "…"}`
          : t("admin.tgAds.campaign.noDates"),
    },
    {
      id: "caps",
      header: t("admin.tgAds.campaign.caps"),
      cell: (row) =>
        t("admin.tgAds.campaign.capsValue", {
          daily: capText(row.dailyImpressionCap),
          total: capText(row.totalImpressionCap),
        }),
    },
    {
      id: "creatives",
      header: t("admin.tgAds.campaign.creatives"),
      cell: (row) => formatNumber(row.creativeCount),
    },
    {
      id: "impressions",
      header: t("admin.tgAds.kpi.impressions"),
      cell: (row) => formatNumber(row.impressions),
    },
    { id: "clicks", header: t("admin.tgAds.kpi.clicks"), cell: (row) => formatNumber(row.clicks) },
  ];

  const rowActions = canWrite
    ? (row: TelegramAdCampaign): RowAction[] => [
        {
          id: "edit",
          label: t("admin.tgAds.campaign.edit"),
          icon: Pencil,
          onSelect: () => {
            setEditor({ campaign: row });
          },
        },
        {
          id: "delete",
          label: t("admin.tgAds.campaign.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(row);
          },
        },
      ]
    : undefined;

  return (
    <TelegramAdsShell title={t("admin.tgAds.campaigns.title")}>
      {canWrite ? (
        <div className="flex justify-end">
          <Button
            name="new-campaign"
            onClick={() => {
              setEditor({ campaign: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.tgAds.campaign.new")}
          </Button>
        </div>
      ) : null}

      <DataTable
        caption={t("admin.tgAds.campaigns.title")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        status={resource.status}
        error={resource.status === "error" ? resource.error : undefined}
        onRetry={resource.reload}
        onOpenRow={
          canWrite
            ? (row) => {
                setEditor({ campaign: row });
              }
            : undefined
        }
        openLabel={(row) => t("admin.tgAds.campaign.open", { name: row.name })}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.name })}
        emptyTitle={t("admin.tgAds.campaign.empty")}
        emptyDescription={t("admin.tgAds.campaign.emptyBody")}
      />

      <TelegramAdsCampaignDialog
        open={editor !== null}
        campaign={editor?.campaign ?? null}
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
        title={t("admin.tgAds.campaign.deleteTitle", { name: removing?.name ?? "" })}
        description={t("admin.tgAds.campaign.deleteBody")}
        confirmLabel={t("admin.tgAds.campaign.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </TelegramAdsShell>
  );
}
