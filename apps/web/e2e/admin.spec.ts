import { t } from "@wasfa/shared/i18n";

import {
  enableTwoFactor,
  finishOnboarding,
  grantSuperAdmin,
  newAccount,
  registerVerified,
  signInContext,
  signOutContext,
  signedInAccount,
} from "./support/accounts";
import { recordServerError } from "./support/errors";
import { expect, test } from "./support/fixtures";
import { totp } from "./support/totp";

// Task 1.10 acceptance: a super admin (password + TOTP) suspends a signed-in user from the admin UI
// and that user's open session is refused on the next request; the issues page groups a thrown
// error, lets the admin resolve it, and the audit log shows the write.

test("admin suspends a signed-in user, resolves a grouped issue and finds the audit trail", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  // --- the admin: verified, promoted with the owner's CLI, two-factor on, signs in through the UI
  const admin = newAccount("Admin");
  await registerVerified(urls, redis, admin);
  grantSuperAdmin(admin.email);
  await signInContext(context, urls, admin);
  await finishOnboarding(page.request, urls, admin.name);
  const secret = await enableTwoFactor(context, urls, admin);
  await signOutContext(context, urls);

  await page.goto("/login");
  const login = page.getByRole("form", { name: t("auth.tab.email") });
  await login.locator("input[name=email]").fill(admin.email);
  await login.locator("input[name=password]").fill(admin.password);
  await login.getByRole("button", { name: t("auth.login.submit") }).click();
  await expect(page).toHaveURL(/\/login\/two-factor/);
  // The code of the next 30 s window: the one used to switch 2FA on cannot be replayed.
  await page.locator("input[name=code]").fill(totp(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: t("auth.twoFactor.submit") }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // --- the victim: signed in in another browser, with a page open
  const victim = newAccount("Victim");
  const victimContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    await signedInAccount(victimContext, urls, redis, victim);
    const victimPage = await victimContext.newPage();
    await finishOnboarding(victimPage.request, urls, victim.name);
    await victimPage.goto("/dashboard");
    expect((await victimPage.request.get(`${urls.api}/me`)).status()).toBe(200);

    // --- suspend through the UI
    await page.goto("/admin/users");
    await page.getByRole("searchbox", { name: /بحث/ }).fill(victim.email);
    await page.getByRole("button", { name: victim.name, exact: true }).click();
    const drawer = page.locator("dialog[open]").first();
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: t("admin.users.suspend") }).click();

    const confirm = page.getByRole("dialog", {
      name: t("admin.users.suspendTitle", { name: victim.name }),
    });
    await confirm.getByLabel(/^السبب/).fill("E2E: suspended by the suite");
    await confirm.getByRole("button", { name: t("admin.users.suspend") }).click();
    await expect(page.getByText(t("admin.users.suspended", { name: victim.name }))).toBeVisible();

    // The victim's already-open session is refused on the next request.
    await expect
      .poll(async () => (await victimPage.request.get(`${urls.api}/me`)).status())
      .toBe(401);
    await victimPage.goto("/dashboard");
    await expect(victimPage).toHaveURL(/\/login/);
  } finally {
    await victimContext.close();
  }

  // --- issues: a recorded error is grouped; the admin marks it resolved
  const { fingerprint } = recordServerError();
  await page.goto("/admin/issues");
  await page.getByRole("button", { name: "INTERNAL", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/issues/${fingerprint}$`));
  await page.getByLabel(t("admin.issue.statusLabel")).selectOption("resolved");
  await page.getByRole("button", { name: t("admin.issue.saveStatus") }).click();
  await expect(
    page.getByText(t("admin.issue.statusSaved", { status: t("admin.issue.status.resolved") })),
  ).toBeVisible();

  // --- audit: the suspension is on record
  await page.goto("/admin/audit");
  await expect(page.getByText("user.suspend", { exact: false }).first()).toBeVisible();
});
