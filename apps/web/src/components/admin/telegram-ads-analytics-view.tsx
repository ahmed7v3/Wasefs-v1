"use client";

import { t } from "@wasfa/shared/i18n";
import {
  telegramAdCampaignListSchema,
  telegramAdStatsSchema,
  type TelegramAdStats,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { TELEGRAM_AD_TRIGGERS } from "@wasfa/shared/telegram-ads";
import { Button, Card, Field, Input, Select, buttonStyles } from "@wasfa/ui";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { publicEnv } from "../../lib/env";
import {
  ADS_BASE,
  RANGE_PRESETS,
  percentText,
  presetRange,
  statsQuery,
} from "../../lib/telegram-ads-admin";
import { useResource } from "../../lib/use-admin-data";

import { ResourceBoundary } from "./resource-boundary";
import { TelegramAdsShell } from "./telegram-ads-shell";
import { TelegramAdsStatsTable } from "./telegram-ads-stats-table";
import { TelegramAdsTrendChart } from "./telegram-ads-trend-chart";

type Preset = (typeof RANGE_PRESETS)[number] | "custom";

function Kpi({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-1">
      <span
        className="font-heading text-2xl font-semibold tabular-nums text-text"
        data-testid={testId}
      >
        {value}
      </span>
      <span className="text-sm text-text-muted">{label}</span>
    </Card>
  );
}

function StatsBody({ stats }: { stats: TelegramAdStats }) {
  const totals = stats.totals;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t("admin.tgAds.kpi.title")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            testId="kpi-impressions"
            label={t("admin.tgAds.kpi.impressions")}
            value={formatNumber(totals.impressions)}
          />
          <Kpi
            testId="kpi-clicks"
            label={t("admin.tgAds.kpi.clicks")}
            value={formatNumber(totals.clicks)}
          />
          <Kpi testId="kpi-ctr" label={t("admin.tgAds.kpi.ctr")} value={percentText(totals.ctr)} />
          <Kpi
            testId="kpi-reactions"
            label={t("admin.tgAds.kpi.reactions")}
            value={formatNumber(totals.reactions)}
          />
          <Kpi
            testId="kpi-hides"
            label={t("admin.tgAds.kpi.hides")}
            value={formatNumber(totals.hides)}
          />
          <Kpi
            testId="kpi-reach"
            label={t("admin.tgAds.kpi.reach")}
            value={formatNumber(totals.reach)}
          />
          <Kpi
            testId="kpi-engagement"
            label={t("admin.tgAds.kpi.engagement")}
            value={percentText(totals.engagementRate)}
          />
        </div>
      </section>

      {totals.impressions === 0 && stats.byDay.length === 0 ? (
        <Card elevation="flat" className="flex flex-col gap-1" data-testid="tg-stats-empty">
          <p className="text-base font-semibold text-text">{t("admin.tgAds.overview.empty")}</p>
          <p className="text-sm text-text-muted">{t("admin.tgAds.overview.emptyBody")}</p>
        </Card>
      ) : null}

      <TelegramAdsTrendChart days={stats.byDay} />

      <TelegramAdsStatsTable
        title={t("admin.tgAds.table.byCampaign")}
        nameHeader={t("admin.tgAds.col.campaign")}
        rows={stats.byCampaign}
        rowKey={(row) => row.campaignId}
        name={(row) => row.name}
        nameText={(row) => row.name}
      />
      <TelegramAdsStatsTable
        title={t("admin.tgAds.table.byCreative")}
        nameHeader={t("admin.tgAds.col.creative")}
        rows={stats.byCreative}
        rowKey={(row) => row.creativeId}
        name={(row) => row.name}
        nameText={(row) => row.name}
      />
      <TelegramAdsStatsTable
        title={t("admin.tgAds.table.byTrigger")}
        nameHeader={t("admin.tgAds.col.trigger")}
        rows={stats.byTrigger}
        rowKey={(row) => row.trigger}
        name={(row) => t(`admin.tgAds.trigger.${row.trigger}`)}
        nameText={(row) => TELEGRAM_AD_TRIGGERS.indexOf(row.trigger).toString().padStart(2, "0")}
      />
    </div>
  );
}

/** `/admin/telegram/ads`: the analytics of the Telegram ads (range, campaign filter, KPIs, trend, tables, CSV). */
export function TelegramAdsAnalyticsView() {
  const [preset, setPreset] = useState<Preset>(30);
  const [custom, setCustom] = useState(() => presetRange(30));
  const [campaignId, setCampaignId] = useState("");
  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset)),
    [preset, custom],
  );
  const customValid = custom.from !== "" && custom.to !== "" && custom.from <= custom.to;
  const valid = preset !== "custom" || customValid;
  const query = statsQuery(range, campaignId);
  const stats = useResource(valid ? `${ADS_BASE}/stats?${query}` : null, telegramAdStatsSchema);
  const campaigns = useResource(`${ADS_BASE}/campaigns`, telegramAdCampaignListSchema);
  const exportHref = `${publicEnv.NEXT_PUBLIC_API_URL}${ADS_BASE}/stats/export?${query}`;

  return (
    <TelegramAdsShell title={t("admin.tgAds.title")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div
            role="group"
            aria-label={t("admin.tgAds.range.label")}
            className="flex flex-wrap gap-2"
          >
            {RANGE_PRESETS.map((days) => (
              <Button
                key={days}
                type="button"
                name={`range-${String(days)}`}
                variant={preset === days ? "primary" : "secondary"}
                aria-pressed={preset === days}
                onClick={() => {
                  setPreset(days);
                }}
              >
                {t("admin.tgAds.range.days", { days })}
              </Button>
            ))}
            <Button
              type="button"
              name="range-custom"
              variant={preset === "custom" ? "primary" : "secondary"}
              aria-pressed={preset === "custom"}
              onClick={() => {
                setPreset("custom");
              }}
            >
              {t("admin.tgAds.range.custom")}
            </Button>
          </div>
          {preset === "custom" ? (
            <>
              <Field label={t("admin.tgAds.range.from")} className="basis-40">
                {(control) => (
                  <Input
                    {...control}
                    name="from"
                    type="date"
                    ltr
                    value={custom.from}
                    onChange={(event) => {
                      setCustom((current) => ({ ...current, from: event.target.value }));
                    }}
                  />
                )}
              </Field>
              <Field
                label={t("admin.tgAds.range.to")}
                className="basis-40"
                error={customValid ? undefined : t("admin.tgAds.range.invalid")}
              >
                {(control) => (
                  <Input
                    {...control}
                    name="to"
                    type="date"
                    ltr
                    value={custom.to}
                    onChange={(event) => {
                      setCustom((current) => ({ ...current, to: event.target.value }));
                    }}
                  />
                )}
              </Field>
            </>
          ) : null}
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
                {(campaigns.status === "ready" ? campaigns.data.items : []).map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <a
          href={exportHref}
          download
          aria-disabled={!valid}
          className={buttonStyles({ variant: "secondary" })}
        >
          <Download aria-hidden className="size-5" />
          {t("admin.tgAds.export")}
        </a>
      </div>

      {valid ? (
        <>
          <p className="text-sm text-text-muted">
            {t("admin.tgAds.range.shown", { from: range.from, to: range.to })}
          </p>
          <ResourceBoundary resource={stats}>
            {(data) => <StatsBody stats={data} />}
          </ResourceBoundary>
        </>
      ) : null}
    </TelegramAdsShell>
  );
}
