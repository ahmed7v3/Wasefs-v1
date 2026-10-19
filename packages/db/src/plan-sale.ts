import { and, eq, gt, isNull, lte, or, type SQL } from "drizzle-orm";

import { plans } from "./schema/index.js";

/**
 * "This plan is for sale at `at`": public, and inside its optional sale window
 * (`available_from <= at < available_until`). Every place that offers or sells a plan (catalog,
 * checkout, trials, the taste upsell) uses this one rule, so a scheduled plan appears and
 * disappears everywhere at the same moment. Admin views and current subscriptions do not.
 */
export function planOnSale(at: Date): SQL {
  return and(
    eq(plans.visibility, "public"),
    or(isNull(plans.availableFrom), lte(plans.availableFrom, at)),
    or(isNull(plans.availableUntil), gt(plans.availableUntil, at)),
  ) as SQL;
}

/** The same rule for a plan row already in memory. */
export function isPlanOnSale(
  plan: { visibility: string; availableFrom: Date | null; availableUntil: Date | null },
  at: Date,
): boolean {
  return (
    plan.visibility === "public" &&
    (plan.availableFrom === null || plan.availableFrom <= at) &&
    (plan.availableUntil === null || plan.availableUntil > at)
  );
}
