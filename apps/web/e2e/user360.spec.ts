import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { createAdminLogin, signInThroughUi } from "./support/admin-billing";
import { expect, test } from "./support/fixtures";
import { auditActions } from "./support/growth";
import { verifyPhoneViaApi } from "./support/phone";
import { sampleResult, seedAnalysis } from "./support/rx";

// Task 3.15 acceptance: an admin finds a user by phone through the command palette, upgrades them to
// Pro for 3 months, opens one of their prescriptions with a reason, and the audit log shows both.

test("palette by phone → upgrade to Pro for 3 months → open a prescription with a reason → audited", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  // The customer: verified phone, one finished analysis.
  const customer = await signedInAccount(context, urls, redis, newAccount("Samir Customer"));
  await finishOnboarding(page.request, urls, customer.name);
  const phone = await verifyPhoneViaApi(context, urls, redis);
  const me = (await (await page.request.get(`${urls.api}/me`)).json()) as { id: string };
  seedAnalysis({ email: customer.email, fileIds: [], status: "done", result: sampleResult() });

  const adminContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const login = await createAdminLogin(adminContext, urls, redis, { label: "Support Lead", superAdmin: true });
    const admin = await adminContext.newPage();
    await signInThroughUi(admin, login);
    await admin.goto("/admin");
    await expect(admin.getByRole("heading", { level: 1 })).toBeVisible();

    // The palette finds the customer by the last digits of the phone. The shortcut is pressed again
    // until the dialog opens: a key press before hydration has no listener yet.
    const palette = admin.getByRole("dialog", { name: t("admin.palette.label") });
    await expect(async () => {
      await admin.keyboard.press("Control+k");
      await expect(palette).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await palette.getByRole("combobox").fill(phone.slice(-4));
    const result = palette.getByRole("option", { name: new RegExp(customer.name) }).first();
    await expect(result).toBeVisible();
    await result.click();
    await expect(admin).toHaveURL(new RegExp(`/admin/users/${me.id}$`));
    await expect(admin.getByTestId("user-name")).toHaveText(customer.name);

    // Upgrade to Pro for 3 months.
    const chipBefore = (await admin.getByTestId("plan-chip").textContent()) ?? "";
    await admin.locator("button[name=open-plan-change]").click();
    await admin.locator("select[name=plan]").selectOption("pro");
    await admin.locator("select[name=months]").selectOption("3");
    await admin.locator("select[name=kind]").selectOption("gift");
    await admin.locator("textarea[name=reason]").fill("Compensation for a support ticket");
    await expect(admin.getByTestId("plan-preview")).toContainText(t("admin.user360.plan.effect.replace"));
    await admin.locator("button[name=confirm-plan-change]").click();
    const password = admin.locator("dialog[open] input[type=password]");
    // A money-sized change may ask for the password again: answer it if it comes.
    const asked = await password
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (asked) {
      await password.fill(login.account.password);
      await password.press("Enter");
    }
    // The chip now names the new plan and its end date.
    await expect(admin.getByTestId("plan-chip")).not.toHaveText(chipBefore);

    // Open a prescription: the access session asks for a reason first.
    await admin.getByRole("tab", { name: t("admin.user360.tab.prescriptions") }).click();
    await admin.locator("button[name=open-phi-session]").click();
    await admin.locator("select[name=phi-reason]").selectOption("support_request");
    await admin.locator("button[name=start-phi-session]").click();
    await expect(admin.getByTestId("phi-session")).toBeVisible();
    await admin.locator("button[name=open-rx]").first().click();
    await expect(admin.getByTestId("admin-rx-view")).toBeVisible();

    // Both actions are in the audit log.
    await expect
      .poll(() => auditActions(me.id), { timeout: 10_000 })
      .toEqual(expect.arrayContaining(["user.plan_change", "phi.view"]));
  } finally {
    await adminContext.close();
  }
});
