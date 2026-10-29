import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { waitForMailLink } from "./support/mail";
import { finishWelcome } from "./support/onboarding-ui";

// Task 1.9 acceptance: register (email) -> verify -> the welcome card -> dashboard; the
// Facebook button is visible and disabled; sign-out; private pages send signed-out visitors to login.

test("registers with email, verifies from the mail, finishes onboarding and reaches the dashboard", async ({
  page,
  redis,
}) => {
  const account = newAccount("Reg");

  await page.goto("/register");
  // Both tabs are in the DOM; scope to the email form.
  const form = page.getByRole("form", { name: t("auth.tab.email") });
  await form.locator("input[name=name]").fill(account.name);
  await form.locator("input[name=email]").fill(account.email);
  await form.locator("input[name=password]").fill(account.password);
  await form.locator("input[name=terms]").check();
  await form.getByRole("button", { name: t("auth.register.submit") }).click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByText(account.email)).toBeVisible();

  // The worker's capture transport keeps the mail; following its link is what a person's click does.
  await page.goto(await waitForMailLink(redis, account.email, "verify-email"));
  await expect(page).toHaveURL(/\/login\?verified=1$/);
  await expect(page.getByText(t("auth.login.verifiedBanner"))).toBeVisible();

  const login = page.getByRole("form", { name: t("auth.tab.email") });
  await login.locator("input[name=email]").fill(account.email);
  await login.locator("input[name=password]").fill(account.password);
  await login.getByRole("button", { name: t("auth.login.submit") }).click();

  // Not onboarded yet: a new user lands on the one-screen welcome card, name prefilled, "for me".
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.locator("input[name=name]")).toHaveValue(account.name);
  await finishWelcome(page);

  await expect(page).toHaveURL(/\/dashboard$/);
  const firstName = account.name.split(" ")[0] ?? "";
  await expect(
    page.getByRole("heading", { level: 1, name: t("dashboard.greeting", { name: firstName }) }),
  ).toBeVisible();
});

test("shows Facebook as visible, disabled and marked as coming soon", async ({ page }) => {
  await page.goto("/login");
  const facebook = page.getByRole("button", { name: new RegExp(t("auth.social.facebook")) });
  await expect(facebook).toBeVisible();
  await expect(facebook).toBeDisabled();
  await expect(facebook.getByText(t("ui.comingSoon"))).toBeVisible();
});

test("signs out, and a private page then redirects to login with ?next=", async ({
  page,
  context,
  urls,
  redis,
}) => {
  const account = await signedInAccount(context, urls, redis);
  await finishOnboarding(page.request, urls, account.name);

  await page.goto("/dashboard");
  const firstName = account.name.split(" ")[0] ?? "";
  await expect(
    page.getByRole("heading", { level: 1, name: t("dashboard.greeting", { name: firstName }) }),
  ).toBeVisible();

  await page.getByRole("button", { name: new RegExp(t("shell.accountMenu")) }).click();
  await page.getByRole("button", { name: t("shell.signOut") }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});
