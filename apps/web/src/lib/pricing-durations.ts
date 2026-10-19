import { t } from "@wasfa/shared/i18n";
import { periodLabel } from "@wasfa/ui";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";

/*
 * Billing periods on the pricing page, read from the catalog only: whatever durations the admin
 * priced (1 to 24 months) are offered, nothing is assumed. Amounts are never computed here beyond
 * comparing the engine's own per-month figures.
 */

type Plan = CatalogResponse["plans"][number];
type Price = Plan["prices"][number];

/** Every period at least one plan is sold for, shortest first. */
export function offeredDurations(plans: readonly Plan[]): number[] {
  return [...new Set(plans.flatMap((plan) => plan.prices.map((price) => price.months)))].sort(
    (left, right) => left - right,
  );
}

/** The period the page opens on: a year when sold (the best monthly rate), else monthly, else the shortest. */
export function defaultDuration(durations: readonly number[]): number | null {
  if (durations.includes(12)) return 12;
  if (durations.includes(1)) return 1;
  return durations[0] ?? null;
}

/** The switcher label of a period: "شهري", "سنوي", or its length ("3 أشهر", "سنتان"…). */
export function durationLabel(months: number): string {
  if (months === 1) return t("billing.pricing.monthly");
  if (months === 12) return t("billing.pricing.annual");
  return periodLabel(months);
}

export interface PlanOffer {
  price: Price;
  /** False when the plan is not sold for the chosen period and its closest one is shown instead. */
  exact: boolean;
  /** Whole percent saved per month against the plan's own monthly price; 0 when none or unknown. */
  savingsPercent: number;
}

/** What a plan's card shows for a chosen period: that price, or the plan's closest period. */
export function planOffer(plan: Plan, months: number): PlanOffer | null {
  const exact = plan.prices.find((price) => price.months === months);
  const price =
    exact ??
    [...plan.prices].sort(
      (left, right) =>
        Math.abs(left.months - months) - Math.abs(right.months - months) ||
        right.months - left.months,
    )[0];
  if (!price) return null;
  return { price, exact: exact !== undefined, savingsPercent: savingsPercent(plan, price) };
}

/** Percent saved per month by `price` against the plan's one-month price (both after promotions). */
export function savingsPercent(plan: Plan, price: Price): number {
  if (price.months <= 1) return 0;
  const monthly = plan.prices.find((candidate) => candidate.months === 1);
  if (!monthly || monthly.display.headlineMinor <= 0) return 0;
  // Integer arithmetic: an exact 10% must not come out as 9.
  const saved = monthly.display.headlineMinor - price.display.perMonthMinor;
  return saved > 0 ? Math.floor((saved * 100) / monthly.display.headlineMinor) : 0;
}

/** The best saving any plan gives for a period: the hint next to that period in the switcher. */
export function bestSavingsPercent(plans: readonly Plan[], months: number): number {
  return Math.max(
    0,
    ...plans.flatMap((plan) => {
      const price = plan.prices.find((candidate) => candidate.months === months);
      return price ? [savingsPercent(plan, price)] : [];
    }),
  );
}
