/*
 * Closed value sets for plans (Phase 2, Task 2.1). Same rule as `identity.ts`: one tuple types the
 * column, builds the DB CHECK and drives the zod schemas and admin forms, so they cannot drift.
 */

/** Who a plan is for: individual accounts, organization accounts, or both. */
export const PLAN_AUDIENCES = ["individual", "organization", "any"] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

/** `hidden` plans are not listed in the plan picker; they are assigned by hand (pilots). */
export const PLAN_VISIBILITIES = ["public", "hidden"] as const;
export type PlanVisibility = (typeof PLAN_VISIBILITIES)[number];

/** Shape every plan key must have; the DB enforces the same rule with a CHECK. */
export const PLAN_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
