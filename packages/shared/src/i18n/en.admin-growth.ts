import type { arAdminGrowth } from "./ar.admin-growth.js";

/** English for the reward rule sentence: keys without an entry fall back to Arabic. */
export const enAdminGrowth: Partial<Record<keyof typeof arAdminGrowth, string>> = {
  "rewards.rule_sentence.main": "When {when}, {who} {reward}.",
  "rewards.rule_sentence.when.referee_verified": "the invitee verifies their account",
  "rewards.rule_sentence.when.first_payment": "the invitee pays for the first time",
  "rewards.rule_sentence.when.renewal": "the invitee renews",
  "rewards.rule_sentence.when.credit_pack": "the invitee buys a credit pack",
  "rewards.rule_sentence.when.org_member_joined": "the invitee joins an organization",
  "rewards.rule_sentence.who.referrer": "the referrer gets",
  "rewards.rule_sentence.who.referee": "the invitee gets",
  "rewards.rule_sentence.reward.fixed_points": "{value} points",
  "rewards.rule_sentence.reward.percent_of_net_bps": "{percent}% of the amount as points",
  "rewards.rule_sentence.reward.fixed_credits": "{value} credits",
  "rewards.rule_sentence.redeem.cash_or_credits": "redeemable as cash or credits",
  "rewards.rule_sentence.redeem.credits_only": "redeemable as credits only",
  "rewards.rule_sentence.hold.none": "immediately",
  "rewards.rule_sentence.hold.days": "after {days} days",
};
