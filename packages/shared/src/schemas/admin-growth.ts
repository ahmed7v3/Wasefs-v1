import { z } from "zod";

import { CURRENCY_CODE_PATTERN, BILLING_KEY_PATTERN, MAX_BPS } from "../billing.js";
import {
  POINTS_BUCKETS,
  REFERRAL_CODE_KINDS,
  REFERRAL_CODE_PATTERN,
  REFERRAL_FRAUD_FLAGS,
  REFERRAL_PROGRAM_KINDS,
  REFERRAL_STATUSES,
  REWARD_BENEFICIARIES,
  REWARD_DECISION_OUTCOMES,
  REWARD_EVENTS,
  REWARD_KINDS,
  REWARD_REDEEMABLE_AS,
} from "../rewards.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * Admin growth console, referrals and rewards (Phase 3, Task 3.13; ADMIN-CONSOLE-SPEC §6.1, §6.2).
 * Bodies are strict (an unknown key is a typo, not an option), amounts are integers, and every
 * change that moves money carries a `reason` that lands in the audit row.
 */

const isoDate = z.iso.datetime({ offset: true });
const currency = z.string().regex(CURRENCY_CODE_PATTERN);
const count = z.number().int().min(0);
/** Why an admin changed something; kept in the audit trail, never shown to the customer. */
export const growthReasonSchema = z.string().trim().min(3).max(500);

export const growthIdParamSchema = z.object({ id: z.uuid() });
export const growthReferralIdParamSchema = z.object({ referralId: z.uuid() });

// --- Overview --------------------------------------------------------------------------------------

export const REFERRAL_OVERVIEW_MAX_DAYS = 366;

export const referralOverviewQuerySchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .superRefine((value, ctx) => {
    if (value.from === undefined && value.to === undefined) return;
    if (value.from === undefined || value.to === undefined) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "from and to go together" });
      return;
    }
    const span = value.to.getTime() - value.from.getTime();
    if (span <= 0 || span > REFERRAL_OVERVIEW_MAX_DAYS * 86_400_000) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "invalid_range" });
    }
  });
export type ReferralOverviewQuery = z.output<typeof referralOverviewQuerySchema>;

const pointsValueSchema = z.object({ points: count, valueMinor: count });

export const referralOverviewSchema = z.object({
  generatedAt: isoDate,
  range: z.object({ from: isoDate, to: isoDate }),
  /** The currency every `valueMinor` below is in (the rewards setting). */
  currency,
  funnel: z.object({ invited: count, verified: count, paid: count }),
  rewards: z.object({
    accrued: pointsValueSchema,
    released: pointsValueSchema,
    reversed: pointsValueSchema,
    /** Withdrawals marked paid in the range: the points and the cash actually sent per currency. */
    paidOut: z.object({ points: count, amountMinor: z.record(z.string(), count) }),
  }),
  topReferrers: z.array(
    z.object({ userId: z.uuid(), initials: z.string(), paidReferrals: count, points: count }),
  ),
  revenueShare: z.array(
    z.object({
      currency,
      referralNetMinor: count,
      totalNetMinor: count,
      shareBps: z.number().int().min(0).max(MAX_BPS),
    }),
  ),
});
export type ReferralOverview = z.output<typeof referralOverviewSchema>;

// --- Programs --------------------------------------------------------------------------------------

export const createProgramSchema = z.strictObject({
  key: z.string().regex(BILLING_KEY_PATTERN),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  kind: z.enum(REFERRAL_PROGRAM_KINDS),
  active: z.boolean().default(true),
});
export type CreateProgramInput = z.output<typeof createProgramSchema>;

export const updateProgramSchema = z
  .strictObject({
    nameAr: z.string().trim().min(1).max(120).optional(),
    nameEn: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
    reason: growthReasonSchema,
  })
  .refine(
    (body) => body.nameAr !== undefined || body.nameEn !== undefined || body.active !== undefined,
    {
      message: "nothing to change",
    },
  );
export type UpdateProgramInput = z.output<typeof updateProgramSchema>;

export const moveMemberSchema = z.strictObject({ userId: z.uuid(), reason: growthReasonSchema });

export const programViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  kind: z.enum(REFERRAL_PROGRAM_KINDS),
  nameAr: z.string(),
  nameEn: z.string(),
  active: z.boolean(),
  createdAt: isoDate,
  counts: z.object({ activeRules: count, tiers: count, codes: count, referrals: count }),
});

export const moveMemberResultSchema = z.object({
  userId: z.uuid(),
  programId: z.uuid(),
  codesMoved: count,
  referralsMoved: count,
});

// --- Rules -----------------------------------------------------------------------------------------

const ruleFields = {
  event: z.enum(REWARD_EVENTS),
  beneficiary: z.enum(REWARD_BENEFICIARIES),
  rewardKind: z.enum(REWARD_KINDS),
  value: z.number().int().min(0).max(1_000_000_000),
  redeemableAs: z.enum(REWARD_REDEEMABLE_AS),
  holdDays: z.number().int().min(0).max(365),
  maxPerReferrerPerDay: z.number().int().min(1).max(100_000).nullable(),
  maxPerReferrerTotal: z.number().int().min(1).max(10_000_000).nullable(),
  minOrderMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  validFrom: isoDate.nullable(),
  validTo: isoDate.nullable(),
  maxRenewals: z.number().int().min(1).max(120).nullable(),
  priority: z.number().int().min(-10_000).max(10_000),
  active: z.boolean(),
};

/** A rule shape's cross-field problems as the field names to report; empty when it is valid. */
export function ruleShapeIssues(rule: {
  rewardKind: (typeof REWARD_KINDS)[number];
  value: number;
  validFrom: string | null;
  validTo: string | null;
}): string[] {
  const issues: string[] = [];
  if (rule.rewardKind === "percent_of_net_bps" && rule.value > MAX_BPS) issues.push("value");
  if (
    rule.validFrom !== null &&
    rule.validTo !== null &&
    Date.parse(rule.validTo) <= Date.parse(rule.validFrom)
  ) {
    issues.push("validTo");
  }
  return issues;
}

export const createRuleSchema = z
  .strictObject({
    ...ruleFields,
    holdDays: ruleFields.holdDays.default(0),
    maxPerReferrerPerDay: ruleFields.maxPerReferrerPerDay.default(null),
    maxPerReferrerTotal: ruleFields.maxPerReferrerTotal.default(null),
    minOrderMinor: ruleFields.minOrderMinor.default(null),
    validFrom: ruleFields.validFrom.default(null),
    validTo: ruleFields.validTo.default(null),
    maxRenewals: ruleFields.maxRenewals.default(null),
    priority: ruleFields.priority.default(0),
    active: ruleFields.active.default(true),
    reason: growthReasonSchema,
  })
  .superRefine((rule, ctx) => {
    for (const path of ruleShapeIssues(rule)) {
      ctx.addIssue({ code: "custom", path: [path], message: "invalid" });
    }
  });
export type CreateRuleInput = z.output<typeof createRuleSchema>;

export const updateRuleSchema = z
  .strictObject({
    rewardKind: ruleFields.rewardKind.optional(),
    value: ruleFields.value.optional(),
    redeemableAs: ruleFields.redeemableAs.optional(),
    holdDays: ruleFields.holdDays.optional(),
    maxPerReferrerPerDay: ruleFields.maxPerReferrerPerDay.optional(),
    maxPerReferrerTotal: ruleFields.maxPerReferrerTotal.optional(),
    minOrderMinor: ruleFields.minOrderMinor.optional(),
    validFrom: ruleFields.validFrom.optional(),
    validTo: ruleFields.validTo.optional(),
    maxRenewals: ruleFields.maxRenewals.optional(),
    priority: ruleFields.priority.optional(),
    active: ruleFields.active.optional(),
    reason: growthReasonSchema,
  })
  .refine((body) => Object.keys(body).some((key) => key !== "reason"), {
    message: "nothing to change",
  });
export type UpdateRuleInput = z.output<typeof updateRuleSchema>;

export const reasonBodySchema = z.strictObject({ reason: growthReasonSchema });
export type ReasonBody = z.output<typeof reasonBodySchema>;

/** `{ key, params }`: the i18n key and the plain values `renderRuleSentence` builds the sentence from. */
export const ruleSentenceSchema = z.object({
  key: z.literal("rewards.rule_sentence.main"),
  params: z.object({
    event: z.enum(REWARD_EVENTS),
    beneficiary: z.enum(REWARD_BENEFICIARIES),
    rewardKind: z.enum(REWARD_KINDS),
    value: count,
    percent: z.number().min(0),
    redeemableAs: z.enum(REWARD_REDEEMABLE_AS),
    holdDays: count,
  }),
});

export const ruleViewSchema = z.object({
  id: z.uuid(),
  programId: z.uuid(),
  ...ruleFields,
  createdAt: isoDate,
  updatedAt: isoDate,
  sentence: ruleSentenceSchema,
});
export type RuleView = z.output<typeof ruleViewSchema>;

export const ruleListSchema = z.object({ items: z.array(ruleViewSchema) });

export const whatIfSchema = z.strictObject({
  programId: z.uuid(),
  event: z.enum(REWARD_EVENTS),
  netMinor: z.number().int().min(0).max(1_000_000_000),
  /** The order's currency; informational (rules compare `minOrderMinor` as the engine does, unit-less). */
  currency: currency.optional(),
  /** A referrer tier's bonus on percentage rules, to preview a referrer already in that tier. */
  tierBonusBps: z.number().int().min(0).max(MAX_BPS).default(0),
  /** Preview the rewards of this deal (its `terms.rewards` override the program's rules), as the engine pays them. */
  dealId: z.uuid().optional(),
});
export type WhatIfInput = z.output<typeof whatIfSchema>;

export const whatIfResultSchema = z.object({
  programId: z.uuid(),
  event: z.enum(REWARD_EVENTS),
  netMinor: count,
  /** What `valueMinor` is in. */
  currency,
  pointValueMinor: z.number().int().min(1),
  beneficiaries: z.array(
    z.object({
      beneficiary: z.enum(REWARD_BENEFICIARIES),
      /** Null when no active rule covers this event and beneficiary, or the rule is a deal's. */
      ruleId: z.uuid().nullable(),
      /** Null when nothing pays this side; `deal` when the previewed deal's terms decide. */
      source: z.enum(["program", "global", "deal"]).nullable(),
      sentence: ruleSentenceSchema.nullable(),
      points: count,
      credits: count,
      valueMinor: count,
      holdDays: count,
      /** Where the points sit once released; null for credits and for nothing. */
      bucket: z.enum(POINTS_BUCKETS).nullable(),
      /** Set when the engine would pay nothing for this rule (`min_order`). */
      deniedReason: z.enum(["min_order"]).nullable(),
    }),
  ),
});
export type WhatIfResult = z.output<typeof whatIfResultSchema>;

// --- Tiers -----------------------------------------------------------------------------------------

const tierFields = {
  key: z.string().regex(BILLING_KEY_PATTERN),
  nameAr: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().min(1).max(120),
  minPaidReferrals: z.number().int().min(0).max(100_000),
  bonusBps: z.number().int().min(0).max(MAX_BPS),
  active: z.boolean(),
};

export const createTierSchema = z.strictObject({
  ...tierFields,
  active: tierFields.active.default(true),
  reason: growthReasonSchema,
});
export type CreateTierInput = z.output<typeof createTierSchema>;

export const updateTierSchema = z
  .strictObject({
    nameAr: tierFields.nameAr.optional(),
    nameEn: tierFields.nameEn.optional(),
    minPaidReferrals: tierFields.minPaidReferrals.optional(),
    bonusBps: tierFields.bonusBps.optional(),
    active: tierFields.active.optional(),
    reason: growthReasonSchema,
  })
  .refine((body) => Object.keys(body).some((key) => key !== "reason"), {
    message: "nothing to change",
  });
export type UpdateTierInput = z.output<typeof updateTierSchema>;

/** `DELETE /tiers/:id?reason=`: a body on DELETE is dropped by many clients and proxies. */
export const deleteTierQuerySchema = z.object({ reason: growthReasonSchema });

export const tierViewSchema = z.object({
  id: z.uuid(),
  programId: z.uuid(),
  ...tierFields,
  /** Referrers whose paid referrals of the last 12 months fall in this tier's band. */
  memberCount: count,
});
export type TierView = z.output<typeof tierViewSchema>;

export const tierListSchema = z.object({ items: z.array(tierViewSchema) });

// --- Tree ------------------------------------------------------------------------------------------

export const TREE_MAX_ANCESTORS = 5;
export const TREE_MAX_DEPTH = 3;
export const TREE_MAX_NODES = 200;

export const referralTreeQuerySchema = z.object({
  userId: z.uuid(),
  depth: z.coerce.number().int().min(1).max(TREE_MAX_DEPTH).default(2),
});
export type ReferralTreeQuery = z.output<typeof referralTreeQuerySchema>;

export const referralTreeNodeSchema = z.object({
  userId: z.uuid(),
  /** First letters of the name only; never an email, phone or full name. */
  initials: z.string(),
  /** The user's own referral status (as an invitee); null for someone nobody invited. */
  status: z.enum(REFERRAL_STATUSES).nullable(),
  fraudFlags: z.array(z.string()),
  fraudScore: count,
  pointsEarned: count,
  paidOrders: count,
  /** The inviter's user id inside this response; null at the top of a chain. */
  parentUserId: z.uuid().nullable(),
  /** 0 for the searched user, 1.. downward. Ancestors are listed nearest first. */
  depth: count,
});

export const referralTreeSchema = z.object({
  root: referralTreeNodeSchema,
  ancestors: z.array(referralTreeNodeSchema),
  descendants: z.array(referralTreeNodeSchema),
  truncated: z.boolean(),
});
export type ReferralTree = z.output<typeof referralTreeSchema>;

// --- Codes -----------------------------------------------------------------------------------------

export const ADMIN_CODE_KINDS = ["partner", "organization", "campaign"] as const;

export const codeListQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(REFERRAL_CODE_KINDS).optional(),
  q: z.string().trim().min(1).max(40).optional(),
});
export type CodeListQuery = z.output<typeof codeListQuerySchema>;

export const createCodeSchema = z
  .strictObject({
    kind: z.enum(ADMIN_CODE_KINDS),
    /** Upper-cased; generated when absent. */
    code: z.string().trim().toUpperCase().regex(REFERRAL_CODE_PATTERN).optional(),
    ownerUserId: z.uuid().optional(),
    orgId: z.uuid().optional(),
    programId: z.uuid().optional(),
    dealId: z.uuid().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === "partner" && body.ownerUserId === undefined) {
      ctx.addIssue({ code: "custom", path: ["ownerUserId"], message: "required" });
    }
    if (body.kind === "organization" && body.orgId === undefined) {
      ctx.addIssue({ code: "custom", path: ["orgId"], message: "required" });
    }
    if (body.kind !== "partner" && body.ownerUserId !== undefined) {
      ctx.addIssue({ code: "custom", path: ["ownerUserId"], message: "not allowed" });
    }
    if (body.kind !== "organization" && body.orgId !== undefined) {
      ctx.addIssue({ code: "custom", path: ["orgId"], message: "not allowed" });
    }
  });
export type CreateCodeInput = z.output<typeof createCodeSchema>;

export const codeViewSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: z.enum(REFERRAL_CODE_KINDS),
  active: z.boolean(),
  programId: z.uuid(),
  programKey: z.string(),
  ownerUserId: z.uuid().nullable(),
  ownerInitials: z.string().nullable(),
  ownerOrgId: z.uuid().nullable(),
  ownerOrgName: z.string().nullable(),
  referrals: count,
  dealIds: z.array(z.uuid()),
  createdAt: isoDate,
});
export type CodeView = z.output<typeof codeViewSchema>;

export const codeListSchema = z.object({
  items: z.array(codeViewSchema),
  nextCursor: z.string().nullable(),
});

// --- Rewards settings preview ----------------------------------------------------------------------

export const rewardsPreviewSchema = z.object({
  pointValueMinor: z.number().int().min(1),
  currency,
  /** Every points-valued setting with its worth in money (`points * pointValueMinor`). */
  fields: z.array(
    z.object({
      key: z.enum([
        "minWithdrawalPoints",
        "maxWithdrawalPointsPerMonth",
        "fourEyesThresholdPoints",
        "weeklyBudgetPoints",
        "pointsPerCredit",
      ]),
      points: count,
      valueMinor: count,
    }),
  ),
});
export type RewardsPreview = z.output<typeof rewardsPreviewSchema>;

// --- Fraud queue -----------------------------------------------------------------------------------

export const fraudListQuerySchema = cursorQuerySchema.extend({
  flag: z.enum(REFERRAL_FRAUD_FLAGS).optional(),
});
export type FraudListQuery = z.output<typeof fraudListQuerySchema>;

const personRefSchema = z.object({ userId: z.uuid(), initials: z.string() });

export const fraudItemSchema = z.object({
  referralId: z.uuid(),
  status: z.enum(REFERRAL_STATUSES),
  /** Evidence chips: the fraud rules that fired and the score they add up to. */
  flags: z.array(z.string()),
  fraudScore: count,
  referrer: personRefSchema.nullable(),
  referee: personRefSchema,
  /** Who invited the referrer: the chain, one step up. */
  referrerInvitedBy: personRefSchema.nullable(),
  /** Points still pending for this referral (both sides), not yet released or reversed. */
  pendingPoints: count,
  heldDecisions: z.array(
    z.object({
      id: z.uuid(),
      event: z.enum(REWARD_EVENTS),
      beneficiary: z.enum(REWARD_BENEFICIARIES),
      outcome: z.enum(REWARD_DECISION_OUTCOMES),
      reason: z.string().nullable(),
      points: count,
      createdAt: isoDate,
    }),
  ),
  createdAt: isoDate,
});
export type FraudItem = z.output<typeof fraudItemSchema>;

export const fraudListSchema = z.object({
  items: z.array(fraudItemSchema),
  nextCursor: z.string().nullable(),
});

export const FRAUD_ACTIONS = ["release", "void", "block_referrer"] as const;
export type FraudAction = (typeof FRAUD_ACTIONS)[number];

export const bulkFraudSchema = z.strictObject({
  referralIds: z.array(z.uuid()).min(1).max(100),
  action: z.enum(FRAUD_ACTIONS),
  reason: growthReasonSchema,
});
export type BulkFraudInput = z.output<typeof bulkFraudSchema>;

export const bulkFraudResultSchema = z.object({
  action: z.enum(FRAUD_ACTIONS),
  results: z.array(
    z.object({
      referralId: z.uuid(),
      outcome: z.enum(["done", "not_found", "conflict", "no_referrer"]),
      reversedPoints: count,
    }),
  ),
});
export type BulkFraudResult = z.output<typeof bulkFraudResultSchema>;
