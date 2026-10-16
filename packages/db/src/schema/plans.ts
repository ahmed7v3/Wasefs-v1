import { AI_MODES, AI_TASKS } from "@wasfa/shared/ai";
import { PLAN_AUDIENCES, PLAN_KEY_PATTERN, PLAN_VISIBILITIES } from "@wasfa/shared/plans";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { PLAN_FEATURES_MAX, type PlanFeature } from "@wasfa/shared/schemas/billing";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { arrayWithin, idColumn, inList, matches, timestamps } from "./columns.js";
import { ownerCheck, ownerColumns } from "./owner.js";
import { subscriptions } from "./subscriptions.js";
import { users } from "./users.js";

/*
 * What a user or organization may do with the AI product. Plans are platform data edited from the
 * admin panel; a plan's allowances live in `plan_entitlements` (one row per task). An owner with no
 * open `plan_assignments` row is on the default plan (`is_default`).
 */
export const plans = pgTable(
  "plans",
  {
    id: idColumn(),
    key: text().notNull().unique("plans_key_key"),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    audience: text({ enum: PLAN_AUDIENCES }).notNull().default("any"),
    isDefault: boolean().notNull().default(false),
    // Credits granted every month, as an integer count of credits.
    monthlyCredits: integer().notNull().default(0),
    visibility: text({ enum: PLAN_VISIBILITIES }).notNull().default("public"),
    sort: integer().notNull().default(0),
    badgeAr: text(),
    badgeEn: text(),
    // Phase 3 (BILLING §2.1): marketing copy and the pricing-page card.
    taglineAr: text(),
    taglineEn: text(),
    // Ordered bullet list; shape guarded by `planFeaturesSchema`.
    features: jsonb().$type<PlanFeature[]>().notNull().default([]),
    trialDays: integer().notNull().default(0),
    pinRecommended: boolean().notNull().default(false),
    // Seat limit of an organization plan (null = no limit).
    maxMembers: integer(),
    fairUseNoteAr: text(),
    fairUseNoteEn: text(),
    ...timestamps(),
  },
  (table) => [
    check("plans_key_check", matches(table.key, PLAN_KEY_PATTERN.source)),
    check("plans_audience_check", inList(table.audience, PLAN_AUDIENCES)),
    check("plans_visibility_check", inList(table.visibility, PLAN_VISIBILITIES)),
    check("plans_monthly_credits_check", sql`${table.monthlyCredits} >= 0`),
    check(
      "plans_features_check",
      sql`case when jsonb_typeof(${table.features}) = 'array' then jsonb_array_length(${table.features}) <= ${sql.raw(String(PLAN_FEATURES_MAX))} else false end`,
    ),
    check("plans_trial_days_check", sql`${table.trialDays} between 0 and 365`),
    check("plans_max_members_check", sql`${table.maxMembers} is null or ${table.maxMembers} > 0`),
    // At most one default plan; the service guarantees there is one.
    uniqueIndex("plans_one_default_idx")
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

/** Plan x task allowances. One row per task the plan configures. */
export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    task: text({ enum: AI_TASKS }).notNull(),
    allowed: boolean().notNull().default(true),
    modes: text({ enum: AI_MODES }).array().notNull(),
    // Null = unlimited.
    dailyCap: integer(),
    monthlyCap: integer(),
    maxPagesPerRx: integer().notNull().default(1),
    webSearch: boolean().notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.planId, table.task], name: "plan_entitlements_pkey" }),
    check("plan_entitlements_task_check", inList(table.task, AI_TASKS)),
    check("plan_entitlements_modes_check", arrayWithin(table.modes, AI_MODES)),
    check(
      "plan_entitlements_daily_cap_check",
      sql`${table.dailyCap} is null or ${table.dailyCap} >= 0`,
    ),
    check(
      "plan_entitlements_monthly_cap_check",
      sql`${table.monthlyCap} is null or ${table.monthlyCap} >= 0`,
    ),
    check(
      "plan_entitlements_max_pages_check",
      sql`${table.maxPagesPerRx} between 1 and ${sql.raw(String(RX_MAX_PAGES))}`,
    ),
  ],
);

/**
 * Which plan an owner is on, and for how long. Manual in Phase 2; subscriptions replace it in
 * Phase 3. No row (or none open now) means the default plan. `ends_at` null = open-ended.
 */
export const planAssignments = pgTable(
  "plan_assignments",
  {
    id: idColumn(),
    ...ownerColumns(),
    // RESTRICT: a plan that someone is on cannot be deleted, only hidden.
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    startsAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp({ withTimezone: true }),
    assignedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    reason: text(),
    // The subscription period this assignment realises (null for manual assignments).
    subscriptionId: uuid().references(() => subscriptions.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    ownerCheck("plan_assignments", table),
    check(
      "plan_assignments_period_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    index("plan_assignments_owner_user_starts_idx").on(table.ownerUserId, table.startsAt),
    index("plan_assignments_owner_org_starts_idx").on(table.ownerOrgId, table.startsAt),
    index("plan_assignments_subscription_idx")
      .on(table.subscriptionId)
      .where(sql`${table.subscriptionId} is not null`),
  ],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanEntitlement = typeof planEntitlements.$inferSelect;
export type NewPlanEntitlement = typeof planEntitlements.$inferInsert;
export type PlanAssignment = typeof planAssignments.$inferSelect;
export type NewPlanAssignment = typeof planAssignments.$inferInsert;
