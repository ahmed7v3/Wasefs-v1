"use client";

import { t } from "@wasfa/shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";

import { useUrlParams } from "../../lib/use-url-params";

import { ContentCategoriesPanel } from "./content-categories-panel";
import { ContentTagsPanel } from "./content-tags-panel";

export interface ContentTaxonomyViewProps {
  permissions: readonly string[];
}

type TaxonomyTab = "categories" | "tags";

/** Categories | Tags, the tab kept in the URL so a link opens the right one. */
export function ContentTaxonomyView({ permissions }: ContentTaxonomyViewProps) {
  const url = useUrlParams();
  const tab: TaxonomyTab = url.get("tab") === "tags" ? "tags" : "categories";
  const canManage = permissions.includes("content.manage");

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        url.update({ tab: next === "categories" ? null : next });
      }}
    >
      <TabList aria-label={t("admin.nav.content.taxonomy")}>
        <Tab value="categories">{t("admin.content.tab.categories")}</Tab>
        <Tab value="tags">{t("admin.content.tab.tags")}</Tab>
      </TabList>
      <TabPanel value="categories">
        {tab === "categories" ? <ContentCategoriesPanel canManage={canManage} /> : null}
      </TabPanel>
      <TabPanel value="tags">
        {tab === "tags" ? <ContentTagsPanel canManage={canManage} /> : null}
      </TabPanel>
    </Tabs>
  );
}
