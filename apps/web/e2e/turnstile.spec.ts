import { t } from "@wasfa/shared/i18n";

import { newAccount, registerVerified } from "./support/accounts";
import { skipTurnstile } from "./support/config";
import { expect, test, watchCsp } from "./support/fixtures";
import { waitForMailLink } from "./support/mail";

// Task 1.9 acceptance: the Turnstile widget loads and works under the app's CSP. This runs against a
// second stack built with Cloudflare's public always-pass test keys, so it needs internet access
// (set E2E_SKIP_TURNSTILE=1 to skip it on an offline machine).

test.skip(skipTurnstile(), "E2E_SKIP_TURNSTILE=1");

/** The dummy token Cloudflare documents for its test secret: accepted for any value. */
const API_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** Turnstile draws its frame in a closed shadow root, so the test watches the response field it fills. */
const widgetToken = 'input[name="cf-turnstile-response"]';

test("register: the widget renders, passes, and the CSP raises no violation", async ({
  page,
  redis,
}) => {
  const csp = await watchCsp(page);
  const account = newAccount("Ts");

  await page.goto("/register");
  const form = page.getByRole("form", { name: t("auth.tab.email") });
  await expect(form.locator(widgetToken)).toHaveValue(/.+/, { timeout: 30_000 });

  await form.locator("input[name=name]").fill(account.name);
  await form.locator("input[name=email]").fill(account.email);
  await form.locator("input[name=password]").fill(account.password);
  await form.locator("input[name=terms]").check();
  await form.getByRole("button", { name: t("auth.register.submit") }).click();
  // The API verified the token with Cloudflare, so sign-up went through.
  await expect(page).toHaveURL(/\/verify-email$/);
  await waitForMailLink(redis, account.email, "verify-email");

  expect(await csp.violations()).toEqual([]);
});

test("login: after repeated failures the widget appears and the CSP raises no violation", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const account = newAccount("Ts");
  await registerVerified(urls, redis, account, { "x-turnstile-token": API_TEST_TOKEN });
  // Three failed sign-ins make the API ask for a Turnstile token on the next one.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const failed = await context.request.post(`${urls.api}/auth/sign-in/email`, {
      data: { email: account.email, password: "wrong password here" },
      headers: { Origin: urls.web },
    });
    expect(failed.status()).toBeGreaterThanOrEqual(400);
  }

  const csp = await watchCsp(page);
  await page.goto("/login");
  await expect(page.locator(widgetToken)).toHaveCount(0);
  const form = page.getByRole("form", { name: t("auth.tab.email") });
  await form.locator("input[name=email]").fill(account.email);
  await form.locator("input[name=password]").fill(account.password);
  await form.getByRole("button", { name: t("auth.login.submit") }).click();

  // The first attempt is refused with "turnstile required" and the widget is drawn.
  await expect(form.locator(widgetToken)).toHaveValue(/.+/, { timeout: 30_000 });
  await form.getByRole("button", { name: t("auth.login.submit") }).click();
  await expect(page).toHaveURL(/\/welcome$/);

  expect(await csp.violations()).toEqual([]);
});
