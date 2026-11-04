"use client";

import { Button, Tab, TabList, TabPanel, Tabs, buttonStyles, useToast } from "@wasfa/ui";
import { Download, ExternalLink } from "lucide-react";

import { downloadCsv } from "../../../lib/csv-download";
import { useUrlParams } from "../../../lib/use-url-params";
import { FilterBar } from "../filter-bar";

import { CampaignsPanel } from "./campaigns-panel";
import { filterFields, useEarlyFilters, useEarlyLinks, type RangeKey } from "./filters";
import { RANGE_LABEL, T } from "./labels";
import { OverviewPanel } from "./overview-panel";
import { SettingsPanel } from "./settings-panel";
import { SignupsPanel } from "./signups-panel";

const TABS = ["overview", "campaigns", "signups", "settings"] as const;
type TabKey = (typeof TABS)[number];

const LAUNCH_URL = "https://early.wasfa.online/";

/** `/admin/growth/early-access`: the waitlist dashboard, its campaign links and the landing settings. */
export function EarlyAccessView({ canWriteSettings }: { canWriteSettings: boolean }) {
  const url = useUrlParams();
  const { toast } = useToast();
  const filters = useEarlyFilters();
  const links = useEarlyLinks();
  const linkItems = links.status === "ready" ? links.data : [];
  const tabParam = url.get("tab");
  const tabs = TABS.filter((key) => key !== "settings" || canWriteSettings);
  const tab: TabKey = tabs.find((key) => key === tabParam) ?? "overview";

  const exportCsv = async (kind: "signups" | "events") => {
    try {
      await downloadCsv(
        `/admin/early-access/${kind}/export.csv${filters.query ? `?${filters.query}` : ""}`,
        `early-access-${kind}.csv`,
      );
    } catch {
      toast({ tone: "error", title: T.export.failed });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold text-text">{T.title}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void exportCsv("signups");
            }}
          >
            <Download aria-hidden className="size-4" />
            {T.export.signups}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void exportCsv("events");
            }}
          >
            <Download aria-hidden className="size-4" />
            {T.export.events}
          </Button>
          <a
            href={LAUNCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonStyles({ variant: "primary" })}
          >
            <ExternalLink aria-hidden className="size-4" />
            {T.open}
          </a>
        </div>
      </div>

      {tab !== "settings" ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={T.filters.from}>
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map((key) => (
              <Button
                key={key}
                variant={filters.range === key ? "primary" : "secondary"}
                aria-pressed={filters.range === key}
                onClick={() => {
                  url.update({ range: key === "30d" ? null : key, d1: null, d2: null });
                }}
              >
                {RANGE_LABEL[key]}
              </Button>
            ))}
          </div>
          <FilterBar fields={filterFields(linkItems, filters.range)} />
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          url.update({ tab: value === "overview" ? null : value, signup: null });
        }}
      >
        <TabList aria-label={T.title}>
          {tabs.map((key) => (
            <Tab key={key} value={key}>
              {T.tabs[key]}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="overview">{tab === "overview" ? <OverviewPanel filters={filters} /> : null}</TabPanel>
        <TabPanel value="campaigns">
          {tab === "campaigns" ? (
            <CampaignsPanel filters={filters} links={linkItems} reloadLinks={links.reload} />
          ) : null}
        </TabPanel>
        <TabPanel value="signups">{tab === "signups" ? <SignupsPanel filters={filters} /> : null}</TabPanel>
        {canWriteSettings ? (
          <TabPanel value="settings">{tab === "settings" ? <SettingsPanel /> : null}</TabPanel>
        ) : null}
      </Tabs>
    </div>
  );
}
