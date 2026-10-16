import { z } from "zod";

import {
  BILLING_KEY_PATTERN,
  BILLING_MAX_MONTHS,
  BILLING_MIN_MONTHS,
  COUPON_CODE_PATTERN,
  CURRENCY_CODE_PATTERN,
  DISCOUNT_KINDS,
  DISCOUNT_STATUSES,
  MAX_BPS,
  PROMOTION_KINDS,
  STACKING_MODES,
} from "../billing.js";
import { PLAN_AUDIENCES, PLAN_KEY_PATTERN } from "../plans.js";

/*
 * Billing contract (Phase 3, Task 3.1). The client never sends a price: a quote request names the
 * plan, the period and optionally a coupon and a method; the server computes every number
 * (BILLING §1). Money is an integer count of minor units.
 */

const isoDate = z.iso.datetime({ offset: true });

export const currencyCodeSchema = z.string().regex(CURRENCY_CODE_PATTERN);
export const monthsSchema = z.number().int().min(BILLING_MIN_MONTHS).max(BILLING_MAX_MONTHS);
export const minorAmountSchema = z.number().int().min(0).max(1_000_000_000);
export const bpsSchema = z.number().int().min(0).max(MAX_BPS);

/** Trimmed and upper-cased before validation, so `" wasfa-10 "` and `"WASFA-10"` are the same code. */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(COUPON_CODE_PATTERN, "4-32 characters: A-Z, 0-9 and -");

export const paymentMethodKeySchema = z.string().regex(BILLING_KEY_PATTERN);

/** `POST /billing/quote` (and the order request built from a quote). */
export const quoteRequestSchema = z.object({
  planKey: z.string().max(40).regex(PLAN_KEY_PATTERN),
  months: monthsSchema,
  couponCode: couponCodeSchema.optional(),
  methodKey: paymentMethodKeySchema.optional(),
});
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

export const PLAN_FEATURES_MAX = 30;

/** `plans.features`: the ordered bullet list on a plan card. */
export const planFeatureSchema = z.strictObject({
  textAr: z.string().trim().min(1).max(160),
  textEn: z.string().trim().min(1).max(160),
  included: z.boolean(),
  highlight: z.boolean(),
});
export const planFeaturesSchema = z.array(planFeatureSchema).max(PLAN_FEATURES_MAX);
export type PlanFeature = z.output<typeof planFeatureSchema>;

// --- Promotions and coupons ---------------------------------------------------------------------

const discountScopeFields = {
  planIds: z.array(z.uuid()).max(50).default([]),
  months: z.array(monthsSchema).max(BILLING_MAX_MONTHS).default([]),
  audience: z.enum(PLAN_AUDIENCES).default("any"),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(250)
    .default([]),
  newCustomersOnly: z.boolean().default(false),
  minAmountMinor: minorAmountSchema.nullable().default(null),
};

const discountCommonFields = {
  name: z.string().trim().min(1).max(120),
  titleAr: z.string().trim().min(1).max(120),
  titleEn: z.string().trim().min(1).max(120),
  badgeAr: z.string().trim().min(1).max(24).nullable().default(null),
  badgeEn: z.string().trim().min(1).max(24).nullable().default(null),
  value: z.number().int().min(0).max(1_000_000_000),
  currency: currencyCodeSchema.nullable().default(null),
  ...discountScopeFields,
  startsAt: isoDate.nullable().default(null),
  endsAt: isoDate.nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(10_000_000).nullable().default(null),
  perOwnerLimit: z.number().int().min(1).max(1_000).nullable().default(null),
  stacking: z.enum(STACKING_MODES).default("exclusive"),
  priority: z.number().int().min(-10_000).max(10_000).default(0),
  status: z.enum(DISCOUNT_STATUSES).default("draft"),
};

interface DiscountShape {
  kind: string;
  value: number;
  currency: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** The cross-field rules the database also enforces by CHECK (value range per kind, currency only for `fixed`, period order). */
function refineDiscount(value: DiscountShape, ctx: z.RefinementCtx): void {
  if (value.kind === "percent" && (value.value < 1 || value.value > MAX_BPS)) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "percent is 1-10000 bps" });
  }
  if (value.kind !== "percent" && value.value < 1) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "must be positive" });
  }
  if ((value.kind === "fixed") !== (value.currency !== null)) {
    ctx.addIssue({
      code: "custom",
      path: ["currency"],
      message: "currency is required for fixed discounts and only for them",
    });
  }
  if (
    value.startsAt !== null &&
    value.endsAt !== null &&
    Date.parse(value.endsAt) <= Date.parse(value.startsAt)
  ) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "must be after startsAt" });
  }
}

export const createPromotionSchema = z
  .object({
    ...discountCommonFields,
    kind: z.enum(PROMOTION_KINDS),
    showOnPricing: z.boolean().default(false),
    showCountdown: z.boolean().default(false),
  })
  .superRefine(refineDiscount)
  .refine((value) => !value.showCountdown || value.endsAt !== null, {
    path: ["showCountdown"],
    message: "a countdown needs a real end date",
  });
export type CreatePromotionInput = z.output<typeof createPromotionSchema>;

/** Kind and value are fixed once a discount exists: redemptions reference what was promised. */
export const updatePromotionSchema = z
  .object({
    name: discountCommonFields.name,
    titleAr: discountCommonFields.titleAr,
    titleEn: discountCommonFields.titleEn,
    badgeAr: discountCommonFields.badgeAr,
    badgeEn: discountCommonFields.badgeEn,
    ...discountScopeFields,
    startsAt: discountCommonFields.startsAt,
    endsAt: discountCommonFields.endsAt,
    maxRedemptions: discountCommonFields.maxRedemptions,
    perOwnerLimit: discountCommonFields.perOwnerLimit,
    stacking: discountCommonFields.stacking,
    priority: discountCommonFields.priority,
    status: discountCommonFields.status,
    showOnPricing: z.boolean(),
    showCountdown: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field");
export type UpdatePromotionInput = z.output<typeof updatePromotionSchema>;

export const createCouponSchema = z
  .object({
    ...discountCommonFields,
    kind: z.enum(DISCOUNT_KINDS),
    code: couponCodeSchema,
    targetUserId: z.uuid().nullable().default(null),
    targetOrgId: z.uuid().nullable().default(null),
    campaign: z.string().trim().min(1).max(80).nullable().default(null),
    referralCodeId: z.uuid().nullable().default(null),
    batch: z.string().trim().min(1).max(80).nullable().default(null),
  })
  .superRefine(refineDiscount)
  .refine((value) => value.targetUserId === null || value.targetOrgId === null, {
    path: ["targetOrgId"],
    message: "a coupon targets a user or an organization, not both",
  });
export type CreateCouponInput = z.output<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    name: discountCommonFields.name,
    titleAr: discountCommonFields.titleAr,
    titleEn: discountCommonFields.titleEn,
    badgeAr: discountCommonFields.badgeAr,
    badgeEn: discountCommonFields.badgeEn,
    ...discountScopeFields,
    startsAt: discountCommonFields.startsAt,
    endsAt: discountCommonFields.endsAt,
    maxRedemptions: discountCommonFields.maxRedemptions,
    perOwnerLimit: discountCommonFields.perOwnerLimit,
    stacking: discountCommonFields.stacking,
    priority: discountCommonFields.priority,
    status: discountCommonFields.status,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field");
export type UpdateCouponInput = z.output<typeof updateCouponSchema>;
