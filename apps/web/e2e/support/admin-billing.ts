import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { t } from "@wasfa/shared/i18n";

import {
  enableTwoFactor,
  finishOnboarding,
  grantSuperAdmin,
  newAccount,
  registerVerified,
  signInContext,
  signOutContext,
  type Account,
} from "./accounts";
import { createOrderViaApi, payFakeOrder, orderStatus } from "./billing";
import { runtime, type StackUrls } from "./runtime";
import { totp } from "./totp";

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { Redis } from "ioredis";

/*
 * Helpers of the admin billing console specs: an admin (or a limited admin) who signs in through the
 * real login form with a TOTP code, TOTP codes that were not used yet, and a few direct database
 * edits to put a payment into the review queue.
 */

const STEP_MS = 30_000;
const stepOf = (time: number) => Math.floor(time / STEP_MS);

export interface AdminLogin {
  account: Account;
  userId: string;
  secret: string;
  /** TOTP steps already spent (a code can be used once). */
  used: Set<number>;
  /**
   * The current window's code, never spent before. If the current window is spent, it waits for the
   * next one: a code for the current window is accepted whichever side of a 30 s edge the server
   * checks it, a code for a neighbouring window is not.
   */
  code: () => Promise<string>;
}

const originHeader = (urls: StackUrls) => ({ Origin: urls.web });

/** Registers an account with two-factor on, optionally a super admin; the session is closed again. */
async function prepareAccount(
  context: BrowserContext,
  urls: StackUrls,
  redis: Redis,
  label: string,
  superAdmin: boolean,
) {
  const account = newAccount(label);
  await registerVerified(urls, redis, account);
  if (superAdmin) grantSuperAdmin(account.email);
  await signInContext(context, urls, account);
  const page = await context.newPage();
  await finishOnboarding(page.request, urls, account.name);
  await page.close();
  const me = await context.request.get(`${urls.api}/me`);
  const userId = ((await me.json()) as { id: string }).id;
  const enabledAt = Date.now();
  const secret = await enableTwoFactor(context, urls, account);
  await signOutContext(context, urls);
  return { account, userId, secret, used: new Set([stepOf(enabledAt)]) };
}

/** Signs in through the login form: password, then the code of a step that is free. */
export async function signInThroughUi(page: Page, login: AdminLogin): Promise<void> {
  await page.goto("/login");
  const form = page.getByRole("form", { name: t("auth.tab.email") });
  await form.locator("input[name=email]").fill(login.account.email);
  await form.locator("input[name=password]").fill(login.account.password);
  await form.getByRole("button", { name: t("auth.login.submit") }).click();
  await page.waitForURL(/\/login\/two-factor/);
  await page.locator("input[name=code]").fill(await login.code());
  await page.getByRole("button", { name: t("auth.twoFactor.submit") }).click();
  await page.waitForURL(/\/dashboard$/);
}

export async function createAdminLogin(
  context: BrowserContext,
  urls: StackUrls,
  redis: Redis,
  options: { label: string; superAdmin: boolean },
): Promise<AdminLogin> {
  const base = await prepareAccount(context, urls, redis, options.label, options.superAdmin);
  const login: AdminLogin = {
    ...base,
    code: async () => {
      let step = stepOf(Date.now());
      if (login.used.has(step)) {
        await new Promise((resolve) =>
          setTimeout(resolve, (step + 1) * STEP_MS - Date.now() + 1_000),
        );
        step = stepOf(Date.now());
      }
      login.used.add(step);
      return totp(base.secret, step * STEP_MS);
    },
  };
  return login;
}

/** A super admin signed in on `page`'s context. */
export async function signedInSuperAdmin(
  page: Page,
  urls: StackUrls,
  redis: Redis,
): Promise<AdminLogin> {
  const login = await createAdminLogin(page.context(), urls, redis, {
    label: "Revenue",
    superAdmin: true,
  });
  await signInThroughUi(page, login);
  return login;
}

/** Runs a SQL script as the database owner (the same way `support/billing.ts` seeds rows). */
function sql(script: string, params: object): void {
  const dbDir = fileURLToPath(new URL("../../../../packages/db/", import.meta.url));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dbDir,
    env: {
      ...process.env,
      DATABASE_URL: runtime().ownerDatabaseUrl,
      P: JSON.stringify(params),
    },
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`seed failed: ${result.stdout}${result.stderr}`);
}

export interface SeededPayment {
  orderId: string;
  paymentId: string;
  number: string;
}

/** A customer's InstaPay order, moved straight into the manual review queue (the proof upload has its own spec). */
export async function seedReviewPayment(
  browser: Browser,
  urls: StackUrls,
  redis: Redis,
): Promise<SeededPayment> {
  const context = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const account = newAccount("Payer");
    await registerVerified(urls, redis, account);
    await signInContext(context, urls, account);
    const page = await context.newPage();
    await finishOnboarding(page.request, urls, account.name);
    const order = await createOrderViaApi(context, urls, {
      planKey: "plus",
      months: 1,
      methodKey: "instapay",
    });
    const status = await orderStatus(context, urls, order.orderId);
    const paymentId = order.paymentId ?? status.payments[0]?.id ?? "";
    sql(
      `import postgres from "postgres";
const p = JSON.parse(process.env.P);
const db = postgres(process.env.DATABASE_URL);
const [file] = await db\`insert into files (owner_user_id, purpose, r2_key, mime, bytes, status)
  select o.owner_user_id, 'payment_proof', \${"e2e/proof-" + p.id + ".jpg"}, 'image/jpeg', 2048, 'processed'
  from payments pay join orders o on o.id = pay.order_id where pay.id = \${p.id} returning id\`;
await db\`update payments set status = 'awaiting_review', proof_file_id = \${file.id}, proof_submissions = 1, txn_id = \${"E2E-" + p.id}, sender_phone_masked = '0101***7026' where id = \${p.id}\`;
await db.end();`,
      { id: paymentId },
    );
    return { orderId: order.orderId, paymentId, number: status.number };
  } finally {
    await context.close();
  }
}

/** A customer's order paid with the scripted fake card: a succeeded payment an admin may refund. */
export async function seedPaidPayment(
  browser: Browser,
  urls: StackUrls,
  redis: Redis,
): Promise<SeededPayment> {
  const context = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const account = newAccount("Buyer");
    await registerVerified(urls, redis, account);
    await signInContext(context, urls, account);
    const page = await context.newPage();
    await finishOnboarding(page.request, urls, account.name);
    const order = await createOrderViaApi(context, urls, {
      planKey: "plus",
      months: 1,
      methodKey: "fake_card",
    });
    await payFakeOrder(context, urls, order.orderId);
    let status = await orderStatus(context, urls, order.orderId);
    for (let attempt = 0; attempt < 40 && status.status !== "paid"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      status = await orderStatus(context, urls, order.orderId);
    }
    return {
      orderId: order.orderId,
      paymentId: status.payments[0]?.id ?? "",
      number: status.number,
    };
  } finally {
    await context.close();
  }
}

/** The admin API as the signed-in page sees it (cookies + origin), for seeding and checking. */
export async function adminGet<T>(page: Page, urls: StackUrls, path: string): Promise<T> {
  const response = await page.request.get(`${urls.api}${path}`);
  if (!response.ok()) throw new Error(`${path} failed: ${String(response.status())}`);
  return (await response.json()) as T;
}

export async function adminSend(
  page: Page,
  urls: StackUrls,
  method: "POST" | "PUT",
  path: string,
  data: object,
): Promise<void> {
  const response = await page.request.fetch(`${urls.api}${path}`, {
    method,
    data,
    headers: originHeader(urls),
  });
  if (!response.ok()) {
    throw new Error(`${path} failed: ${String(response.status())} ${await response.text()}`);
  }
}
