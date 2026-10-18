import {
  IDENTIFIER_PATTERN,
  LIVE_SUBSCRIPTION_STATUSES,
  PERSONAL_OFFER_KINDS,
  SUBSCRIPTION_EVENT_TYPES,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "@wasfa/shared/billing";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { orders } from "./billing.js";
import { idColumn, inList, matches, timestamps } from "./columns.js";
import { billingOwnerColumns, ownerCheck } from "./owner.js";
import { plans } from "./plans.js";
import { coupons, promotions } from "./promotions.js";
import { rxAnalyses } from "./rx.js";
import { users } from "./users.js";

/*
 * Subscriptions are prepaid periods (BILLING §7, Decision 1). `plan_assignments` stays the
 * effective-plan record the quota and credits code reads; each paid period creates or extends one
 * assignment row linked by `plan_assignments.subscription_id`.
 */

const liveStatuses = sql.raw(LIVE_SUBSCRIPTION_STATUSES.map((status) => `'${status}'`).join(", "));

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: idColumn(),
    ...billingOwnerColumns(),
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: text({ enum: SUBSCRIPTION_STATUSES }).notNull(),
    source: text({ enum: SUBSCRIPTION_SOURCES }).notNull(),
    currentPeriodStart: timestamp({ withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp({ withTimezone: true }).notNull(),
    monthsPaid: integer().notNull().default(0),
    lastOrderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    cancelAtPeriodEnd: boolean().notNull().default(false),
    canceledAt: timestamp({ withTimezone: true }),
    graceUntil: timestamp({ withTimezone: true }),
    // A scheduled downgrade: { planId, effectiveAt }.
    pendingChange: jsonb().$type<Record<string, unknown>>(),
    // What the owner agreed to pay, kept even after the catalog changes.
    priceSnapshot: jsonb().$type<Record<string, unknown>>(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("subscriptions", table),
    check("subscriptions_status_check", inList(table.status, SUBSCRIPTION_STATUSES)),
    check("subscriptions_source_check", inList(table.source, SUBSCRIPTION_SOURCES)),
    check(
      "subscriptions_period_check",
      sql`${table.currentPeriodEnd} > ${table.currentPeriodStart}`,
    ),
    check("subscriptions_months_paid_check", sql`${table.monthsPaid} >= 0`),
    // At most one subscription that still gives access per owner.
    uniqueIndex("subscriptions_owner_user_live_key")
      .on(table.ownerUserId)
      .where(sql`${table.status} in (${liveStatuses})`),
    uniqueIndex("subscriptions_owner_org_live_key")
      .on(table.ownerOrgId)
      .where(sql`${table.status} in (${liveStatuses})`),
    // The expiry and reminder jobs.
    index("subscriptions_period_end_idx")
      .on(table.currentPeriodEnd)
      .where(sql`${table.status} in (${liveStatuses})`),
  ],
);

/** Append-only timeline of a subscription (the `wasfa_api` role has SELECT and INSERT only, migration 0010). */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: idColumn(),
    subscriptionId: uuid()
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    type: text({ enum: SUBSCRIPTION_EVENT_TYPES }).notNull(),
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("subscription_events_type_check", inList(table.type, SUBSCRIPTION_EVENT_TYPES)),
    check("subscription_events_data_check", sql`jsonb_typeof(${table.data}) = 'object'`),
    index("subscription_events_subscription_created_idx").on(table.subscriptionId, table.createdAt),
    // Activation is idempotent per order, and refunds find the period an order bought.
    index("subscription_events_order_idx")
      .on(sql`(${table.data}->>'orderId')`)
      .where(sql`(${table.data}->>'orderId') is not null`),
  ],
);

/** A personal offer with a server-side deadline, so it is true in every tab (BILLING §9). User only. */
export const personalOffers = pgTable(
  "personal_offers",
  {
    id: idColumn(),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text({ enum: PERSONAL_OFFER_KINDS }).notNull(),
    // The discount template: a promotion or a coupon (at most one).
    promotionId: uuid().references(() => promotions.id, { onDelete: "set null" }),
    couponId: uuid().references(() => coupons.id, { onDelete: "set null" }),
    // Key of the lifecycle rule (`growth_rules.key`) that created the offer; no FK, it is a label for reports.
    ruleKey: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    shownCount: integer().notNull().default(0),
    dismissedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("personal_offers_kind_check", inList(table.kind, PERSONAL_OFFER_KINDS)),
    check(
      "personal_offers_template_check",
      sql`num_nonnulls(${table.promotionId}, ${table.couponId}) <= 1`,
    ),
    check("personal_offers_shown_count_check", sql`${table.shownCount} >= 0`),
    index("personal_offers_owner_expires_idx").on(table.ownerUserId, table.expiresAt),
  ],
);

/** Free single uses of a premium feature for a free user; one per owner, feature and period. */
export const tasteGrants = pgTable(
  "taste_grants",
  {
    id: idColumn(),
    ...billingOwnerColumns(),
    // The premium capability, e.g. `deep_mode`.
    feature: text().notNull(),
    // Idempotency: e.g. `2026-W42` or `2026-10`.
    periodKey: text().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    // The analysis the person tasted from, and the new premium-mode analysis of the same pages.
    sourceAnalysisId: uuid().references(() => rxAnalyses.id, { onDelete: "set null" }),
    analysisId: uuid().references(() => rxAnalyses.id, { onDelete: "set null" }),
    // Credits granted through the ledger (`trial_grant`, key `taste:<id>`): the cost of one taste.
    credits: integer().notNull().default(0),
  },
  (table) => [
    ownerCheck("taste_grants", table),
    check("taste_grants_credits_check", sql`${table.credits} >= 0`),
    index("taste_grants_analysis_idx")
      .on(table.analysisId)
      .where(sql`${table.analysisId} is not null`),
    check("taste_grants_feature_check", matches(table.feature, IDENTIFIER_PATTERN.source)),
    check("taste_grants_period_key_check", sql`char_length(${table.periodKey}) between 1 and 32`),
    check("taste_grants_expires_check", sql`${table.expiresAt} > ${table.grantedAt}`),
    uniqueIndex("taste_grants_owner_user_period_key").on(
      table.ownerUserId,
      table.feature,
      table.periodKey,
    ),
    uniqueIndex("taste_grants_owner_org_period_key").on(
      table.ownerOrgId,
      table.feature,
      table.periodKey,
    ),
  ],
);

/** In-app notification of a user (bell). The text comes from i18n keys + params, never stored prose. */
export const userNotifications = pgTable(
  "user_notifications",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    link: text(),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("user_notifications_kind_check", matches(table.kind, IDENTIFIER_PATTERN.source)),
    check("user_notifications_params_check", sql`jsonb_typeof(${table.params}) = 'object'`),
    index("user_notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("user_notifications_unread_idx")
      .on(table.userId)
      .where(sql`${table.readAt} is null`),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect;
export type NewSubscriptionEvent = typeof subscriptionEvents.$inferInsert;
export type PersonalOffer = typeof personalOffers.$inferSelect;
export type NewPersonalOffer = typeof personalOffers.$inferInsert;
export type TasteGrant = typeof tasteGrants.$inferSelect;
export type NewTasteGrant = typeof tasteGrants.$inferInsert;
export type UserNotification = typeof userNotifications.$inferSelect;
export type NewUserNotification = typeof userNotifications.$inferInsert;
