import { z } from "zod";

import { BILLING_MAX_MONTHS, MAX_BPS } from "../billing.js";
import { ORG_MEMBER_ROLES } from "../identity.js";
import { PLAN_KEY_PATTERN } from "../plans.js";
import { QUOTE_ERROR_CODES } from "../price-engine.js";
import {
  DEAL_BILLING_MODES,
  DEAL_STATUSES,
  DEAL_TARGET_KINDS,
  EMAIL_DOMAIN_PATTERN,
  JOIN_LINK_APPROVALS,
  SLUG_PATTERN,
} from "../rewards.js";

import {
  couponOutcomeSchema,
  currencyCodeSchema,
  dealSimulationSchema,
  monthsSchema,
  priceQuoteSchema,
} from "./billing.js";

/*
 * Deals contract (Phase 3, Task 3.1; REFERRALS-REWARDS §7). `deals.terms` is jsonb, so this schema
 * is its only guard: every level is strict, an unknown key is rejected (a typo must not silently
 * become "no discount"), and money is stated per currency.
 */

const isoDate = z.iso.datetime({ offset: true });
const count = z.number().int().min(0).max(1_000_000_000);

const planKey = z.string().max(40).regex(PLAN_KEY_PATTERN);
const dealMonths = z.array(monthsSchema).min(1).max(BILLING_MAX_MONTHS);

/** One pricing term: a fixed price in one currency, or a percentage off the list price. */
export const dealPricingTermSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    planKey,
    months: dealMonths.optional(),
    mode: z.literal("fixed"),
    amountMinor: count,
    currency: currencyCodeSchema,
  }),
  z.strictObject({
    planKey,
    months: dealMonths.optional(),
    mode: z.literal("percent_off"),
    bps: z.number().int().min(1).max(MAX_BPS),
  }),
]);

export const dealTermsSchema = z.strictObject({
  pricing: z.array(dealPricingTermSchema).max(50).default([]),
  stackWithPromotions: z.boolean().default(false),
  stackWithCoupons: z.boolean().default(false),
  /** How long the member price follows a member who joined through an institution. */
  membership: z
    .strictObject({
      durationMonths: z.number().int().min(1).max(120),
      newMembersOnly: z.boolean().default(true),
    })
    .optional(),
  rewards: z
    .strictObject({
      referrerSignupPoints: count,
      referrerPaymentBps: z.number().int().min(0).max(MAX_BPS),
      refereeSignupCredits: count,
      maxRenewals: z.number().int().min(0).max(120),
    })
    .optional(),
  credits: z
    .strictObject({
      welcomeCredits: count,
      monthlyBonusCredits: count,
    })
    .optional(),
  seats: z.strictObject({ maxMembers: z.number().int().min(1).max(100_000) }).optional(),
  billing: z.strictObject({ mode: z.enum(DEAL_BILLING_MODES) }).optional(),
});
export type DealTerms = z.output<typeof dealTermsSchema>;

export const dealTargetInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("user"),
    userId: z.uuid(),
    memberOnly: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("organization"),
    orgId: z.uuid(),
    memberOnly: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("referral_code"),
    referralCodeId: z.uuid(),
    memberOnly: z.boolean().default(false),
  }),
  z.strictObject({
    kind: z.literal("email_domain"),
    emailDomain: z.string().trim().toLowerCase().max(253).regex(EMAIL_DOMAIN_PATTERN),
    memberOnly: z.boolean().default(false),
  }),
]);

export const createDealSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    status: z.enum(DEAL_STATUSES).default("draft"),
    startsAt: isoDate.nullable().default(null),
    endsAt: isoDate.nullable().default(null),
    terms: dealTermsSchema,
    notes: z.string().trim().max(2_000).nullable().default(null),
    targets: z.array(dealTargetInputSchema).max(200).default([]),
  })
  .refine(
    (deal) =>
      deal.startsAt === null ||
      deal.endsAt === null ||
      Date.parse(deal.endsAt) > Date.parse(deal.startsAt),
    { path: ["endsAt"], message: "must be after startsAt" },
  );
export type CreateDealInput = z.output<typeof createDealSchema>;

export type DealPricingTerm = z.output<typeof dealPricingTermSchema>;
export type DealTargetInput = z.output<typeof dealTargetInputSchema>;

/*
 * Admin API (Task 3.10). An update has no defaults (an omitted field keeps its stored value) and
 * cannot change the status: that is what the transitions are for.
 */
export const updateDealSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    startsAt: isoDate.nullable(),
    endsAt: isoDate.nullable(),
    terms: dealTermsSchema,
    notes: z.string().trim().max(2_000).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field")
  .refine(
    (deal) =>
      deal.startsAt == null || deal.endsAt == null || Date.parse(deal.endsAt) > Date.parse(deal.startsAt),
    { path: ["endsAt"], message: "must be after startsAt" },
  );
export type UpdateDealInput = z.output<typeof updateDealSchema>;

export const dealIdParamSchema = z.object({ id: z.uuid() });
export const dealTargetParamSchema = z.object({ id: z.uuid(), targetId: z.uuid() });

export const dealListQuerySchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  targetKind: z.enum(DEAL_TARGET_KINDS).optional(),
  q: z.string().trim().max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type DealListQuery = z.output<typeof dealListQuerySchema>;

export const dealTargetViewSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DEAL_TARGET_KINDS),
  userId: z.uuid().nullable(),
  orgId: z.uuid().nullable(),
  referralCodeId: z.uuid().nullable(),
  emailDomain: z.string().nullable(),
  memberOnly: z.boolean(),
  createdAt: z.string(),
});

export const dealViewSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(DEAL_STATUSES),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  terms: dealTermsSchema,
  notes: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  targets: z.array(dealTargetViewSchema),
});
export type DealView = z.output<typeof dealViewSchema>;

export const dealUsageSchema = z.object({
  /** People the deal can apply to: user targets, members of organization targets, referred people, domain users. */
  membersSubject: z.number().int().min(0),
  ordersCount: z.number().int().min(0),
  /** Paid order totals by currency, in minor units. */
  revenueMinor: z.record(z.string(), z.number().int().min(0)),
});

export const dealDetailSchema = dealViewSchema.extend({ usage: dealUsageSchema });
export const dealListResponseSchema = z.object({
  items: z.array(dealViewSchema),
  nextCursor: z.string().nullable(),
});

/** `POST /admin/growth/deals/simulate`: exactly one of a user, an organization or a new member of one. */
export const simulateDealSchema = z
  .strictObject({
    userId: z.uuid().optional(),
    orgId: z.uuid().optional(),
    newMember: z.strictObject({ orgId: z.uuid() }).optional(),
    planKey,
    months: monthsSchema,
    currency: currencyCodeSchema.optional(),
    couponCode: z.string().trim().min(1).max(64).optional(),
  })
  .refine(
    (value) =>
      [value.userId, value.orgId, value.newMember].filter((part) => part !== undefined).length === 1,
    { message: "exactly one of userId, orgId, newMember" },
  );
export type SimulateDealInput = z.output<typeof simulateDealSchema>;

/** The quote before and after the deal engine, with the engine explanation. */
export const simulateDealResponseSchema = z.object({
  before: priceQuoteSchema.nullable(),
  after: priceQuoteSchema.nullable(),
  error: z.enum(QUOTE_ERROR_CODES).nullable(),
  coupon: couponOutcomeSchema.nullable(),
  deal: dealSimulationSchema,
});
export type SimulateDealResponse = z.output<typeof simulateDealResponseSchema>;

export const createJoinLinkSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
  // A shareable link never makes an admin: a leaked link would hand out the wallet and billing.
  role: z.literal("org_member" satisfies (typeof ORG_MEMBER_ROLES)[number]).default("org_member"),
  dealId: z.uuid().nullable().default(null),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  expiresAt: isoDate.nullable().default(null),
  approval: z.enum(JOIN_LINK_APPROVALS).default("auto_approve"),
});
export type CreateJoinLinkInput = z.output<typeof createJoinLinkSchema>;
