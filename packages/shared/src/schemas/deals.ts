import { z } from "zod";

import { BILLING_MAX_MONTHS, MAX_BPS } from "../billing.js";
import { ORG_MEMBER_ROLES } from "../identity.js";
import { PLAN_KEY_PATTERN } from "../plans.js";
import {
  DEAL_BILLING_MODES,
  DEAL_STATUSES,
  EMAIL_DOMAIN_PATTERN,
  JOIN_LINK_APPROVALS,
  SLUG_PATTERN,
} from "../rewards.js";

import { currencyCodeSchema, monthsSchema } from "./billing.js";

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

export const createJoinLinkSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN),
  role: z.enum(ORG_MEMBER_ROLES).default("org_member"),
  dealId: z.uuid().nullable().default(null),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  expiresAt: isoDate.nullable().default(null),
  approval: z.enum(JOIN_LINK_APPROVALS).default("auto_approve"),
});
export type CreateJoinLinkInput = z.output<typeof createJoinLinkSchema>;
