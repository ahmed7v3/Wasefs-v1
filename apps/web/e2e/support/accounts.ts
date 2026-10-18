import { spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";

import { waitForMailLink } from "./mail";
import { runtime, type StackUrls } from "./runtime";
import { totp } from "./totp";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import type { Redis } from "ioredis";

export const PASSWORD = "correct horse battery";

export interface Account {
  name: string;
  email: string;
  password: string;
}

export function newAccount(label = "Tester"): Account {
  const id = randomBytes(4).toString("hex");
  return {
    name: `${label} ${id}`,
    // The label may hold spaces ("Pharmacy Owner"); the address keeps a slug of it.
    email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user"}-${id}@example.com`,
    password: PASSWORD,
  };
}

/** A fresh, valid Egyptian mobile number in E.164 (what the API stores) and as typed in the form. */
export function newPhone(): { e164: string; national: string } {
  const digits = String(randomInt(10_000_000, 99_999_999));
  return { e164: `+2010${digits}`, national: `010${digits}` };
}

/** State-changing API calls with a session cookie must carry the web origin (the API's origin guard). */
const originHeader = (urls: StackUrls) => ({ Origin: urls.web });

/** Registers through the API, follows the mailed link and returns once the address is verified. */
export async function registerVerified(
  urls: StackUrls,
  redis: Redis,
  account: Account,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const signUp = await fetch(`${urls.api}/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...originHeader(urls), ...extraHeaders },
    body: JSON.stringify({ ...account, callbackURL: "/login?verified=1" }),
  });
  if (!signUp.ok)
    throw new Error(`sign-up failed: ${String(signUp.status)} ${await signUp.text()}`);
  const link = await waitForMailLink(redis, account.email, "verify-email");
  const verified = await fetch(link, { redirect: "manual" });
  const location = verified.headers.get("location") ?? "";
  // Better Auth answers a bad or expired token with a redirect too, carrying `error=` in the URL.
  if (verified.status >= 400 || /[?&]error=/.test(location))
    throw new Error(`email verification failed: ${String(verified.status)} ${location}`);
}

/** Password sign-in with the browser context's own cookie jar, so its pages are signed in afterwards. */
export async function signInContext(
  context: BrowserContext,
  urls: StackUrls,
  account: Account,
): Promise<void> {
  const response = await context.request.post(`${urls.api}/auth/sign-in/email`, {
    data: { email: account.email, password: account.password },
    headers: originHeader(urls),
  });
  if (!response.ok()) throw new Error(`sign-in failed: ${String(response.status())}`);
}

/** Registers a verified user and signs the context in. */
export async function signedInAccount(
  context: BrowserContext,
  urls: StackUrls,
  redis: Redis,
  account: Account = newAccount(),
): Promise<Account> {
  await registerVerified(urls, redis, account);
  await signInContext(context, urls, account);
  return account;
}

async function put(request: APIRequestContext, urls: StackUrls, step: string, data: object) {
  const response = await request.put(`${urls.api}/onboarding/${step}`, {
    data,
    headers: originHeader(urls),
  });
  if (!response.ok()) {
    throw new Error(`onboarding ${step} failed: ${String(response.status())} ${await response.text()}`);
  }
}

/** Answers the onboarding steps through the API (the UI path has its own specs). Phone must be skippable. */
export async function finishOnboarding(
  request: APIRequestContext,
  urls: StackUrls,
  name: string,
  kind: "individual" | "organization" = "individual",
): Promise<void> {
  await put(request, urls, "account_type", { accountType: kind });
  await put(request, urls, "name", { name });
  if (kind === "organization") {
    await put(request, urls, "organization", {
      name: "E2E Pharmacy",
      type: "pharmacy",
      country: "EG",
      city: "Cairo",
    });
  }
  await put(request, urls, "profession_intent", {
    profession: "pharmacist",
    usageIntent: ["study"],
    country: "EG",
  });
  await put(request, urls, "plan_picker", { plan: "free" });
  await put(request, urls, "social_follow", { followed: false });
}

/** Makes the account a super admin with the same CLI the owner runs in production. */
export function grantSuperAdmin(email: string): void {
  const apiDir = fileURLToPath(new URL("../../../api/", import.meta.url));
  const result = spawnSync(process.execPath, ["dist/cli/admin-grant.js", email], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: runtime().ownerDatabaseUrl },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`admin-grant failed: ${result.stdout}${result.stderr}`);
  }
}

/** Switches TOTP on for the signed-in context and returns the secret (an authenticator app's seed). */
export async function enableTwoFactor(
  context: BrowserContext,
  urls: StackUrls,
  account: Account,
): Promise<string> {
  const enable = await context.request.post(`${urls.api}/auth/two-factor/enable`, {
    data: { password: account.password },
    headers: originHeader(urls),
  });
  if (!enable.ok()) throw new Error(`2FA enable failed: ${String(enable.status())}`);
  const { totpURI } = (await enable.json()) as { totpURI: string };
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const confirm = await context.request.post(`${urls.api}/auth/two-factor/verify-totp`, {
    data: { code: totp(secret) },
    headers: originHeader(urls),
  });
  if (!confirm.ok()) throw new Error(`2FA confirm failed: ${String(confirm.status())}`);
  return secret;
}

/** Ends the session of the context (and its cookies). */
export async function signOutContext(context: BrowserContext, urls: StackUrls): Promise<void> {
  await context.request.post(`${urls.api}/auth/sign-out`, {
    data: {},
    headers: originHeader(urls),
  });
}

/** The page's current user according to the API, as the browser sees it. */
export async function meStatus(page: Page, urls: StackUrls): Promise<number> {
  return (await page.request.get(`${urls.api}/me`)).status();
}
