import { t, type Locale } from "@wasfa/shared/i18n";

import { featureText } from "./pricing-durations";

import type { CatalogFreePlan, CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { ComparisonColumn, ComparisonRow } from "@wasfa/ui";

type Plan = CatalogResponse["plans"][number];

export interface ComparisonModel {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

/**
 * The comparison table from the catalog alone: the plan facts (credits, members, trial) and one row
 * per feature text any plan lists. The free plan (the admin's default plan, when it is on sale) is
 * the first column and is compared like the others; facts that do not apply to it show a dash.
 */
export function comparisonModel(
  plans: readonly Plan[],
  free: CatalogFreePlan | null,
  locale: Locale = "ar",
): ComparisonModel {
  const pad = <T>(value: T): T[] => (free ? [value] : []);
  const columns: ComparisonColumn[] = [
    ...(free ? [{ key: free.key, name: free.names[locale] }] : []),
    ...plans.map((plan) => ({
      key: plan.key,
      name: plan.names[locale],
      highlighted: plan.pinRecommended || undefined,
    })),
  ];

  const rows: ComparisonRow[] = [
    {
      key: "credits",
      label: t("billing.compare.credits", undefined, locale),
      cells: [
        ...(free ? [t("billing.plan.monthlyCredits", { count: free.monthlyCredits }, locale)] : []),
        ...plans.map((plan) =>
          t("billing.plan.monthlyCredits", { count: plan.monthlyCredits }, locale),
        ),
      ],
    },
  ];

  if (plans.some((plan) => plan.maxMembers !== null)) {
    rows.push({
      key: "members",
      label: t("billing.compare.members", undefined, locale),
      cells: [
        ...pad(null),
        ...plans.map((plan) => (plan.maxMembers === null ? null : String(plan.maxMembers))),
      ],
    });
  }

  if (plans.some((plan) => plan.trialDays > 0)) {
    rows.push({
      key: "trial",
      label: t("billing.compare.trial", undefined, locale),
      cells: [
        ...pad(null),
        ...plans.map((plan) =>
          plan.trialDays > 0
            ? t("billing.compare.trialDays", { days: plan.trialDays }, locale)
            : false,
        ),
      ],
    });
  }

  const all = [...(free ? [free] : []), ...plans];
  const seen = new Set<string>();
  for (const plan of all) {
    for (const feature of plan.features) {
      if (seen.has(feature.textAr)) continue;
      seen.add(feature.textAr);
      rows.push({
        key: `feature-${feature.textAr}`,
        label: featureText(feature, locale),
        cells: all.map((candidate) => {
          const found = candidate.features.find((entry) => entry.textAr === feature.textAr);
          return found ? found.included : false;
        }),
      });
    }
  }

  return { columns, rows };
}
