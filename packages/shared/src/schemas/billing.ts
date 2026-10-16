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
  ORDER_KINDS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHOD_KINDS,
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

/** `POST /billing/quote` for a plan period. */
export const planQuoteRequestSchema = z.object({
  planKey: z.string().max(40).regex(PLAN_KEY_PATTERN),
  months: monthsSchema,
  couponCode: couponCodeSchema.optional(),
  methodKey: paymentMethodKeySchema.optional(),
});
/** `POST /billing/quote` for a credit pack: no promotions, coupons or proration apply to packs. */
export const packQuoteRequestSchema = z.strictObject({
  packKey: z.string().regex(BILLING_KEY_PATTERN),
  methodKey: paymentMethodKeySchema.optional(),
});
export const quoteRequestSchema = z.union([packQuoteRequestSchema, planQuoteRequestSchema]);
export type PlanQuoteRequest = z.output<typeof planQuoteRequestSchema>;
export type PackQuoteRequest = z.output<typeof packQuoteRequestSchema>;
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

/** What a quote buys; stored with the quote and signed with it, so checkout cannot swap it. */
export const quoteTargetSchema = z.object({
  kind: z.enum(["subscription", "upgrade", "credit_pack"]),
  key: z.string(),
  planId: z.uuid().nullable(),
  packId: z.uuid().nullable(),
  months: monthsSchema.nullable(),
});
export type QuoteTarget = z.output<typeof quoteTargetSchema>;

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

// --- Catalog, quote and recommendation responses (Task 3.2) -----------------------------------------
// Responses are parsed with these schemas before they leave the API, so a column added to a table
// can never reach the public catalog by accident.

/** `?currency=` and `?country=`: free text on purpose, an unknown value falls back instead of failing. */
export const marketQuerySchema = z.object({
  currency: z.string().max(16).optional(),
  country: z.string().max(8).optional(),
});
export type MarketQuery = z.output<typeof marketQuerySchema>;

const localizedSchema = z.object({ ar: z.string(), en: z.string() });

export const catalogPriceSchema = z.object({
  months: monthsSchema,
  amountMinor: minorAmountSchema,
  /** Id of the promotion this price already includes, for the card badge. */
  promotionId: z.uuid().nullable(),
  display: z.object({
    headlineMinor: minorAmountSchema,
    struckMinor: minorAmountSchema.nullable(),
    savingsMinor: minorAmountSchema,
    perMonthMinor: minorAmountSchema,
  }),
});

export const catalogPlanSchema = z.object({
  key: z.string(),
  audience: z.enum(PLAN_AUDIENCES),
  names: localizedSchema,
  tagline: localizedSchema.nullable(),
  features: planFeaturesSchema,
  badge: localizedSchema.nullable(),
  pinRecommended: z.boolean(),
  trialDays: z.number().int().min(0),
  monthlyCredits: z.number().int().min(0),
  maxMembers: z.number().int().positive().nullable(),
  fairUseNote: localizedSchema.nullable(),
  prices: z.array(catalogPriceSchema),
  /** 12 x the monthly price minus the 12-month price, when both exist and it is not negative. */
  annualSavingsMinor: minorAmountSchema.optional(),
});

export const catalogPromotionSchema = z.object({
  id: z.uuid(),
  title: localizedSchema,
  badge: localizedSchema.nullable(),
  /** Only when the promotion has `show_countdown`; always a real, enforced end. */
  endsAt: z.string().nullable(),
});

export const catalogCreditPackSchema = z.object({
  key: z.string(),
  names: localizedSchema,
  credits: z.number().int().positive(),
  bonusCredits: z.number().int().min(0),
  validMonths: z.number().int().positive(),
  amountMinor: minorAmountSchema,
});

export const catalogMethodSchema = z.object({
  key: z.string(),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  names: localizedSchema,
  feeBps: bpsSchema,
  feeFixedMinor: minorAmountSchema,
  feeFree: z.boolean(),
});

export const catalogResponseSchema = z.object({
  currency: currencyCodeSchema,
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  plans: z.array(catalogPlanSchema),
  promotions: z.array(catalogPromotionSchema),
  creditPacks: z.array(catalogCreditPackSchema),
  tax: z.object({ mode: z.enum(["inclusive", "added", "none"]) }),
  methods: z.array(catalogMethodSchema),
  billing: z.object({
    trialAvailable: z.boolean(),
    reviewSlaMinutes: z.number().int(),
    refundWindowDays: z.number().int(),
  }),
});
export type CatalogResponse = z.output<typeof catalogResponseSchema>;
export type CatalogPlan = z.output<typeof catalogPlanSchema>;

const quoteLineSchema = z.object({
  kind: z.enum(["plan", "discount", "proration", "adjustment", "tax", "fee", "bonus"]),
  labelKey: z.string(),
  amountMinor: z.number().int(),
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

/** Mirror of the engine's `PriceQuote`; the engine stays the source of truth. */
export const priceQuoteSchema = z.object({
  quoteVersion: z.literal(1),
  planKey: z.string(),
  months: monthsSchema,
  currency: currencyCodeSchema,
  lines: z.array(quoteLineSchema),
  listPriceMinor: minorAmountSchema,
  subtotalMinor: minorAmountSchema,
  taxMinor: minorAmountSchema,
  taxAddedMinor: minorAmountSchema,
  taxIncludedMinor: minorAmountSchema,
  taxMode: z.enum(["added", "inclusive"]).nullable(),
  feeMinor: minorAmountSchema,
  totalMinor: minorAmountSchema,
  methodKey: z.string().nullable(),
  methodOptions: z.array(
    z.object({
      key: z.string(),
      feeMinor: z.number().int(),
      totalMinor: minorAmountSchema,
      available: z.boolean(),
    }),
  ),
  isFreeOrder: z.boolean(),
  grants: z.object({
    bonusCredits: z.number().int().min(0),
    extraMonths: z.number().int().min(0),
  }),
  applied: z.object({
    dealId: z.string().optional(),
    promotionId: z.string().optional(),
    couponId: z.string().optional(),
    personalOfferId: z.string().optional(),
  }),
  display: z.object({
    headlineMinor: minorAmountSchema,
    struckMinor: minorAmountSchema.nullable(),
    savingsMinor: z.number().int(),
    savingsBps: z.number().int(),
    perMonthMinor: minorAmountSchema,
    feeLine: z.object({
      amountMinor: minorAmountSchema,
      show: z.boolean(),
      items: z.array(z.object({ kind: z.enum(["tax", "fee"]), amountMinor: minorAmountSchema })),
    }),
    buttonTotalMinor: minorAmountSchema,
  }),
  expiresAt: z.string(),
});

/** `applied` and `not_applied` are for a usable code; every refusal is one generic `invalid`. */
export const COUPON_OUTCOMES = ["applied", "not_applied", "invalid"] as const;
export const couponOutcomeSchema = z.object({
  status: z.enum(COUPON_OUTCOMES),
  /** Only for a code that exists, is meant for the caller and starts later. */
  startsAt: z.string().optional(),
});
export type CouponOutcome = z.output<typeof couponOutcomeSchema>;

export const quoteResponseSchema = z.object({
  quoteId: z.uuid(),
  quote: priceQuoteSchema,
  target: quoteTargetSchema,
  coupon: couponOutcomeSchema.nullable(),
});
export type QuoteResponse = z.output<typeof quoteResponseSchema>;

// --- Orders (Task 3.3) --------------------------------------------------------------------------

/** `POST /billing/orders`: the client names a stored quote and the method it was priced with. */
export const createOrderSchema = z.strictObject({
  quoteId: z.uuid(),
  methodKey: paymentMethodKeySchema.optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
});
export type CreateOrderInput = z.output<typeof createOrderSchema>;

export const createOrderResponseSchema = z.object({
  orderId: z.uuid(),
  orderNumber: z.string(),
  status: z.enum(ORDER_STATUSES),
  /** Gateway methods: where to send the customer. Manual methods and free orders: null. */
  redirectUrl: z.string().nullable(),
  payment: z
    .object({
      id: z.uuid(),
      reference: z.string(),
      methodKey: z.string(),
      status: z.enum(PAYMENT_STATUSES),
      amountMinor: minorAmountSchema,
      currency: currencyCodeSchema,
    })
    .nullable(),
});
export type CreateOrderResponse = z.output<typeof createOrderResponseSchema>;

export const orderIdParamSchema = z.object({ id: z.uuid() });

/** `GET /billing/orders/:id`: a status read for the return page; it never changes anything. */
export const orderStatusResponseSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  kind: z.enum(ORDER_KINDS),
  status: z.enum(ORDER_STATUSES),
  currency: currencyCodeSchema,
  totalMinor: minorAmountSchema,
  expiresAt: z.string(),
  paidAt: z.string().nullable(),
  payments: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      methodKey: z.string(),
      status: z.enum(PAYMENT_STATUSES),
      failureCode: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type OrderStatusResponse = z.output<typeof orderStatusResponseSchema>;

export const recommendationResponseSchema = z.object({
  usage30dCredits: z.number().int().min(0),
  currency: currencyCodeSchema,
  recommended: z
    .object({
      planKey: z.string(),
      months: z.literal(1),
      amountMinor: minorAmountSchema,
      perCreditMinor: minorAmountSchema,
    })
    .nullable(),
  packPerCreditMinor: minorAmountSchema.nullable(),
  currentPlanKey: z.string(),
});
export type RecommendationResponse = z.output<typeof recommendationResponseSchema>;
