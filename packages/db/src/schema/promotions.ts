import {
  COUPON_CODE_PATTERN,
  COUPON_REDEMPTION_STATUSES,
  CURRENCY_CODE_PATTERN,
  DISCOUNT_KINDS,
  DISCOUNT_STATUSES,
  MAX_BPS,
  PROMOTION_KINDS,
  STACKING_MODES,
} from "@wasfa/shared/billing";
import { PLAN_AUDIENCES } from "@wasfa/shared/plans";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { orders } from "./billing.js";
import { idColumn, inList, matches, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { billingOwnerColumns, ownerCheck } from "./owner.js";
import { referralCodes } from "./referral-codes.js";
import { users } from "./users.js";

/*
 * Promotions (automatic) and coupons (typed or followed) are both discount definitions
 * (BILLING §3); they share their columns and rules. Percentages are basis points; `fixed` amounts
 * are minor units of `currency`; `bonus_credits` is a credit count; `extra_months` a month count;
 * `trial_extension` (coupons only) a day count.
 */
const discountColumns = () => ({
  name: text().notNull(),
  titleAr: text().notNull(),
  titleEn: text().notNull(),
  badgeAr: text(),
  badgeEn: text(),
  value: integer().notNull(),
  // Only for `fixed`.
  currency: text(),
  // Scope: empty arrays mean "any".
  planIds: uuid()
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  months: integer()
    .array()
    .notNull()
    .default(sql`'{}'::integer[]`),
  audience: text({ enum: PLAN_AUDIENCES }).notNull().default("any"),
  countries: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  newCustomersOnly: boolean().notNull().default(false),
  minAmountMinor: integer(),
  startsAt: timestamp({ withTimezone: true }),
  endsAt: timestamp({ withTimezone: true }),
  maxRedemptions: integer(),
  perOwnerLimit: integer(),
  redeemedCount: integer().notNull().default(0),
  stacking: text({ enum: STACKING_MODES }).notNull().default("exclusive"),
  priority: integer().notNull().default(0),
  status: text({ enum: DISCOUNT_STATUSES }).notNull().default("draft"),
  createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

interface DiscountTable {
  kind: AnyPgColumn;
  value: AnyPgColumn;
  currency: AnyPgColumn;
  audience: AnyPgColumn;
  minAmountMinor: AnyPgColumn;
  startsAt: AnyPgColumn;
  endsAt: AnyPgColumn;
  maxRedemptions: AnyPgColumn;
  perOwnerLimit: AnyPgColumn;
  redeemedCount: AnyPgColumn;
  stacking: AnyPgColumn;
  status: AnyPgColumn;
}

/** The CHECKs both tables share, named `<table>_<rule>_check`. `kinds` differs: promotions exclude `trial_extension`. */
function discountChecks(tableName: string, table: DiscountTable, kinds: readonly string[]) {
  return [
    check(`${tableName}_kind_check`, inList(table.kind, kinds)),
    check(
      `${tableName}_value_check`,
      sql`${table.value} >= 0 and (${table.kind} <> 'percent' or ${table.value} between 1 and ${sql.raw(String(MAX_BPS))})`,
    ),
    // A currency exists exactly for a fixed amount.
    check(
      `${tableName}_currency_check`,
      sql`(${table.kind} = 'fixed') = (${table.currency} is not null) and (${table.currency} is null or ${matches(table.currency, CURRENCY_CODE_PATTERN.source)})`,
    ),
    check(`${tableName}_audience_check`, inList(table.audience, PLAN_AUDIENCES)),
    check(
      `${tableName}_min_amount_check`,
      sql`${table.minAmountMinor} is null or ${table.minAmountMinor} >= 0`,
    ),
    check(
      `${tableName}_period_check`,
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      `${tableName}_max_redemptions_check`,
      sql`${table.maxRedemptions} is null or ${table.maxRedemptions} > 0`,
    ),
    check(
      `${tableName}_per_owner_limit_check`,
      sql`${table.perOwnerLimit} is null or ${table.perOwnerLimit} > 0`,
    ),
    check(
      `${tableName}_redeemed_count_check`,
      sql`${table.redeemedCount} >= 0 and (${table.maxRedemptions} is null or ${table.redeemedCount} <= ${table.maxRedemptions})`,
    ),
    check(`${tableName}_stacking_check`, inList(table.stacking, STACKING_MODES)),
    check(`${tableName}_status_check`, inList(table.status, DISCOUNT_STATUSES)),
  ];
}

/** Applies automatically; shown on the pricing page when `show_on_pricing`. */
export const promotions = pgTable(
  "promotions",
  {
    id: idColumn(),
    kind: text({ enum: PROMOTION_KINDS }).notNull(),
    ...discountColumns(),
    showOnPricing: boolean().notNull().default(false),
    // A countdown is shown only for a real, enforced `ends_at`.
    showCountdown: boolean().notNull().default(false),
  },
  (table) => [
    ...discountChecks("promotions", table, PROMOTION_KINDS),
    check(
      "promotions_countdown_check",
      sql`not ${table.showCountdown} or ${table.endsAt} is not null`,
    ),
    // The scheduler flips scheduled -> active -> ended by the clock.
    index("promotions_status_starts_idx").on(table.status, table.startsAt),
  ],
);

/** Typed or followed by the customer; may target one user or organization. */
export const coupons = pgTable(
  "coupons",
  {
    id: idColumn(),
    code: text().notNull().unique("coupons_code_key"),
    kind: text({ enum: DISCOUNT_KINDS }).notNull(),
    ...discountColumns(),
    // Private coupons: a coupon is meaningless without its target, so these cascade.
    targetUserId: uuid().references(() => users.id, { onDelete: "cascade" }),
    targetOrgId: uuid().references(() => organizations.id, { onDelete: "cascade" }),
    campaign: text(),
    // Granted to everyone who signed up with this referral code.
    referralCodeId: uuid().references(() => referralCodes.id, { onDelete: "cascade" }),
    // Bulk generation: a batch can be exported and paused as one.
    batch: text(),
  },
  (table) => [
    ...discountChecks("coupons", table, DISCOUNT_KINDS),
    check("coupons_code_check", matches(table.code, COUPON_CODE_PATTERN.source)),
    check(
      "coupons_target_check",
      sql`num_nonnulls(${table.targetUserId}, ${table.targetOrgId}) <= 1`,
    ),
    index("coupons_batch_idx")
      .on(table.batch)
      .where(sql`${table.batch} is not null`),
  ],
);

/**
 * Reserved when an order is created (counter incremented under a row lock), confirmed on payment
 * success and released when the order expires or is canceled. One per coupon and order.
 */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: idColumn(),
    couponId: uuid()
      .notNull()
      .references(() => coupons.id, { onDelete: "restrict" }),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    ...billingOwnerColumns(),
    status: text({ enum: COUPON_REDEMPTION_STATUSES }).notNull().default("reserved"),
    reservedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp({ withTimezone: true }),
    releasedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    ownerCheck("coupon_redemptions", table),
    unique("coupon_redemptions_coupon_order_key").on(table.couponId, table.orderId),
    check("coupon_redemptions_status_check", inList(table.status, COUPON_REDEMPTION_STATUSES)),
    // The per-owner limit counts a coupon's live redemptions by owner.
    index("coupon_redemptions_coupon_owner_user_idx").on(table.couponId, table.ownerUserId),
    index("coupon_redemptions_coupon_owner_org_idx").on(table.couponId, table.ownerOrgId),
    index("coupon_redemptions_order_idx").on(table.orderId),
  ],
);

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
export type Coupon = typeof coupons.$inferSelect;
export type NewCoupon = typeof coupons.$inferInsert;
export type CouponRedemption = typeof couponRedemptions.$inferSelect;
export type NewCouponRedemption = typeof couponRedemptions.$inferInsert;
