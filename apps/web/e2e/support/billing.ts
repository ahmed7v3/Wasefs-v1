import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { FAKE_GATEWAY_DEV_SECRET, createFakeGateway } from "@wasfa/shared/gateways";
import {
  createOrderResponseSchema,
  orderStatusResponseSchema,
  quoteResponseSchema,
  type OrderStatusResponse,
} from "@wasfa/shared/schemas/billing";

import {
  enableTwoFactor,
  finishOnboarding,
  grantSuperAdmin,
  newAccount,
  registerVerified,
  signInContext,
  signOutContext,
} from "./accounts";
import { runtime, type StackUrls } from "./runtime";
import { totp } from "./totp";

import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import type { Redis } from "ioredis";

/*
 * Billing helpers for the end-to-end suite. The catalog itself (public plans, the fake-gateway card
 * method) is seeded once by `stack.ts`; this file creates orders through the real API, plays the
 * payment provider with a signed fake webhook, drives the admin review through the real admin
 * endpoints, and does the few direct database edits a test needs (a coupon, an expired order).
 */

const DB_DIR = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));

/** Runs a SQL script with the owner role (the same way `support/rx.ts` seeds analyses). */
function sql(script: string, params: object = {}): void {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: DB_DIR,
    env: { ...process.env, DATABASE_URL: runtime().ownerDatabaseUrl, P: JSON.stringify(params) },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`billing seed failed: ${result.stdout}${result.stderr}`);
}

/**
 * The account already spent this month's free credits: the plan grant the API would pay on demand is
 * paid and expired (the db package's own functions), so the app shows a short balance.
 */
export function useUpMonthlyGrant(email: string): void {
  sql(
    `import postgres from "postgres";
const { createDb, ensureMonthlyGrant, expireUnused, grantPeriod } = await import("./dist/index.js");
const p = JSON.parse(process.env.P);
const pg = postgres(process.env.DATABASE_URL);
const [user] = await pg\`select id from users where email = \${p.email}\`;
await pg.end();
if (!user) throw new Error("no such account");
const { db, close } = createDb({ url: process.env.DATABASE_URL, max: 1 });
const now = new Date();
await ensureMonthlyGrant(db, user.id, now);
await expireUnused(db, { type: "user", id: user.id }, grantPeriod(now));
await close();`,
    { email },
  );
}

/** An active percentage coupon (basis points) for everyone, valid now. */
export function insertCoupon(code: string, bps: number): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`insert into coupons (code, kind, name, title_ar, title_en, value, status)
  values (\${p.code}, 'percent', \${"E2E " + p.code}, 'خصم تجريبي', 'E2E discount', \${p.bps}, 'active')\`;
await db.end();`,
    { code, bps },
  );
}

/** Ends an order the way the expiry job does: expired, with its deadline in the past. */
export function expireOrder(orderId: string): void {
  sql(
    `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
await db\`update orders set status = 'expired', expires_at = now() - interval '1 hour' where id = \${p.id}\`;
await db\`update payments set status = 'expired' where order_id = \${p.id} and status in ('created', 'awaiting_customer')\`;
await db.end();`,
    { id: orderId },
  );
}

const originHeader = (urls: StackUrls) => ({ Origin: urls.web });

export interface CreatedOrder {
  orderId: string;
  paymentId: string | null;
  totalMinor: number;
  currency: string;
}

/** Quotes and orders through the API as the signed-in user of `context` (what the checkout page does). */
export async function createOrderViaApi(
  context: BrowserContext,
  urls: StackUrls,
  body: { planKey: string; months: number; methodKey: string },
): Promise<CreatedOrder> {
  const quoteResponse = await context.request.post(`${urls.api}/billing/quote`, {
    data: body,
    headers: originHeader(urls),
  });
  if (!quoteResponse.ok()) throw new Error(`quote failed: ${String(quoteResponse.status())}`);
  const quote = quoteResponseSchema.parse(await quoteResponse.json());
  const orderResponse = await context.request.post(`${urls.api}/billing/orders`, {
    data: { quoteId: quote.quoteId, methodKey: body.methodKey, locale: "ar" },
    headers: originHeader(urls),
  });
  if (!orderResponse.ok()) throw new Error(`order failed: ${String(orderResponse.status())}`);
  const order = createOrderResponseSchema.parse(await orderResponse.json());
  return {
    orderId: order.orderId,
    paymentId: order.payment?.id ?? null,
    totalMinor: quote.quote.totalMinor,
    currency: quote.quote.currency,
  };
}

export async function orderStatus(
  context: BrowserContext | Page,
  urls: StackUrls,
  orderId: string,
): Promise<OrderStatusResponse> {
  const response = await context.request.get(`${urls.api}/billing/orders/${orderId}`);
  if (!response.ok()) throw new Error(`order status failed: ${String(response.status())}`);
  return orderStatusResponseSchema.parse(await response.json());
}

/** The fake provider confirms the latest payment of an order: a signed webhook, as Kashier would send. */
export async function payFakeOrder(
  context: BrowserContext | Page,
  urls: StackUrls,
  orderId: string,
): Promise<void> {
  const order = await orderStatus(context, urls, orderId);
  const payment = order.payments[0];
  if (!payment) throw new Error("the order has no payment to confirm");
  const body = {
    eventId: randomUUID(),
    paymentId: payment.id,
    providerRef: `fake_${payment.id}`,
    state: "succeeded" as const,
    amountMinor: order.totalMinor,
    currency: order.currency,
  };
  const signature = createFakeGateway(FAKE_GATEWAY_DEV_SECRET).sign(body);
  const response = await fetch(`${urls.api}/webhooks/fake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fake-signature": signature },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`webhook refused: ${String(response.status)}`);
}

export interface AdminSession {
  request: APIRequestContext;
  close: () => Promise<void>;
  review: (paymentId: string, decision: "approve" | "reject") => Promise<void>;
}

/**
 * A super admin with the full password + TOTP sign-in, in its own browser context, plus the
 * password re-check money actions ask for. Decisions go through the real admin endpoints.
 */
export async function adminSession(
  browser: Browser,
  urls: StackUrls,
  redis: Redis,
): Promise<AdminSession> {
  const context = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  const admin = newAccount("Reviewer");
  await registerVerified(urls, redis, admin);
  grantSuperAdmin(admin.email);
  await signInContext(context, urls, admin);
  await finishOnboarding(context.request, urls, admin.name);
  const secret = await enableTwoFactor(context, urls, admin);
  await signOutContext(context, urls);

  const signIn = await context.request.post(`${urls.api}/auth/sign-in/email`, {
    data: { email: admin.email, password: admin.password },
    headers: originHeader(urls),
  });
  if (!signIn.ok()) throw new Error(`admin sign-in failed: ${String(signIn.status())}`);
  // The code of the next 30 s window: the one used to switch 2FA on cannot be replayed.
  const verify = await context.request.post(`${urls.api}/auth/two-factor/verify-totp`, {
    data: { code: totp(secret, Date.now() + 30_000) },
    headers: originHeader(urls),
  });
  if (!verify.ok()) throw new Error(`admin 2FA failed: ${String(verify.status())}`);
  const reauth = await context.request.post(`${urls.api}/auth/reauth`, {
    data: { password: admin.password },
    headers: originHeader(urls),
  });
  if (!reauth.ok()) throw new Error(`admin reauth failed: ${String(reauth.status())}`);

  const post = async (path: string, data: object): Promise<void> => {
    const response = await context.request.post(`${urls.api}${path}`, {
      data,
      headers: originHeader(urls),
    });
    if (!response.ok()) {
      throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
    }
  };

  return {
    request: context.request,
    close: () => context.close(),
    review: async (paymentId, decision) => {
      await post(`/admin/billing/payments/${paymentId}/claim`, {});
      if (decision === "approve") {
        await post(`/admin/billing/payments/${paymentId}/approve`, {});
      } else {
        await post(`/admin/billing/payments/${paymentId}/reject`, { reason: "unreadable_proof" });
      }
    },
  };
}

/** Draws a crisp page of text in the browser and returns it as a JPEG, for the proof upload. */
export async function proofPicture(
  page: Page,
  name = "transfer.jpg",
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1200, 1600);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 40px monospace";
    for (let line = 0; line < 30; line += 1) {
      ctx.fillText(`InstaPay transfer ${String(line)}  EGP 99.00  OK`, 60, 80 + line * 48);
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) throw new Error("no jpeg");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  });
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

/** Text with bidi marks and runs of whitespace removed, for comparing formatted amounts. */
export function plain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[‎‏؜‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The number in a formatted amount ("283.10 ج.م." -> 283.1). */
export function amountOf(text: string | null | undefined): number {
  const match = /\d[\d,]*(?:\.\d+)?/.exec(plain(text));
  return match ? Number(match[0].replaceAll(",", "")) : Number.NaN;
}
