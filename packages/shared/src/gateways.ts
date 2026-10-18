import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { fromMinor, toMinor } from "./money.js";
import { canonicalJson } from "./price-engine.js";

/*
 * Payment gateway adapters (BILLING §5.6). The API (checkout, webhooks, status) and the worker
 * (reconciliation) use the same adapters, so they live here rather than in one app. Everything a
 * provider calls a field name stays inside its adapter: the rest of the code only sees the types
 * below. Cards are entered on the provider's hosted page; no card data ever reaches our servers.
 */

/** What the provider says about one payment attempt, normalized. */
export const GATEWAY_PAYMENT_STATES = ["pending", "succeeded", "failed", "refunded"] as const;
export type GatewayPaymentState = (typeof GATEWAY_PAYMENT_STATES)[number];

export interface GatewayStatus {
  /** Our payment id, as we sent it to the provider. */
  paymentId: string;
  /** The provider's id of the attempt (unique per gateway). Null while nothing exists there yet. */
  providerRef: string | null;
  state: GatewayPaymentState;
  /** Amount the provider reports, in minor units of `currency`. Null when it reports none. */
  amountMinor: number | null;
  currency: string | null;
  failureCode: string | null;
}

/** A verified webhook delivery. `eventId` is the provider's (or derived) unique delivery id. */
export interface GatewayEvent extends GatewayStatus {
  eventId: string;
  type: string;
  /** The payload without card or personal data, for `payment_events.payload`. */
  redacted: Record<string, unknown>;
}

export interface CheckoutInput {
  paymentId: string;
  orderNumber: string;
  amountMinor: number;
  currency: string;
  returnUrl: string;
  webhookUrl: string;
  locale: "ar" | "en";
}

export interface PaymentGateway {
  readonly key: string;
  createCheckout(
    input: CheckoutInput,
  ): Promise<{ redirectUrl: string; providerRef: string | null }>;
  /** Throws `GatewaySignatureError` when the delivery is not authentic. */
  verifyWebhook(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): GatewayEvent;
  /** Reconciliation: never trust the return URL, ask the provider. */
  getStatus(paymentId: string, providerRef: string | null): Promise<GatewayStatus>;
  /** Checks provider authentication without moving money. */
  testConnection(): Promise<{ ok: boolean; errorCode: string | null }>;
}

export const GATEWAY_TEST_ORDER_PREFIX = "gwtest-";

export class GatewaySignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "GatewaySignatureError";
  }
}

/** The provider could not be reached or answered something we cannot use. Safe to retry later. */
export class GatewayUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GatewayUnavailableError";
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function hmacHex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameHex(actual: string, expected: string): boolean {
  if (!/^[0-9a-f]+$/i.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual.toLowerCase(), "hex"), Buffer.from(expected, "hex"));
}

// --- Kashier ------------------------------------------------------------------------------------

/**
 * Kashier hosted payment page.
 *
 * Verified against a real test-mode payment (2026-10-16, fixtures in
 * `packages/shared/test/fixtures/kashier/`): the checkout hash, the secret-key status call and its
 * shape (amount and currency under `response.order`, 404 for an order the customer never paid).
 * Still UNVERIFIED: the webhook body and signature (no public URL during the spike; the return
 * redirect is signed the same way, HMAC(paymentApiKey) over `key=value&...`).
 * Nothing outside this block depends on Kashier's fields.
 */
export interface KashierCredentials {
  merchantId: string;
  /** "Payment API key": signs the checkout hash and the webhook signature. */
  paymentApiKey: string;
  /** "Secret key": authorizes server-to-server calls (status). */
  secretKey: string;
}

export interface KashierOptions {
  mode: "test" | "live";
  credentials: KashierCredentials;
  fetch?: typeof fetch;
}

export const KASHIER_URLS = {
  checkout: "https://checkout.kashier.io/",
  api: { test: "https://test-api.kashier.io", live: "https://api.kashier.io" },
} as const;

const KASHIER_SIGNATURE_HEADER = "x-kashier-signature";

/** `HMAC_SHA256(paymentApiKey, "/?payment=<mid>.<orderId>.<amount>.<currency>")`, hex. */
export function kashierCheckoutHash(
  credentials: KashierCredentials,
  orderId: string,
  amount: string,
  currency: string,
): string {
  const path = `/?payment=${credentials.merchantId}.${orderId}.${amount}.${currency}`;
  return hmacHex(credentials.paymentApiKey, path);
}

/** RFC 3986 encoding of one value, as Kashier's `query-string` / `rawurlencode` samples do. */
function kashierEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The webhook signature (developers.kashier.io/docs/webhooks): HMAC over `key=value&...` of
 * `data.signatureKeys`, sorted, with each value URL-encoded ("online | e-commerce" ->
 * "online%20%7C%20e-commerce"). Missing keys are left out and null values sign as the bare key,
 * like `query-string` does.
 */
export function kashierWebhookSignature(
  paymentApiKey: string,
  data: Record<string, unknown>,
): string {
  const keys = Array.isArray(data.signatureKeys)
    ? data.signatureKeys.filter((key): key is string => typeof key === "string")
    : [];
  const message = [...keys]
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) =>
      data[key] === null
        ? kashierEncode(key)
        : `${kashierEncode(key)}=${kashierEncode(String(data[key]))}`,
    )
    .join("&");
  return hmacHex(paymentApiKey, message);
}

function kashierState(status: unknown): GatewayPaymentState {
  const value = typeof status === "string" ? status.toUpperCase() : "";
  if (value === "SUCCESS" || value === "CAPTURED" || value === "PAID") return "succeeded";
  if (value === "REFUNDED") return "refunded";
  if (value === "FAILURE" || value === "FAILED" || value === "DECLINED" || value === "CANCELLED")
    return "failed";
  return "pending";
}

function minorOrNull(amount: unknown, currency: string | null): number | null {
  if (currency === null || (typeof amount !== "string" && typeof amount !== "number")) return null;
  try {
    return toMinor(amount, currency);
  } catch {
    return null;
  }
}

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export function createKashierGateway(options: KashierOptions): PaymentGateway {
  const { credentials, mode } = options;
  const http = options.fetch ?? fetch;

  /** The JSON body, or null when Kashier answers 404 and the caller allowed it. */
  async function call(
    url: string,
    init: RequestInit,
    allowNotFound: true,
  ): Promise<Record<string, unknown> | null>;
  async function call(url: string, init: RequestInit): Promise<Record<string, unknown>>;
  async function call(
    url: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<Record<string, unknown> | null> {
    let response: Response;
    try {
      response = await http(url, {
        ...init,
        headers: {
          Authorization: credentials.secretKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw new GatewayUnavailableError("Kashier is unreachable", { cause });
    }
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new GatewayUnavailableError(`Kashier answered ${response.status}`);
    const body: unknown = await response.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      throw new GatewayUnavailableError("Kashier answered without JSON");
    }
    return body as Record<string, unknown>;
  }

  return {
    key: "kashier",

    createCheckout(input) {
      const amount = fromMinor(input.amountMinor, input.currency);
      const params = new URLSearchParams({
        merchantId: credentials.merchantId,
        orderId: input.paymentId,
        amount,
        currency: input.currency,
        hash: kashierCheckoutHash(credentials, input.paymentId, amount, input.currency),
        mode,
        merchantRedirect: input.returnUrl,
        serverWebhook: input.webhookUrl,
        redirectMethod: "get",
        display: input.locale,
      });
      // Kashier creates its own order id only when the customer pays: nothing to store yet.
      return Promise.resolve({
        redirectUrl: `${KASHIER_URLS.checkout}?${params.toString()}`,
        providerRef: null,
      });
    },

    verifyWebhook(body, headers) {
      const signature = header(headers, KASHIER_SIGNATURE_HEADER);
      const root =
        body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
      const data =
        root.data !== null && typeof root.data === "object"
          ? (root.data as Record<string, unknown>)
          : null;
      if (!signature || !data) throw new GatewaySignatureError();
      if (!sameHex(signature, kashierWebhookSignature(credentials.paymentApiKey, data))) {
        throw new GatewaySignatureError();
      }
      const paymentId = str(data.merchantOrderId);
      if (!paymentId) throw new GatewaySignatureError("Webhook without merchantOrderId");
      const currency = str(data.currency);
      const transactionId = str(data.transactionId) ?? str(data.kashierOrderId) ?? paymentId;
      const state = kashierState(data.status);
      const type = str(root.event) ?? "pay";
      return {
        eventId: `${type}:${transactionId}:${String(data.status ?? "")}`,
        type,
        paymentId,
        providerRef: str(data.kashierOrderId) ?? str(data.orderReference),
        state,
        amountMinor: minorOrNull(data.amount, currency),
        currency,
        failureCode: state === "failed" ? (str(data.responseCode) ?? "declined") : null,
        // Only the fields we act on; never the masked card, the card token or the customer.
        redacted: {
          event: type,
          status: data.status ?? null,
          merchantOrderId: paymentId,
          kashierOrderId: data.kashierOrderId ?? null,
          transactionId: data.transactionId ?? null,
          amount: data.amount ?? null,
          currency,
          method: data.method ?? null,
        },
      };
    },

    async getStatus(paymentId) {
      const body = await call(
        `${KASHIER_URLS.api[mode]}/payments/orders/${encodeURIComponent(paymentId)}`,
        { method: "GET" },
        true,
      );
      // The customer never reached the payment step: Kashier has no order for this id yet.
      if (body === null) {
        return {
          paymentId,
          providerRef: null,
          state: "pending",
          amountMinor: null,
          currency: null,
          failureCode: null,
        };
      }
      const response =
        body.response !== null && typeof body.response === "object"
          ? (body.response as Record<string, unknown>)
          : body;
      const order =
        response.order !== null && typeof response.order === "object"
          ? (response.order as Record<string, unknown>)
          : response;
      const currency = str(order.currency);
      const state = kashierState(response.status);
      return {
        paymentId,
        providerRef: str(response.kashierOrderId) ?? str(response.orderId),
        state,
        amountMinor: minorOrNull(order.amount, currency),
        currency,
        failureCode: state === "failed" ? "declined" : null,
      };
    },
    async testConnection() {
      try {
        const response = await http(
          `${KASHIER_URLS.api[mode]}/payments/orders/gwprobe-${randomUUID()}`,
          {
            method: "GET",
            headers: { Authorization: credentials.secretKey, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (response.status === 200 || response.status === 404)
          return { ok: true, errorCode: null };
        if (response.status === 401 || response.status === 403)
          return { ok: false, errorCode: "auth" };
        return { ok: false, errorCode: "unavailable" };
      } catch {
        return { ok: false, errorCode: "unavailable" };
      }
    },
  };
}

// --- Fake gateway -------------------------------------------------------------------------------

/**
 * Drives tests and E2E: scripted success, failure, delayed / duplicate webhooks, bad signatures,
 * amount mismatch. The status of each payment lives in a map the test controls. Refused in
 * production by the caller (`NODE_ENV=production` never registers it).
 */
export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

export interface FakeWebhookBody {
  eventId: string;
  paymentId: string;
  providerRef: string;
  state: GatewayPaymentState;
  amountMinor: number;
  currency: string;
  failureCode?: string | null;
}

export interface FakeGateway extends PaymentGateway {
  readonly statuses: Map<string, GatewayStatus>;
  /** Signs a body the way the fake provider would. */
  sign(body: FakeWebhookBody): string;
  /** When true, `getStatus` throws (provider down). */
  unavailable: boolean;
}

export function createFakeGateway(secret: string): FakeGateway {
  const statuses = new Map<string, GatewayStatus>();
  const sign = (body: FakeWebhookBody) => hmacHex(secret, canonicalJson(body));

  const gateway: FakeGateway = {
    key: "fake",
    statuses,
    sign,
    unavailable: false,

    createCheckout(input) {
      const providerRef = `fake_${input.paymentId}`;
      statuses.set(input.paymentId, {
        paymentId: input.paymentId,
        providerRef,
        state: "pending",
        amountMinor: input.amountMinor,
        currency: input.currency,
        failureCode: null,
      });
      const url = new URL(input.returnUrl);
      url.searchParams.set("fake", providerRef);
      return Promise.resolve({ redirectUrl: url.toString(), providerRef });
    },

    verifyWebhook(body, headers) {
      const signature = header(headers, FAKE_SIGNATURE_HEADER);
      const parsed = body as FakeWebhookBody;
      if (!signature || typeof parsed !== "object" || parsed === null) {
        throw new GatewaySignatureError();
      }
      if (!sameHex(signature, sign(parsed))) throw new GatewaySignatureError();
      return {
        eventId: parsed.eventId,
        type: "payment",
        paymentId: parsed.paymentId,
        providerRef: parsed.providerRef,
        state: parsed.state,
        amountMinor: parsed.amountMinor,
        currency: parsed.currency,
        failureCode: parsed.failureCode ?? null,
        redacted: { ...parsed },
      };
    },

    getStatus(paymentId, providerRef) {
      if (gateway.unavailable) {
        return Promise.reject(new GatewayUnavailableError("fake gateway is down"));
      }
      return Promise.resolve(
        statuses.get(paymentId) ?? {
          paymentId,
          providerRef,
          state: "pending",
          amountMinor: null,
          currency: null,
          failureCode: null,
        },
      );
    },

    testConnection() {
      return Promise.resolve({
        ok: !gateway.unavailable,
        errorCode: gateway.unavailable ? "unavailable" : null,
      });
    },
  };
  return gateway;
}

// --- Construction -------------------------------------------------------------------------------

/** Non-production fake gateway secret; the fake gateway never exists in production. */
export const FAKE_GATEWAY_DEV_SECRET = "wasfa-fake-gateway-dev-secret";

/** The plaintext inside `payment_gateways.credentials_enc` (sealed JSON), per provider. */
export function parseKashierCredentials(plaintext: string): KashierCredentials | null {
  let value: unknown;
  try {
    value = JSON.parse(plaintext);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const { merchantId, paymentApiKey, secretKey } = value as Record<string, unknown>;
  if (
    typeof merchantId !== "string" ||
    typeof paymentApiKey !== "string" ||
    typeof secretKey !== "string"
  ) {
    return null;
  }
  if (!merchantId || !paymentApiKey || !secretKey) return null;
  return { merchantId, paymentApiKey, secretKey };
}

/** Builds the adapter for one `payment_gateways` row whose credentials were already decrypted. */
export function gatewayFromConfig(config: {
  provider: string;
  mode: "test" | "live";
  credentials: string;
}): PaymentGateway | null {
  if (config.provider === "kashier") {
    const credentials = parseKashierCredentials(config.credentials);
    return credentials ? createKashierGateway({ mode: config.mode, credentials }) : null;
  }
  return null;
}

/** AES-GCM context of a gateway's sealed credentials (binds the ciphertext to its row). */
export const gatewayCredentialsContext = (key: string) => `payment_gateways:${key}`;
