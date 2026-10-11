import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signInContext, signedInAccount } from "./support/accounts";
import { expect, test } from "./support/fixtures";

// Task 1.9 acceptance: the same user signed in twice sees the other session on the security page,
// revokes it, and that other browser is signed out on its next navigation.

test("revoking another session signs that browser out", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  const account = await signedInAccount(context, urls, redis, newAccount("Sess"));
  await finishOnboarding(page.request, urls, account.name);

  const otherContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    await signInContext(otherContext, urls, account);
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/dashboard$/);

    await page.goto("/account/security");
    await expect(page.getByText(t("account.sessions.current"), { exact: true })).toBeVisible();
    const revoke = page.locator("button[name=revoke-session]");
    await expect(revoke).toHaveCount(1);
    await revoke.click();
    await expect(page.getByText(t("account.sessions.revoked"))).toBeVisible();
    await expect(revoke).toHaveCount(0);

    // The revoked browser has a cookie, but the API no longer knows the session.
    await otherPage.goto("/dashboard");
    await expect(otherPage).toHaveURL(/\/login\?next=%2Fdashboard$/);
    expect((await otherPage.request.get(`${urls.api}/me`)).status()).toBe(401);

    // The browser that revoked stays signed in.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally {
    await otherContext.close();
  }
});
