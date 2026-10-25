"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";

import type { ReactNode } from "react";

export const PANEL_TABS = ["publish", "seo", "media", "review", "history"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export const PANEL_LABELS: Record<PanelTab, MessageKey> = {
  publish: "admin.editor.tab.publish",
  seo: "admin.editor.tab.seo",
  media: "admin.editor.tab.media",
  review: "admin.editor.tab.review",
  history: "admin.editor.tab.history",
};

export interface EditorPanelProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** Tabs available now (a new item has no review or history yet). */
  tabs: readonly PanelTab[];
  /** Only the active tab renders its content: History and Review fetch on open, not at page load. */
  render: (tab: PanelTab) => ReactNode;
}

export function EditorPanel({ tab, onTabChange, tabs, render }: EditorPanelProps) {
  const active = tabs.includes(tab) ? tab : (tabs[0] ?? "publish");
  return (
    <Tabs
      value={active}
      onValueChange={(next) => {
        onTabChange(next as PanelTab);
      }}
    >
      <TabList aria-label={t("admin.editor.panel.label")}>
        {tabs.map((name) => (
          <Tab key={name} value={name}>
            {t(PANEL_LABELS[name])}
          </Tab>
        ))}
      </TabList>
      {tabs.map((name) => (
        <TabPanel key={name} value={name}>
          {name === active ? render(name) : null}
        </TabPanel>
      ))}
    </Tabs>
  );
}
