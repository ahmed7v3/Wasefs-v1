import type { arRewards } from "./ar.rewards.js";

/** English for referrals, points and rewards: keys without an entry fall back to Arabic. */
export const enRewards: Partial<Record<keyof typeof arRewards, string>> = {
  "rewards.coupon.title": "Invitation discount on your first plan",

  "rewards.notify.points_earned": "You earned {points} points",
  "rewards.notify.points_released": "{points} points are now available",
  "rewards.notify.credits_earned": "You received {credits} bonus credits",
  "rewards.notify.coupon_ready": "A {percent}% discount on your first plan: {code}",

  "rewards.event.referee_verified": "A friend registered and verified their account",
  "rewards.event.first_payment": "A friend's first subscription",
  "rewards.event.renewal": "A friend renewed",
  "rewards.event.credit_pack": "A friend bought a credit pack",
  "rewards.event.org_member_joined": "A member joined an organization",

  "rewards.activity.reward_pending": "Points pending",
  "rewards.activity.reward_release": "Points now available",
  "rewards.activity.reward_reverse": "Points reversed",
  "rewards.activity.convert_to_credits": "Points converted to credits",
  "rewards.activity.withdraw_hold": "Points held for a withdrawal",
  "rewards.activity.withdraw_paid": "Cash withdrawal paid",
  "rewards.activity.withdraw_release": "Points returned from a withdrawal",
  "rewards.activity.admin_adjust": "Adjustment by the team",
  "rewards.activity.expiry": "Points expired",

  "deals.why.user": "Deal \"{name}\" is assigned to this user directly",
  "deals.why.org_owner": "Deal \"{name}\" is assigned to the organization {org}",
  "deals.why.org_member": "Deal \"{name}\" applies because the user is a member of {org}",
  "deals.why.join_link": "Deal \"{name}\" applies because the user joined through a link of {org}",
  "deals.why.referral_code": "Deal \"{name}\" applies because of the referral code {code}",
  "deals.why.email_domain": "Deal \"{name}\" applies to the email domain {domain}",
  "deals.lost.outranked": "Deal \"{name}\" lost to \"{winner}\", which has higher precedence or is newer",
  "deals.lost.no_matching_term": "Deal \"{name}\" sets no price for this plan, period or currency",
  "deals.lost.membership_expired": "The membership period of deal \"{name}\" has ended",
  "deals.lost.not_new_member": "Deal \"{name}\" is for new members only",
  "deals.lost.billing_mode": "Deal \"{name}\" is paid by the organization and does not lower a member's personal price",
  "deals.lost.invalid_terms": "The terms of deal \"{name}\" are invalid",
};
