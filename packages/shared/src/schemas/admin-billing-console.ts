import { z } from "zod";

import {
  BILLING_KEY_PATTERN,
  CURRENCY_CODE_PATTERN,
  ORDER_KINDS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
  TAX_APPLIES_TO,
  TAX_MODES,
} from "../billing.js";

/*
 * Admin billing console (Task 3.8): the queries, bodies and responses of the overview, records,
 * subscriptions, catalog and search routes. Money is integer minor units; any total that spans
 * orders is a `Record<currency, number>` and is never summed across currencies.
 */

const paging = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
};

/** Query strings carry booleans as text; `z.coerce.boolean()` would make "false" true. */
const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");
const reasonSchema = z.string().trim().min(3).max(500);
const currencySchema = z.string().regex(CURRENCY_CODE_PATTERN);
const countrySchema = z.string().regex(/^[A-Z]{2}$/);

export const adminConsoleIdSchema = z.object({ id: z.uuid() });
export const adminConsoleKeySchema = z.object({ key: z.string().regex(BILLING_KEY_PATTERN) });
export const adminSearchQuerySchema = z.object({ q: z.string().trim().min(2).max(80) });
export const adminCountsQuerySchema = z.object({});

export const ADMIN_OVERVIEW_MAX_CUSTOM_DAYS = 366;

export const adminBillingOverviewQuerySchema = z
  .object({
    range: z.enum(["today", "7d", "30d", "custom"]).default("30d"),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.range !== "custom") return;
    if (!value.from || !value.to) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "required" });
      return;
    }
    const duration = value.to.getTime() - value.from.getTime();
    if (duration <= 0 || duration > ADMIN_OVERVIEW_MAX_CUSTOM_DAYS * 86_400_000) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "invalid_range" });
    }
  });

export const adminPaymentListQuerySchema = z.object({
  ...paging,
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.string().regex(BILLING_KEY_PATTERN).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  minAmount: z.coerce.number().int().nonnegative().optional(),
  maxAmount: z.coerce.number().int().nonnegative().optional(),
  needsReview: queryBoolean.optional(),
  q: z.string().trim().max(80).optional(),
});
export const adminOrderListQuerySchema = z.object({
  ...paging,
  status: z.enum(ORDER_STATUSES).optional(),
  kind: z.enum(ORDER_KINDS).optional(),
  q: z.string().trim().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export const adminRefundListQuerySchema = z.object({
  ...paging,
  status: z.enum(REFUND_STATUSES).optional(),
});
export const adminSubscriptionListQuerySchema = z.object({
  ...paging,
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  planKey: z.string().regex(BILLING_KEY_PATTERN).optional(),
  source: z.enum(SUBSCRIPTION_SOURCES).optional(),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const adminRefundPreviewSchema = z.object({
  amountMinor: z.number().int().positive(),
});
export const adminRefundSchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: reasonSchema,
  transferReference: z.string().trim().min(1).max(120),
  clawbackCredits: z.number().int().nonnegative(),
});

export const adminReasonSchema = z.object({ reason: reasonSchema });
export const adminSubscriptionExtendSchema = z
  .object({
    months: z.number().int().min(1).max(24).optional(),
    until: z.iso
      .date()
      .transform((value) => new Date(`${value}T00:00:00.000Z`))
      .optional(),
    reason: reasonSchema,
  })
  .refine((value) => (value.months === undefined) !== (value.until === undefined), {
    path: ["months"],
    message: "months_or_until",
  });

const priceCells = z
  .array(
    z.object({
      months: z.number().int().min(1).max(24),
      currency: currencySchema,
      // Null switches the cell off; rows are never deleted.
      amountMinor: z.number().int().positive().nullable(),
    }),
  )
  .min(1)
  .max(120)
  .refine((cells) => new Set(cells.map((c) => `${c.months}:${c.currency}`)).size === cells.length, {
    message: "duplicate_cell",
  });
export const adminPlanPricesSchema = z.object({ prices: priceCells });
export const adminPublishPlanPricesSchema = adminPlanPricesSchema.extend({
  reason: reasonSchema,
  overrideMargin: z.boolean().optional(),
});

const creditPackFields = {
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  credits: z.number().int().min(1).max(1_000_000),
  bonusCredits: z.number().int().min(0).max(1_000_000),
  validMonths: z.number().int().min(1).max(36),
  active: z.boolean(),
  sort: z.number().int().min(0).max(10_000),
};
export const adminCreditPackCreateSchema = z.object({
  key: z.string().regex(BILLING_KEY_PATTERN),
  ...creditPackFields,
  bonusCredits: creditPackFields.bonusCredits.default(0),
  active: creditPackFields.active.default(true),
  sort: creditPackFields.sort.default(0),
});
/** The key is the pack's identity in links and orders: it is never edited. */
export const adminCreditPackPatchSchema = z
  .object(creditPackFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "at_least_one_field" });
export const adminCreditPackPricesSchema = z.object({
  reason: reasonSchema,
  prices: z
    .array(
      z.object({ currency: currencySchema, amountMinor: z.number().int().positive().nullable() }),
    )
    .min(1)
    .max(20)
    .refine((cells) => new Set(cells.map((c) => c.currency)).size === cells.length, {
      message: "duplicate_cell",
    }),
});

const taxRuleFields = {
  country: countrySchema.nullable(),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  rateBps: z.number().int().min(0).max(10_000),
  mode: z.enum(TAX_MODES),
  appliesTo: z.enum(TAX_APPLIES_TO),
  active: z.boolean(),
};
export const adminTaxRuleSchema = z.object({
  ...taxRuleFields,
  reason: reasonSchema,
  // Activating a rule while another is active in the same country swaps them in one step.
  replaceActive: z.boolean().optional(),
});
export const adminTaxRulePatchSchema = z
  .object({ ...taxRuleFields, reason: reasonSchema, replaceActive: z.boolean() })
  .partial()
  .refine((value) => value.reason !== undefined, { path: ["reason"], message: "required" })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "reason" && key !== "replaceActive"),
    {
      message: "at_least_one_field",
    },
  );

const instructionsSchema = z
  .string()
  .max(2_000)
  .refine((value) => !/\{(?!amount\}|reference\}|account\})/.test(value), "invalid_placeholder");
/**
 * What an admin may edit on a method here. `account_display` and `account_holder` are deliberately
 * absent: they change only through the delayed, TOTP-confirmed flow (BILLING §12), and zod strips
 * unknown keys, so sending them is a no-op.
 */
export const adminPaymentMethodPatchSchema = z
  .object({
    reason: reasonSchema,
    nameAr: z.string().trim().min(1).max(120),
    nameEn: z.string().trim().min(1).max(120),
    instructionsAr: instructionsSchema.nullable(),
    instructionsEn: instructionsSchema.nullable(),
    feeBps: z.number().int().min(0).max(2_000),
    feeFixedMinor: z.number().int().nonnegative(),
    minAmountMinor: z.number().int().nonnegative().nullable(),
    maxAmountMinor: z.number().int().nonnegative().nullable(),
    currencies: z.array(currencySchema).min(1),
    countries: z.array(countrySchema).nullable(),
    requiresProof: z.boolean(),
    reviewSlaMinutes: z.number().int().min(5).max(1_440).nullable(),
    sort: z.number().int(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((value) => value.reason !== undefined, { path: ["reason"], message: "required" })
  .refine((value) => Object.keys(value).some((key) => key !== "reason"), {
    message: "at_least_one_field",
  })
  .refine(
    (value) =>
      value.minAmountMinor == null ||
      value.maxAmountMinor == null ||
      value.minAmountMinor <= value.maxAmountMinor,
    { path: ["maxAmountMinor"], message: "max_less_than_min" },
  );

// --- Responses -----------------------------------------------------------------------------------

export const adminSearchResponseSchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(["user", "order", "payment", "coupon", "referral_code"]),
      id: z.uuid(),
      title: z.string(),
      subtitle: z.string(),
      href: z.string(),
    }),
  ),
});
export const adminCountsResponseSchema = z.object({
  paymentsToReview: z.number().int().nonnegative().nullable(),
  withdrawalsToReview: z.number().int().nonnegative().nullable(),
  fraudHolds: z.number().int().nonnegative().nullable(),
});
export const adminKeysetResponseSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

const perCurrency = z.record(z.string(), z.number().int());
const customerSchema = z.object({
  type: z.enum(["user", "org"]),
  id: z.uuid(),
  name: z.string().nullable(),
  maskedPhone: z.string().nullable(),
});

export const adminPaymentRowSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  reference: z.string(),
  customer: customerSchema,
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  months: z.number().int().nullable(),
  methodKey: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  ageSeconds: z.number().int().nonnegative(),
});
export const adminPaymentListResponseSchema = adminKeysetResponseSchema(adminPaymentRowSchema);

export const adminPaymentRecordSchema = z.object({
  id: z.uuid(),
  payment: z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.enum(PAYMENT_STATUSES),
    methodKey: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    txnIdMasked: z.string().nullable(),
    senderPhoneMasked: z.string().nullable(),
    createdAt: z.iso.datetime(),
    hasProof: z.boolean(),
    flags: z.array(z.string()),
  }),
  order: z.object({
    id: z.uuid(),
    number: z.string(),
    kind: z.enum(ORDER_KINDS),
    planKey: z.string().nullable(),
    packKey: z.string().nullable(),
    months: z.number().int().nullable(),
    status: z.enum(ORDER_STATUSES),
    quoteLines: z.array(z.unknown()),
    totals: z.object({
      subtotalMinor: z.number().int(),
      discountMinor: z.number().int(),
      taxMinor: z.number().int(),
      feeMinor: z.number().int(),
      totalMinor: z.number().int(),
    }),
    applied: z.record(z.string(), z.unknown()),
  }),
  timeline: z.array(
    z.object({ type: z.string(), time: z.iso.datetime(), signatureOk: z.boolean() }),
  ),
  refunds: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: z.number().int(),
      currency: z.string(),
      status: z.enum(REFUND_STATUSES),
      createdAt: z.iso.datetime(),
    }),
  ),
  customer: z.object({
    type: z.enum(["user", "org"]),
    id: z.uuid(),
    name: z.string().nullable(),
    maskedPhone: z.string().nullable(),
    maskedEmail: z.string().nullable(),
    previousPaidOrders: z.number().int().nonnegative(),
    currentPlanKey: z.string().nullable(),
    referralSourceCode: z.string().nullable(),
  }),
  flags: z.array(z.string()),
});

export const adminOrderRowSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  kind: z.enum(ORDER_KINDS),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  owner: z.object({ type: z.enum(["user", "org"]), id: z.uuid(), label: z.string() }),
  status: z.enum(ORDER_STATUSES),
  subtotalMinor: z.number().int(),
  totalMinor: z.number().int(),
  currency: z.string(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});
export const adminOrderListResponseSchema = adminKeysetResponseSchema(adminOrderRowSchema);

export const adminOrderDetailSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(ORDER_STATUSES),
  kind: z.enum(ORDER_KINDS),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  months: z.number().int().nullable(),
  currency: z.string(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  feeMinor: z.number().int(),
  totalMinor: z.number().int(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  receipt: z.record(z.string(), z.unknown()).nullable(),
  payments: z.array(
    z.object({
      id: z.uuid(),
      reference: z.string(),
      methodKey: z.string(),
      status: z.enum(PAYMENT_STATUSES),
      amountMinor: z.number().int(),
      currency: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
});

export const adminRefundRowSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.string(),
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(REFUND_STATUSES),
  reason: z.string(),
  transferReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export const adminRefundListResponseSchema = adminKeysetResponseSchema(adminRefundRowSchema);

export const adminRefundPreviewResponseSchema = z.object({
  paidMinor: z.number().int(),
  alreadyRefundedMinor: z.number().int(),
  refundableMinor: z.number().int(),
  full: z.boolean(),
  currency: z.string(),
  subscription: z
    .object({
      id: z.uuid(),
      planKey: z.string().nullable(),
      effect: z.enum(["ends_now", "shortened", "downgrade_removed", "unchanged"]),
      newPeriodEnd: z.iso.datetime().nullable(),
    })
    .nullable(),
  creditsGranted: z.number().int().nonnegative(),
  creditsUsed: z.number().int().nonnegative(),
  maxClawback: z.number().int().nonnegative(),
  rewardsToReverse: z.number().int().nonnegative(),
  couponKept: z.boolean(),
});

export const adminSubscriptionRowSchema = z.object({
  id: z.uuid(),
  owner: z.object({ type: z.enum(["user", "org"]), id: z.uuid(), label: z.string() }),
  planKey: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  source: z.enum(SUBSCRIPTION_SOURCES),
  currentPeriodEnd: z.iso.datetime(),
  cancelAtPeriodEnd: z.boolean(),
  pendingChange: z.record(z.string(), z.unknown()).nullable(),
  nextAction: z.enum(["renewal_due", "grace", "downgrade_scheduled", "ends", "none"]),
});
export const adminSubscriptionListResponseSchema = adminKeysetResponseSchema(
  adminSubscriptionRowSchema,
);

export const adminOverviewKpisSchema = z.object({
  revenueNetMinor: perCurrency,
  refundsMinor: perCurrency,
  orders: z.number().int(),
  newPaidSubscribers: z.number().int(),
  mrrMinor: perCurrency,
  arpuMinor: perCurrency,
  refundRateBps: z.number().int(),
  aiCostUsdMicros: z.number().int(),
  creditsSold: z.number().int(),
  creditsConsumed: z.number().int(),
  rewardsAccruedPoints: z.number().int(),
  rewardsPaidPoints: z.number().int(),
});
export const adminOverviewResponseSchema = z.object({
  generatedAt: z.iso.datetime(),
  range: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  attention: z.object({
    manualPaymentsWaiting: z.object({
      count: z.number().int(),
      oldestSeconds: z.number().int(),
      overdueCount: z.number().int(),
    }),
    withdrawalsWaiting: z.object({ count: z.number().int(), oldestSeconds: z.number().int() }),
    fraudHolds: z.number().int(),
    failedOrMismatchPayments24h: z.number().int(),
    subscriptionsEnding: z.array(
      z.object({
        id: z.uuid(),
        ownerLabel: z.string(),
        planKey: z.string(),
        periodEnd: z.iso.datetime(),
        subtotalMinor: z.number().int().nullable(),
      }),
    ),
    promotionsEnding: z.array(
      z.object({ id: z.uuid(), name: z.string(), endsAt: z.iso.datetime() }),
    ),
    couponsNearLimit: z.array(
      z.object({
        id: z.uuid(),
        code: z.string(),
        redeemed: z.number().int(),
        max: z.number().int(),
      }),
    ),
  }),
  kpis: adminOverviewKpisSchema,
  previous: adminOverviewKpisSchema,
  funnel: z.array(
    z.object({
      step: z.string(),
      methodKey: z.string().nullable(),
      sessions: z.number().int(),
    }),
  ),
  planMix: z.array(
    z.object({
      planKey: z.string().nullable(),
      currency: z.string(),
      orders: z.number().int(),
      amountMinor: z.number().int(),
    }),
  ),
  topDiscounts: z.object({
    coupons: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        currency: z.string(),
        revenueMinor: z.number().int(),
      }),
    ),
    promotions: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        currency: z.string(),
        revenueMinor: z.number().int(),
      }),
    ),
  }),
});

export type PaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;
export type OrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
export type RefundListQuery = z.infer<typeof adminRefundListQuerySchema>;
export type SubscriptionListQuery = z.infer<typeof adminSubscriptionListQuerySchema>;
export type OverviewQuery = z.infer<typeof adminBillingOverviewQuerySchema>;
export type PlanPriceCell = z.infer<typeof adminPlanPricesSchema>["prices"][number];
export type CreditPackCreate = z.infer<typeof adminCreditPackCreateSchema>;
export type CreditPackPatch = z.infer<typeof adminCreditPackPatchSchema>;
export type CreditPackPriceCell = z.infer<typeof adminCreditPackPricesSchema>["prices"][number];
export type PaymentMethodPatch = z.infer<typeof adminPaymentMethodPatchSchema>;
export type TaxRuleCreate = z.infer<typeof adminTaxRuleSchema>;
export type TaxRulePatch = z.infer<typeof adminTaxRulePatchSchema>;
export type SubscriptionExtend = z.infer<typeof adminSubscriptionExtendSchema>;
export type AdminRefundInput = z.infer<typeof adminRefundSchema>;
