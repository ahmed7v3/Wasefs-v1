import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  GatewaySignatureError,
  GatewayUnavailableError,
  createFakeGateway,
  createKashierGateway,
  gatewayFromConfig,
  kashierCheckoutHash,
  kashierWebhookSignature,
  parseKashierCredentials,
  sameHex,
  type FakeWebhookBody,
} from "../src/gateways.js";

/*
 * Adapter behaviour that does not need the provider. Status responses come from a real test-mode
 * payment (`fixtures/kashier/`, card and session data removed); the webhook payloads are still
 * hand-made from Kashier's documentation until a delivery is recorded.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/kashier/${name}`, import.meta.url)), "utf8");

const credentials = { merchantId: "MID-1-1", paymentApiKey: "pay-key", secretKey: "secret-key" };
const kashier = createKashierGateway({ mode: "test", credentials });

function signed(data: Record<string, unknown>) {
  return {
    body: { event: "pay", data },
    headers: { "x-kashier-signature": kashierWebhookSignature("pay-key", data) },
  };
}

const paidData = {
  merchantOrderId: "0190f0b8-0000-7000-8000-000000000001",
  kashierOrderId: "KO-1",
  transactionId: "TX-1",
  status: "SUCCESS",
  amount: "283.10",
  currency: "EGP",
  maskedCard: "4111********1111",
  signatureKeys: ["merchantOrderId", "status", "amount", "currency", "transactionId"],
};

describe("kashier", () => {
  it("signs the checkout path with the payment API key", () => {
    const expected = createHmac("sha256", "pay-key")
      .update("/?payment=MID-1-1.order-1.283.10.EGP")
      .digest("hex");
    expect(kashierCheckoutHash(credentials, "order-1", "283.10", "EGP")).toBe(expected);
  });

  it("signs webhook values URL-encoded, keys sorted, like Kashier's documented sample", () => {
    // Computed by hand from developers.kashier.io/docs/webhooks, not by the function under test.
    const data = {
      status: "SUCCESS",
      channel: "online | e-commerce",
      creationDate: "2026-10-19T10:00:00.000Z",
      amount: 79,
      method: "card",
      signatureKeys: ["status", "channel", "creationDate", "amount", "method"],
    };
    const expected = createHmac("sha256", "pay-key")
      .update(
        "amount=79&channel=online%20%7C%20e-commerce&creationDate=2026-10-19T10%3A00%3A00.000Z" +
          "&method=card&status=SUCCESS",
      )
      .digest("hex");
    expect(kashierWebhookSignature("pay-key", data)).toBe(expected);
    const { body } = signed(data);
    expect(() =>
      kashier.verifyWebhook(
        { ...body, data: { ...data, merchantOrderId: "x" } },
        {
          "x-kashier-signature": expected,
        },
      ),
    ).not.toThrow();
  });

  it("builds the hosted page URL with the major-unit amount and both callbacks", async () => {
    const { redirectUrl, providerRef } = await kashier.createCheckout({
      paymentId: "pay-1",
      orderNumber: "WSO-2026-000001",
      amountMinor: 28_310,
      currency: "EGP",
      returnUrl: "https://wasfa.online/billing/orders/o-1",
      webhookUrl: "https://api.wasfa.online/webhooks/kashier",
      locale: "ar",
    });
    const url = new URL(redirectUrl);
    expect(url.origin).toBe("https://checkout.kashier.io");
    expect(url.searchParams.get("amount")).toBe("283.10");
    expect(url.searchParams.get("orderId")).toBe("pay-1");
    expect(url.searchParams.get("mode")).toBe("test");
    expect(url.searchParams.get("hash")).toBe(
      kashierCheckoutHash(credentials, "pay-1", "283.10", "EGP"),
    );
    expect(providerRef).toBeNull();
  });

  it("verifies a webhook and maps it without card data", () => {
    const { body, headers } = signed(paidData);
    const event = kashier.verifyWebhook(body, headers);
    expect(event).toMatchObject({
      paymentId: paidData.merchantOrderId,
      providerRef: "KO-1",
      state: "succeeded",
      amountMinor: 28_310,
      currency: "EGP",
    });
    expect(JSON.stringify(event.redacted)).not.toContain("4111");
    expect(event.eventId).toBe("pay:TX-1:SUCCESS");
  });

  it("refuses a tampered amount, a missing or wrong signature", () => {
    const { body, headers } = signed(paidData);
    const tampered = { ...body, data: { ...paidData, amount: "1.00" } };
    expect(() => kashier.verifyWebhook(tampered, headers)).toThrow(GatewaySignatureError);
    expect(() => kashier.verifyWebhook(body, {})).toThrow(GatewaySignatureError);
    expect(() => kashier.verifyWebhook(body, { "x-kashier-signature": "zz" })).toThrow(
      GatewaySignatureError,
    );
    expect(() => kashier.verifyWebhook("not json", headers)).toThrow(GatewaySignatureError);
  });

  it("maps a failed payment", () => {
    const { body, headers } = signed({ ...paidData, status: "FAILURE", responseCode: "05" });
    expect(kashier.verifyWebhook(body, headers)).toMatchObject({
      state: "failed",
      failureCode: "05",
    });
  });

  it("asks for status with the secret key and treats outages as retryable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ response: { status: "SUCCESS", amount: 283.1, currency: "EGP" } }),
        {
          status: 200,
        },
      ),
    );
    const gateway = createKashierGateway({ mode: "test", credentials, fetch: fetchMock });
    const status = await gateway.getStatus("pay-1", null);
    expect(status).toMatchObject({ state: "succeeded", amountMinor: 28_310 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://test-api.kashier.io/payments/orders/pay-1");
    expect((init.headers as Record<string, string>).Authorization).toBe("secret-key");

    const down = createKashierGateway({
      mode: "test",
      credentials,
      fetch: vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    });
    await expect(down.getStatus("pay-1", null)).rejects.toBeInstanceOf(GatewayUnavailableError);
  });

  it("reads a recorded captured payment with its amount under response.order", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(fixture("status-captured.json"), { status: 200 }));
    const gateway = createKashierGateway({ mode: "test", credentials, fetch: fetchMock });
    const status = await gateway.getStatus("dab47e4c-12cf-45c3-bcc6-920744c72d31", null);
    expect(status).toEqual({
      paymentId: "dab47e4c-12cf-45c3-bcc6-920744c72d31",
      providerRef: "c24f669e-8729-47cf-a36e-220f14f5a8cf",
      state: "succeeded",
      amountMinor: 10_000,
      currency: "EGP",
      failureCode: null,
    });
  });

  it("treats a recorded 404 (customer never paid) as pending, not as an outage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(fixture("status-not-found.json"), { status: 404 }));
    const gateway = createKashierGateway({ mode: "test", credentials, fetch: fetchMock });
    expect(await gateway.getStatus("pay-1", null)).toMatchObject({
      state: "pending",
      providerRef: null,
      amountMinor: null,
    });
  });

  it.each([200, 404])("accepts %s as an authenticated connection response", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status }));
    const gateway = createKashierGateway({ mode: "test", credentials, fetch: fetchMock });
    expect(await gateway.testConnection()).toEqual({ ok: true, errorCode: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/test-api\.kashier\.io\/payments\/orders\/gwprobe-/);
    expect((init.headers as Record<string, string>).Authorization).toBe("secret-key");
  });

  it.each([401, 403])("returns auth for %s", async (status) => {
    const gateway = createKashierGateway({
      mode: "test",
      credentials,
      fetch: vi.fn().mockResolvedValue(new Response("", { status })),
    });
    expect(await gateway.testConnection()).toEqual({ ok: false, errorCode: "auth" });
  });

  it("returns unavailable for 5xx and network errors", async () => {
    const down = createKashierGateway({
      mode: "test",
      credentials,
      fetch: vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    });
    const network = createKashierGateway({
      mode: "test",
      credentials,
      fetch: vi.fn().mockRejectedValue(new Error("network")),
    });
    expect(await down.testConnection()).toEqual({ ok: false, errorCode: "unavailable" });
    expect(await network.testConnection()).toEqual({ ok: false, errorCode: "unavailable" });
  });

  it("parses sealed credentials strictly", () => {
    expect(parseKashierCredentials(JSON.stringify(credentials))).toEqual(credentials);
    expect(parseKashierCredentials("{}")).toBeNull();
    expect(parseKashierCredentials("nope")).toBeNull();
    expect(gatewayFromConfig({ provider: "kashier", mode: "live", credentials: "{}" })).toBeNull();
    expect(gatewayFromConfig({ provider: "other", mode: "live", credentials: "{}" })).toBeNull();
  });
});

describe("fake gateway", () => {
  it("signs and verifies its own deliveries only", () => {
    const fake = createFakeGateway("secret");
    const body: FakeWebhookBody = {
      eventId: "e-1",
      paymentId: "p-1",
      providerRef: "fake_p-1",
      state: "succeeded",
      amountMinor: 100,
      currency: "EGP",
    };
    expect(fake.verifyWebhook(body, { "x-fake-signature": fake.sign(body) }).state).toBe(
      "succeeded",
    );
    const other = createFakeGateway("other");
    expect(() => fake.verifyWebhook(body, { "x-fake-signature": other.sign(body) })).toThrow(
      GatewaySignatureError,
    );
  });

  it("reports what the test scripted, and can be down", async () => {
    const fake = createFakeGateway("secret");
    await fake.createCheckout({
      paymentId: "p-2",
      orderNumber: "WSO-1",
      amountMinor: 500,
      currency: "EGP",
      returnUrl: "https://wasfa.online/x",
      webhookUrl: "https://api/x",
      locale: "en",
    });
    expect((await fake.getStatus("p-2", null)).state).toBe("pending");
    expect(await fake.testConnection()).toEqual({ ok: true, errorCode: null });
    fake.unavailable = true;
    await expect(fake.getStatus("p-2", null)).rejects.toBeInstanceOf(GatewayUnavailableError);
    expect(await fake.testConnection()).toEqual({ ok: false, errorCode: "unavailable" });
  });
});

describe("sameHex", () => {
  it("compares digests in constant time and rejects junk", () => {
    expect(sameHex("ab", "ab")).toBe(true);
    expect(sameHex("AB", "ab")).toBe(true);
    expect(sameHex("ab", "abcd")).toBe(false);
    expect(sameHex("zz", "ab")).toBe(false);
  });
});
