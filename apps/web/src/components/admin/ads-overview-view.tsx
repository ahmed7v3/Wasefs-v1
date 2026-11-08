"use client";

import { AD_CHANNELS, adminAdStatsSchema, adsSettingsSchema } from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Card, CardTitle, Field, Select, useToast } from "@wasfa/ui";
import { Eye, MousePointerClick, Percent } from "lucide-react";
import { useState } from "react";

import { formatNumber, tOr } from "../../lib/admin-format";
import { formatCtr, statsPath } from "../../lib/ads-admin";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { Code } from "./badges";
import { ConfirmDialog } from "./confirm-dialog";
import { DataTable, type DataTableColumn } from "./data-table";
import { ResourceBoundary } from "./resource-boundary";
import { StatCard } from "./stat-card";

import type { AdminAdStats } from "@wasfa/shared/ads";

type PlacementRow = AdminAdStats["byPlacement"][number];
type CreativeRow = AdminAdStats["byCreative"][number];

function CtrCard({ ratio }: { ratio: number }) {
  return (
    <Card
      elevation="flat"
      padding="compact"
      className="flex items-center justify-between gap-4 border-s-4 border-s-primary"
    >
      <div className="min-w-0">
        <p
          className="font-heading text-3xl font-semibold tabular-nums text-text"
          data-testid="ads-ctr"
        >
          {formatCtr(ratio)}
        </p>
        <p className="text-sm text-text-muted">{t("admin.ads.overview.ctr")}</p>
      </div>
      <span
        aria-hidden
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
      >
        <Percent className="size-6" />
      </span>
    </Card>
  );
}

/** The global switch: nothing is shown anywhere while it is off, whatever the placements say. */
function GlobalSwitch({ canWrite }: { canWrite: boolean }) {
  const settings = useResource("/admin/ads/settings", adsSettingsSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  if (settings.status === "error")
    return <ErrorNotice error={settings.error} onRetry={settings.reload} />;
  if (settings.status === "loading") return null;
  const enabled = settings.data.enabled;

  const toggle = async (): Promise<void> => {
    await reauth.run(() =>
      api("/admin/ads/settings", {
        method: "PATCH",
        body: { enabled: !enabled },
        schema: adsSettingsSchema,
      }),
    );
    toast({
      tone: "success",
      title: t(enabled ? "admin.ads.switch.turnedOff" : "admin.ads.switch.turnedOn"),
    });
    settings.reload();
  };

  return (
    <Card
      elevation="flat"
      className="flex flex-wrap items-center justify-between gap-4"
      data-testid="ads-switch"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-3">
          <CardTitle>{t("admin.ads.switch.title")}</CardTitle>
          <Badge tone={enabled ? "success" : "neutral"}>
            {t(enabled ? "admin.ads.on" : "admin.ads.off")}
          </Badge>
        </div>
        <p className="text-sm text-text-muted">{t("admin.ads.switch.body")}</p>
      </div>
      {canWrite ? (
        <Button
          name="ads-switch"
          variant={enabled ? "secondary" : "primary"}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t(enabled ? "admin.ads.switch.turnOff" : "admin.ads.switch.turnOn")}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t(enabled ? "admin.ads.switch.offTitle" : "admin.ads.switch.onTitle")}
        description={t(enabled ? "admin.ads.switch.offBody" : "admin.ads.switch.onBody")}
        confirmLabel={t(enabled ? "admin.ads.switch.turnOff" : "admin.ads.switch.turnOn")}
        tone={enabled ? "danger" : "primary"}
        onConfirm={toggle}
      />
    </Card>
  );
}

function StatsBody({ stats }: { stats: AdminAdStats }) {
  const placementColumns: DataTableColumn<PlacementRow>[] = [
    {
      id: "placement",
      header: t("admin.ads.col.placement"),
      primary: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{tOr(`admin.ads.placement.${row.placement}`, row.placement)}</span>
          <Code>{row.placement}</Code>
        </span>
      ),
    },
    {
      id: "impressions",
      header: t("admin.ads.col.impressions"),
      cell: (row) => formatNumber(row.impressions),
    },
    { id: "clicks", header: t("admin.ads.col.clicks"), cell: (row) => formatNumber(row.clicks) },
    { id: "ctr", header: t("admin.ads.col.ctr"), cell: (row) => formatCtr(row.ctr) },
  ];
  const creativeColumns: DataTableColumn<CreativeRow>[] = [
    { id: "title", header: t("admin.ads.col.creative"), primary: true, cell: (row) => row.title },
    {
      id: "impressions",
      header: t("admin.ads.col.impressions"),
      cell: (row) => formatNumber(row.impressions),
    },
    { id: "clicks", header: t("admin.ads.col.clicks"), cell: (row) => formatNumber(row.clicks) },
    { id: "ctr", header: t("admin.ads.col.ctr"), cell: (row) => formatCtr(row.ctr) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("admin.ads.overview.impressions")}
          value={stats.totals.impressions}
          icon={Eye}
        />
        <StatCard
          label={t("admin.ads.overview.clicks")}
          value={stats.totals.clicks}
          icon={MousePointerClick}
          accent="success"
        />
        <CtrCard ratio={stats.totals.ctr} />
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="ads-by-placement">
        <h2 id="ads-by-placement" className="font-heading text-xl font-semibold text-text">
          {t("admin.ads.overview.byPlacement")}
        </h2>
        <DataTable
          caption={t("admin.ads.overview.byPlacement")}
          columns={placementColumns}
          rows={stats.byPlacement}
          rowKey={(row) => row.placement}
          status="ready"
          emptyTitle={t("admin.ads.overview.empty")}
          emptyDescription={t("admin.ads.overview.emptyBody")}
        />
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="ads-by-creative">
        <h2 id="ads-by-creative" className="font-heading text-xl font-semibold text-text">
          {t("admin.ads.overview.byCreative")}
        </h2>
        <DataTable
          caption={t("admin.ads.overview.byCreative")}
          columns={creativeColumns}
          rows={stats.byCreative}
          rowKey={(row) => row.creativeId}
          status="ready"
          emptyTitle={t("admin.ads.overview.empty")}
          emptyDescription={t("admin.ads.overview.emptyBody")}
        />
      </section>
    </div>
  );
}

/**
 * Ads overview (docs/ADS.md §6): the global switch, the totals of the last 7 days (UTC) and the
 * per-placement and per-creative tables with CTR, filtered by channel (web / WhatsApp).
 */
export function AdsOverviewView({ canWrite }: { canWrite: boolean }) {
  const [channel, setChannel] = useState("");
  const stats = useResource(statsPath(channel), adminAdStatsSchema);

  return (
    <div className="flex flex-col gap-6">
      <GlobalSwitch canWrite={canWrite} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Notice className="min-w-0 flex-1 basis-64">
          {stats.status === "ready"
            ? t("admin.ads.overview.range", { from: stats.data.from, to: stats.data.to })
            : t("admin.ads.overview.rangeDefault")}
        </Notice>
        <Field label={t("admin.ads.filter.channel")} className="basis-48">
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
      <ResourceBoundary resource={stats}>{(data) => <StatsBody stats={data} />}</ResourceBoundary>
    </div>
  );
}
