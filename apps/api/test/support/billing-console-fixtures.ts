import { randomBytes, randomUUID } from "node:crypto";

import {
  creditPacks,
  files,
  onboardingProgress,
  orders,
  paymentMethods,
  payments,
  plans,
  type Order,
  type Payment,
} from "@wasfa/db";
import { type FakeWebhookBody } from "@wasfa/shared/gateways";
import { createOrderResponseSchema, quoteResponseSchema } from "@wasfa/shared/schemas/billing";
import { eq, inArray } from "drizzle-orm";
import { expect } from "vitest";

import { GatewayRegistry } from "../../src/payments/gateway-registry.js";

import type { AdminTestContext, Person } from "./admin-context.js";
import type { OrderStatus, PaymentStatus } from "@wasfa/shared/billing";

/*
 * Rows and flows the admin billing console tests share: orders and payments written straight to the
 * database (to pin exact numbers and dates), and a real card purchase through the fake gateway
 * (to get a genuine subscription, credit grant and ledger for refunds).
 */

export interface OrderSeed {
  ownerUserId: string;
  kind?: "subscription" | "credit_pack";
  planKey?: string;
  packKey?: string;
  months?: number;
  currency?: string;
  subtotalMinor: number;
  totalMinor?: number;
  status?: OrderStatus;
  paidAt?: Date | null;
  createdAt?: Date;
  applied?: Record<string, unknown>;
}

export async function planIdOf(ctx: AdminTestContext, key: string): Promise<string> {
  const [row] = await ctx.owner.db.select({ id: plans.id }).from(plans).where(eq(plans.key, key));
  if (!row) throw new Error(`plan ${key} is not seeded`);
  return row.id;
}

async function packIdOf(ctx: AdminTestContext, key: string): Promise<string> {
  const [row] = await ctx.owner.db
    .select({ id: creditPacks.id })
    .from(creditPacks)
    .where(eq(creditPacks.key, key));
  if (!row) throw new Error(`pack ${key} is not seeded`);
  return row.id;
}

/** A paid order unless `status` says otherwise; the CHECKs need a `paidAt` for every paid state. */
export async function insertOrder(ctx: AdminTestContext, seed: OrderSeed): Promise<Order> {
  const kind = seed.kind ?? "subscription";
  const status = seed.status ?? "paid";
  const unpaid = status === "pending_payment" || status === "expired" || status === "canceled";
  const paidAt = seed.paidAt === undefined ? (unpaid ? null : new Date()) : seed.paidAt;
  const months = kind === "subscription" ? (seed.months ?? 1) : null;
  const [row] = await ctx.owner.db
    .insert(orders)
    .values({
      ownerUserId: seed.ownerUserId,
      kind,
      planId: kind === "subscription" ? await planIdOf(ctx, seed.planKey ?? "plus") : null,
      packId: kind === "credit_pack" ? await packIdOf(ctx, seed.packKey ?? "pack_100") : null,
      months,
      currency: seed.currency ?? "EGP",
      quote: {
        lines: [{ kind: "plan", labelKey: "billing.line.plan", amountMinor: seed.subtotalMinor }],
        taxMode: null,
      },
      quoteHash: "a".repeat(64),
      subtotalMinor: seed.subtotalMinor,
      totalMinor: seed.totalMinor ?? seed.subtotalMinor,
      applied: seed.applied ?? {},
      status,
      paymentKind: unpaid ? null : "manual",
      expiresAt: new Date(Date.now() + 86_400_000),
      paidAt,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
    })
    .returning();
  if (!row) throw new Error("order insert failed");
  return row;
}

export interface PaymentSeed {
  order: Order;
  status?: PaymentStatus;
  methodKey?: string;
  amountMinor?: number;
  createdAt?: Date;
  updatedAt?: Date;
  txnId?: string;
  senderPhoneMasked?: string;
  senderPhoneEnc?: string;
  proofFileId?: string;
  flags?: string[];
  failureCode?: string;
}

/** `WSP-XXXXXX` like the references checkout hands out. */
export function paymentReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  return `WSP-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

export async function insertPayment(ctx: AdminTestContext, seed: PaymentSeed): Promise<Payment> {
  const [row] = await ctx.owner.db
    .insert(payments)
    .values({
      orderId: seed.order.id,
      reference: paymentReference(),
      methodKey: seed.methodKey ?? "instapay",
      status: seed.status ?? "succeeded",
      amountMinor: seed.amountMinor ?? seed.order.totalMinor,
      currency: seed.order.currency,
      ...(seed.txnId ? { txnId: seed.txnId } : {}),
      ...(seed.senderPhoneMasked ? { senderPhoneMasked: seed.senderPhoneMasked } : {}),
      ...(seed.senderPhoneEnc ? { senderPhoneEnc: seed.senderPhoneEnc } : {}),
      ...(seed.proofFileId ? { proofFileId: seed.proofFileId } : {}),
      ...(seed.flags ? { flags: seed.flags } : {}),
      ...(seed.failureCode ? { failureCode: seed.failureCode } : {}),
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
      ...(seed.updatedAt ? { updatedAt: seed.updatedAt } : {}),
    })
    .returning();
  if (!row) throw new Error("payment insert failed");
  return row;
}

/** A processed payment-proof image row, the kind a manual payment points at. */
export async function insertProofFile(ctx: AdminTestContext, userId: string): Promise<string> {
  const [file] = await ctx.owner.db
    .insert(files)
    .values({
      ownerUserId: userId,
      createdBy: userId,
      purpose: "payment_proof",
      r2Key: `test-payment-proof/${randomUUID()}`,
      mime: "image/jpeg",
      bytes: 1_024,
      sha256: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64),
      dhash: "0123456789abcdef",
      status: "processed",
    })
    .returning();
  if (!file) throw new Error("proof insert failed");
  return file.id;
}

/** A user with onboarding finished, which checkout requires. */
export async function buyer(ctx: AdminTestContext): Promise<Person> {
  const person = await ctx.harness.signedInUser();
  await ctx.owner.db
    .insert(onboardingProgress)
    .values({ userId: person.userId, currentStep: "done", completedAt: new Date() })
    .onConflictDoNothing();
  return person;
}

/** Public plans and a card method served by the scripted fake gateway (never present in production). */
export async function enableFakeCard(ctx: AdminTestContext): Promise<void> {
  await ctx.owner.db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  await ctx.owner.db.update(plans).set({ monthlyCredits: 150 }).where(eq(plans.key, "plus"));
  await ctx.owner.db.insert(paymentMethods).values({
    key: "fake_card",
    kind: "gateway",
    provider: "fake",
    nameAr: "بطاقة تجريبية",
    nameEn: "Test card",
    currencies: ["EGP"],
    enabled: true,
  });
}

/** Quote, order and a signed success webhook: a genuinely paid order, activated like production. */
export async function payWithFakeCard(
  ctx: AdminTestContext,
  who: Pick<Person, "jar">,
  target: Record<string, unknown>,
): Promise<{ orderId: string; paymentId: string; totalMinor: number }> {
  const quoted = await ctx.harness.call("POST", "/billing/quote", {
    jar: who.jar,
    body: { ...target, methodKey: "fake_card" },
  });
  expect(quoted.statusCode, quoted.body).toBe(200);
  const quote = quoteResponseSchema.parse(quoted.json());
  const created = await ctx.harness.call("POST", "/billing/orders", {
    jar: who.jar,
    body: { quoteId: quote.quoteId, methodKey: "fake_card" },
  });
  expect(created.statusCode, created.body).toBe(201);
  const order = createOrderResponseSchema.parse(created.json());
  const paymentId = order.payment?.id;
  if (!paymentId) throw new Error("payment missing");
  const fake = ctx.app.get(GatewayRegistry).fake;
  if (!fake) throw new Error("fake gateway missing");
  const body: FakeWebhookBody = {
    eventId: randomUUID(),
    paymentId,
    providerRef: `fake_${paymentId}`,
    state: "succeeded",
    amountMinor: quote.quote.totalMinor,
    currency: "EGP",
  };
  const hook = await ctx.harness.call("POST", "/webhooks/fake", {
    body: body as unknown as Record<string, unknown>,
    origin: null,
    headers: { "x-fake-signature": fake.sign(body) },
  });
  expect(hook.statusCode, hook.body).toBe(200);
  return { orderId: order.orderId, paymentId, totalMinor: quote.quote.totalMinor };
}
