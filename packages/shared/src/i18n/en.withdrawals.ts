import type { arWithdrawals } from "./ar.withdrawals.js";

/** English for cash withdrawals: keys without an entry fall back to Arabic. */
export const enWithdrawals: Partial<Record<keyof typeof arWithdrawals, string>> = {
  "rewards.notify.withdrawal_requested":
    "We received your request to withdraw {points} points ({amount})",
  "rewards.notify.withdrawal_approved":
    "Your withdrawal of {points} points was approved; the transfer follows shortly",
  "rewards.notify.withdrawal_rejected":
    "Your withdrawal was rejected and {points} points are back in your balance: {reason}",
  "rewards.notify.withdrawal_paid":
    "{amount} was transferred to your payout destination. Reference: {reference}",
  "rewards.notify.withdrawal_canceled":
    "Your withdrawal was canceled and {points} points are back in your balance",
  "rewards.notify.payout_destination_added":
    "A new payout destination was added to your account. It can receive money after {hours} hours. If this was not you, change your password now.",

  "rewards.withdrawal.reject.suspected_fraud": "Suspected irregular activity",
  "rewards.withdrawal.reject.destination_invalid": "The payout destination is not valid",
  "rewards.withdrawal.reject.account_review": "Your account is under review",
  "rewards.withdrawal.reject.limit_exceeded": "Withdrawal limits exceeded",
  "rewards.withdrawal.reject.other": "Other reason",

  "rewards.withdrawal.refusal.not_enough_points": "Your cash balance does not cover this amount",
  "rewards.withdrawal.refusal.below_minimum": "The amount is below the minimum withdrawal",
  "rewards.withdrawal.refusal.phone_unverified": "Verify your phone number first",
  "rewards.withdrawal.refusal.account_too_new":
    "Your account is new; you can withdraw once the waiting period has passed",
  "rewards.withdrawal.refusal.open_request": "You already have a withdrawal in progress",
  "rewards.withdrawal.refusal.monthly_cap": "You reached the monthly withdrawal limit",
  "rewards.withdrawal.refusal.cash_out_off": "Cash withdrawals are not available right now",
  "rewards.withdrawal.refusal.reward_debt":
    "Refunded rewards are first deducted from your next earnings",
  "rewards.withdrawal.refusal.destination_cooldown":
    "This payout destination is new; it becomes usable after the safety period",
  "rewards.withdrawal.refusal.method_disabled": "This payout method is not available right now",
  "rewards.withdrawal.refusal.amount_out_of_range":
    "The amount is outside the payout method's limits",
  "rewards.withdrawal.refusal.request_id_reused":
    "This request number was already used for a different request",

  "rewards.payout.field.number": "Wallet number",
  "rewards.payout.field.address": "InstaPay address or mobile number",
  "rewards.payout.field.iban": "IBAN",

  "whatsapp.customer.withdrawalRequested":
    "We received your request to withdraw {points} points ({amount}). We will review it within {hours} hours.",
  "whatsapp.customer.withdrawalApproved":
    "Your withdrawal of {points} points was approved. {amount} will reach you shortly.",
  "whatsapp.customer.withdrawalRejected":
    "We could not process your withdrawal: {reason}. {points} points are back in your balance.",
  "whatsapp.customer.withdrawalPaid":
    "{amount} was transferred to your payout destination. Reference: {reference}.",
  "whatsapp.customer.withdrawalCanceled":
    "Your withdrawal was canceled and {points} points are back in your balance.",
  "whatsapp.customer.payoutDestinationAdded":
    "A new payout destination was added to your account; it can receive money after {hours} hours. If this was not you, change your password now.",

  "email.withdrawal.requested.subject": "We received your withdrawal request",
  "email.withdrawal.requested.body":
    "We received your request to withdraw {points} points ({amount}) and will review it shortly.",
  "email.withdrawal.approved.subject": "Your withdrawal was approved",
  "email.withdrawal.approved.body":
    "Your withdrawal of {points} points ({amount}) was approved; the transfer follows shortly.",
  "email.withdrawal.rejected.subject": "We could not process your withdrawal",
  "email.withdrawal.rejected.body":
    "We could not process your withdrawal of {points} points: {reason}. The points are back in your balance.",
  "email.withdrawal.paid.subject": "Your withdrawal was transferred",
  "email.withdrawal.paid.body":
    "{amount} was transferred to your payout destination. Reference: {reference}.",
  "email.withdrawal.canceled.subject": "Your withdrawal was canceled",
  "email.withdrawal.canceled.body":
    "Your withdrawal was canceled and {points} points are back in your balance.",
  "email.withdrawal.destination_added.subject": "A new payout destination was added to your account",
  "email.withdrawal.destination_added.body":
    "A new payout destination was added to your account; it can receive money after a safety period. If this was not you, change your password now and contact support.",
  "email.withdrawal.note": "Reviewer note: {note}",
  "email.withdrawal.button": "Open the rewards page",
};
