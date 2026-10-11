import { newAccount, finishOnboarding, signedInAccount } from "./support/accounts";
import { expect, test, watchCsp } from "./support/fixtures";

// Task 1.9 acceptance: no Content-Security-Policy violations. This runs against the stack without
// Turnstile; the page with the Turnstile widget loaded is in turnstile.spec.ts.

test("the auth pages and the dashboard raise no CSP violations", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const csp = await watchCsp(page);

  for (const path of ["/login", "/register", "/forgot-password"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
  }

  const account = await signedInAccount(context, urls, redis, newAccount("Csp"));
  await finishOnboarding(page.request, urls, account.name);
  for (const path of ["/dashboard", "/account", "/account/security"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
  }

  expect(await csp.violations()).toEqual([]);
});
