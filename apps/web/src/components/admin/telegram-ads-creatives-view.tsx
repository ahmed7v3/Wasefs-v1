"use client";

import { t } from "@wasfa/shared/i18n";
import {
  telegramAdCampaignListSchema,
  telegramAdCreativeListSchema,
  telegramAdCreativeSchema,
  telegramAdTestSendResultSchema,
  type TelegramAdCreative,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { TELEGRAM_AD_STATUSES } from "@wasfa/shared/telegram-ads";
import { Badge, Button, Field, Select, useToast } from "@wasfa/ui";
import { Archive, ArrowRight, CircleCheck, Pause, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ADS_BASE, percentText } from "../../lib/telegram-ads-admin";
import { buildQuery, useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn, type RowAction } from "./data-table";
import { TelegramAdCreativeForm } from "./telegram-ad-creative-form";
import { TelegramAdsShell } from "./telegram-ads-shell";

import type { ApiRequestError } from "../../lib/api-error";

type Status = (typeof TELEGRAM_AD_STATUSES)[number];

const STATUS_TONE = {
  draft: "neutral",
  approved: "success",
  paused: "warning",
  archived: "neutral",
} as const satisfies Record<Status, "neutral" | "success" | "warning">;

/** `/admin/telegram/ads/creatives`: the creatives with results and quick actions, and the editor with the live preview. */
export function TelegramAdsCreativesView({ canWrite }: { canWrite: boolean }) {
  const [campaignId, setCampaignId] = useState("");
  const campaigns = useResource(`${ADS_BASE}/campaigns`, telegramAdCampaignListSchema);
  const query = buildQuery({ campaignId });
  const resource = useResource(
    query === "" ? `${ADS_BASE}/creatives` : `${ADS_BASE}/creatives?${query}`,
    telegramAdCreativeListSchema,
  );
  const reauth = useReauth();
  const { toast } = useToast();
  const [editor, setEditor] = useState<{ creative: TelegramAdCreative | null } | null>(null);
  const [removing, setRemoving] = useState<TelegramAdCreative | null>(null);
  const [actionError, setActionError] = useState<ApiRequestError | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const rows = resource.status === "ready" ? resource.data.items : [];
  const campaignList = campaigns.status === "ready" ? campaigns.data.items : [];

  const changeStatus = (creative: TelegramAdCreative, next: Status): void => {
    setActionError(null);
    reauth
      .run(() =>
        api(`${ADS_BASE}/creatives/${creative.id}/status`, {
          method: "POST",
          body: { status: next },
          schema: telegramAdCreativeSchema,
        }),
      )
      .then(
        () => {
          toast({ tone: "success", title: t(`admin.tgAds.creative.status.done.${next}`) });
          resource.reload();
        },
        (error: unknown) => {
          // A refusal (the medicine floor) arrives here with its reason.
          setActionError(toApiError(error));
        },
      );
  };

  const testSend = (creative: TelegramAdCreative): void => {
    setActionError(null);
    setSendingId(creative.id);
    reauth
      .run(() =>
        api(`${ADS_BASE}/creatives/${creative.id}/test-send`, {
          method: "POST",
          schema: telegramAdTestSendResultSchema,
        }),
      )
      .then(
        (result) => {
          setSendingId(null);
          toast(
            result.sent > 0
              ? { tone: "success", title: t("admin.tgAds.creative.testSent") }
              : { tone: "info", title: t("admin.tgAds.creative.testNoChat") },
          );
        },
        (error: unknown) => {
          setSendingId(null);
          setActionError(toApiError(error));
        },
      );
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    await api(`${ADS_BASE}/creatives/${removing.id}`, { method: "DELETE" });
    toast({ tone: "success", title: t("admin.tgAds.creative.deleted") });
    resource.reload();
  };

  if (editor) {
    return (
      <TelegramAdsShell
        title={editor.creative ? editor.creative.name : t("admin.tgAds.creative.newTitle")}
      >
        <div>
          <Button
            type="button"
            variant="ghost"
            name="back"
            onClick={() => {
              setEditor(null);
            }}
          >
            <ArrowRight aria-hidden className="size-5 ltr:rotate-180" />
            {t("admin.tgAds.creative.back")}
          </Button>
        </div>
        {campaignList.length === 0 && campaigns.status === "ready" ? (
          <Notice>{t("admin.tgAds.creative.needCampaign")}</Notice>
        ) : (
          <TelegramAdCreativeForm
            key={editor.creative?.id ?? "new"}
            creative={editor.creative}
            defaultCampaignId={campaignId}
            campaigns={campaignList}
            onSaved={resource.reload}
            onClose={() => {
              setEditor(null);
            }}
          />
        )}
      </TelegramAdsShell>
    );
  }

  const columns: DataTableColumn<TelegramAdCreative>[] = [
    {
      id: "name",
      header: t("admin.tgAds.col.creative"),
      primary: true,
      cell: (row) => (
        <span className="flex items-center gap-3">
          {row.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin thumbnail of a CDN variant
            <img src={row.imageUrl} alt="" className="size-10 rounded object-cover" />
          ) : null}
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{row.name}</span>
            <span className="truncate text-sm text-text-muted">{row.headline}</span>
          </span>
        </span>
      ),
    },
    {
      id: "layout",
      header: t("admin.tgAds.creative.layout"),
      cell: (row) => t(`admin.tgAds.layout.${row.layout}`),
    },
    {
      id: "status",
      header: t("admin.tgAds.campaign.status"),
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]}>
          {t(`admin.tgAds.creativeStatus.${row.status}`)}
        </Badge>
      ),
    },
    {
      id: "impressions",
      header: t("admin.tgAds.kpi.impressions"),
      cell: (row) => formatNumber(row.impressions),
    },
    { id: "clicks", header: t("admin.tgAds.kpi.clicks"), cell: (row) => formatNumber(row.clicks) },
    {
      id: "ctr",
      header: t("admin.tgAds.kpi.ctr"),
      cell: (row) => percentText(row.impressions === 0 ? 0 : row.clicks / row.impressions),
    },
    ...(canWrite
      ? [
          {
            id: "test",
            header: t("admin.tgAds.creative.test"),
            cell: (row: TelegramAdCreative) => (
              <Button
                type="button"
                variant="secondary"
                name={`test-send-${row.id}`}
                loading={sendingId === row.id}
                onClick={() => {
                  testSend(row);
                }}
              >
                <Send aria-hidden className="size-5" />
                {t("admin.tgAds.creative.testSend")}
              </Button>
            ),
          } satisfies DataTableColumn<TelegramAdCreative>,
        ]
      : []),
  ];

  const rowActions = canWrite
    ? (row: TelegramAdCreative): RowAction[] => {
        const actions: RowAction[] = [
          {
            id: "edit",
            label: t("admin.tgAds.creative.edit"),
            icon: Pencil,
            onSelect: () => {
              setEditor({ creative: row });
            },
          },
        ];
        if (row.status !== "approved") {
          actions.push({
            id: "approve",
            label: t("admin.tgAds.creative.approve"),
            icon: CircleCheck,
            onSelect: () => {
              changeStatus(row, "approved");
            },
          });
        }
        if (row.status === "approved") {
          actions.push({
            id: "pause",
            label: t("admin.tgAds.creative.pause"),
            icon: Pause,
            onSelect: () => {
              changeStatus(row, "paused");
            },
          });
        }
        if (row.status !== "archived") {
          actions.push({
            id: "archive",
            label: t("admin.tgAds.creative.archive"),
            icon: Archive,
            onSelect: () => {
              changeStatus(row, "archived");
            },
          });
        }
        actions.push({
          id: "delete",
          label: t("admin.tgAds.creative.delete"),
          icon: Trash2,
          tone: "danger",
          onSelect: () => {
            setRemoving(row);
          },
        });
        return actions;
      }
    : undefined;

  return (
    <TelegramAdsShell title={t("admin.tgAds.creatives.title")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label={t("admin.tgAds.filter.campaign")} className="basis-56">
          {(control) => (
            <Select
              {...control}
              name="campaign"
              value={campaignId}
              onChange={(event) => {
                setCampaignId(event.target.value);
              }}
            >
              <option value="">{t("admin.tgAds.filter.allCampaigns")}</option>
              {campaignList.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {canWrite ? (
          <Button
            name="new-creative"
            onClick={() => {
              setEditor({ creative: null });
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.tgAds.creative.new")}
          </Button>
        ) : null}
      </div>

      {actionError ? <ErrorNotice error={actionError} /> : null}

      <DataTable
        caption={t("admin.tgAds.creatives.title")}
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
        openLabel={(row) => t("admin.tgAds.creative.open", { name: row.name })}
        rowActions={rowActions}
        actionsLabel={(row) => t("admin.table.actionsFor", { name: row.name })}
        filtersActive={campaignId !== ""}
        onClearFilters={() => {
          setCampaignId("");
        }}
        emptyTitle={t("admin.tgAds.creative.empty")}
        emptyDescription={t("admin.tgAds.creative.emptyBody")}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("admin.tgAds.creative.deleteTitle", { name: removing?.name ?? "" })}
        description={t("admin.tgAds.creative.deleteBody")}
        confirmLabel={t("admin.tgAds.creative.delete")}
        tone="danger"
        onConfirm={remove}
      />
    </TelegramAdsShell>
  );
}
