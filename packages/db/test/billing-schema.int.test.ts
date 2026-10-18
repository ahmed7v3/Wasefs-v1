import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb } from "../src/client.js";
import { API_DB_ROLE, setApiRolePassword } from "../src/migrations.js";
import {
  couponRedemptions,
  coupons,
  creditLedger,
  creditPackPrices,
  creditPacks,
  creditWallets,
  organizations,
  orders,
  outbox,
  paymentEvents,
  paymentGatewayTests,
  paymentGateways,
  paymentMethods,
  payments,
  personalOffers,
  planAssignments,
  planPrices,
  plans,
  promotions,
  refunds,
  subscriptionEvents,
  subscriptions,
  tasteGrants,
  taxRules,
  userNotifications,
  users,
} from "../src/schema/index.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import {
  itHasNames,
  rejection,
  sqlState,
  unique,
  uniqueKey,
  urlFor,
  type NameSpec,
} from "./schema-kit.js";

/*
 * Phase 3 billing core (migration 0010): orders, payments, catalog, subscriptions, promotions.
 * Constraint names are listed by hand; every CHECK is also exercised with a violating row.
 */

const SPEC: NameSpec = {
  checks: [
    "credit_pack_prices_currency_check",
    "credit_pack_prices_amount_check",
    "credit_packs_key_check",
    "credit_packs_credits_check",
    "credit_packs_bonus_credits_check",
    "credit_packs_valid_months_check",
    "orders_owner_check",
    "orders_kind_check",
    "orders_status_check",
    "orders_payment_kind_check",
    "orders_currency_check",
    "orders_months_check",
    "orders_refs_check",
    "orders_quote_hash_check",
    "orders_amounts_check",
    "orders_paid_at_check",
    "outbox_topic_check",
    "outbox_attempts_check",
    "payment_events_payload_check",
    "payment_gateways_key_check",
    "payment_gateways_provider_check",
    "payment_gateways_mode_check",
    "payment_gateway_tests_mode_check",
    "payment_gateway_tests_status_check",
    "payment_gateway_tests_amount_check",
    "payment_gateway_tests_currency_check",
    "payment_methods_key_check",
    "payment_methods_kind_check",
    "payment_methods_provider_check",
    "payment_methods_fee_bps_check",
    "payment_methods_fee_fixed_check",
    "payment_methods_amount_range_check",
    "payment_methods_currencies_check",
    "payment_methods_config_check",
    "payment_methods_review_sla_check",
    "payments_status_check",
    "payments_currency_check",
    "payments_amount_check",
    "payments_proof_submissions_check",
    "payments_flags_check",
    "plan_prices_months_check",
    "plan_prices_currency_check",
    "plan_prices_amount_check",
    "refunds_status_check",
    "refunds_currency_check",
    "refunds_amount_check",
    "refunds_reason_check",
    "tax_rules_country_check",
    "tax_rules_rate_bps_check",
    "tax_rules_mode_check",
    "tax_rules_applies_to_check",
    "coupon_redemptions_owner_check",
    "coupon_redemptions_status_check",
    "coupons_kind_check",
    "coupons_value_check",
    "coupons_currency_check",
    "coupons_audience_check",
    "coupons_min_amount_check",
    "coupons_period_check",
    "coupons_max_redemptions_check",
    "coupons_per_owner_limit_check",
    "coupons_redeemed_count_check",
    "coupons_stacking_check",
    "coupons_status_check",
    "coupons_code_check",
    "coupons_target_check",
    "promotions_kind_check",
    "promotions_value_check",
    "promotions_currency_check",
    "promotions_audience_check",
    "promotions_min_amount_check",
    "promotions_period_check",
    "promotions_max_redemptions_check",
    "promotions_per_owner_limit_check",
    "promotions_redeemed_count_check",
    "promotions_stacking_check",
    "promotions_status_check",
    "promotions_countdown_check",
    "personal_offers_kind_check",
    "personal_offers_template_check",
    "personal_offers_shown_count_check",
    "subscription_events_type_check",
    "subscription_events_data_check",
    "subscriptions_owner_check",
    "subscriptions_status_check",
    "subscriptions_source_check",
    "subscriptions_period_check",
    "subscriptions_months_paid_check",
    "taste_grants_owner_check",
    "taste_grants_feature_check",
    "taste_grants_period_key_check",
    "taste_grants_expires_check",
    "taste_grants_credits_check",
    "user_notifications_kind_check",
    "user_notifications_params_check",
    "credit_ledger_kind_check",
    "plans_features_check",
    "plans_trial_days_check",
    "plans_max_members_check",
  ],
  uniques: [
    "credit_pack_prices_pack_currency_key",
    "credit_packs_key_key",
    "orders_number_key",
    "payment_events_provider_event_id_key",
    "payment_gateways_key_key",
    "payment_gateway_tests_provider_order_id_key",
    "payment_methods_key_key",
    "payments_reference_key",
    "plan_prices_plan_months_currency_key",
    "coupon_redemptions_coupon_order_key",
    "coupons_code_key",
  ],
  indexes: [
    "orders_owner_user_created_idx",
    "orders_owner_org_created_idx",
    "orders_pending_expires_idx",
    "outbox_idempotency_key_key",
    "outbox_pending_idx",
    "payment_events_payment_received_idx",
    "payments_gateway_provider_ref_key",
    "payments_method_txn_id_key",
    "payments_order_idx",
    "payments_review_queue_idx",
    "payment_gateway_tests_gateway_status_created_idx",
    "refunds_provider_ref_key",
    "refunds_payment_idx",
    "coupon_redemptions_coupon_owner_user_idx",
    "coupon_redemptions_coupon_owner_org_idx",
    "coupon_redemptions_order_idx",
    "coupons_batch_idx",
    "promotions_status_starts_idx",
    "personal_offers_owner_expires_idx",
    "subscription_events_subscription_created_idx",
    "subscriptions_owner_user_live_key",
    "subscriptions_owner_org_live_key",
    "subscriptions_period_end_idx",
    "taste_grants_owner_user_period_key",
    "taste_grants_owner_org_period_key",
    "taste_grants_analysis_idx",
    "user_notifications_user_created_idx",
    "user_notifications_unread_idx",
    "plan_assignments_subscription_idx",
  ],
  foreignKeys: [
    ["credit_pack_prices_pack_id_credit_packs_id_fk", "cascade"],
    ["orders_owner_user_id_users_id_fk", "restrict"],
    ["orders_owner_org_id_organizations_id_fk", "restrict"],
    ["orders_plan_id_plans_id_fk", "restrict"],
    ["orders_pack_id_credit_packs_id_fk", "restrict"],
    ["payment_events_payment_id_payments_id_fk", "set null"],
    ["payment_gateway_tests_created_by_users_id_fk", "set null"],
    ["payments_order_id_orders_id_fk", "restrict"],
    ["payments_proof_file_id_files_id_fk", "set null"],
    ["payments_reviewed_by_users_id_fk", "set null"],
    ["payments_second_approved_by_users_id_fk", "set null"],
    ["plan_prices_plan_id_plans_id_fk", "cascade"],
    ["refunds_payment_id_payments_id_fk", "restrict"],
    ["refunds_requested_by_users_id_fk", "set null"],
    ["refunds_approved_by_users_id_fk", "set null"],
    ["coupon_redemptions_coupon_id_coupons_id_fk", "restrict"],
    ["coupon_redemptions_order_id_orders_id_fk", "restrict"],
    ["coupon_redemptions_owner_user_id_users_id_fk", "restrict"],
    ["coupon_redemptions_owner_org_id_organizations_id_fk", "restrict"],
    ["coupons_created_by_users_id_fk", "set null"],
    ["coupons_target_user_id_users_id_fk", "cascade"],
    ["coupons_target_org_id_organizations_id_fk", "cascade"],
    ["promotions_created_by_users_id_fk", "set null"],
    ["personal_offers_owner_user_id_users_id_fk", "restrict"],
    ["personal_offers_promotion_id_promotions_id_fk", "set null"],
    ["personal_offers_coupon_id_coupons_id_fk", "set null"],
    ["subscription_events_subscription_id_subscriptions_id_fk", "restrict"],
    ["subscription_events_actor_id_users_id_fk", "set null"],
    ["subscriptions_owner_user_id_users_id_fk", "restrict"],
    ["subscriptions_owner_org_id_organizations_id_fk", "restrict"],
    ["subscriptions_plan_id_plans_id_fk", "restrict"],
    ["subscriptions_last_order_id_orders_id_fk", "set null"],
    ["subscriptions_created_by_users_id_fk", "set null"],
    ["taste_grants_owner_user_id_users_id_fk", "restrict"],
    ["taste_grants_owner_org_id_organizations_id_fk", "restrict"],
    ["taste_grants_source_analysis_id_rx_analyses_id_fk", "set null"],
    ["taste_grants_analysis_id_rx_analyses_id_fk", "set null"],
    ["user_notifications_user_id_users_id_fk", "cascade"],
    ["plan_assignments_subscription_id_subscriptions_id_fk", "set null"],
  ],
};

let fixture: TestDb;
let api: ReturnType<typeof createDb>;
const API_PASSWORD = "api-password-3";

beforeAll(async () => {
  fixture = await startTestDb();
  await setApiRolePassword(fixture.handle.db, API_PASSWORD);
  api = createDb({ url: urlFor(fixture.url, API_DB_ROLE, API_PASSWORD), max: 1 });
}, 180_000);

afterAll(async () => {
  await api?.close();
  await fixture?.stop();
});

const db = () => fixture.handle.db;
/** An invalid value for a typed column: the point of these tests is that the database refuses it. */
const bad = (value: unknown): never => value as never;
const HASH = "a".repeat(64);
const inOneDay = () => new Date(Date.now() + 86_400_000);
const DAY = 86_400_000;

async function one<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error("insert returned no row");
  return row;
}

const newUser = () =>
  one(
    db()
      .insert(users)
      .values({ name: "Test", email: `${unique("user")}@example.com` })
      .returning(),
  );
const newOrg = (createdBy: string) =>
  one(
    db()
      .insert(organizations)
      .values({ name: "Org", type: "pharmacy", country: "EG", createdBy })
      .returning(),
  );
const newPlan = () =>
  one(
    db()
      .insert(plans)
      .values({ key: uniqueKey("plan"), nameAr: "خطة", nameEn: "Plan" })
      .returning(),
  );
const newPack = () =>
  one(
    db()
      .insert(creditPacks)
      .values({ key: uniqueKey("pack"), nameAr: "حزمة", nameEn: "Pack", credits: 100 })
      .returning(),
  );

function orderValues(ownerUserId: string, planId: string, overrides: object = {}) {
  return {
    ownerUserId,
    kind: "subscription" as const,
    planId,
    months: 1,
    currency: "EGP",
    quote: {},
    quoteHash: HASH,
    subtotalMinor: 9_900,
    totalMinor: 9_900,
    expiresAt: inOneDay(),
    ...overrides,
  };
}
const newOrder = (ownerUserId: string, planId: string, overrides: object = {}) =>
  one(
    db()
      .insert(orders)
      .values(orderValues(ownerUserId, planId, overrides) as never)
      .returning(),
  );

function paymentValues(orderId: string, overrides: object = {}) {
  return {
    orderId,
    reference: unique("WSP"),
    methodKey: "instapay",
    amountMinor: 9_900,
    currency: "EGP",
    ...overrides,
  };
}
const newPayment = (orderId: string, overrides: object = {}) =>
  one(
    db()
      .insert(payments)
      .values(paymentValues(orderId, overrides) as never)
      .returning(),
  );

function discountValues(overrides: object = {}) {
  return {
    name: "Spring",
    titleAr: "خصم",
    titleEn: "Discount",
    kind: "percent",
    value: 1_000,
    ...overrides,
  };
}
const promotionValues = (overrides: object = {}) =>
  discountValues(overrides) as typeof promotions.$inferInsert;
const couponValues = (overrides: object = {}) =>
  ({ ...discountValues(), code: unique("CODE"), ...overrides }) as typeof coupons.$inferInsert;

interface Ctx {
  user: typeof users.$inferSelect;
  other: typeof users.$inferSelect;
  org: typeof organizations.$inferSelect;
  plan: typeof plans.$inferSelect;
  pack: typeof creditPacks.$inferSelect;
  order: typeof orders.$inferSelect;
  payment: typeof payments.$inferSelect;
  subscription: typeof subscriptions.$inferSelect;
}
const ctx = {} as Ctx;

beforeAll(async () => {
  ctx.user = await newUser();
  ctx.other = await newUser();
  ctx.org = await newOrg(ctx.user.id);
  ctx.plan = await newPlan();
  ctx.pack = await newPack();
  ctx.order = await newOrder(ctx.user.id, ctx.plan.id);
  ctx.payment = await newPayment(ctx.order.id);
  ctx.subscription = await one(
    db()
      .insert(subscriptions)
      .values({
        ownerUserId: ctx.other.id,
        planId: ctx.plan.id,
        status: "expired",
        source: "paid",
        currentPeriodStart: new Date(Date.now() - 30 * DAY),
        currentPeriodEnd: new Date(Date.now() - DAY),
      })
      .returning(),
  );
}, 180_000);

type Case = readonly [constraint: string, run: () => Promise<unknown>];

/** One violating statement per CHECK; the database must name exactly that constraint. */
function checkCases(): Case[] {
  const subscriptionValues = (overrides: object = {}) =>
    ({
      ownerUserId: ctx.user.id,
      planId: ctx.plan.id,
      status: "expired",
      source: "paid",
      currentPeriodStart: new Date(Date.now() - 30 * DAY),
      currentPeriodEnd: new Date(Date.now() - DAY),
      ...overrides,
    }) as typeof subscriptions.$inferInsert;
  const taste = (overrides: object = {}) =>
    ({
      ownerUserId: ctx.user.id,
      feature: "deep_mode",
      periodKey: unique("2026-W"),
      expiresAt: inOneDay(),
      ...overrides,
    }) as typeof tasteGrants.$inferInsert;
  const method = (overrides: object = {}) =>
    ({
      key: uniqueKey("method"),
      kind: "manual",
      provider: "instapay",
      nameAr: "طريقة",
      nameEn: "Method",
      currencies: ["EGP"],
      ...overrides,
    }) as typeof paymentMethods.$inferInsert;
  const gateway = (overrides: object = {}) =>
    ({
      key: uniqueKey("gw"),
      provider: "kashier",
      ...overrides,
    }) as typeof paymentGateways.$inferInsert;
  const gatewayTest = (overrides: object = {}) =>
    ({
      gatewayKey: "kashier",
      mode: "test",
      providerOrderId: unique("gwtest"),
      amountMinor: 100,
      currency: "EGP",
      ...overrides,
    }) as typeof paymentGatewayTests.$inferInsert;
  const tax = (overrides: object = {}) =>
    ({
      nameAr: "ضريبة",
      nameEn: "VAT",
      rateBps: 1_400,
      mode: "inclusive",
      ...overrides,
    }) as typeof taxRules.$inferInsert;
  const refund = (overrides: object = {}) =>
    ({
      paymentId: ctx.payment.id,
      amountMinor: 100,
      currency: "EGP",
      reason: "customer request",
      ...overrides,
    }) as typeof refunds.$inferInsert;
  const redemption = (overrides: object = {}) =>
    ({ ownerUserId: ctx.user.id, ...overrides }) as typeof couponRedemptions.$inferInsert;

  // The checks both discount tables share, applied to promotions and coupons alike.
  const discountCases = (
    table: "promotions" | "coupons",
    insert: (overrides: object) => Promise<unknown>,
  ): Case[] => [
    [`${table}_value_check`, () => insert({ kind: "percent", value: 0 })],
    [`${table}_currency_check`, () => insert({ kind: "fixed", value: 100 })],
    [`${table}_audience_check`, () => insert({ audience: "everyone" })],
    [`${table}_min_amount_check`, () => insert({ minAmountMinor: -1 })],
    [
      `${table}_period_check`,
      () => insert({ startsAt: new Date(Date.now() + DAY), endsAt: new Date() }),
    ],
    [`${table}_max_redemptions_check`, () => insert({ maxRedemptions: 0 })],
    [`${table}_per_owner_limit_check`, () => insert({ perOwnerLimit: 0 })],
    [`${table}_redeemed_count_check`, () => insert({ maxRedemptions: 1, redeemedCount: 2 })],
    [`${table}_stacking_check`, () => insert({ stacking: "both" })],
    [`${table}_status_check`, () => insert({ status: "live" })],
  ];

  return [
    // Catalog.
    [
      "plan_prices_months_check",
      () =>
        db()
          .insert(planPrices)
          .values({ planId: ctx.plan.id, months: 25, currency: "EGP", amountMinor: 1 }),
    ],
    [
      "plan_prices_currency_check",
      () =>
        db()
          .insert(planPrices)
          .values({ planId: ctx.plan.id, months: 1, currency: "egp", amountMinor: 1 }),
    ],
    [
      "plan_prices_amount_check",
      () =>
        db()
          .insert(planPrices)
          .values({ planId: ctx.plan.id, months: 1, currency: "EGP", amountMinor: -1 }),
    ],
    [
      "credit_packs_key_check",
      () =>
        db().insert(creditPacks).values({ key: "Bad Key", nameAr: "ا", nameEn: "a", credits: 1 }),
    ],
    [
      "credit_packs_credits_check",
      () =>
        db()
          .insert(creditPacks)
          .values({ key: uniqueKey("pack"), nameAr: "ا", nameEn: "a", credits: 0 }),
    ],
    [
      "credit_packs_bonus_credits_check",
      () =>
        db()
          .insert(creditPacks)
          .values({
            key: uniqueKey("pack"),
            nameAr: "ا",
            nameEn: "a",
            credits: 1,
            bonusCredits: -1,
          }),
    ],
    [
      "credit_packs_valid_months_check",
      () =>
        db()
          .insert(creditPacks)
          .values({ key: uniqueKey("pack"), nameAr: "ا", nameEn: "a", credits: 1, validMonths: 0 }),
    ],
    [
      "credit_pack_prices_currency_check",
      () =>
        db()
          .insert(creditPackPrices)
          .values({ packId: ctx.pack.id, currency: "EG", amountMinor: 1 }),
    ],
    [
      "credit_pack_prices_amount_check",
      () =>
        db()
          .insert(creditPackPrices)
          .values({ packId: ctx.pack.id, currency: "EGP", amountMinor: -1 }),
    ],
    [
      "tax_rules_country_check",
      () =>
        db()
          .insert(taxRules)
          .values(tax({ country: "egypt" })),
    ],
    [
      "tax_rules_rate_bps_check",
      () =>
        db()
          .insert(taxRules)
          .values(tax({ rateBps: 10_001 })),
    ],
    [
      "tax_rules_mode_check",
      () =>
        db()
          .insert(taxRules)
          .values(tax({ mode: "both" })),
    ],
    [
      "tax_rules_applies_to_check",
      () =>
        db()
          .insert(taxRules)
          .values(tax({ appliesTo: "x" })),
    ],
    [
      "payment_methods_key_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ key: "A" })),
    ],
    [
      "payment_methods_kind_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ kind: "x" })),
    ],
    [
      "payment_methods_provider_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ provider: "Insta Pay" })),
    ],
    [
      "payment_methods_fee_bps_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ feeBps: 10_001 })),
    ],
    [
      "payment_methods_fee_fixed_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ feeFixedMinor: -1 })),
    ],
    [
      "payment_methods_amount_range_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ minAmountMinor: 500, maxAmountMinor: 100 })),
    ],
    [
      "payment_methods_currencies_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ currencies: [] })),
    ],
    [
      "payment_methods_config_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ config: [] })),
    ],
    [
      "payment_methods_review_sla_check",
      () =>
        db()
          .insert(paymentMethods)
          .values(method({ reviewSlaMinutes: 0 })),
    ],
    [
      "payment_gateways_key_check",
      () =>
        db()
          .insert(paymentGateways)
          .values(gateway({ key: "K" })),
    ],
    [
      "payment_gateways_provider_check",
      () =>
        db()
          .insert(paymentGateways)
          .values(gateway({ provider: "Kash ier" })),
    ],
    [
      "payment_gateways_mode_check",
      () =>
        db()
          .insert(paymentGateways)
          .values(gateway({ mode: "staging" })),
    ],
    [
      "payment_gateway_tests_mode_check",
      () =>
        db()
          .insert(paymentGatewayTests)
          .values(gatewayTest({ mode: "staging" })),
    ],
    [
      "payment_gateway_tests_status_check",
      () =>
        db()
          .insert(paymentGatewayTests)
          .values(gatewayTest({ status: "waiting" })),
    ],
    [
      "payment_gateway_tests_amount_check",
      () =>
        db()
          .insert(paymentGatewayTests)
          .values(gatewayTest({ amountMinor: 0 })),
    ],
    [
      "payment_gateway_tests_currency_check",
      () =>
        db()
          .insert(paymentGatewayTests)
          .values(gatewayTest({ currency: "egp" })),
    ],

    // Orders.
    [
      "orders_owner_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { ownerUserId: undefined }) as never),
    ],
    [
      "orders_kind_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { kind: "gift" }) as never),
    ],
    [
      "orders_status_check",
      () =>
        db()
          .insert(orders)
          .values(
            orderValues(ctx.user.id, ctx.plan.id, { status: "open", paidAt: new Date() }) as never,
          ),
    ],
    [
      "orders_payment_kind_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { paymentKind: "cash" }) as never),
    ],
    [
      "orders_currency_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { currency: "egp" }) as never),
    ],
    [
      "orders_months_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { months: 25 }) as never),
    ],
    [
      "orders_refs_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { planId: null }) as never),
    ],
    [
      "orders_quote_hash_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { quoteHash: "xyz" }) as never),
    ],
    [
      "orders_amounts_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { discountMinor: -1 }) as never),
    ],
    [
      "orders_paid_at_check",
      () =>
        db()
          .insert(orders)
          .values(orderValues(ctx.user.id, ctx.plan.id, { status: "paid" }) as never),
    ],

    // Payments.
    [
      "payments_status_check",
      () =>
        db()
          .insert(payments)
          .values(paymentValues(ctx.order.id, { status: "done" }) as never),
    ],
    [
      "payments_currency_check",
      () =>
        db()
          .insert(payments)
          .values(paymentValues(ctx.order.id, { currency: "E" }) as never),
    ],
    [
      "payments_amount_check",
      () =>
        db()
          .insert(payments)
          .values(paymentValues(ctx.order.id, { amountMinor: 0 }) as never),
    ],
    [
      "payments_proof_submissions_check",
      () =>
        db()
          .insert(payments)
          .values(paymentValues(ctx.order.id, { proofSubmissions: 4 }) as never),
    ],
    [
      "payments_flags_check",
      () =>
        db()
          .insert(payments)
          .values(paymentValues(ctx.order.id, { flags: {} }) as never),
    ],
    [
      "payment_events_payload_check",
      () =>
        db()
          .insert(paymentEvents)
          .values({
            provider: "kashier",
            eventId: unique("evt"),
            type: "payment.succeeded",
            payload: bad([]),
            signatureOk: true,
          }),
    ],
    [
      "refunds_status_check",
      () =>
        db()
          .insert(refunds)
          .values(refund({ status: "done" })),
    ],
    [
      "refunds_currency_check",
      () =>
        db()
          .insert(refunds)
          .values(refund({ currency: "e" })),
    ],
    [
      "refunds_amount_check",
      () =>
        db()
          .insert(refunds)
          .values(refund({ amountMinor: 0 })),
    ],
    [
      "refunds_reason_check",
      () =>
        db()
          .insert(refunds)
          .values(refund({ reason: "  " })),
    ],
    ["outbox_topic_check", () => db().insert(outbox).values({ topic: "Receipt Mail" })],
    [
      "outbox_attempts_check",
      () => db().insert(outbox).values({ topic: "mail.receipt", attempts: -1 }),
    ],

    // Subscriptions, offers, grants, notifications.
    [
      "subscriptions_owner_check",
      () =>
        db()
          .insert(subscriptions)
          .values(subscriptionValues({ ownerOrgId: ctx.org.id })),
    ],
    [
      "subscriptions_status_check",
      () =>
        db()
          .insert(subscriptions)
          .values(subscriptionValues({ status: "paused" })),
    ],
    [
      "subscriptions_source_check",
      () =>
        db()
          .insert(subscriptions)
          .values(subscriptionValues({ source: "gift" })),
    ],
    [
      "subscriptions_period_check",
      () =>
        db()
          .insert(subscriptions)
          .values(subscriptionValues({ currentPeriodEnd: new Date(Date.now() - 31 * DAY) })),
    ],
    [
      "subscriptions_months_paid_check",
      () =>
        db()
          .insert(subscriptions)
          .values(subscriptionValues({ monthsPaid: -1 })),
    ],
    [
      "subscription_events_type_check",
      () =>
        db()
          .insert(subscriptionEvents)
          .values({ subscriptionId: ctx.subscription.id, type: bad("paused") }),
    ],
    [
      "subscription_events_data_check",
      () =>
        db()
          .insert(subscriptionEvents)
          .values({ subscriptionId: ctx.subscription.id, type: "created", data: bad([]) }),
    ],
    [
      "personal_offers_kind_check",
      () =>
        db()
          .insert(personalOffers)
          .values({ ownerUserId: ctx.user.id, kind: bad("gift"), expiresAt: inOneDay() }),
    ],
    [
      "personal_offers_template_check",
      async () => {
        const promotion = await one(db().insert(promotions).values(promotionValues()).returning());
        const coupon = await one(db().insert(coupons).values(couponValues()).returning());
        await db().insert(personalOffers).values({
          ownerUserId: ctx.user.id,
          kind: "welcome",
          expiresAt: inOneDay(),
          promotionId: promotion.id,
          couponId: coupon.id,
        });
      },
    ],
    [
      "personal_offers_shown_count_check",
      () =>
        db().insert(personalOffers).values({
          ownerUserId: ctx.user.id,
          kind: "welcome",
          expiresAt: inOneDay(),
          shownCount: -1,
        }),
    ],
    [
      "taste_grants_owner_check",
      () =>
        db()
          .insert(tasteGrants)
          .values(taste({ ownerOrgId: ctx.org.id })),
    ],
    [
      "taste_grants_feature_check",
      () =>
        db()
          .insert(tasteGrants)
          .values(taste({ feature: "Deep Mode" })),
    ],
    [
      "taste_grants_period_key_check",
      () =>
        db()
          .insert(tasteGrants)
          .values(taste({ periodKey: "" })),
    ],
    [
      "taste_grants_expires_check",
      () =>
        db()
          .insert(tasteGrants)
          .values(taste({ expiresAt: new Date(Date.now() - DAY) })),
    ],
    [
      "taste_grants_credits_check",
      () =>
        db()
          .insert(tasteGrants)
          .values(taste({ credits: -1 })),
    ],
    [
      "user_notifications_kind_check",
      () => db().insert(userNotifications).values({ userId: ctx.user.id, kind: "Order Paid" }),
    ],
    [
      "user_notifications_params_check",
      () =>
        db()
          .insert(userNotifications)
          .values({ userId: ctx.user.id, kind: "order.paid", params: bad([]) }),
    ],

    // Promotions and coupons.
    [
      "promotions_kind_check",
      () =>
        db()
          .insert(promotions)
          .values(promotionValues({ kind: "trial_extension" })),
    ],
    [
      "promotions_countdown_check",
      () =>
        db()
          .insert(promotions)
          .values(promotionValues({ showCountdown: true })),
    ],
    ...discountCases("promotions", (overrides) =>
      db().insert(promotions).values(promotionValues(overrides)),
    ),
    [
      "coupons_kind_check",
      () =>
        db()
          .insert(coupons)
          .values(couponValues({ kind: "gift" })),
    ],
    [
      "coupons_code_check",
      () =>
        db()
          .insert(coupons)
          .values(couponValues({ code: "ab" })),
    ],
    [
      "coupons_target_check",
      () =>
        db()
          .insert(coupons)
          .values(couponValues({ targetUserId: ctx.user.id, targetOrgId: ctx.org.id })),
    ],
    ...discountCases("coupons", (overrides) =>
      db().insert(coupons).values(couponValues(overrides)),
    ),
    [
      "coupon_redemptions_owner_check",
      async () => {
        const coupon = await one(db().insert(coupons).values(couponValues()).returning());
        const order = await newOrder(ctx.user.id, ctx.plan.id);
        await db()
          .insert(couponRedemptions)
          .values(redemption({ couponId: coupon.id, orderId: order.id, ownerUserId: null }));
      },
    ],
    [
      "coupon_redemptions_status_check",
      async () => {
        const coupon = await one(db().insert(coupons).values(couponValues()).returning());
        const order = await newOrder(ctx.user.id, ctx.plan.id);
        await db()
          .insert(couponRedemptions)
          .values(redemption({ couponId: coupon.id, orderId: order.id, status: bad("used") }));
      },
    ],

    // Phase 2 tables changed by this migration.
    [
      "plans_features_check",
      () =>
        db()
          .insert(plans)
          .values({ key: uniqueKey("plan"), nameAr: "ا", nameEn: "a", features: bad({}) }),
    ],
    [
      "plans_trial_days_check",
      () =>
        db()
          .insert(plans)
          .values({ key: uniqueKey("plan"), nameAr: "ا", nameEn: "a", trialDays: 366 }),
    ],
    [
      "plans_max_members_check",
      () =>
        db()
          .insert(plans)
          .values({ key: uniqueKey("plan"), nameAr: "ا", nameEn: "a", maxMembers: 0 }),
    ],
    [
      "credit_ledger_kind_check",
      async () => {
        const wallet = await one(
          db()
            .insert(creditWallets)
            .values({ ownerUserId: ctx.user.id })
            .onConflictDoUpdate({
              target: creditWallets.ownerUserId,
              set: { balance: 0 },
            })
            .returning(),
        );
        await db()
          .insert(creditLedger)
          .values({
            walletId: wallet.id,
            kind: bad("bonus"),
            amount: 1,
            balanceAfter: 1,
            idempotencyKey: unique("bad-kind"),
          });
      },
    ],
  ];
}

describe("Phase 3 billing schema: names", () => {
  itHasNames(db, SPEC);

  it("exercises every CHECK with a violating row (no check is only named, never tried)", () => {
    const covered = new Set(checkCases().map(([name]) => name));
    expect(SPEC.checks.filter((name) => !covered.has(name))).toEqual([]);
  });
});

describe("Phase 3 billing schema: CHECK constraints", () => {
  const names = checkCases().map(([name]) => name);
  it.each(names.map((name, index) => [name, index] as const))("%s", async (name, index) => {
    const entry = checkCases()[index];
    expect(entry?.[0]).toBe(name);
    expect(await rejection(() => entry?.[1]() ?? Promise.resolve())).toBe(name);
  });

  it("accepts the new credit ledger kinds", async () => {
    const wallet = await one(
      db().insert(creditWallets).values({ ownerOrgId: ctx.org.id }).returning(),
    );
    for (const kind of ["purchase", "points_conversion", "trial_grant", "reward_bonus"] as const) {
      await db()
        .insert(creditLedger)
        .values({
          walletId: wallet.id,
          kind,
          amount: 5,
          balanceAfter: 5,
          idempotencyKey: unique(kind),
        });
    }
  });

  it("accepts a valid row of every table the checks above are written against", async () => {
    await db()
      .insert(planPrices)
      .values({ planId: ctx.plan.id, months: 12, currency: "EGP", amountMinor: 99_000 });
    await db()
      .insert(creditPackPrices)
      .values({ packId: ctx.pack.id, currency: "EGP", amountMinor: 7_900 });
    await db()
      .insert(promotions)
      .values(promotionValues({ kind: "fixed", value: 500, currency: "EGP" }));
    await db()
      .insert(promotions)
      .values(promotionValues({ showCountdown: true, endsAt: inOneDay() }));
    await db()
      .insert(coupons)
      .values(couponValues({ kind: "trial_extension", value: 7 }));
  });
});

describe("Phase 3 billing schema: unique constraints and idempotency keys", () => {
  it("plan_prices: one price per plan, period and currency", async () => {
    const plan = await newPlan();
    const row = { planId: plan.id, months: 1, currency: "EGP", amountMinor: 9_900 };
    await db().insert(planPrices).values(row);
    expect(await rejection(() => db().insert(planPrices).values(row))).toBe(
      "plan_prices_plan_months_currency_key",
    );
    await db()
      .insert(planPrices)
      .values({ ...row, currency: "SAR" });
  });

  it("credit packs: unique key, one price per pack and currency", async () => {
    const pack = await newPack();
    expect(
      await rejection(() =>
        db().insert(creditPacks).values({ key: pack.key, nameAr: "ا", nameEn: "a", credits: 1 }),
      ),
    ).toBe("credit_packs_key_key");
    await db()
      .insert(creditPackPrices)
      .values({ packId: pack.id, currency: "EGP", amountMinor: 1 });
    expect(
      await rejection(() =>
        db().insert(creditPackPrices).values({ packId: pack.id, currency: "EGP", amountMinor: 2 }),
      ),
    ).toBe("credit_pack_prices_pack_currency_key");
  });

  it("payment methods and gateways: unique key", async () => {
    const key = uniqueKey("method");
    const row = {
      key,
      kind: "manual",
      provider: "instapay",
      nameAr: "ا",
      nameEn: "a",
      currencies: ["EGP"],
    } satisfies typeof paymentMethods.$inferInsert;
    await db().insert(paymentMethods).values(row);
    expect(await rejection(() => db().insert(paymentMethods).values(row))).toBe(
      "payment_methods_key_key",
    );
    const gateway = { key: uniqueKey("gw"), provider: "kashier" };
    await db().insert(paymentGateways).values(gateway);
    expect(await rejection(() => db().insert(paymentGateways).values(gateway))).toBe(
      "payment_gateways_key_key",
    );
  });

  it("gateway test provider order ids are unique", async () => {
    const row = {
      gatewayKey: "kashier",
      mode: "test",
      providerOrderId: unique("gwtest"),
      amountMinor: 100,
      currency: "EGP",
    } as const;
    await db().insert(paymentGatewayTests).values(row);
    expect(await rejection(() => db().insert(paymentGatewayTests).values(row))).toBe(
      "payment_gateway_tests_provider_order_id_key",
    );
  });

  it("orders: the number is built by the database from a sequence and is unique", async () => {
    const first = await newOrder(ctx.user.id, ctx.plan.id);
    const second = await newOrder(ctx.user.id, ctx.plan.id);
    expect(first.number).toMatch(/^WSO-\d{4}-\d{6}$/);
    expect(second.number).not.toBe(first.number);
    expect(
      await rejection(() => newOrder(ctx.user.id, ctx.plan.id, { number: first.number })),
    ).toBe("orders_number_key");
  });

  it("payments: unique reference; unique (gateway, provider_ref) and (method, txn id) only when set", async () => {
    const order = await newOrder(ctx.user.id, ctx.plan.id);
    const reference = unique("WSP");
    await newPayment(order.id, { reference });
    expect(await rejection(() => newPayment(order.id, { reference }))).toBe(
      "payments_reference_key",
    );

    const providerRef = unique("prov");
    await newPayment(order.id, { gateway: "kashier", providerRef });
    expect(await rejection(() => newPayment(order.id, { gateway: "kashier", providerRef }))).toBe(
      "payments_gateway_provider_ref_key",
    );
    await newPayment(order.id, { gateway: "fake", providerRef });
    await newPayment(order.id, { gateway: "kashier" });
    await newPayment(order.id, { gateway: "kashier" });

    const txnId = unique("txn");
    await newPayment(order.id, { methodKey: "instapay", txnId });
    expect(await rejection(() => newPayment(order.id, { methodKey: "instapay", txnId }))).toBe(
      "payments_method_txn_id_key",
    );
    await newPayment(order.id, { methodKey: "vodafone_cash", txnId });
    await newPayment(order.id, { methodKey: "instapay" });
    await newPayment(order.id, { methodKey: "instapay" });
  });

  it("payment_events: (provider, event_id) is the replay shield", async () => {
    const event = {
      provider: "kashier",
      eventId: unique("evt"),
      type: "payment.succeeded",
      signatureOk: true,
    };
    await db().insert(paymentEvents).values(event);
    expect(await rejection(() => db().insert(paymentEvents).values(event))).toBe(
      "payment_events_provider_event_id_key",
    );
    await db()
      .insert(paymentEvents)
      .values({ ...event, provider: "other" });
  });

  it("refunds: provider_ref is unique when set", async () => {
    const providerRef = unique("rf");
    const row = {
      paymentId: ctx.payment.id,
      amountMinor: 100,
      currency: "EGP",
      reason: "r",
      providerRef,
    };
    await db().insert(refunds).values(row);
    expect(await rejection(() => db().insert(refunds).values(row))).toBe(
      "refunds_provider_ref_key",
    );
    await db()
      .insert(refunds)
      .values({ ...row, providerRef: null });
    await db()
      .insert(refunds)
      .values({ ...row, providerRef: null });
  });

  it("outbox: idempotency_key is unique when set", async () => {
    const idempotencyKey = unique("order-receipt");
    await db().insert(outbox).values({ topic: "mail.receipt", idempotencyKey });
    expect(
      await rejection(() => db().insert(outbox).values({ topic: "mail.receipt", idempotencyKey })),
    ).toBe("outbox_idempotency_key_key");
    await db().insert(outbox).values({ topic: "mail.receipt" });
    await db().insert(outbox).values({ topic: "mail.receipt" });
  });

  it("coupons: unique code; one redemption per coupon and order", async () => {
    const coupon = await one(db().insert(coupons).values(couponValues()).returning());
    expect(
      await rejection(() =>
        db()
          .insert(coupons)
          .values(couponValues({ code: coupon.code })),
      ),
    ).toBe("coupons_code_key");
    const order = await newOrder(ctx.user.id, ctx.plan.id);
    await db()
      .insert(couponRedemptions)
      .values({ couponId: coupon.id, orderId: order.id, ownerUserId: ctx.user.id });
    expect(
      await rejection(() =>
        db()
          .insert(couponRedemptions)
          .values({ couponId: coupon.id, orderId: order.id, ownerUserId: ctx.user.id }),
      ),
    ).toBe("coupon_redemptions_coupon_order_key");
  });

  it("subscriptions: one live subscription per user and per organization, any number of past ones", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    const base = {
      planId: ctx.plan.id,
      source: "paid" as const,
      currentPeriodStart: new Date(Date.now() - DAY),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    };
    await db()
      .insert(subscriptions)
      .values({ ...base, ownerUserId: user.id, status: "expired" });
    await db()
      .insert(subscriptions)
      .values({ ...base, ownerUserId: user.id, status: "canceled" });
    await db()
      .insert(subscriptions)
      .values({ ...base, ownerUserId: user.id, status: "active" });
    for (const status of ["trialing", "active", "grace"] as const) {
      expect(
        await rejection(() =>
          db()
            .insert(subscriptions)
            .values({ ...base, ownerUserId: user.id, status }),
        ),
      ).toBe("subscriptions_owner_user_live_key");
    }
    await db()
      .insert(subscriptions)
      .values({ ...base, ownerOrgId: org.id, status: "grace" });
    expect(
      await rejection(() =>
        db()
          .insert(subscriptions)
          .values({ ...base, ownerOrgId: org.id, status: "active" }),
      ),
    ).toBe("subscriptions_owner_org_live_key");
    await db()
      .insert(subscriptions)
      .values({ ...base, ownerOrgId: org.id, status: "expired" });
  });

  it("taste grants: one per owner, feature and period", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    const row = { feature: "deep_mode", periodKey: "2026-W42", expiresAt: inOneDay() };
    await db()
      .insert(tasteGrants)
      .values({ ...row, ownerUserId: user.id });
    expect(
      await rejection(() =>
        db()
          .insert(tasteGrants)
          .values({ ...row, ownerUserId: user.id }),
      ),
    ).toBe("taste_grants_owner_user_period_key");
    await db()
      .insert(tasteGrants)
      .values({ ...row, ownerUserId: user.id, periodKey: "2026-W43" });
    await db()
      .insert(tasteGrants)
      .values({ ...row, ownerOrgId: org.id });
    expect(
      await rejection(() =>
        db()
          .insert(tasteGrants)
          .values({ ...row, ownerOrgId: org.id }),
      ),
    ).toBe("taste_grants_owner_org_period_key");
  });
});

describe("Phase 3 billing schema: foreign-key behaviour", () => {
  it("money history is never cascaded away: a user or organization with orders cannot be deleted", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    await db()
      .insert(orders)
      .values(
        orderValues(user.id, ctx.plan.id, { ownerUserId: undefined, ownerOrgId: org.id }) as never,
      );
    expect(await sqlState(db().execute(sql`delete from organizations where id = ${org.id}`))).toBe(
      "23001",
    );
    expect(await sqlState(db().execute(sql`delete from users where id = ${user.id}`))).toBe(
      "23001",
    );
  });

  it("a plan with prices can be deleted (prices go with it) but not while an order uses it", async () => {
    const plan = await newPlan();
    await db()
      .insert(planPrices)
      .values({ planId: plan.id, months: 1, currency: "EGP", amountMinor: 1 });
    await newOrder(ctx.user.id, plan.id);
    expect(await sqlState(db().execute(sql`delete from plans where id = ${plan.id}`))).toBe(
      "23001",
    );
    const free = await newPlan();
    await db()
      .insert(planPrices)
      .values({ planId: free.id, months: 1, currency: "EGP", amountMinor: 1 });
    await db().execute(sql`delete from plans where id = ${free.id}`);
    const left = await db().select().from(planPrices).where(eq(planPrices.planId, free.id));
    expect(left).toEqual([]);
  });

  it("a payment with a refund or events keeps them: the payment cannot be deleted, events are detached", async () => {
    const order = await newOrder(ctx.user.id, ctx.plan.id);
    const payment = await newPayment(order.id);
    await db()
      .insert(refunds)
      .values({ paymentId: payment.id, amountMinor: 1, currency: "EGP", reason: "r" });
    expect(await sqlState(db().execute(sql`delete from payments where id = ${payment.id}`))).toBe(
      "23001",
    );
    expect(await sqlState(db().execute(sql`delete from orders where id = ${order.id}`))).toBe(
      "23001",
    );

    const lone = await newPayment((await newOrder(ctx.user.id, ctx.plan.id)).id);
    const event = await one(
      db()
        .insert(paymentEvents)
        .values({
          provider: "kashier",
          eventId: unique("evt"),
          type: "t",
          signatureOk: false,
          paymentId: lone.id,
        })
        .returning(),
    );
    await db().execute(sql`delete from payments where id = ${lone.id}`);
    const [kept] = await db().select().from(paymentEvents).where(eq(paymentEvents.id, event.id));
    expect(kept?.paymentId).toBeNull();
  });

  it("assignments keep existing after their subscription is deleted (subscription_id set null)", async () => {
    const user = await newUser();
    const sub = await one(
      db()
        .insert(subscriptions)
        .values({
          ownerUserId: user.id,
          planId: ctx.plan.id,
          status: "expired",
          source: "paid",
          currentPeriodStart: new Date(Date.now() - 2 * DAY),
          currentPeriodEnd: new Date(Date.now() - DAY),
        })
        .returning(),
    );
    const assignment = await one(
      db()
        .insert(planAssignments)
        .values({ ownerUserId: user.id, planId: ctx.plan.id, subscriptionId: sub.id })
        .returning(),
    );
    await db().execute(sql`delete from subscriptions where id = ${sub.id}`);
    const [kept] = await db()
      .select()
      .from(planAssignments)
      .where(eq(planAssignments.id, assignment.id));
    expect(kept?.subscriptionId).toBeNull();
  });

  it("a private coupon follows its target organization", async () => {
    const user = await newUser();
    const org = await newOrg(user.id);
    const coupon = await one(
      db()
        .insert(coupons)
        .values(couponValues({ targetOrgId: org.id }))
        .returning(),
    );
    await db().execute(sql`delete from organizations where id = ${org.id}`);
    const left = await db()
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, coupon.id)));
    expect(left).toEqual([]);
  });
});

describe("Phase 3 billing schema: append-only grants for the API role", () => {
  it("payment_events and subscription_events: INSERT and SELECT only", async () => {
    await api.db.insert(paymentEvents).values({
      provider: "kashier",
      eventId: unique("evt"),
      type: "payment.succeeded",
      signatureOk: true,
    });
    await api.db
      .insert(subscriptionEvents)
      .values({ subscriptionId: ctx.subscription.id, type: "created" });
    expect((await api.db.select().from(paymentEvents)).length).toBeGreaterThan(0);
    expect((await api.db.select().from(subscriptionEvents)).length).toBeGreaterThan(0);

    for (const table of ["payment_events", "subscription_events"]) {
      expect(await sqlState(api.db.execute(sql.raw(`update ${table} set id = id`)))).toBe("42501");
      expect(await sqlState(api.db.execute(sql.raw(`delete from ${table}`)))).toBe("42501");
      expect(await sqlState(api.db.execute(sql.raw(`truncate ${table}`)))).toBe("42501");
    }
  });

  it("the API role can create orders: it may use the order number sequence", async () => {
    const [row] = await api.db
      .insert(orders)
      .values(orderValues(ctx.user.id, ctx.plan.id) as never)
      .returning({ number: orders.number });
    expect(row?.number).toMatch(/^WSO-/);
  });
});
