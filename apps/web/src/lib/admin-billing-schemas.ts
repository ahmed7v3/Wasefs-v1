import { z } from "zod";

/*
 * Response shapes of the admin billing console as the browser receives them (JSON: dates are ISO
 * strings). The API stays the authority; these schemas only describe what the pages read, so a
 * column added later never breaks a page. Request bodies use the shared schemas directly.
 */

const money = z.record(z.string(), z.number());
const count = z.number().nullable().transform((value) => value ?? 0);
const iso = z.string();

const kpiSchema = z.object({
  revenueNetMinor: money,
  refundsMinor: money,
  orders: count,
  newPaidSubscribers: count,
  mrrMinor: money,
  arpuMinor: money,
  refundRateBps: count,
  aiCostUsdMicros: count,
  creditsSold: count,
  creditsConsumed: count,
  rewardsAccruedPoints: count,
  rewardsPaidPoints: count,
});

export const overviewSchema = z.object({
  generatedAt: iso,
  range: z.object({ from: iso, to: iso }),
  kpis: kpiSchema,
  previous: kpiSchema,
  topDiscounts: z.object({
    coupons: z.array(
      z.object({ id: z.string(), name: z.string(), currency: z.string(), revenueMinor: count }),
    ),
    promotions: z.array(
      z.object({ id: z.string(), name: z.string(), currency: z.string(), revenueMinor: count }),
    ),
  }),
  planMix: z.array(
    z.object({ planKey: z.string().nullable(), currency: z.string(), amountMinor: count }),
  ),
  funnel: z.array(
    z.object({ step: z.string(), methodKey: z.string().nullable(), sessions: count }),
  ),
  attention: z.object({
    manualPaymentsWaiting: z.object({
      count,
      oldestSeconds: count,
      overdueCount: count,
    }),
    withdrawalsWaiting: z.object({ count, oldestSeconds: count }),
    fraudHolds: count,
    failedOrMismatchPayments24h: count,
    subscriptionsEnding: z.array(
      z.object({
        id: z.string(),
        planKey: z.string(),
        periodEnd: iso,
        subtotalMinor: z.number().nullable(),
        ownerLabel: z.string(),
      }),
    ),
    promotionsEnding: z.array(z.object({ id: z.string(), name: z.string(), endsAt: iso.nullable() })),
    couponsNearLimit: z.array(
      z.object({ id: z.string(), code: z.string(), redeemed: z.number(), max: z.number().nullable() }),
    ),
  }),
});
export type OverviewView = z.output<typeof overviewSchema>;
export type KpiView = z.output<typeof kpiSchema>;

export const paymentRowSchema = z.object({
  id: z.string(),
  createdAt: iso,
  orderId: z.string(),
  orderNumber: z.string(),
  reference: z.string(),
  customer: z.object({
    id: z.string().nullable(),
    name: z.string().nullable(),
    maskedPhone: z.string().nullable(),
  }),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  months: z.number().nullable(),
  methodKey: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: z.string(),
  ageSeconds: z.number(),
});
export type PaymentRow = z.output<typeof paymentRowSchema>;
export const paymentPageSchema = z.object({
  items: z.array(paymentRowSchema),
  nextCursor: z.string().nullable(),
});

const quoteLineSchema = z.object({
  kind: z.string(),
  labelKey: z.string(),
  amountMinor: z.number(),
});

export const paymentRecordSchema = z.object({
  id: z.string(),
  payment: z.object({
    id: z.string(),
    reference: z.string(),
    status: z.string(),
    methodKey: z.string(),
    amountMinor: z.number(),
    currency: z.string(),
    txnIdMasked: z.string().nullable(),
    senderPhoneMasked: z.string().nullable(),
    createdAt: iso,
    flags: z.array(z.string()),
  }),
  order: z.object({
    id: z.string(),
    number: z.string(),
    kind: z.string(),
    planKey: z.string().nullable(),
    packKey: z.string().nullable(),
    months: z.number().nullable(),
    status: z.string(),
    quoteLines: z.array(quoteLineSchema).catch([]),
    totals: z.object({
      subtotalMinor: z.number(),
      discountMinor: z.number(),
      taxMinor: z.number(),
      feeMinor: z.number(),
      totalMinor: z.number(),
    }),
  }),
  timeline: z.array(z.object({ type: z.string(), time: iso, signatureOk: z.boolean().nullable() })),
  refunds: z.array(
    z.object({
      id: z.string(),
      amountMinor: z.number(),
      currency: z.string(),
      status: z.string(),
      createdAt: iso,
    }),
  ),
  customer: z.object({
    id: z.string().nullable(),
    name: z.string().nullable(),
    maskedPhone: z.string().nullable(),
    maskedEmail: z.string().nullable(),
    previousPaidOrders: z.number(),
    currentPlanKey: z.string().nullable(),
    referralSourceCode: z.string().nullable(),
  }),
  flags: z.array(z.string()),
});
export type PaymentRecord = z.output<typeof paymentRecordSchema>;

export const refundPreviewSchema = z.object({
  paidMinor: z.number(),
  alreadyRefundedMinor: z.number(),
  refundableMinor: z.number(),
  full: z.boolean(),
  currency: z.string(),
  subscription: z
    .object({
      id: z.string(),
      planKey: z.string().nullable(),
      effect: z.enum(["ends_now", "shortened", "downgrade_removed", "unchanged"]),
      newPeriodEnd: iso.nullable(),
    })
    .nullable(),
  creditsGranted: z.number(),
  creditsUsed: z.number(),
  maxClawback: z.number(),
  rewardsToReverse: z.number(),
  couponKept: z.boolean(),
});
export type RefundPreview = z.output<typeof refundPreviewSchema>;

export const orderRowSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.string(),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  owner: z.object({ id: z.string().nullable(), label: z.string() }),
  status: z.string(),
  subtotalMinor: z.number(),
  totalMinor: z.number(),
  currency: z.string(),
  createdAt: iso,
  paidAt: iso.nullable(),
});
export type OrderRow = z.output<typeof orderRowSchema>;
export const orderPageSchema = z.object({
  items: z.array(orderRowSchema),
  nextCursor: z.string().nullable(),
});

export const receiptPayloadSchema = z.object({
  number: z.string(),
  issuedAt: iso,
  paidAt: iso.nullable(),
  status: z.string(),
  currency: z.string(),
  buyer: z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  company: z
    .object({
      legalName: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      taxId: z.string().nullable().optional(),
    })
    .catch({}),
  item: z.object({
    kind: z.string(),
    planKey: z.string().nullable(),
    packKey: z.string().nullable(),
    months: z.number().nullable(),
  }),
  lines: z.array(quoteLineSchema),
  taxMode: z.enum(["added", "inclusive"]).nullable(),
  totals: z.object({
    subtotalMinor: z.number(),
    discountMinor: z.number(),
    taxMinor: z.number(),
    feeMinor: z.number(),
    totalMinor: z.number(),
    refundedMinor: z.number(),
    netPaidMinor: z.number(),
  }),
  payment: z
    .object({ methodKey: z.string(), methodNameAr: z.string(), reference: z.string() })
    .nullable(),
});
export type ReceiptPayload = z.output<typeof receiptPayloadSchema>;

export const orderDetailSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  kind: z.string(),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  months: z.number().nullable(),
  currency: z.string(),
  totalMinor: z.number(),
  createdAt: iso,
  paidAt: iso.nullable(),
  receipt: receiptPayloadSchema.nullable(),
  payments: z.array(z.object({ id: z.string(), reference: z.string(), status: z.string() })),
});
export type OrderDetail = z.output<typeof orderDetailSchema>;

export const refundRowSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: z.string(),
  reason: z.string(),
  transferReference: z.string().nullable(),
  createdAt: iso,
});
export type RefundRow = z.output<typeof refundRowSchema>;
export const refundPageSchema = z.object({
  items: z.array(refundRowSchema),
  nextCursor: z.string().nullable(),
});

export const subscriptionRowSchema = z.object({
  id: z.string(),
  owner: z.object({ type: z.string(), id: z.string().nullable(), label: z.string() }),
  planKey: z.string(),
  status: z.string(),
  source: z.string(),
  currentPeriodEnd: iso,
  cancelAtPeriodEnd: z.boolean(),
  nextAction: z.enum(["renewal_due", "grace", "downgrade_scheduled", "ends", "none"]),
});
export type SubscriptionRow = z.output<typeof subscriptionRowSchema>;
export const subscriptionPageSchema = z.object({
  items: z.array(subscriptionRowSchema),
  nextCursor: z.string().nullable(),
});

export const subscriptionDetailSchema = z.object({
  subscription: z.object({
    id: z.string(),
    status: z.string(),
    source: z.string(),
    currentPeriodStart: iso,
    currentPeriodEnd: iso,
    graceUntil: iso.nullable(),
    cancelAtPeriodEnd: z.boolean(),
  }),
  owner: z.object({ type: z.string(), id: z.string().nullable(), label: z.string() }),
  creditBalance: z.number().nullable().catch(null),
  events: z.array(z.object({ id: z.string(), type: z.string(), createdAt: iso })),
  orders: z.array(
    z.object({ id: z.string(), number: z.string().optional(), status: z.string().optional() }),
  ),
});
export type SubscriptionDetail = z.output<typeof subscriptionDetailSchema>;

// --- Manual payment review -----------------------------------------------------------------------

export const reviewItemSchema = z.object({
  id: z.string(),
  number: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  method: z.string(),
  maskedUser: z.string(),
  ageSeconds: z.number(),
  flags: z.array(z.string()),
  status: z.string(),
  lockHolder: z.object({ id: z.string(), displayName: z.string().nullable() }).nullable(),
});
export type ReviewItem = z.output<typeof reviewItemSchema>;
export const reviewPageSchema = z.object({
  items: z.array(reviewItemSchema),
  nextCursor: z.string().nullable(),
});

export const reviewDetailSchema = z.object({
  id: z.string(),
  payment: z.object({
    id: z.string(),
    reference: z.string(),
    status: z.string(),
    amountMinor: z.number(),
    currency: z.string(),
    methodKey: z.string(),
    txnId: z.string().nullable(),
    senderPhoneMasked: z.string().nullable(),
    flags: z.array(z.string()),
    proofSubmissions: z.number(),
    reviewedBy: z.string().nullable(),
    secondApprovedBy: z.string().nullable(),
    reviewNote: z.string().nullable(),
    createdAt: iso,
  }),
  order: z.object({
    id: z.string(),
    number: z.string(),
    planKey: z.string().nullable(),
    months: z.number().nullable(),
    totalMinor: z.number(),
    currency: z.string(),
    status: z.string(),
    expiresAt: iso,
  }),
  method: z.object({ key: z.string(), name: z.string() }),
  user: z.object({
    name: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  proofUrl: z.string().nullable(),
  proofUnavailable: z.boolean(),
  paidOrdersCount: z.number(),
  earlierRejected: z.array(z.unknown()),
  lockHolder: z.object({ id: z.string(), displayName: z.string().nullable() }).nullable(),
});
export type ReviewDetail = z.output<typeof reviewDetailSchema>;

export const reviewDecisionSchema = z.object({
  status: z.string().optional(),
  activated: z.boolean().optional(),
});

// --- Catalog -------------------------------------------------------------------------------------

export const adminPlanSchema = z.object({
  id: z.string(),
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  audience: z.enum(["individual", "organization", "any"]),
  isDefault: z.boolean(),
  monthlyCredits: z.number(),
  visibility: z.enum(["public", "hidden"]),
  sort: z.number(),
  badgeAr: z.string().nullable(),
  badgeEn: z.string().nullable(),
  taglineAr: z.string().nullable(),
  taglineEn: z.string().nullable(),
  features: z.array(
    z.object({
      textAr: z.string(),
      textEn: z.string(),
      included: z.boolean(),
      highlight: z.boolean(),
    }),
  ),
  trialDays: z.number(),
  pinRecommended: z.boolean(),
  maxMembers: z.number().nullable(),
  fairUseNoteAr: z.string().nullable(),
  fairUseNoteEn: z.string().nullable(),
  prices: z.array(
    z.object({ months: z.number(), currency: z.string(), amountMinor: z.number().nullable() }),
  ),
  activeSubscribers: z.number(),
  marginInputs: z.object({
    costPerCreditUsdMicros: z.number(),
    source: z.string(),
    fxUsdToEgp: z.number(),
  }),
});
export type AdminPlan = z.output<typeof adminPlanSchema>;
export const adminPlanListSchema = z.object({ items: z.array(adminPlanSchema) });

const marginSchema = z.object({
  revenueMonthlyMinor: z.number(),
  costFullMinor: z.number(),
  marginFullMinor: z.number(),
  marginBps: z.number(),
  breakEvenBps: z.number(),
  warn: z.boolean(),
});
export const pricePreviewSchema = z.object({
  diff: z.object({
    added: z.array(z.object({ months: z.number(), currency: z.string(), amountMinor: z.number().nullable() })),
    changed: z.array(
      z.object({
        months: z.number(),
        currency: z.string(),
        from: z.number().nullable(),
        to: z.number().nullable(),
      }),
    ),
    removed: z.array(z.object({ months: z.number(), currency: z.string(), amountMinor: z.number() })),
  }),
  activeSubscribers: z.number(),
  margin: z.array(
    z.object({
      months: z.number(),
      currency: z.string(),
      amountMinor: z.number().nullable(),
      margin: marginSchema.nullable(),
    }),
  ),
});
export type PricePreview = z.output<typeof pricePreviewSchema>;

export const creditPackSchema = z.object({
  id: z.string(),
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  credits: z.number(),
  bonusCredits: z.number(),
  validMonths: z.number(),
  active: z.boolean(),
  sort: z.number(),
  prices: z.array(z.object({ currency: z.string(), amountMinor: z.number().nullable() })),
});
export type CreditPackView = z.output<typeof creditPackSchema>;
export const creditPackListSchema = z.object({ items: z.array(creditPackSchema) });

export const methodSchema = z.object({
  key: z.string(),
  kind: z.enum(["gateway", "manual"]),
  provider: z.string().nullable(),
  nameAr: z.string(),
  nameEn: z.string(),
  instructionsAr: z.string().nullable(),
  instructionsEn: z.string().nullable(),
  accountDisplay: z.string().nullable(),
  pendingAccountChange: z.object({ id: z.string(), effectiveAt: iso }).nullable(),
  feeBps: z.number(),
  feeFixedMinor: z.number(),
  minAmountMinor: z.number().nullable(),
  maxAmountMinor: z.number().nullable(),
  currencies: z.array(z.string()),
  countries: z.array(z.string()).nullable(),
  requiresProof: z.boolean(),
  reviewSlaMinutes: z.number().nullable(),
  enabled: z.boolean(),
  sort: z.number(),
  gateway: z.object({ enabled: z.boolean(), verified: z.boolean() }).nullable(),
});
export type MethodView = z.output<typeof methodSchema>;
export const methodListSchema = z.object({ items: z.array(methodSchema) });

export const taxRuleSchema = z.object({
  id: z.string(),
  country: z.string().nullable(),
  nameAr: z.string(),
  nameEn: z.string(),
  rateBps: z.number(),
  mode: z.enum(["added", "inclusive"]),
  appliesTo: z.enum(["all", "subscription", "credit_pack"]),
  active: z.boolean(),
});
export type TaxRuleView = z.output<typeof taxRuleSchema>;
export const taxRuleListSchema = z.array(taxRuleSchema);

/** `GET .../account-change`: the pending change, or an empty answer when there is none. */
export const pendingAccountChangeSchema = z
  .object({
    change: z.object({
      id: z.string(),
      oldAccountDisplay: z.string(),
      newAccountDisplay: z.string(),
      oldAccountHolder: z.string().nullable(),
      newAccountHolder: z.string().nullable(),
      effectiveAt: iso,
      requestedBy: z.string().nullable(),
    }),
  })
  .nullish();
export const accountChangeRequestedSchema = z.object({
  effectiveAt: iso,
  diff: z.object({
    oldAccountDisplay: z.string(),
    newAccountDisplay: z.string(),
    oldAccountHolder: z.string().nullable(),
    newAccountHolder: z.string().nullable(),
  }),
});

export const countsSchema = z.object({
  paymentsToReview: z.number().nullable(),
  withdrawalsToReview: z.number().nullable(),
  fraudHolds: z.number().nullable(),
});
export type CountsView = z.output<typeof countsSchema>;
