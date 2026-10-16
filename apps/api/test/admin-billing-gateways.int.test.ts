import {
  paymentGatewayTests,
  paymentMethods,
  paymentGateways,
  payments,
  paymentEvents,
  outbox,
  adminAlerts,
  auditLogs,
} from "@wasfa/db";
import { kashierWebhookSignature } from "@wasfa/shared/gateways";
import {
  gatewayListSchema,
  gatewayTestStartResponseSchema,
  gatewayTestViewSchema,
  gatewayViewSchema,
} from "@wasfa/shared/schemas/admin-billing-gateways";
import { count, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AdminBillingGatewaysRepo } from "../src/admin/billing/admin-billing-gateways.repo.js";

import { AdminTestContext, type Admin, type Person } from "./support/admin-context.js";

const ctx = new AdminTestContext();
let boss: Admin;
const credentials = {
  merchantId: "MID-123-456",
  paymentApiKey: "made-up-payment-api-key-1",
  secretKey: "made-up-secret-key-1",
};
const changedCredentials = {
  merchantId: "MID-123-456",
  paymentApiKey: "made-up-payment-api-key-2",
  secretKey: "made-up-secret-key-2",
};

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (
  method: "GET" | "POST" | "PUT",
  url: string,
  who: { jar: Person["jar"] },
  body?: Record<string, unknown>,
) => ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

async function createGateway(
  who: { jar: Person["jar"] } = boss,
): Promise<ReturnType<typeof gatewayViewSchema.parse>> {
  await ctx.owner.db
    .delete(paymentGatewayTests)
    .where(eq(paymentGatewayTests.gatewayKey, "kashier"));
  await ctx.owner.db.delete(paymentMethods).where(eq(paymentMethods.provider, "kashier"));
  await ctx.owner.db.delete(paymentGateways).where(eq(paymentGateways.key, "kashier"));
  const result = await call("POST", "/admin/billing/gateways", who, {
    key: "kashier",
    provider: "kashier",
    mode: "test",
    credentials,
    reason: "initial gateway setup",
  });
  expect(result.statusCode, result.body).toBe(201);
  const [row] = await ctx.owner.db
    .select()
    .from(paymentGateways)
    .where(eq(paymentGateways.key, "kashier"));
  expect(row).toBeDefined();
  const alerts = await ctx.owner.db
    .select()
    .from(adminAlerts)
    .where(eq(adminAlerts.refId, row?.id ?? ""));
  expect(
    alerts.filter(
      (alert) => alert.kind === "payment.review_needed" && alert.severity === "critical",
    ),
  ).toHaveLength(1);
  const createAudit = await ctx.auditRowsFor("billing.gateway.create", "kashier");
  expect(createAudit[0]?.after).toMatchObject({ reason: "initial gateway setup" });
  return gatewayViewSchema.parse(result.json());
}

function providerFetch(orderAmount = "1.00") {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("gwprobe-")) return new Response("", { status: 404 });
    return Response.json({
      response: {
        status: "CAPTURED",
        order: { amount: orderAmount, currency: "EGP" },
        orderId: "made-up-provider-order",
      },
    });
  });
}

function signedTestWebhook(
  providerOrderId: string,
  amount = "1.00",
  signatureKey = credentials.paymentApiKey,
) {
  const data = {
    merchantOrderId: providerOrderId,
    status: "CAPTURED",
    amount,
    currency: "EGP",
    transactionId: `made-up-${providerOrderId}`,
    signatureKeys: ["merchantOrderId", "status", "amount", "currency", "transactionId"],
  };
  return { body: { event: "pay", data }, signature: kashierWebhookSignature(signatureKey, data) };
}

describe("admin billing gateway access and credential handling", () => {
  it("requires billing.write, permits billing.read, and requires fresh auth on sensitive routes", async () => {
    const readRole = await ctx.customRole(["billing.read"]);
    const reader = await ctx.admin(readRole);
    const listed = await call("GET", "/admin/billing/gateways", reader);
    expect(listed.statusCode).toBe(200);
    expect(gatewayListSchema.parse(listed.json()).items).toEqual([]);
    const denied = await call("POST", "/admin/billing/gateways", reader, {
      key: "kashier",
      provider: "kashier",
      mode: "test",
      credentials,
      reason: "initial gateway setup",
    });
    expect(denied.statusCode).toBe(403);

    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const freshRoutes: Array<["POST" | "PUT", string, Record<string, unknown>]> = [
      [
        "POST",
        "/admin/billing/gateways",
        {
          key: "kashier",
          provider: "kashier",
          mode: "test",
          credentials,
          reason: "initial gateway setup",
        },
      ],
      [
        "PUT",
        "/admin/billing/gateways/kashier/credentials",
        { credentials, reason: "credential rotation" },
      ],
      ["PUT", "/admin/billing/gateways/kashier/mode", { mode: "test", reason: "mode review" }],
      [
        "PUT",
        "/admin/billing/gateways/kashier/enabled",
        { enabled: false, reason: "pause gateway" },
      ],
      ["POST", "/admin/billing/gateways/kashier/test-payments", { amountMinor: 100 }],
    ];
    for (const [method, url, body] of freshRoutes) {
      const response = await call(method, url, stale, body);
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toMatchObject({
        code: "AUTH_REQUIRED",
        details: { reason: "reauth", maxAgeMinutes: 10 },
      });
    }
  });

  it("seals secrets, omits them from responses/audit, and resets linked methods with a critical alert", async () => {
    await createGateway();
    await ctx.owner.db.insert(paymentMethods).values({
      key: "kashier_card",
      kind: "gateway",
      provider: "kashier",
      nameAr: "بطاقة",
      nameEn: "Card",
      currencies: ["EGP"],
      enabled: true,
    });
    const changed = await call("PUT", "/admin/billing/gateways/kashier/credentials", boss, {
      credentials: changedCredentials,
      reason: "rotate merchant keys",
    });
    expect(changed.statusCode).toBe(200);
    const credentialAudit = await ctx.auditRowsFor("billing.gateway.credentials", "kashier");
    expect(credentialAudit[0]?.after).toMatchObject({ reason: "rotate merchant keys" });
    expect(changed.body).not.toContain(changedCredentials.paymentApiKey);
    expect(changed.body).not.toContain(changedCredentials.secretKey);
    const views = gatewayListSchema.parse(
      (await call("GET", "/admin/billing/gateways", boss)).json(),
    );
    expect(views.items[0]).toMatchObject({
      enabled: false,
      hasCredentials: true,
      verifiedAt: null,
      methods: [{ key: "kashier_card", enabled: false }],
    });
    const alertRows = await ctx.owner.db
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.severity, "critical"));
    expect(alertRows.some((row) => row.summary.includes("kashier"))).toBe(true);
    const auditRows = await ctx.owner.db.select().from(auditLogs);
    const serialized = JSON.stringify(auditRows);
    expect(serialized).not.toContain(credentials.paymentApiKey);
    expect(serialized).not.toContain(credentials.secretKey);
    expect(serialized).not.toContain(changedCredentials.paymentApiKey);
    expect(serialized).not.toContain(changedCredentials.secretKey);
  });

  it("requires the exact live confirmation", async () => {
    await createGateway();
    const rejected = await call("PUT", "/admin/billing/gateways/kashier/mode", boss, {
      mode: "live",
      confirm: "live",
      reason: "switch mode",
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["confirm"] },
    });
    const accepted = await call("PUT", "/admin/billing/gateways/kashier/mode", boss, {
      mode: "live",
      confirm: "LIVE",
      reason: "switch mode",
    });
    expect(accepted.statusCode).toBe(200);
    expect(gatewayViewSchema.parse(accepted.json()).mode).toBe("live");
    const modeAudit = await ctx.auditRowsFor("billing.gateway.mode", "kashier");
    expect(modeAudit[0]?.after).toMatchObject({ reason: "switch mode" });
  });
});

describe("isolated Kashier test payments", () => {
  it("checks a signed test webhook and status without touching payment accounting", async () => {
    await createGateway();
    providerFetch();
    const connection = await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    expect(connection.statusCode).toBe(201);
    expect(connection.json()).toEqual({ ok: true, errorCode: null });
    const countsBefore = await Promise.all([
      ctx.owner.db.select({ n: count() }).from(payments),
      ctx.owner.db.select({ n: count() }).from(paymentEvents),
      ctx.owner.db.select({ n: count() }).from(outbox),
    ]);
    const started = await call("POST", "/admin/billing/gateways/kashier/test-payments", boss, {
      amountMinor: 100,
    });
    expect(started.statusCode).toBe(201);
    const testStart = gatewayTestStartResponseSchema.parse(started.json());
    const test = await ctx.owner.db
      .select()
      .from(paymentGatewayTests)
      .where(eq(paymentGatewayTests.id, testStart.id));
    const providerOrderId = test[0]?.providerOrderId;
    expect(providerOrderId).toMatch(/^gwtest-/);
    const delivery = signedTestWebhook(providerOrderId ?? "");
    const received = await ctx.harness.call("POST", "/webhooks/kashier", {
      origin: null,
      body: delivery.body,
      headers: { "x-kashier-signature": delivery.signature },
    });
    expect(received.statusCode).toBe(200);
    expect(received.json()).toMatchObject({ outcome: "test" });
    const checked = await call(
      "POST",
      `/admin/billing/gateways/kashier/test-payments/${testStart.id}/check`,
      boss,
    );
    expect(checked.statusCode).toBe(201);
    expect(gatewayTestViewSchema.parse(checked.json())).toMatchObject({
      status: "succeeded",
      checklist: { paid: true, webhookReceived: true, signatureValid: true, amountMatches: true },
    });
    const verified = gatewayViewSchema.parse(
      (await call("GET", "/admin/billing/gateways", boss)).json().items[0],
    );
    expect(verified.verifiedAt).not.toBeNull();
    const countsAfter = await Promise.all([
      ctx.owner.db.select({ n: count() }).from(payments),
      ctx.owner.db.select({ n: count() }).from(paymentEvents),
      ctx.owner.db.select({ n: count() }).from(outbox),
    ]);
    expect(countsAfter).toEqual(countsBefore);
  });

  it("stores only a webhook error code on a bad test signature", async () => {
    await createGateway();
    providerFetch();
    await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    const started = gatewayTestStartResponseSchema.parse(
      (await call("POST", "/admin/billing/gateways/kashier/test-payments", boss, {})).json(),
    );
    const row = (
      await ctx.owner.db
        .select()
        .from(paymentGatewayTests)
        .where(eq(paymentGatewayTests.id, started.id))
    )[0];
    const bad = signedTestWebhook(row?.providerOrderId ?? "");
    const response = await ctx.harness.call("POST", "/webhooks/kashier", {
      origin: null,
      body: bad.body,
      headers: { "x-kashier-signature": "bad" },
    });
    expect(response.statusCode).toBe(401);
    const gateway = gatewayViewSchema.parse(
      (await call("GET", "/admin/billing/gateways", boss)).json().items[0],
    );
    expect(gateway).toMatchObject({ lastWebhookOk: false, lastWebhookError: "bad_signature" });
  });

  it("blocks enablement at every required checkpoint, then allows it after the cooldown", async () => {
    await createGateway();
    const [row] = await ctx.owner.db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.key, "kashier"));
    expect(row).toBeDefined();
    await ctx.owner.db
      .update(paymentGateways)
      .set({ credentialsEnc: null })
      .where(eq(paymentGateways.key, "kashier"));
    let response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response).toMatchObject({ statusCode: 409 });
    expect(response.json()).toMatchObject({ details: { reason: "no_credentials" } });

    response = await call("PUT", "/admin/billing/gateways/kashier/credentials", boss, {
      credentials,
      reason: "restore test keys",
    });
    expect(response.statusCode).toBe(200);
    response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response.json()).toMatchObject({ details: { reason: "connection_untested" } });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    response = await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    expect(response.json()).toMatchObject({ ok: false, errorCode: "unavailable" });
    response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response.json()).toMatchObject({ details: { reason: "connection_failed" } });

    providerFetch();
    await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response.json()).toMatchObject({ details: { reason: "not_verified" } });

    const now = new Date();
    await ctx.owner.db
      .update(paymentGateways)
      .set({ verifiedAt: now, credentialsUpdatedAt: now, lastTestAt: now, lastTestOk: true })
      .where(eq(paymentGateways.key, "kashier"));
    response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response.json()).toMatchObject({ details: { reason: "cooldown" } });

    await ctx.owner.db
      .update(paymentGateways)
      .set({ credentialsUpdatedAt: new Date(Date.now() - 11 * 60_000), lastTestAt: now })
      .where(eq(paymentGateways.key, "kashier"));
    response = await call("PUT", "/admin/billing/gateways/kashier/enabled", boss, {
      enabled: true,
      reason: "enable card",
    });
    expect(response.statusCode).toBe(200);
    expect(gatewayViewSchema.parse(response.json()).enabled).toBe(true);
    const enabledAudit = await ctx.auditRowsFor("billing.gateway.enabled", "kashier");
    expect(enabledAudit[0]?.after).toMatchObject({ reason: "enable card" });
    await ctx.owner.db.insert(paymentMethods).values({
      key: "kashier_card",
      kind: "gateway",
      provider: "kashier",
      nameAr: "بطاقة",
      nameEn: "Card",
      currencies: ["EGP"],
      enabled: false,
    });
    response = await call("PUT", "/admin/billing/gateways/kashier/methods/kashier_card", boss, {
      enabled: true,
      reason: "activate card method",
    });
    expect(response.statusCode).toBe(200);
    const methodAudit = await ctx.auditRowsFor("billing.gateway.method", "kashier_card");
    expect(methodAudit[0]?.after).toMatchObject({ reason: "activate card method" });
  });

  it("conditionally enables and verifies only the credentials that passed their checks", async () => {
    await createGateway();
    const repo = ctx.app.get(AdminBillingGatewaysRepo);
    const credentialsUpdatedAt = new Date();
    await ctx.owner.db
      .update(paymentGateways)
      .set({
        credentialsUpdatedAt,
        lastTestAt: credentialsUpdatedAt,
        lastTestOk: true,
        verifiedAt: credentialsUpdatedAt,
      })
      .where(eq(paymentGateways.key, "kashier"));

    expect(await repo.setEnabled("kashier", true)).toBeUndefined();
    await ctx.owner.db
      .update(paymentGateways)
      .set({ verifiedAt: null })
      .where(eq(paymentGateways.key, "kashier"));
    const beforeVerify = new Date(credentialsUpdatedAt.getTime() - 1);
    expect(await repo.verifyGateway("kashier", "test", beforeVerify)).toBe(false);
    const [row] = await ctx.owner.db
      .select()
      .from(paymentGateways)
      .where(eq(paymentGateways.key, "kashier"));
    expect(row?.enabled).toBe(false);
    expect(row?.verifiedAt).toBeNull();

    await ctx.owner.db.insert(paymentMethods).values({
      key: "kashier_card",
      kind: "gateway",
      provider: "kashier",
      nameAr: "بطاقة",
      nameEn: "Card",
      currencies: ["EGP"],
      enabled: false,
    });
    const disabledMethod = await repo.enableMethod("kashier", "kashier_card", true);
    expect(disabledMethod).toBeUndefined();
    const methodResponse = await call(
      "PUT",
      "/admin/billing/gateways/kashier/methods/kashier_card",
      boss,
      { enabled: true, reason: "activate card method" },
    );
    expect(methodResponse.statusCode).toBe(409);
    expect(methodResponse.json()).toMatchObject({ details: { reason: "gateway_disabled" } });
  });

  it("marks amount mismatches and does not verify a payment created before credentials changed", async () => {
    await createGateway();
    providerFetch("2.00");
    await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    let started = gatewayTestStartResponseSchema.parse(
      (await call("POST", "/admin/billing/gateways/kashier/test-payments", boss, {})).json(),
    );
    let test = (
      await ctx.owner.db
        .select()
        .from(paymentGatewayTests)
        .where(eq(paymentGatewayTests.id, started.id))
    )[0];
    let delivery = signedTestWebhook(test?.providerOrderId ?? "", "2.00");
    await ctx.harness.call("POST", "/webhooks/kashier", {
      origin: null,
      body: delivery.body,
      headers: { "x-kashier-signature": delivery.signature },
    });
    let checked = await call(
      "POST",
      `/admin/billing/gateways/kashier/test-payments/${started.id}/check`,
      boss,
    );
    expect(gatewayTestViewSchema.parse(checked.json()).status).toBe("mismatch");
    expect(
      gatewayViewSchema.parse((await call("GET", "/admin/billing/gateways", boss)).json().items[0])
        .verifiedAt,
    ).toBeNull();

    providerFetch("1.00");
    await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    started = gatewayTestStartResponseSchema.parse(
      (await call("POST", "/admin/billing/gateways/kashier/test-payments", boss, {})).json(),
    );
    test = (
      await ctx.owner.db
        .select()
        .from(paymentGatewayTests)
        .where(eq(paymentGatewayTests.id, started.id))
    )[0];
    delivery = signedTestWebhook(test?.providerOrderId ?? "", "1.00", credentials.paymentApiKey);
    await ctx.harness.call("POST", "/webhooks/kashier", {
      origin: null,
      body: delivery.body,
      headers: { "x-kashier-signature": delivery.signature },
    });
    await call("PUT", "/admin/billing/gateways/kashier/credentials", boss, {
      credentials: changedCredentials,
      reason: "rotate before checking old test",
    });
    await call("POST", "/admin/billing/gateways/kashier/test-connection", boss);
    checked = await call(
      "POST",
      `/admin/billing/gateways/kashier/test-payments/${started.id}/check`,
      boss,
    );
    expect(gatewayTestViewSchema.parse(checked.json()).status).toBe("succeeded");
    expect(
      gatewayViewSchema.parse((await call("GET", "/admin/billing/gateways", boss)).json().items[0])
        .verifiedAt,
    ).toBeNull();
  });
});
