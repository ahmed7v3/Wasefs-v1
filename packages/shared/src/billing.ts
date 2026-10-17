/*
 * Closed value sets of billing (Phase 3, Task 3.1; docs/BILLING.md). Same rule as `identity.ts` and
 * `plans.ts`: one tuple types the column, builds the DB CHECK and drives the zod schemas and admin
 * forms, so they cannot drift. Money is always an integer `*_minor` plus an ISO currency; percentages
 * are basis points (100 bps = 1%).
 */
import type { SettingValue } from "./settings.js";

/** ISO 4217 shape; whether a code is really enabled is the `currency` setting's business. */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

/** A price exists for 1 to 24 months (BILLING §2.1). */
export const BILLING_MIN_MONTHS = 1;
export const BILLING_MAX_MONTHS = 24;

/** 100% in basis points. */
export const MAX_BPS = 10_000;

/** Key of a credit pack, payment method, payout method, gateway or experiment. */
export const BILLING_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

// --- Orders and payments (BILLING §5) ---------------------------------------------------------

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "partially_refunded",
  "refunded",
  "expired",
  "canceled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_KINDS = ["subscription", "upgrade", "credit_pack"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** How an order was settled; `free` = a total of 0 activated without a payment row (BILLING §5.4). */
export const ORDER_PAYMENT_KINDS = ["gateway", "manual", "free"] as const;
export type OrderPaymentKind = (typeof ORDER_PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = [
  "created",
  "awaiting_customer",
  "processing",
  "awaiting_review",
  "awaiting_second_approval",
  "succeeded",
  "failed",
  "rejected",
  "canceled",
  "expired",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A payment still waiting for a human (the admin review queue). */
export const PAYMENT_REVIEW_STATUSES = ["awaiting_review", "awaiting_second_approval"] as const;

/** At most this many proof submissions per payment (BILLING §5.7.3). */
export const PAYMENT_MAX_PROOF_SUBMISSIONS = 3;
export const PAYMENT_REJECT_REASONS = [
  "amount_differs",
  "not_received",
  "unreadable_proof",
  "duplicate_proof",
  "wrong_reference",
  "other",
] as const;

export const REFUND_STATUSES = [
  "requested",
  "approved",
  "succeeded",
  "failed",
  "rejected",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYMENT_METHOD_KINDS = ["gateway", "manual"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];
export const PAYMENT_METHOD_ACCOUNT_CHANGE_STATUSES = ["pending", "applied", "canceled"] as const;

export const GATEWAY_MODES = ["test", "live"] as const;
export type GatewayMode = (typeof GATEWAY_MODES)[number];

export const TAX_MODES = ["added", "inclusive"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_APPLIES_TO = ["all", "subscription", "credit_pack"] as const;
export type TaxAppliesTo = (typeof TAX_APPLIES_TO)[number];

/** Shape of an order number that is built by the database, e.g. `WSO-2026-000123`. */
export const ORDER_NUMBER_PATTERN = /^WSO-[0-9]{4}-[0-9]{6,}$/;

// --- Subscriptions (BILLING §7.1) -------------------------------------------------------------

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "grace",
  "expired",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses in which a subscription still gives access: at most one such row per owner. */
export const LIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "grace"] as const;

export const SUBSCRIPTION_SOURCES = ["paid", "trial", "admin_grant", "deal", "promo"] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

export const SUBSCRIPTION_EVENT_TYPES = [
  "created",
  "renewed",
  "upgraded",
  "downgraded_scheduled",
  "grace_started",
  "expired",
  "canceled",
  "admin_changed",
  "refund_applied",
] as const;
export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

// --- Promotions and coupons (BILLING §3) ------------------------------------------------------

export const DISCOUNT_KINDS = [
  "percent",
  "fixed",
  "bonus_credits",
  "extra_months",
  "trial_extension",
] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** Promotions apply automatically, so they cannot be a trial extension (coupons only). */
export const PROMOTION_KINDS = ["percent", "fixed", "bonus_credits", "extra_months"] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];

export const STACKING_MODES = ["exclusive", "stack_with_other"] as const;
export type StackingMode = (typeof STACKING_MODES)[number];

export const DISCOUNT_STATUSES = ["draft", "scheduled", "active", "paused", "ended"] as const;
export type DiscountStatus = (typeof DISCOUNT_STATUSES)[number];

export const COUPON_REDEMPTION_STATUSES = ["reserved", "confirmed", "released"] as const;
export type CouponRedemptionStatus = (typeof COUPON_REDEMPTION_STATUSES)[number];

/** Upper-case letters, digits and dashes, 4 to 32 characters (input is trimmed and upper-cased first). */
export const COUPON_CODE_PATTERN = /^[A-Z0-9-]{4,32}$/;

// --- Personal offers, taste grants, notifications (BILLING §9) --------------------------------

export const PERSONAL_OFFER_KINDS = ["welcome", "winback", "renewal", "taste"] as const;
export type PersonalOfferKind = (typeof PERSONAL_OFFER_KINDS)[number];

/** Lower-case dotted or underscored identifier (notification kinds, outbox topics, feature names). */
export const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_.]{1,63}$/;

// --- Admin alerts (BILLING §10) ---------------------------------------------------------------

export const ALERT_KINDS = [
  "payment.review_needed",
  "payment.review_overdue",
  "payment.amount_mismatch",
  "payment.failure_spike",
  "withdrawal.requested",
  "withdrawal.overdue",
  "reward.fraud_flag",
  "credits.reconcile_drift",
  "points.reconcile_drift",
  "refund.requested",
  "payment_method.account_change_requested",
  "payment_method.account_change_canceled",
  "payment_method.account_change_applied",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_CHANNELS = ["in_app", "email", "telegram", "whatsapp"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_DELIVERY_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

// --- Markets ------------------------------------------------------------------------------------

/**
 * Currency a visitor from a country most likely pays in (`CF-IPCountry`). Only used when that
 * currency is enabled in the `currency` setting; every other country falls back to the default.
 */
export const COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  EG: "EGP",
  SA: "SAR",
  AE: "AED",
};

// --- Public view of the billing setting -------------------------------------------------------

export interface BillingPublicView {
  trialAvailable: boolean;
  reviewSlaMinutes: number;
  refundWindowDays: number;
}

/**
 * The part of the admin-only `billing` setting that the public catalog may show (BILLING §11): trial
 * availability, the review SLA and the refund window. Whether tax is inclusive comes from `tax_rules`
 * at runtime, never from here.
 */
export function billingPublicView(value: SettingValue<"billing">): BillingPublicView {
  return {
    trialAvailable: value.trial.credits > 0,
    reviewSlaMinutes: value.reviewSlaMinutes,
    refundWindowDays: value.refundWindowDays,
  };
}
