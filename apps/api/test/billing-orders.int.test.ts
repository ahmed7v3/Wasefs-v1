import { randomUUID } from "node:crypto";

import {
  adminAlerts,
  alertDeliveries,
  coupons,
  creditLedger,
  files,
  onboardingProgress,
  orders,
  outbox,
  paymentEvents,
  paymentGateways,
  paymentMethods,
  paymentMethodAccountChanges,
  payments,
  plans,
} from "@wasfa/db";
import { decodeEncryptionKey, encryptSecret } from "@wasfa/shared/crypto";
import {
  FAKE_GATEWAY_DEV_SECRET,
  gatewayCredentialsContext,
  kashierWebhookSignature,
  type FakeWebhookBody,
} from "@wasfa/shared/gateways";
import { alertHealthSchema, type AlertHealth } from "@wasfa/shared/schemas/admin-alerts";
import {
  createOrderResponseSchema,
  orderStatusResponseSchema,
  quoteResponseSchema,
} from "@wasfa/shared/schemas/billing";
import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminAlertService } from "../src/alerts/alerts.service.js";
import { GatewayRegistry } from "../src/payments/gateway-registry.js";
import { PaymentsService } from "../src/payments/payments.service.js";
import { SettingsService } from "../src/settings/settings.service.js";

import { AdminTestContext, type Person } from "./support/admin-context.js";
import { totp } from "./support/auth-harness.js";

/*
 * Checkout end to end against Postgres 18 and Redis (Task 3.3): quote -> order -> fake gateway ->
 * webhook -> activation, plus the refusals (altered/expired quote, other owner's order, bad
 * signature, amount mismatch) and the free and manual paths.
 */

const ctx = new AdminTestContext();
let registry: GatewayRegistry;

beforeAll(async () => {
  await ctx.start();
  registry = ctx.app.get(GatewayRegistry);
  const { db } = ctx.owner;
  await db
    .update(plans)
    .set({ visibility: "public" })
    .where(inArray(plans.key, ["plus", "pro"]));
  // A card method served by the scripted fake gateway (never present in production).
  await db.insert(paymentMethods).values({
    key: "fake_card",
    kind: "gateway",
    provider: "fake",
    nameAr: "بطاقة تجريبية",
    nameEn: "Test card",
    currencies: ["EGP"],
    feeBps: 275,
    feeFixedMinor: 300,
    enabled: true,
  });
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Who = Pick<Person, "jar" | "userId">;

async function quote(who: Who, body: Record<string, unknown>) {
  const res = await ctx.harness.call("POST", "/billing/quote", { jar: who.jar, body });
  expect(res.statusCode, res.body).toBe(200);
  return quoteResponseSchema.parse(res.json());
}

async function order(who: Who, body: Record<string, unknown>) {
  return ctx.harness.call("POST", "/billing/orders", { jar: who.jar, body });
}

async function cardOrder(
  who: Who,
  extra: Record<string, unknown> = { planKey: "plus", months: 1 },
) {
  const q = await quote(who, { ...extra, methodKey: "fake_card" });
  const res = await order(who, { quoteId: q.quoteId, methodKey: "fake_card" });
  expect(res.statusCode, res.body).toBe(201);
  return { q, created: createOrderResponseSchema.parse(res.json()) };
}

function webhook(body: FakeWebhookBody, signature?: string) {
  const fake = registry.fake;
  if (!fake) throw new Error("fake gateway missing");
  return ctx.harness.call("POST", "/webhooks/fake", {
    body: body as unknown as Record<string, unknown>,
    origin: null,
    headers: { "x-fake-signature": signature ?? fake.sign(body) },
  });
}

function paid(paymentId: string, amountMinor: number, eventId = randomUUID()): FakeWebhookBody {
  return {
    eventId,
    paymentId,
    providerRef: `fake_${paymentId}`,
    state: "succeeded",
    amountMinor,
    currency: "EGP",
  };
}

async function status(who: Who, orderId: string) {
  return ctx.harness.call("GET", `/billing/orders/${orderId}`, { jar: who.jar });
}

describe("POST /billing/orders", () => {
  it("needs a session", async () => {
    const res = await ctx.harness.call("POST", "/billing/orders", {
      body: { quoteId: randomUUID(), methodKey: "fake_card" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates an order and a payment from the stored quote and returns the provider page", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    expect(created.status).toBe("pending_payment");
    expect(created.redirectUrl).toContain("fake=fake_");
    expect(created.payment?.status).toBe("awaiting_customer");
    expect(created.payment?.amountMinor).toBe(q.quote.totalMinor);
    const [row] = await ctx.owner.db.select().from(orders).where(eq(orders.id, created.orderId));
    expect(row?.totalMinor).toBe(q.quote.totalMinor);
    expect(row?.quoteHash).toMatch(/^[a-f0-9]{64}$/);
    // A quote is used once.
    const again = await order(user, { quoteId: q.quoteId, methodKey: "fake_card" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("refuses an altered quote, another user's quote and a mismatched method", async () => {
    const user = await ctx.harness.signedInUser();
    const other = await ctx.harness.signedInUser();

    const tampered = await quote(user, { planKey: "plus", months: 1, methodKey: "fake_card" });
    const key = `billing:quote:${tampered.quoteId}`;
    const stored = JSON.parse((await ctx.redis.get(key)) ?? "{}") as {
      quote: { totalMinor: number };
    };
    stored.quote.totalMinor = 1;
    await ctx.redis.set(key, JSON.stringify(stored), "EX", 600);
    const altered = await order(user, { quoteId: tampered.quoteId, methodKey: "fake_card" });
    expect(altered.statusCode).toBe(409);

    const mine = await quote(user, { planKey: "plus", months: 1, methodKey: "fake_card" });
    const stolen = await order(other, { quoteId: mine.quoteId, methodKey: "fake_card" });
    expect(stolen.statusCode).toBe(409);

    // Priced without a method: the fee is unknown, so the customer must re-quote.
    const bare = await quote(user, { planKey: "plus", months: 1 });
    const noMethod = await order(user, { quoteId: bare.quoteId, methodKey: "fake_card" });
    expect(noMethod.statusCode).toBe(409);
    expect(
      await ctx.owner.db
        .select({ n: count() })
        .from(orders)
        .where(eq(orders.ownerUserId, other.userId)),
    ).toEqual([{ n: 0 }]);
  });

  it("parallel orders from one quote create exactly one order", async () => {
    const user = await ctx.harness.signedInUser();
    const q = await quote(user, { planKey: "plus", months: 1, methodKey: "fake_card" });
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => order(user, { quoteId: q.quoteId, methodKey: "fake_card" })),
    );
    expect(responses.filter((res) => res.statusCode === 201)).toHaveLength(1);
    expect(responses.filter((res) => res.statusCode === 409)).toHaveLength(4);
    const [made] = await ctx.owner.db
      .select({ n: count() })
      .from(orders)
      .where(eq(orders.ownerUserId, user.userId));
    expect(made?.n).toBe(1);
  });

  it("refuses an expired quote", async () => {
    const user = await ctx.harness.signedInUser();
    const q = await quote(user, { planKey: "plus", months: 1, methodKey: "fake_card" });
    await ctx.redis.del(`billing:quote:${q.quoteId}`);
    const res = await order(user, { quoteId: q.quoteId, methodKey: "fake_card" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "QUOTE_EXPIRED" });
  });

  it("a manual method waits for the customer and needs no provider", async () => {
    const user = await ctx.harness.signedInUser();
    const q = await quote(user, { planKey: "plus", months: 1, methodKey: "instapay" });
    const res = await order(user, { quoteId: q.quoteId, methodKey: "instapay" });
    expect(res.statusCode, res.body).toBe(201);
    const created = createOrderResponseSchema.parse(res.json());
    expect(created.redirectUrl).toBeNull();
    expect(created.payment?.status).toBe("awaiting_customer");
    expect(created.payment?.reference).toMatch(/^WSP-[A-Z2-9]{6}$/);
  });

  it("a 100% coupon makes a free order that is paid at once", async () => {
    const user = await ctx.harness.signedInUser();
    const code = `FREE-${randomUUID().slice(0, 6).toUpperCase()}`;
    await ctx.owner.db.insert(coupons).values({
      code,
      kind: "percent",
      name: "Free",
      titleAr: "مجاني",
      titleEn: "Free",
      value: 10_000,
      status: "active",
    });
    const q = await quote(user, { planKey: "plus", months: 1, couponCode: code });
    expect(q.quote.totalMinor).toBe(0);
    const res = await order(user, { quoteId: q.quoteId });
    expect(res.statusCode, res.body).toBe(201);
    const created = createOrderResponseSchema.parse(res.json());
    expect(created.status).toBe("paid");
    expect(created.payment).toBeNull();
  });

  it("a credit pack is quoted, paid and its credits granted once", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user, { packKey: "pack_100" });
    expect(q.target.kind).toBe("credit_pack");
    const paymentId = created.payment?.id ?? "";
    const delivery = paid(paymentId, q.quote.totalMinor);
    for (let i = 0; i < 3; i++) expect((await webhook(delivery)).statusCode).toBe(200);
    const rows = await ctx.owner.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, `order:${created.orderId}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("purchase");
  });
});

describe("manual payment HTTP flow", () => {
  async function onboard(userId: string) {
    await ctx.owner.db
      .insert(onboardingProgress)
      .values({ userId, currentStep: "done", completedAt: new Date() })
      .onConflictDoNothing();
  }

  async function manualOrder(who: Who) {
    await onboard(who.userId);
    const q = await quote(who, { planKey: "plus", months: 1, methodKey: "instapay" });
    const response = await order(who, { quoteId: q.quoteId, methodKey: "instapay" });
    expect(response.statusCode, response.body).toBe(201);
    return createOrderResponseSchema.parse(response.json());
  }

  async function processedProof(userId: string) {
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
    if (!file) throw new Error("processed proof insert failed");
    return file.id;
  }

  it("creates instructions, submits proof, reviews it, and observes paid status over HTTP", async () => {
    const buyer = await ctx.harness.signedInUser();
    const created = await manualOrder(buyer);
    const payment = created.payment;
    if (!payment) throw new Error("manual payment was not created");

    const instructions = await ctx.harness.call(
      "GET",
      `/billing/orders/${created.orderId}/instructions`,
      { jar: buyer.jar },
    );
    expect(instructions.statusCode, instructions.body).toBe(200);
    expect(instructions.json()).toMatchObject({
      reference: payment.reference,
      accountDisplay: expect.any(String),
      expiresAt: expect.any(String),
      reviewSlaMinutes: expect.any(Number),
      status: "awaiting_customer",
    });
    expect(instructions.json<{ instructionsEn: string }>().instructionsEn).not.toContain(
      "{amount}",
    );

    const fileId = await processedProof(buyer.userId);
    const submitted = await ctx.harness.call("POST", `/billing/payments/${payment.id}/proof`, {
      jar: buyer.jar,
      body: { txnId: "T1-HTTP-TXN-1234", senderPhone: "01012345678", fileId },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json()).toMatchObject({ status: "awaiting_review", submissionsLeft: 2 });

    const reviewer = await ctx.admin("super_admin");
    const queue = await ctx.harness.call("GET", "/admin/billing/payments/review", {
      jar: reviewer.jar,
    });
    expect(queue.statusCode, queue.body).toBe(200);
    expect(queue.json<{ items: Array<{ id: string }> }>().items.map((item) => item.id)).toContain(
      payment.id,
    );
    const approved = await ctx.harness.call(
      "POST",
      `/admin/billing/payments/${payment.id}/approve`,
      {
        jar: reviewer.jar,
        body: {},
      },
    );
    expect(approved.statusCode, approved.body).toBe(201);
    expect(approved.json()).toMatchObject({
      status: "succeeded",
      activated: true,
      activation: "activated",
    });
    expect((await status(buyer, created.orderId)).json()).toMatchObject({ status: "paid" });
    const paymentEvent = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `order_paid:${created.orderId}`));
    expect(paymentEvent).toHaveLength(1);
  });

  it("hides another owner's instructions and proof submissions and rejects malformed input", async () => {
    const owner = await ctx.harness.signedInUser();
    const intruder = await ctx.harness.signedInUser();
    await onboard(intruder.userId);
    const created = await manualOrder(owner);
    const payment = created.payment;
    if (!payment) throw new Error("manual payment was not created");
    const foreignFile = await processedProof(intruder.userId);
    expect(
      (
        await ctx.harness.call("GET", `/billing/orders/${created.orderId}/instructions`, {
          jar: intruder.jar,
        })
      ).statusCode,
    ).toBe(404);
    const wrongOwner = await ctx.harness.call("POST", `/billing/payments/${payment.id}/proof`, {
      jar: intruder.jar,
      body: { txnId: "T2-WRONG-OWNER-123", senderPhone: "01012345678", fileId: foreignFile },
    });
    expect(wrongOwner.statusCode).toBe(404);
    const foreignFileOnOwnerPayment = await ctx.harness.call(
      "POST",
      `/billing/payments/${payment.id}/proof`,
      {
        jar: owner.jar,
        body: { txnId: "T2-FOREIGN-FILE-123", senderPhone: "01012345678", fileId: foreignFile },
      },
    );
    expect(foreignFileOnOwnerPayment.statusCode).toBe(404);

    const invalidInputs = [
      { txnId: "bad txn!", senderPhone: "01012345678", fileId: foreignFile },
      { txnId: "T2-BAD-PHONE-123", senderPhone: "02012345678", fileId: foreignFile },
      { txnId: "T2-BAD-FILE-123", senderPhone: "01012345678", fileId: "not-a-uuid" },
    ];
    for (const body of invalidInputs) {
      const malformed = await ctx.harness.call("POST", `/billing/payments/${payment.id}/proof`, {
        jar: owner.jar,
        body,
      });
      expect(malformed.statusCode).toBe(400);
    }
    expect(
      (await ctx.harness.call("GET", `/billing/orders/${created.orderId}/instructions`)).statusCode,
    ).toBe(401);
    expect(
      (
        await ctx.harness.call("POST", `/billing/payments/${payment.id}/proof`, {
          body: { txnId: "T2-ANON-REQUEST-1", senderPhone: "01012345678", fileId: foreignFile },
        })
      ).statusCode,
    ).toBe(401);
    expect((await ctx.harness.call("GET", "/admin/billing/payments/review")).statusCode).toBe(401);
    const anonymousAdminRoutes: Array<["GET" | "POST" | "PUT", string, Record<string, unknown>?]> =
      [
        ["GET", `/admin/billing/payments/${payment.id}`],
        ["POST", `/admin/billing/payments/${payment.id}/claim`],
        ["POST", `/admin/billing/payments/${payment.id}/approve`, {}],
        ["POST", `/admin/billing/payments/${payment.id}/reject`, { reason: "other", note: "test" }],
        ["POST", `/admin/billing/payments/${payment.id}/request-proof`, {}],
        ["GET", "/admin/alerts"],
        ["GET", "/admin/alerts/prefs"],
        ["PUT", "/admin/alerts/prefs", {}],
        ["POST", "/admin/alerts/read-all"],
        ["POST", "/admin/billing/methods/instapay/account-change", {}],
        ["POST", "/admin/billing/methods/instapay/account-change/cancel"],
      ];
    for (const [method, path, body] of anonymousAdminRoutes) {
      expect((await ctx.harness.call(method, path, { ...(body ? { body } : {}) })).statusCode).toBe(
        401,
      );
    }
  });

  it("reports alert delivery health by channel and reason, without alert text", async () => {
    const first = await ctx.admin("super_admin");
    const second = await ctx.admin("super_admin");
    const health = async () => {
      const res = await ctx.harness.call("GET", "/admin/alerts/health", { jar: first.jar });
      expect(res.statusCode, res.body).toBe(200);
      return alertHealthSchema.parse(res.json());
    };
    const channel = (body: AlertHealth, name: string) =>
      body.channels.find((entry) => entry.channel === name);
    const before = await health();
    expect(before.channels.map((entry) => entry.channel)).toEqual([
      "in_app",
      "email",
      "telegram",
      "whatsapp",
    ]);
    expect(before.whatsapp).toMatchObject({ alertsEnabled: false, customerMessagesEnabled: false });
    expect(before.me).toMatchObject({ telegramChatIdSet: false, whatsappLinked: false });

    const alertId = await ctx.app.get(AdminAlertService).notify({
      kind: "payment.review_needed",
      severity: "warning",
      refType: "payment",
      refId: randomUUID(),
      summary: "Health check alert.",
      link: "/admin/billing/payments",
    });
    const sentAt = new Date();
    await ctx.owner.db.insert(alertDeliveries).values([
      { alertId, adminUserId: first.userId, channel: "email", status: "sent", sentAt },
      {
        alertId,
        adminUserId: first.userId,
        channel: "telegram",
        status: "skipped",
        error: "not_configured",
      },
      {
        alertId,
        adminUserId: second.userId,
        channel: "telegram",
        status: "skipped",
        error: "not_configured",
      },
      {
        alertId,
        adminUserId: second.userId,
        channel: "email",
        status: "failed",
        error: "send_failed",
      },
      {
        alertId,
        adminUserId: first.userId,
        channel: "whatsapp",
        status: "skipped",
        error: "disabled",
      },
    ]);

    const after = await health();
    const reason = (body: AlertHealth, name: string, code: string) =>
      channel(body, name)?.reasons.find((entry) => entry.reason === code)?.count ?? 0;
    expect((channel(after, "email")?.sent ?? 0) - (channel(before, "email")?.sent ?? 0)).toBe(1);
    expect((channel(after, "email")?.failed ?? 0) - (channel(before, "email")?.failed ?? 0)).toBe(
      1,
    );
    expect(
      reason(after, "telegram", "not_configured") - reason(before, "telegram", "not_configured"),
    ).toBe(2);
    expect(reason(after, "whatsapp", "disabled") - reason(before, "whatsapp", "disabled")).toBe(1);
    expect(channel(after, "email")?.lastSentAt).not.toBeNull();
    // Counts and reasons only: never the summary of an alert.
    const raw = (await ctx.harness.call("GET", "/admin/alerts/health", { jar: first.jar })).body;
    expect(raw).not.toContain("Health check alert");

    const customer = await ctx.harness.signedInUser();
    expect(
      (await ctx.harness.call("GET", "/admin/alerts/health", { jar: customer.jar })).statusCode,
    ).toBe(403);
    expect((await ctx.harness.call("GET", "/admin/alerts/health")).statusCode).toBe(401);
  });

  it("returns only the current admin's in-app alerts and validates alert preferences", async () => {
    const first = await ctx.admin("super_admin");
    const second = await ctx.admin("super_admin");
    const alertId = await ctx.app.get(AdminAlertService).notify({
      kind: "payment.review_needed",
      severity: "warning",
      refType: "payment",
      refId: randomUUID(),
      summary: "Order WSO-2026-000123 requires review.",
      link: "/admin/billing/payments",
    });
    const [firstDelivery] = await ctx.owner.db
      .insert(alertDeliveries)
      .values({ alertId, adminUserId: first.userId, channel: "in_app", status: "sent" })
      .returning();
    const [secondDelivery] = await ctx.owner.db
      .insert(alertDeliveries)
      .values({ alertId, adminUserId: second.userId, channel: "in_app", status: "sent" })
      .returning();
    if (!firstDelivery || !secondDelivery) throw new Error("alert delivery insert failed");

    const list = await ctx.harness.call("GET", "/admin/alerts", { jar: first.jar });
    expect(list.statusCode, list.body).toBe(200);
    expect(
      list
        .json<{ items: Array<{ delivery: { id: string } }> }>()
        .items.map(({ delivery }) => delivery.id),
    ).toContain(firstDelivery.id);
    expect(
      list
        .json<{ items: Array<{ delivery: { id: string } }> }>()
        .items.map(({ delivery }) => delivery.id),
    ).not.toContain(secondDelivery.id);
    expect(
      (
        await ctx.harness.call("POST", `/admin/alerts/${secondDelivery.id}/read`, {
          jar: first.jar,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await ctx.harness.call("POST", "/admin/alerts/read-all", { jar: first.jar })).statusCode,
    ).toBe(201);
    expect(
      (
        await ctx.harness.call("PUT", "/admin/alerts/prefs", {
          jar: first.jar,
          body: {
            inAppEnabled: true,
            emailEnabled: true,
            telegramEnabled: false,
            whatsappEnabled: true,
            telegramChatId: null,
            mutedKinds: [],
          },
        })
      ).statusCode,
    ).toBe(409);
    const invalidKinds = await ctx.harness.call("PUT", "/admin/alerts/prefs", {
      jar: first.jar,
      body: {
        inAppEnabled: true,
        emailEnabled: true,
        telegramEnabled: false,
        whatsappEnabled: false,
        telegramChatId: null,
        mutedKinds: ["unknown.kind"],
      },
    });
    expect(invalidKinds.statusCode).toBe(400);
  });

  it("blocks own-payment review actions and stale approval or rejection sessions", async () => {
    const ownerAdmin = await ctx.admin("super_admin");
    const ownOrder = await manualOrder(ownerAdmin);
    const ownPaymentId = ownOrder.payment?.id;
    if (!ownPaymentId) throw new Error("manual payment missing");
    for (const [path, body] of [
      [`/approve`, {}],
      [`/reject`, { reason: "not_received" }],
      [`/request-proof`, {}],
    ] as const) {
      const response = await ctx.harness.call(
        "POST",
        `/admin/billing/payments/${ownPaymentId}${path}`,
        { jar: ownerAdmin.jar, body },
      );
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json()).toMatchObject({ details: { reason: "own_payment" } });
    }

    const customer = await ctx.harness.signedInUser();
    const otherOrder = await manualOrder(customer);
    const otherPaymentId = otherOrder.payment?.id;
    if (!otherPaymentId) throw new Error("manual payment missing");
    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const approve = await ctx.harness.call(
      "POST",
      `/admin/billing/payments/${otherPaymentId}/approve`,
      { jar: stale.jar, body: {} },
    );
    const reject = await ctx.harness.call(
      "POST",
      `/admin/billing/payments/${otherPaymentId}/reject`,
      { jar: stale.jar, body: { reason: "not_received" } },
    );
    for (const response of [approve, reject]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ details: { reason: "reauth" } });
    }
  });

  it("protects account changes with TOTP, cooldown, and a different-admin cancel", async () => {
    const requester = await ctx.admin("super_admin");
    const otherAdmin = await ctx.admin("super_admin");
    const body = {
      accountDisplay: "01212345678",
      accountHolder: "Updated Store",
      reason: "The settlement account changed",
      totpCode: "000000",
    };
    const invalid = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change",
      { jar: requester.jar, body },
    );
    expect(invalid.statusCode).toBe(403);
    expect(invalid.json()).toMatchObject({ details: { reason: "totp_invalid" } });

    const request = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change",
      {
        jar: requester.jar,
        body: { ...body, totpCode: totp(requester.secret) },
      },
    );
    expect(request.statusCode, request.body).toBe(201);
    const response = request.json<{ effectiveAt: string; diff: { oldAccountDisplay: string } }>();
    expect(Date.parse(response.effectiveAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(response.diff.oldAccountDisplay).not.toBe("01212345678");
    const [pending] = await ctx.owner.db
      .select()
      .from(paymentMethodAccountChanges)
      .where(eq(paymentMethodAccountChanges.status, "pending"));
    expect(pending?.newAccountDisplay).toBe("01212345678");

    const duplicate = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change",
      {
        jar: requester.jar,
        body: { ...body, accountDisplay: "01112345678", totpCode: totp(requester.secret) },
      },
    );
    expect(duplicate.statusCode).toBe(409);
    const visible = await ctx.harness.call(
      "GET",
      "/admin/billing/methods/instapay/account-change",
      {
        jar: requester.jar,
      },
    );
    expect(visible.json()).toMatchObject({ change: { newAccountDisplay: "01212345678" } });

    const ownCancel = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change/cancel",
      { jar: requester.jar },
    );
    expect(ownCancel.statusCode).toBe(403);
    const canceled = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change/cancel",
      { jar: otherAdmin.jar },
    );
    expect(canceled.statusCode, canceled.body).toBe(201);
    const [afterCancel] = await ctx.owner.db
      .select()
      .from(paymentMethodAccountChanges)
      .where(eq(paymentMethodAccountChanges.status, "canceled"));
    expect(afterCancel?.canceledBy).toBe(otherAdmin.userId);
  });

  async function submitProof(who: Who, paymentId: string, txnId: string) {
    return ctx.harness.call("POST", `/billing/payments/${paymentId}/proof`, {
      jar: who.jar,
      body: { txnId, senderPhone: "01012345678", fileId: await processedProof(who.userId) },
    });
  }

  /** A fresh customer's manual order with a proof under review. */
  async function underReview(methodKey = "instapay") {
    const customer = await ctx.harness.signedInUser();
    await onboard(customer.userId);
    const q = await quote(customer, { planKey: "plus", months: 1, methodKey });
    const res = await order(customer, { quoteId: q.quoteId, methodKey });
    expect(res.statusCode, res.body).toBe(201);
    const created = createOrderResponseSchema.parse(res.json());
    const paymentId = created.payment?.id;
    if (!paymentId) throw new Error("manual payment missing");
    const submitted = await submitProof(customer, paymentId, `REV-${randomUUID().slice(0, 12)}`);
    expect(submitted.statusCode, submitted.body).toBe(200);
    return { customer, orderId: created.orderId, paymentId };
  }

  function admin(person: Who, path: string, body: Record<string, unknown> = {}) {
    return ctx.harness.call("POST", `/admin/billing/payments${path}`, { jar: person.jar, body });
  }

  it("rate-limits proof submissions and proof upload requests per user", async () => {
    const buyer = await ctx.harness.signedInUser();
    const created = await manualOrder(buyer);
    const paymentId = created.payment?.id;
    if (!paymentId) throw new Error("manual payment missing");
    // Every attempt counts, also the refused ones (an unknown file here).
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await ctx.harness.call("POST", `/billing/payments/${paymentId}/proof`, {
        jar: buyer.jar,
        body: { txnId: `RL-${attempt}-ABCDEF`, senderPhone: "01012345678", fileId: randomUUID() },
      });
      expect(res.statusCode).not.toBe(429);
    }
    const limited = await ctx.harness.call("POST", `/billing/payments/${paymentId}/proof`, {
      jar: buyer.jar,
      body: { txnId: "RL-11-ABCDEF", senderPhone: "01012345678", fileId: randomUUID() },
    });
    expect(limited.statusCode).toBe(429);

    const uploader = await ctx.harness.signedInUser();
    await onboard(uploader.userId);
    const presign = () =>
      ctx.harness.call("POST", "/uploads", {
        jar: uploader.jar,
        body: {
          purpose: "payment_proof",
          mime: "image/jpeg",
          bytes: 2_048,
          sha256: "d".repeat(64),
        },
      });
    for (let attempt = 0; attempt < 10; attempt++) {
      expect((await presign()).statusCode).not.toBe(429);
    }
    expect((await presign()).statusCode).toBe(429);
  });

  it("refuses a transaction id already used on the same method, not on another method", async () => {
    const txnId = `DUP-${randomUUID().slice(0, 12).toUpperCase()}`;
    const first = await ctx.harness.signedInUser();
    const firstOrder = await manualOrder(first);
    const firstPayment = firstOrder.payment?.id;
    if (!firstPayment) throw new Error("manual payment missing");
    expect((await submitProof(first, firstPayment, txnId)).statusCode).toBe(200);

    const second = await ctx.harness.signedInUser();
    const secondOrder = await manualOrder(second);
    const secondPayment = secondOrder.payment?.id;
    if (!secondPayment) throw new Error("manual payment missing");
    const duplicate = await submitProof(second, secondPayment, txnId);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "DUPLICATE_TXN" });

    const third = await ctx.harness.signedInUser();
    await onboard(third.userId);
    const q = await quote(third, { planKey: "plus", months: 1, methodKey: "vodafone_cash" });
    const res = await order(third, { quoteId: q.quoteId, methodKey: "vodafone_cash" });
    expect(res.statusCode, res.body).toBe(201);
    const vodafonePayment = createOrderResponseSchema.parse(res.json()).payment?.id;
    if (!vodafonePayment) throw new Error("manual payment missing");
    expect((await submitProof(third, vodafonePayment, txnId)).statusCode).toBe(200);
  });

  it("shapes the review detail without the sealed phone and audits every open", async () => {
    const { paymentId } = await underReview();
    const reviewer = await ctx.admin("finance");
    const res = await ctx.harness.call("GET", `/admin/billing/payments/${paymentId}`, {
      jar: reviewer.jar,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain("senderPhoneEnc");
    expect(res.body).not.toContain("quote");
    const detail = res.json<{ payment: Record<string, unknown>; user: { phone: string | null } }>();
    expect(detail.payment).not.toHaveProperty("senderPhoneEnc");
    expect(detail.payment.senderPhoneMasked).toBe("010*****678");
    expect(detail.user.phone).toBe("01012345678");
    // Test storage is not configured: the page still renders and says the image is unavailable.
    expect(res.json()).toMatchObject({ proofUrl: null, proofUnavailable: true });
    expect(await ctx.auditRowsFor("payment.review_opened", paymentId)).not.toHaveLength(0);
  });

  it("honours the soft lock unless overridden and requires a note for an `other` rejection", async () => {
    const { paymentId } = await underReview();
    const holder = await ctx.admin("finance");
    const other = await ctx.admin("finance");
    expect((await admin(holder, `/${paymentId}/claim`)).statusCode).toBe(201);
    const queue = await ctx.harness.call("GET", "/admin/billing/payments/review", {
      jar: other.jar,
    });
    const item = queue
      .json<{ items: Array<{ id: string; lockHolder: { id: string } | null }> }>()
      .items.find((entry) => entry.id === paymentId);
    expect(item?.lockHolder?.id).toBe(holder.userId);

    const noNote = await admin(other, `/${paymentId}/reject`, { reason: "other", override: true });
    expect(noNote.statusCode).toBe(400);
    const locked = await admin(other, `/${paymentId}/approve`);
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ details: { reason: "review_locked" } });
    const overridden = await admin(other, `/${paymentId}/approve`, { override: true });
    expect(overridden.statusCode, overridden.body).toBe(201);
    expect(overridden.json()).toMatchObject({ status: "succeeded" });
  });

  it("needs a second, different admin above the four-eyes threshold", async () => {
    const settings = ctx.app.get(SettingsService);
    const billing = await settings.get("billing");
    await settings.set("billing", { ...billing, fourEyesThresholdMinor: 1 }, { actorId: null });
    try {
      const { customer, orderId, paymentId } = await underReview();
      const first = await ctx.admin("finance");
      const second = await ctx.admin("finance");
      const one = await admin(first, `/${paymentId}/approve`);
      expect(one.statusCode, one.body).toBe(201);
      expect(one.json()).toMatchObject({ status: "awaiting_second_approval" });
      expect((await status(customer, orderId)).json()).toMatchObject({ status: "pending_payment" });

      const again = await admin(first, `/${paymentId}/approve`);
      expect(again.statusCode).toBe(403);
      expect(again.json()).toMatchObject({ details: { reason: "same_reviewer" } });

      const two = await admin(second, `/${paymentId}/approve`);
      expect(two.statusCode, two.body).toBe(201);
      expect(two.json()).toMatchObject({ status: "succeeded" });
      expect((await status(customer, orderId)).json()).toMatchObject({ status: "paid" });
      const [row] = await ctx.owner.db.select().from(payments).where(eq(payments.id, paymentId));
      expect(row).toMatchObject({ reviewedBy: first.userId, secondApprovedBy: second.userId });
    } finally {
      await settings.set("billing", billing, { actorId: null });
    }
  });

  it("keeps showing the old account during the cooldown and alerts the billing admins", async () => {
    const [method] = await ctx.owner.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, "instapay"));
    const oldAccount = method?.accountDisplay;
    if (!oldAccount) throw new Error("instapay account missing");
    const requester = await ctx.admin("finance");
    const canceller = await ctx.admin("finance");
    const request = await ctx.harness.call(
      "POST",
      "/admin/billing/methods/instapay/account-change",
      {
        jar: requester.jar,
        body: {
          accountDisplay: "01112223334",
          accountHolder: "Cooldown Holder",
          reason: "Cooldown visibility check",
          totpCode: totp(requester.secret),
        },
      },
    );
    expect(request.statusCode, request.body).toBe(201);
    try {
      const buyer = await ctx.harness.signedInUser();
      const created = await manualOrder(buyer);
      const instructions = await ctx.harness.call(
        "GET",
        `/billing/orders/${created.orderId}/instructions`,
        { jar: buyer.jar },
      );
      expect(instructions.json()).toMatchObject({ accountDisplay: oldAccount });
      expect(instructions.body).not.toContain("01112223334");

      const [pending] = await ctx.owner.db
        .select()
        .from(paymentMethodAccountChanges)
        .where(eq(paymentMethodAccountChanges.status, "pending"));
      if (!pending) throw new Error("pending change missing");
      const alerts = await ctx.owner.db
        .select()
        .from(adminAlerts)
        .where(
          and(
            eq(adminAlerts.kind, "payment_method.account_change_requested"),
            eq(adminAlerts.refId, pending.id),
          ),
        );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.severity).toBe("critical");
      expect(alerts[0]?.summary).not.toContain("01112223334");
      expect(alerts[0]?.summary).toContain("011*****334");
    } finally {
      const cancel = await ctx.harness.call(
        "POST",
        "/admin/billing/methods/instapay/account-change/cancel",
        { jar: canceller.jar },
      );
      expect(cancel.statusCode, cancel.body).toBe(201);
    }
  });

  it("no other admin route can change a manual method's account", async () => {
    const [before] = await ctx.owner.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, "instapay"));
    const finance = await ctx.admin("finance");
    for (const gateway of ["fake", "kashier"]) {
      await ctx.harness.call("PUT", `/admin/billing/gateways/${gateway}/methods/instapay`, {
        jar: finance.jar,
        body: {
          enabled: true,
          reason: "Trying to move the account",
          accountDisplay: "01099999999",
          accountHolder: "Hijacker",
        },
      });
    }
    const [after] = await ctx.owner.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.key, "instapay"));
    expect(after?.accountDisplay).toBe(before?.accountDisplay);
    expect(after?.accountHolder).toBe(before?.accountHolder);
  });

  it("resolving an alert needs the kind's permission and payments.review or billing.write", async () => {
    const alertId = await ctx.app.get(AdminAlertService).notify({
      kind: "reward.fraud_flag",
      severity: "warning",
      refType: "referral",
      refId: randomUUID(),
      summary: "A referral looks suspicious.",
      link: "/admin/growth",
    });
    const bellOnly = await ctx.admin(await ctx.customRole(["alerts.receive"]));
    const denied = await ctx.harness.call("POST", `/admin/alerts/${alertId}/resolve`, {
      jar: bellOnly.jar,
    });
    expect(denied.statusCode).toBe(403);
    const reviewer = await ctx.admin(await ctx.customRole(["alerts.receive", "payments.review"]));
    const resolved = await ctx.harness.call("POST", `/admin/alerts/${alertId}/resolve`, {
      jar: reviewer.jar,
    });
    expect(resolved.statusCode, resolved.body).toBe(201);
    const [row] = await ctx.owner.db.select().from(adminAlerts).where(eq(adminAlerts.id, alertId));
    expect(row?.resolvedBy).toBe(reviewer.userId);
  });

  it("no alert stored by these flows carries the full sender phone or a transaction id", async () => {
    const rows = await ctx.owner.db.select({ summary: adminAlerts.summary }).from(adminAlerts);
    const txnIds = await ctx.owner.db.select({ txnId: payments.txnId }).from(payments);
    expect(rows.length).toBeGreaterThan(0);
    for (const { summary } of rows) {
      expect(summary).not.toContain("01012345678");
      expect(summary).not.toMatch(/r2\.cloudflarestorage|\.r2\.dev|test-payment-proof/);
      for (const { txnId } of txnIds) if (txnId) expect(summary).not.toContain(txnId);
    }
  });
});

describe("webhooks and the return page", () => {
  it("applies a verified payment webhook after its configured gateway is disabled", async () => {
    const credentials = {
      merchantId: "MID-123-456",
      paymentApiKey: "made-up-payment-api-key",
      secretKey: "made-up-secret-key",
    };
    await ctx.owner.db.insert(paymentGateways).values({
      key: "kashier",
      provider: "kashier",
      mode: "test",
      credentialsEnc: encryptSecret(
        JSON.stringify(credentials),
        decodeEncryptionKey(ctx.env.ENCRYPTION_KEY),
        gatewayCredentialsContext("kashier"),
      ),
      merchantRef: credentials.merchantId,
      keyHint: "…-key",
      credentialsUpdatedAt: new Date(),
      enabled: true,
    });
    await ctx.owner.db
      .update(paymentMethods)
      .set({ enabled: true })
      .where(eq(paymentMethods.key, "kashier_card"));
    const user = await ctx.harness.signedInUser();
    const q = await quote(user, { planKey: "plus", months: 1, methodKey: "kashier_card" });
    const createdResponse = await order(user, { quoteId: q.quoteId, methodKey: "kashier_card" });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = createOrderResponseSchema.parse(createdResponse.json());
    const paymentId = created.payment?.id ?? "";
    await ctx.owner.db
      .update(paymentGateways)
      .set({ enabled: false })
      .where(eq(paymentGateways.key, "kashier"));

    const data = {
      merchantOrderId: paymentId,
      status: "CAPTURED",
      amount: (q.quote.totalMinor / 100).toFixed(2),
      currency: "EGP",
      transactionId: `made-up-${paymentId}`,
      signatureKeys: ["merchantOrderId", "status", "amount", "currency", "transactionId"],
    };
    const delivery = await ctx.harness.call("POST", "/webhooks/kashier", {
      origin: null,
      body: { event: "pay", data },
      headers: { "x-kashier-signature": kashierWebhookSignature(credentials.paymentApiKey, data) },
    });
    expect(delivery.statusCode, delivery.body).toBe(200);
    expect(delivery.json()).toMatchObject({ outcome: "activated" });
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("paid");
    const recorded = await ctx.owner.db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.paymentId, paymentId), eq(paymentEvents.provider, "kashier")));
    expect(recorded).toHaveLength(1);
  });

  it("10 duplicate deliveries activate once", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    const delivery = paid(created.payment?.id ?? "", q.quote.totalMinor);
    const responses = await Promise.all(Array.from({ length: 10 }, () => webhook(delivery)));
    expect(responses.every((res) => res.statusCode === 200)).toBe(true);
    const outcomes = responses.map((res) => (res.json() as { outcome: string }).outcome);
    expect(outcomes.filter((outcome) => outcome === "activated")).toHaveLength(1);
    const queued = await ctx.owner.db
      .select()
      .from(outbox)
      .where(eq(outbox.idempotencyKey, `order_paid:${created.orderId}`));
    expect(queued).toHaveLength(1);
  });

  it("return before webhook shows pending, then paid; reading never activates", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    const before = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(before.status).toBe("pending_payment");
    await webhook(paid(created.payment?.id ?? "", q.quote.totalMinor));
    const after = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(after.status).toBe("paid");
    expect(after.payments[0]?.status).toBe("succeeded");
  });

  it("webhook before return: the page finds the order already paid", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    await webhook(paid(created.payment?.id ?? "", q.quote.totalMinor));
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("paid");
  });

  it("a bad signature is refused with 401 and recorded", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    const before = await ctx.owner.db
      .select({ n: count() })
      .from(paymentEvents)
      .where(eq(paymentEvents.signatureOk, false));
    const res = await webhook(paid(created.payment?.id ?? "", q.quote.totalMinor), "ab".repeat(32));
    expect(res.statusCode).toBe(401);
    const after = await ctx.owner.db
      .select({ n: count() })
      .from(paymentEvents)
      .where(eq(paymentEvents.signatureOk, false));
    expect(after[0]?.n).toBe((before[0]?.n ?? 0) + 1);
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("pending_payment");
  });

  it("an amount mismatch is acknowledged, never activates and alerts", async () => {
    const user = await ctx.harness.signedInUser();
    const { created } = await cardOrder(user);
    const paymentId = created.payment?.id ?? "";
    const res = await webhook(paid(paymentId, 100));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: "amount_mismatch" });
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("pending_payment");
    const alerts = await ctx.owner.db
      .select()
      .from(adminAlerts)
      .where(
        and(eq(adminAlerts.refId, paymentId), eq(adminAlerts.kind, "payment.amount_mismatch")),
      );
    expect(alerts).toHaveLength(1);
  });

  it("an unknown gateway is 404", async () => {
    const res = await ctx.harness.call("POST", "/webhooks/nope", { body: {}, origin: null });
    expect(res.statusCode).toBe(404);
  });

  it("the fake gateway secret is the dev one (never used in production)", () => {
    expect(FAKE_GATEWAY_DEV_SECRET).toMatch(/dev/);
  });
});

describe("ownership and cancel", () => {
  it("another owner's order does not exist for the caller", async () => {
    const owner = await ctx.harness.signedInUser();
    const stranger = await ctx.harness.signedInUser();
    const { created } = await cardOrder(owner);
    expect((await status(stranger, created.orderId)).statusCode).toBe(404);
    const cancel = await ctx.harness.call("POST", `/billing/orders/${created.orderId}/cancel`, {
      jar: stranger.jar,
    });
    expect(cancel.statusCode).toBe(404);
  });

  it("the owner cancels an unpaid order; a paid one cannot be canceled", async () => {
    const user = await ctx.harness.signedInUser();
    const { created } = await cardOrder(user);
    const res = await ctx.harness.call("POST", `/billing/orders/${created.orderId}/cancel`, {
      jar: user.jar,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(orderStatusResponseSchema.parse(res.json()).status).toBe("canceled");
    const [attempt] = await ctx.owner.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, created.orderId));
    expect(attempt?.status).toBe("canceled");

    const second = await cardOrder(user);
    await webhook(paid(second.created.payment?.id ?? "", second.q.quote.totalMinor));
    const refused = await ctx.harness.call(
      "POST",
      `/billing/orders/${second.created.orderId}/cancel`,
      { jar: user.jar },
    );
    expect(refused.statusCode).toBe(409);
  });
});

describe("refunds (service)", () => {
  it("records an owner-issued gateway refund reference without calling the provider", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    await webhook(paid(created.payment?.id ?? "", q.quote.totalMinor));
    const service = ctx.app.get(PaymentsService);
    const input = {
      paymentId: created.payment?.id ?? "",
      amountMinor: q.quote.totalMinor,
      reason: "customer asked",
      actorId: user.userId,
      clawbackCredits: 0,
    };
    await expect(service.refund(input)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["transferReference"] },
    });
    const refund = await service.refund({ ...input, transferReference: "KASH-REFUND-1" });
    expect(refund.status).toBe("succeeded");
    expect(refund.transferReference).toBe("KASH-REFUND-1");
    expect(registry.fake && "refund" in registry.fake).toBe(false);
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("refunded");
  });

  it("alerts once when a verified provider reports an unrecorded refund", async () => {
    const user = await ctx.harness.signedInUser();
    const { q, created } = await cardOrder(user);
    const paymentId = created.payment?.id ?? "";
    await webhook(paid(paymentId, q.quote.totalMinor));
    const refundReport = {
      ...paid(paymentId, q.quote.totalMinor, randomUUID()),
      state: "refunded" as const,
    };
    await webhook(refundReport);
    await webhook(refundReport);
    const alerts = await ctx.owner.db
      .select()
      .from(adminAlerts)
      .where(
        and(
          eq(adminAlerts.kind, "payment.review_needed"),
          eq(adminAlerts.refType, "payment"),
          eq(adminAlerts.refId, paymentId),
        ),
      );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe("warning");
    const read = orderStatusResponseSchema.parse((await status(user, created.orderId)).json());
    expect(read.status).toBe("paid");
  });
});
