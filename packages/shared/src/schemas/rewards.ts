import { z } from "zod";

import { MAX_BPS } from "../billing.js";
import {
  REFERRAL_CODE_PATTERN,
  REWARD_BENEFICIARIES,
  REWARD_EVENTS,
  REWARD_KINDS,
  REWARD_REDEEMABLE_AS,
} from "../rewards.js";

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
