import { t } from "@wasfa/shared/i18n";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { ComparisonColumn, ComparisonRow } from "@wasfa/ui";

type Plan = CatalogResponse["plans"][number];

export interface ComparisonModel {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

/**
 * The comparison table from the catalog alone: the plan facts (credits, members, trial) and one row
 * per feature text any plan lists. The free plan's column only fills the rows the settings state
 * (its monthly analyses); for the others it shows a dash rather than claiming something untrue.
 */
export function comparisonModel(
  plans: readonly Plan[],
  freeMonthlyAnalyses: number,
): ComparisonModel {
  const columns: ComparisonColumn[] = [
    { key: "free", name: t("billing.plan.free.name") },
    ...plans.map((plan) => ({
      key: plan.key,
      name: plan.names.ar,
      highlighted: plan.pinRecommended || undefined,
    })),
  ];

  const rows: ComparisonRow[] = [
    {
      key: "credits",
      label: t("billing.compare.credits"),
      cells: [
        t("billing.plan.free.analyses", { count: freeMonthlyAnalyses }),
        ...plans.map((plan) => t("billing.plan.monthlyCredits", { count: plan.monthlyCredits })),
      ],
    },
  ];

  if (plans.some((plan) => plan.maxMembers !== null)) {
    rows.push({
      key: "members",
      label: t("billing.compare.members"),
      cells: [
        null,
        ...plans.map((plan) => (plan.maxMembers === null ? null : String(plan.maxMembers))),
      ],
    });
  }

  rows.push({
    key: "trial",
    label: t("billing.compare.trial"),
    cells: [
      null,
      ...plans.map((plan) =>
        plan.trialDays > 0 ? t("billing.compare.trialDays", { days: plan.trialDays }) : false,
      ),
    ],
  });

  const seen = new Set<string>();
  for (const plan of plans) {
    for (const feature of plan.features) {
      if (seen.has(feature.textAr)) continue;
      seen.add(feature.textAr);
      rows.push({
        key: `feature-${feature.textAr}`,
        label: feature.textAr,
        cells: [
          null,
          ...plans.map((candidate) => {
            const found = candidate.features.find((entry) => entry.textAr === feature.textAr);
            return found ? found.included : false;
          }),
        ],
      });
    }
  }

  return { columns, rows };
}
