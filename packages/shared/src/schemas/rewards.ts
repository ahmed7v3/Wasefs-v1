import { z } from "zod";

import { CURRENCY_CODE_PATTERN, MAX_BPS } from "../billing.js";
import {
  POINTS_BUCKETS,
  POINTS_LEDGER_KINDS,
  REFERRAL_CODE_PATTERN,
  REWARD_BENEFICIARIES,
  REWARD_EVENTS,
  REWARD_KINDS,
  REWARD_REDEEMABLE_AS,
} from "../rewards.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * Referrals and rewards contract (Phase 3, Task 3.1; REFERRALS-REWARDS). Points are integers; the
 * server decides every amount, so none of these schemas carries a computed value from the client.
 */

const isoDate = z.iso.datetime({ offset: true });

/** Upper-cased before validation: codes are case-insensitive for users, upper case in storage. */
export const referralCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(REFERRAL_CODE_PATTERN, "3-20 characters: A-Z and 0-9");

/** One reward rule: "when EVENT happens, give BENEFICIARY a REWARD" (REFERRALS §3.2). */
export const rewardRuleInputSchema = z
  .object({
    programId: z.uuid(),
    event: z.enum(REWARD_EVENTS),
    beneficiary: z.enum(REWARD_BENEFICIARIES),
    rewardKind: z.enum(REWARD_KINDS),
    value: z.number().int().min(0).max(1_000_000_000),
    redeemableAs: z.enum(REWARD_REDEEMABLE_AS),
    holdDays: z.number().int().min(0).max(365).default(0),
    maxPerReferrerPerDay: z.number().int().min(1).max(100_000).nullable().default(null),
    maxPerReferrerTotal: z.number().int().min(1).max(10_000_000).nullable().default(null),
    minOrderMinor: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
    validFrom: isoDate.nullable().default(null),
    validTo: isoDate.nullable().default(null),
    maxRenewals: z.number().int().min(1).max(120).nullable().default(null),
    priority: z.number().int().min(-10_000).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .refine((rule) => rule.rewardKind !== "percent_of_net_bps" || rule.value <= MAX_BPS, {
    path: ["value"],
    message: "a percentage is at most 10000 bps",
  })
  .refine(
    (rule) =>
      rule.validFrom === null ||
      rule.validTo === null ||
      Date.parse(rule.validTo) > Date.parse(rule.validFrom),
    { path: ["validTo"], message: "must be after validFrom" },
  );
export type RewardRuleInput = z.output<typeof rewardRuleInputSchema>;

/** `POST /me/rewards/convert`: the request id makes a retried tap convert once. */
export const convertPointsSchema = z.object({
  points: z.number().int().min(1).max(100_000_000),
  requestId: z.uuid(),
});

/** `POST /me/withdrawals`: amounts and the rate are snapshotted by the server, never sent. */
export const withdrawalRequestSchema = z.object({
  points: z.number().int().min(1).max(100_000_000),
  destinationId: z.uuid(),
  requestId: z.uuid(),
});

// --- The user's own referral and rewards pages (Task 3.11) ----------------------------------------

/** `PATCH /me/referral`: the one-time vanity edit. */
export const updateReferralCodeSchema = z.object({ code: referralCodeSchema });

/** `GET /me/referral` and the reply of the vanity edit. */
export const meReferralSchema = z.object({
  code: z.string().regex(REFERRAL_CODE_PATTERN),
  link: z.url(),
  vanityEdited: z.boolean(),
});
export type MeReferral = z.output<typeof meReferralSchema>;

/** What one side earns for one event; numbers and keys only, the web writes the sentence. */
export const rewardOfferSchema = z.object({
  event: z.enum(REWARD_EVENTS),
  rewardKind: z.enum(REWARD_KINDS),
  value: z.number().int().min(0),
  redeemableAs: z.enum(REWARD_REDEEMABLE_AS),
  holdDays: z.number().int().min(0),
  maxRenewals: z.number().int().min(1).nullable(),
});

const tierViewSchema = z.object({
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  bonusBps: z.number().int().min(0),
  minPaidReferrals: z.number().int().min(0),
});

/** `GET /me/rewards`. */
export const meRewardsSchema = z.object({
  enabled: z.boolean(),
  code: z.string().regex(REFERRAL_CODE_PATTERN),
  link: z.url(),
  vanityEdited: z.boolean(),
  offers: z.object({
    referrer: z.array(rewardOfferSchema),
    referee: z.array(rewardOfferSchema),
    /** The invited person's private first-purchase coupon, in basis points; 0 = none. */
    refereeDiscountBps: z.number().int().min(0).max(MAX_BPS),
  }),
  balances: z.object({
    pending: z.number().int().min(0),
    /** When the soonest pending reward is released; null with nothing pending. */
    pendingReleaseAt: isoDate.nullable(),
    cash: z.number().int().min(0),
    cashValueMinor: z.number().int().min(0),
    currency: z.string().regex(CURRENCY_CODE_PATTERN),
    creditOnly: z.number().int().min(0),
    lifetimeEarned: z.number().int().min(0),
  }),
  conversion: z.object({
    pointsPerCredit: z.number().int().min(1),
    bonusBps: z.number().int().min(0).max(MAX_BPS),
  }),
  tier: z
    .object({
      paidReferrals: z.number().int().min(0),
      current: tierViewSchema.nullable(),
      next: tierViewSchema.nullable(),
    })
    .nullable(),
  counts: z.object({
    invited: z.number().int().min(0),
    verified: z.number().int().min(0),
    paid: z.number().int().min(0),
  }),
  /** Points still owed to offset against future earnings (refunded rewards that were already spent). */
  debt: z.number().int().min(0),
});
export type MeRewards = z.output<typeof meRewardsSchema>;

/** `GET /me/rewards/activity?cursor=&limit=`. */
export const meRewardsActivityQuerySchema = cursorQuerySchema;

export const rewardActivityEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(POINTS_LEDGER_KINDS),
  bucket: z.enum(POINTS_BUCKETS),
  /** Signed. */
  amount: z.number().int(),
  /** i18n key of the line (`rewards.activity.<kind>`); params are plain values. */
  labelKey: z.string().regex(/^rewards[.]activity[.][a-z_.]+$/),
  event: z.enum(REWARD_EVENTS).nullable(),
  /** "م. أ." - never an email, phone or full name. */
  refereeInitials: z.string().max(12).nullable(),
  releaseAt: isoDate.nullable(),
  createdAt: isoDate,
});
export const rewardActivityPageSchema = z.object({
  items: z.array(rewardActivityEntrySchema),
  nextCursor: z.string().nullable(),
});
export type RewardActivityEntry = z.output<typeof rewardActivityEntrySchema>;
export type RewardActivityPage = z.output<typeof rewardActivityPageSchema>;

/** `GET /me/rewards/convert/preview?points=`. */
export const convertPreviewQuerySchema = z.object({
  points: z.coerce.number().int().min(1).max(100_000_000),
});

export const convertPreviewSchema = z.object({
  points: z.number().int().min(1),
  /** Exactly what the conversion will add. */
  credits: z.number().int().min(0),
  fromCreditOnly: z.number().int().min(0),
  fromCash: z.number().int().min(0),
  /** False when the balance cannot cover `points`, or the amount would give no credits. */
  possible: z.boolean(),
  reason: z.enum(["insufficient_points", "below_minimum", "open_reward_debt"]).nullable(),
});

/** `POST /me/rewards/convert`. */
export const convertResultSchema = z.object({
  points: z.number().int().min(1),
  credits: z.number().int().min(1),
  /** True when this request id had already been converted: nothing changed. */
  replayed: z.boolean(),
});
