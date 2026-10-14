"use client";

import { t } from "@wasfa/shared/i18n";
import { Tab, TabList, TabPanel, Tabs } from "@wasfa/ui";

import { EvalsReviewPanel } from "./evals-review-panel";
import { EvalsRunsPanel } from "./evals-runs-panel";
import { EvalsSetsPanel } from "./evals-sets-panel";

/** `/admin/ai/evals` (Task 2.10): runs and their comparison, label sets and import, review of user corrections. */
export function EvalsView() {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">{t("admin.evals.lead")}</p>
      <Tabs defaultValue="runs">
        <TabList aria-label={t("admin.evals.title")}>
          <Tab value="runs">{t("admin.evals.tab.runs")}</Tab>
          <Tab value="sets">{t("admin.evals.tab.sets")}</Tab>
          <Tab value="review">{t("admin.evals.tab.review")}</Tab>
        </TabList>
        <TabPanel value="runs" className="pt-5">
          <EvalsRunsPanel />
        </TabPanel>
        <TabPanel value="sets" className="pt-5">
          <EvalsSetsPanel />
        </TabPanel>
        <TabPanel value="review" className="pt-5">
          <EvalsReviewPanel />
        </TabPanel>
      </Tabs>
    </div>
  );
}
