import { t } from "@wasfa/shared/i18n";
import { adminWithdrawalListSchema } from "@wasfa/shared/schemas/withdrawals";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { adminSession } from "./support/billing";
import { expect, test } from "./support/fixtures";
import { enablePayoutMethod, fundCashPoints, mergeSetting } from "./support/growth";
import { verifyPhoneViaApi } from "./support/phone";

// Task 3.12 acceptance: a person with cash points saves a destination, requests a withdrawal and
// confirms it; an admin approves and marks it paid with a transfer reference; the person sees
// "paid" with that reference. The admin steps go through the real admin endpoints.

test("request → admin approves → marks paid → the person sees paid with the reference", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  await mergeSetting(redis, "rewards", {
    enabled: true,
    cashOutEnabled: true,
    destinationCooldownHours: 0,
    minAccountAgeDays: 0,
  });

  const person = await signedInAccount(context, urls, redis, newAccount("Withdrawer"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  fundCashPoints(person.email, 1_500);
  enablePayoutMethod("vodafone_cash");

  await page.goto("/rewards/withdraw");
  await expect(page.getByRole("heading", { level: 1, name: t("withdrawPage.title") })).toBeVisible();
  await expect(page.getByTestId("withdraw-cash")).toContainText(/1\D?500/);

  // A Vodafone Cash wallet as the destination (no cooldown in this test's settings).
  await page.locator("button[name=add-destination]").click();
  await page.locator("select[name=method]").selectOption("vodafone_cash");
  await page.locator("input[name^=field-]").first().fill("01012345678");
  await page.locator("button[name=save-destination]").click();
  await expect(page.getByTestId("destinations")).toContainText("678");

  // Request 1,000 points and confirm the amount on the confirmation.
  await page.locator("input[name=points]").fill("1000");
  await page.locator("button[name=continue-withdraw]").click();
  await expect(page.getByTestId("withdraw-confirm")).toContainText(/1\D?000/);
  await page.locator("button[name=confirm-withdraw]").click();
  await expect(page.getByTestId("withdrawal-status").first()).toHaveText(
    t("withdrawPage.status.requested"),
  );

  // The admin approves and records the payment.
  const admin = await adminSession(browser, urls, redis);
  try {
    const list = adminWithdrawalListSchema.parse(
      await (await admin.request.get(`${urls.api}/admin/growth/withdrawals?status=requested`)).json(),
    );
    const request = list.items[0];
    expect(request).toBeDefined();
    const headers = { Origin: urls.web };
    const id = request?.id ?? "";
    expect((await admin.request.post(`${urls.api}/admin/growth/withdrawals/${id}/approve`, { data: {}, headers })).ok()).toBe(true);
    const paid = await admin.request.post(`${urls.api}/admin/growth/withdrawals/${id}/mark-paid`, {
      data: { transferReference: "VF-E2E-778899" },
      headers,
    });
    expect(paid.ok(), await paid.text()).toBe(true);
  } finally {
    await admin.close();
  }

  await page.reload();
  await expect(page.getByTestId("withdrawal-status").first()).toHaveText(t("withdrawPage.status.paid"));
  await expect(page.getByTestId("withdrawal-reference").first()).toContainText("VF-E2E-778899");
});
