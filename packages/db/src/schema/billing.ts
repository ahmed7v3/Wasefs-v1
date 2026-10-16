import {
  BILLING_KEY_PATTERN,
  BILLING_MAX_MONTHS,
  BILLING_MIN_MONTHS,
  CURRENCY_CODE_PATTERN,
  GATEWAY_MODES,
  IDENTIFIER_PATTERN,
  MAX_BPS,
  ORDER_KINDS,
  ORDER_PAYMENT_KINDS,
  ORDER_STATUSES,
  PAYMENT_MAX_PROOF_SUBMISSIONS,
  PAYMENT_METHOD_KINDS,
  PAYMENT_STATUSES,
  REFUND_STATUSES,
  TAX_APPLIES_TO,
  TAX_MODES,
} from "@wasfa/shared/billing";
import { COUNTRY_CODE_PATTERN } from "@wasfa/shared/identity";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { deals } from "./deals.js";
import { files } from "./files.js";
import { billingOwnerColumns, ownerCheck } from "./owner.js";
import { plans } from "./plans.js";
import { users } from "./users.js";

/*
 * Billing core (Phase 3, Task 3.1; docs/BILLING.md). Money is `integer` minor units plus an ISO
 * currency, percentages are basis points. Everything commercial is admin data. Money history is
 * never cascaded away: the owner FKs of orders are RESTRICT (see `billingOwnerColumns`).
 */

// --- Catalog ------------------------------------------------------------------------------------

/** A price per plan, period and currency. No automatic conversion: no row = not offered in that currency. */
export const planPrices = pgTable(
  "plan_prices",
  {
    id: idColumn(),
    planId: uuid()
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    months: integer().notNull(),
    currency: text().notNull(),
    amountMinor: integer().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique("plan_prices_plan_months_currency_key").on(table.planId, table.months, table.currency),
    check(
      "plan_prices_months_check",
      sql`${table.months} between ${sql.raw(String(BILLING_MIN_MONTHS))} and ${sql.raw(String(BILLING_MAX_MONTHS))}`,
    ),
    check("plan_prices_currency_check", matches(table.currency, CURRENCY_CODE_PATTERN.source)),
    check("plan_prices_amount_check", sql`${table.amountMinor} >= 0`),
  ],
);

export const creditPacks = pgTable(
  "credit_packs",
  {
    id: idColumn(),
    key: text().notNull().unique("credit_packs_key_key"),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    credits: integer().notNull(),
    bonusCredits: integer().notNull().default(0),
    // How long purchased credits stay usable.
    validMonths: integer().notNull().default(12),
    active: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("credit_packs_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("credit_packs_credits_check", sql`${table.credits} > 0`),
    check("credit_packs_bonus_credits_check", sql`${table.bonusCredits} >= 0`),
    check("credit_packs_valid_months_check", sql`${table.validMonths} between 1 and 120`),
  ],
);

export const creditPackPrices = pgTable(
  "credit_pack_prices",
  {
    id: idColumn(),
    packId: uuid()
      .notNull()
      .references(() => creditPacks.id, { onDelete: "cascade" }),
    currency: text().notNull(),
    amountMinor: integer().notNull(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique("credit_pack_prices_pack_currency_key").on(table.packId, table.currency),
    check(
      "credit_pack_prices_currency_check",
      matches(table.currency, CURRENCY_CODE_PATTERN.source),
    ),
    check("credit_pack_prices_amount_check", sql`${table.amountMinor} >= 0`),
  ],
);

export const taxRules = pgTable(
  "tax_rules",
  {
    id: idColumn(),
    // Null = the default rule for every country without its own.
    country: text(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    rateBps: integer().notNull(),
    mode: text({ enum: TAX_MODES }).notNull(),
    appliesTo: text({ enum: TAX_APPLIES_TO }).notNull().default("all"),
    active: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    check(
      "tax_rules_country_check",
      sql`${table.country} is null or ${matches(table.country, COUNTRY_CODE_PATTERN.source)}`,
    ),
    check(
      "tax_rules_rate_bps_check",
      sql`${table.rateBps} between 0 and ${sql.raw(String(MAX_BPS))}`,
    ),
    check("tax_rules_mode_check", inList(table.mode, TAX_MODES)),
    check("tax_rules_applies_to_check", inList(table.appliesTo, TAX_APPLIES_TO)),
  ],
);

/**
 * How a customer can pay (admin data). `kind = manual` rows carry the account the customer sends
 * money to (`account_display`): the highest-risk field of the product, edited only through the
 * protected flow (BILLING §12).
 */
export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: idColumn(),
    key: text().notNull().unique("payment_methods_key_key"),
    kind: text({ enum: PAYMENT_METHOD_KINDS }).notNull(),
    // kashier | instapay | vodafone_cash | bank_transfer | ...
    provider: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    // Plain text with {amount}, {reference} and {account} placeholders.
    instructionsAr: text(),
    instructionsEn: text(),
    accountDisplay: text(),
    accountHolder: text(),
    feeBps: integer().notNull().default(0),
    feeFixedMinor: integer().notNull().default(0),
    minAmountMinor: integer(),
    maxAmountMinor: integer(),
    currencies: text().array().notNull(),
    // Null = every country.
    countries: text().array(),
    requiresProof: boolean().notNull().default(false),
    reviewSlaMinutes: integer(),
    enabled: boolean().notNull().default(false),
    sort: integer().notNull().default(0),
    // Non-secret settings only.
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (table) => [
    check("payment_methods_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("payment_methods_kind_check", inList(table.kind, PAYMENT_METHOD_KINDS)),
    check("payment_methods_provider_check", matches(table.provider, BILLING_KEY_PATTERN.source)),
    check(
      "payment_methods_fee_bps_check",
      sql`${table.feeBps} between 0 and ${sql.raw(String(MAX_BPS))}`,
    ),
    check("payment_methods_fee_fixed_check", sql`${table.feeFixedMinor} >= 0`),
    check(
      "payment_methods_amount_range_check",
      sql`(${table.minAmountMinor} is null or ${table.minAmountMinor} >= 0)
        and (${table.maxAmountMinor} is null or ${table.maxAmountMinor} >= 0)
        and (${table.minAmountMinor} is null or ${table.maxAmountMinor} is null or ${table.maxAmountMinor} >= ${table.minAmountMinor})`,
    ),
    check("payment_methods_currencies_check", sql`cardinality(${table.currencies}) >= 1`),
    check("payment_methods_config_check", sql`jsonb_typeof(${table.config}) = 'object'`),
    check(
      "payment_methods_review_sla_check",
      sql`${table.reviewSlaMinutes} is null or ${table.reviewSlaMinutes} > 0`,
    ),
  ],
);

/** Provider credentials. `credentials_enc` is a sealed string (AES-256-GCM, key id prefix): never plaintext. */
export const paymentGateways = pgTable(
  "payment_gateways",
  {
    id: idColumn(),
    key: text().notNull().unique("payment_gateways_key_key"),
    provider: text().notNull(),
    mode: text({ enum: GATEWAY_MODES }).notNull().default("test"),
    credentialsEnc: text(),
    merchantRef: text(),
    credentialsUpdatedAt: timestamp({ withTimezone: true }),
    verifiedAt: timestamp({ withTimezone: true }),
    lastWebhookAt: timestamp({ withTimezone: true }),
    lastWebhookOk: boolean(),
    lastWebhookError: text(),
    // Last 4 characters of the main key, safe to show.
    keyHint: text(),
    enabled: boolean().notNull().default(false),
    lastTestAt: timestamp({ withTimezone: true }),
    lastTestOk: boolean(),
    lastTestError: text(),
    ...timestamps(),
  },
  (table) => [
    check("payment_gateways_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("payment_gateways_provider_check", matches(table.provider, BILLING_KEY_PATTERN.source)),
    check("payment_gateways_mode_check", inList(table.mode, GATEWAY_MODES)),
  ],
);

export const GATEWAY_TEST_STATUSES = ["pending", "succeeded", "failed", "mismatch"] as const;

/** Isolated gateway verification attempts; these rows never enter order/payment accounting. */
export const paymentGatewayTests = pgTable(
  "payment_gateway_tests",
  {
    id: idColumn(),
    gatewayKey: text().notNull(),
    mode: text({ enum: GATEWAY_MODES }).notNull(),
    providerOrderId: text().notNull().unique("payment_gateway_tests_provider_order_id_key"),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    status: text({ enum: GATEWAY_TEST_STATUSES }).notNull().default("pending"),
    webhookReceivedAt: timestamp({ withTimezone: true }),
    webhookState: text(),
    webhookAmountMinor: integer(),
    webhookCurrency: text(),
    statusCheckedAt: timestamp({ withTimezone: true }),
    statusState: text(),
    statusAmountMinor: integer(),
    statusCurrency: text(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("payment_gateway_tests_mode_check", inList(table.mode, GATEWAY_MODES)),
    check("payment_gateway_tests_status_check", inList(table.status, GATEWAY_TEST_STATUSES)),
    check("payment_gateway_tests_amount_check", sql`${table.amountMinor} > 0`),
    check(
      "payment_gateway_tests_currency_check",
      matches(table.currency, CURRENCY_CODE_PATTERN.source),
    ),
    index("payment_gateway_tests_gateway_status_created_idx").on(
      table.gatewayKey,
      table.status,
      table.createdAt,
    ),
  ],
);

// --- Orders and payments ------------------------------------------------------------------------

/** `WSO-2026-000123`: built by the database, so two concurrent orders can never share a number. */
export const orderNumberSeq = pgSequence("order_number_seq", { startWith: 1, increment: 1 });

/** What is being bought. The server stores the quote it computed together with its HMAC. */
export const orders = pgTable(
  "orders",
  {
    id: idColumn(),
    number: text()
      .notNull()
      .unique("orders_number_key")
      .default(
        sql`('WSO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('order_number_seq')::text, 6, '0'))`,
      ),
    ...billingOwnerColumns(),
    kind: text({ enum: ORDER_KINDS }).notNull(),
    planId: uuid().references(() => plans.id, { onDelete: "restrict" }),
    packId: uuid().references(() => creditPacks.id, { onDelete: "restrict" }),
    months: integer(),
    currency: text().notNull(),
    quote: jsonb().$type<Record<string, unknown>>().notNull(),
    quoteHash: text().notNull(),
    subtotalMinor: integer().notNull(),
    discountMinor: integer().notNull().default(0),
    taxMinor: integer().notNull().default(0),
    feeMinor: integer().notNull().default(0),
    totalMinor: integer().notNull(),
    // Ids of the promotion / coupon the quote applied (audit trail; redemptions hold the real links).
    applied: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    dealId: uuid().references(() => deals.id, { onDelete: "set null" }),
    status: text({ enum: ORDER_STATUSES }).notNull().default("pending_payment"),
    paymentKind: text({ enum: ORDER_PAYMENT_KINDS }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    paidAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("orders", table),
    check("orders_kind_check", inList(table.kind, ORDER_KINDS)),
    check("orders_status_check", inList(table.status, ORDER_STATUSES)),
    check(
      "orders_payment_kind_check",
      sql`${table.paymentKind} is null or ${inList(table.paymentKind, ORDER_PAYMENT_KINDS)}`,
    ),
    check("orders_currency_check", matches(table.currency, CURRENCY_CODE_PATTERN.source)),
    check(
      "orders_months_check",
      sql`${table.months} is null or ${table.months} between ${sql.raw(String(BILLING_MIN_MONTHS))} and ${sql.raw(String(BILLING_MAX_MONTHS))}`,
    ),
    check(
      "orders_refs_check",
      sql`(${table.kind} = 'credit_pack' and ${table.packId} is not null)
        or (${table.kind} in ('subscription', 'upgrade') and ${table.planId} is not null and ${table.months} is not null)`,
    ),
    check("orders_quote_hash_check", matches(table.quoteHash, "^[a-f0-9]{64}$")),
    check(
      "orders_amounts_check",
      sql`${table.subtotalMinor} >= 0 and ${table.discountMinor} >= 0 and ${table.taxMinor} >= 0 and ${table.feeMinor} >= 0 and ${table.totalMinor} >= 0`,
    ),
    check(
      "orders_paid_at_check",
      sql`${table.status} in ('pending_payment', 'expired', 'canceled') or ${table.paidAt} is not null`,
    ),
    index("orders_owner_user_created_idx").on(table.ownerUserId, table.createdAt.desc()),
    index("orders_owner_org_created_idx").on(table.ownerOrgId, table.createdAt.desc()),
    // The expiry job only looks at unpaid orders.
    index("orders_pending_expires_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'pending_payment'`),
  ],
);

/** An attempt to pay an order (several allowed: card failed, then InstaPay). */
export const payments = pgTable(
  "payments",
  {
    id: idColumn(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    // Short reference the customer writes in a manual transfer: WSP-XXXX.
    reference: text().notNull().unique("payments_reference_key"),
    // Snapshot of the method and gateway keys: history must survive an admin deleting a method.
    methodKey: text().notNull(),
    gateway: text(),
    status: text({ enum: PAYMENT_STATUSES }).notNull().default("created"),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    providerRef: text(),
    // Manual payments.
    senderPhoneMasked: text(),
    txnId: text(),
    proofFileId: uuid().references(() => files.id, { onDelete: "set null" }),
    proofSubmissions: integer().notNull().default(0),
    // Duplicate-defence results (same image used before, ...).
    flags: jsonb().$type<string[]>().notNull().default([]),
    // Review.
    reviewedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp({ withTimezone: true }),
    secondApprovedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    secondApprovedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    rejectReason: text(),
    failureCode: text(),
    ...timestamps(),
  },
  (table) => [
    check("payments_status_check", inList(table.status, PAYMENT_STATUSES)),
    check("payments_currency_check", matches(table.currency, CURRENCY_CODE_PATTERN.source)),
    check("payments_amount_check", sql`${table.amountMinor} > 0`),
    check(
      "payments_proof_submissions_check",
      sql`${table.proofSubmissions} between 0 and ${sql.raw(String(PAYMENT_MAX_PROOF_SUBMISSIONS))}`,
    ),
    check("payments_flags_check", sql`jsonb_typeof(${table.flags}) = 'array'`),
    // The same provider transaction can never belong to two payments.
    uniqueIndex("payments_gateway_provider_ref_key")
      .on(table.gateway, table.providerRef)
      .where(sql`${table.providerRef} is not null`),
    // The same manual transfer id can never be used twice on one method.
    uniqueIndex("payments_method_txn_id_key")
      .on(table.methodKey, table.txnId)
      .where(sql`${table.txnId} is not null`),
    index("payments_order_idx").on(table.orderId),
    // The admin review queue.
    index("payments_review_queue_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('awaiting_review', 'awaiting_second_approval')`),
  ],
);

/**
 * Append-only log of every webhook / poll result (the `wasfa_api` role has SELECT and INSERT only,
 * migration 0010). `(provider, event_id)` is the replay shield: a conflict means a duplicate delivery.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: idColumn(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    paymentId: uuid().references(() => payments.id, { onDelete: "set null" }),
    // Redacted: no card data, no full phone numbers.
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    signatureOk: boolean().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payment_events_provider_event_id_key").on(table.provider, table.eventId),
    check("payment_events_payload_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    index("payment_events_payment_received_idx").on(table.paymentId, table.receivedAt),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: idColumn(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amountMinor: integer().notNull(),
    currency: text().notNull(),
    reason: text().notNull(),
    status: text({ enum: REFUND_STATUSES }).notNull().default("requested"),
    requestedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    providerRef: text(),
    // Manual refunds are made outside the app and marked with the transfer reference.
    transferReference: text(),
    ...timestamps(),
  },
  (table) => [
    check("refunds_status_check", inList(table.status, REFUND_STATUSES)),
    check("refunds_currency_check", matches(table.currency, CURRENCY_CODE_PATTERN.source)),
    check("refunds_amount_check", sql`${table.amountMinor} > 0`),
    check("refunds_reason_check", sql`char_length(btrim(${table.reason})) > 0`),
    uniqueIndex("refunds_provider_ref_key")
      .on(table.providerRef)
      .where(sql`${table.providerRef} is not null`),
    index("refunds_payment_idx").on(table.paymentId),
  ],
);

/**
 * Generic transactional outbox: side effects outside the database (receipt mail, notifications,
 * reward evaluation) are written in the same transaction as the change and drained by the worker.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: idColumn(),
    topic: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text(),
    attempts: integer().notNull().default(0),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("outbox_topic_check", matches(table.topic, IDENTIFIER_PATTERN.source)),
    check("outbox_attempts_check", sql`${table.attempts} >= 0`),
    uniqueIndex("outbox_idempotency_key_key")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    // The drainer only looks at unprocessed rows.
    index("outbox_pending_idx")
      .on(table.availableAt)
      .where(sql`${table.processedAt} is null`),
  ],
);

export type PlanPrice = typeof planPrices.$inferSelect;
export type NewPlanPrice = typeof planPrices.$inferInsert;
export type CreditPack = typeof creditPacks.$inferSelect;
export type NewCreditPack = typeof creditPacks.$inferInsert;
export type CreditPackPrice = typeof creditPackPrices.$inferSelect;
export type NewCreditPackPrice = typeof creditPackPrices.$inferInsert;
export type TaxRule = typeof taxRules.$inferSelect;
export type NewTaxRule = typeof taxRules.$inferInsert;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type NewPaymentMethod = typeof paymentMethods.$inferInsert;
export type PaymentGateway = typeof paymentGateways.$inferSelect;
export type NewPaymentGateway = typeof paymentGateways.$inferInsert;
export type PaymentGatewayTest = typeof paymentGatewayTests.$inferSelect;
export type NewPaymentGatewayTest = typeof paymentGatewayTests.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentEvent = typeof paymentEvents.$inferSelect;
export type NewPaymentEvent = typeof paymentEvents.$inferInsert;
export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
export type OutboxEntry = typeof outbox.$inferSelect;
export type NewOutboxEntry = typeof outbox.$inferInsert;
