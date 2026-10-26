"use client";

import { t } from "@wasfa/shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";
import { useState } from "react";

import { WaAgentInboxTab } from "./wa-agent-inbox";
import { WaAgentSettingsTab } from "./wa-agent-settings";
import { WaAgentUsageTab } from "./wa-agent-usage";

type TabId = "settings" | "inbox" | "usage";

export interface WaAgentViewProps {
  /** `wa_agent.write`: change settings, pause, resume, block, set the voice key. */
  canWrite: boolean;
  /** `wa_agent.inbox`: the Inbox tab exists only for holders (transcripts are health data). */
  canInbox: boolean;
  /** `plans.read`: lets the discount policy pick plans from a list. */
  canReadPlans: boolean;
}

/** `/admin/whatsapp/agent`: the Settings, Inbox and Usage tabs of the WhatsApp AI agent. */
export function WaAgentView({ canWrite, canInbox, canReadPlans }: WaAgentViewProps) {
  const [tab, setTab] = useState<TabId>("settings");
  const select = (value: string) => {
    setTab(value === "inbox" && canInbox ? "inbox" : value === "usage" ? "usage" : "settings");
  };

  return (
    <Tabs value={tab} onValueChange={select} className="flex flex-col gap-5">
      <TabList aria-label={t("admin.waAgent.tabs")}>
        <Tab value="settings">{t("admin.waAgent.tab.settings")}</Tab>
        {canInbox ? <Tab value="inbox">{t("admin.waAgent.tab.inbox")}</Tab> : null}
        <Tab value="usage">{t("admin.waAgent.tab.usage")}</Tab>
      </TabList>
      <TabPanel value="settings">
        {tab === "settings" ? (
          <WaAgentSettingsTab canWrite={canWrite} canReadPlans={canReadPlans} />
        ) : null}
      </TabPanel>
      {canInbox ? (
        <TabPanel value="inbox">
          {tab === "inbox" ? <WaAgentInboxTab canWrite={canWrite} /> : null}
        </TabPanel>
      ) : null}
      <TabPanel value="usage">{tab === "usage" ? <WaAgentUsageTab /> : null}</TabPanel>
    </Tabs>
  );
}
