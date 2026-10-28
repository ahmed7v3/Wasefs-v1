import { t } from "@wasfa/shared/i18n";

import {
  adminGet,
  adminSend,
  createAdminLogin,
  seedPaidPayment,
  seedReviewPayment,
  signInThroughUi,
  signedInSuperAdmin,
} from "./support/admin-billing";
import { expectAccessible } from "./support/axe";
import { expect, test } from "./support/fixtures";

/*
 * Task 3.8 acceptance: an admin runs revenue and pricing from /admin/billing/* against the real
 * stack - prices and promotions that show on /pricing, the manual review queue with the keyboard,
 * a partial refund with its consequences shown first, 50 coupons with a CSV, the protected account
 * number change with its countdown, the command palette and the calm 403 - plus axe on the key pages.
 */

const PRICE = "123.45";

test.describe("admin billing console", () => {
  test("a plan price and a promotion created by the admin show on /pricing", async ({
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    await signedInSuperAdmin(page, urls, redis);

    // --- the price: draft in the matrix, then Publish with its diff and a reason
    await page.goto("/admin/billing/plans?plan=plus");
    await page.getByRole("tab", { name: t("admin.pricing.tabs.prices") }).click();
    await page
      .getByLabel(t("admin.pricing.matrix.cell", { months: 1, currency: "EGP" }))
      .fill(PRICE);
    await page.getByRole("button", { name: t("admin.pricing.prices.publish") }).click();
    const publish = page.getByRole("dialog");
    await expect(publish.getByTestId("publish-diff")).toBeVisible();
    await publish.getByLabel(/^السبب/).fill("E2E: new monthly price");
    await publish.getByRole("button", { name: t("admin.pricing.publish.confirm") }).click();
    await expect(page.getByText(t("admin.pricing.publish.done", { name: "بلس" }))).toBeVisible();

    // --- the promotion: four steps, shown on the pricing page
    await page.goto("/admin/billing/promotions");
    await page.getByRole("button", { name: t("admin.pricing.promo.new") }).click();
    await page.getByLabel(t("admin.pricing.promo.name")).fill("E2E launch");
    await page.getByLabel(t("admin.pricing.promo.titleAr")).fill("عرض الإطلاق التجريبي");
    await page.getByLabel(t("admin.pricing.promo.titleEn")).fill("E2E launch offer");
    await page.getByLabel(t("admin.pricing.promo.badgeAr")).fill("خصم الإطلاق");
    await page.getByLabel(t("admin.pricing.promo.value.percent")).fill("10");
    await page.getByRole("button", { name: t("admin.pricing.promo.next") }).click();
    await page.getByRole("button", { name: t("admin.pricing.promo.next") }).click();
    await page.getByLabel(t("admin.pricing.promo.showOnPricing")).check();
    await page.getByRole("button", { name: t("admin.pricing.promo.next") }).click();
    await expect(page.getByTestId("rule-sentence").first()).toBeVisible();
    await page.getByRole("button", { name: t("admin.pricing.promo.publish") }).click();
    await expect(page.getByTestId("promotion-card").first()).toContainText(
      t("admin.revenue.status.discount.active"),
      { timeout: 20_000 },
    );

    // --- both are on the public pricing page
    // The pricing page caches the catalog for about a minute (BILLING-RUNBOOK §4): reload until then.
    await page.goto("/pricing?period=1");
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/123\.45/).first()).toBeVisible({ timeout: 2_000 });
      await expect(page.getByText("عرض الإطلاق التجريبي").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 90_000, intervals: [5_000] });
  });

  test("approves a manual payment from the queue with J, K and A", async ({
    browser,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    await seedReviewPayment(browser, urls, redis);
    await seedReviewPayment(browser, urls, redis);
    await signedInSuperAdmin(page, urls, redis);

    await page.goto("/admin/billing/payments?view=review");
    const rows = page.getByRole("list").locator("button[aria-current]");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("j");
    await page.keyboard.press("k");
    const header = page.getByRole("heading", { level: 2 }).filter({ hasText: /WSO-/ });
    await expect(header).toBeVisible();
    const number = (await header.innerText()).match(/WSO-\d{4}-\d+/)?.[0] ?? "";
    expect(number).not.toBe("");

    await page.keyboard.press("a");
    const dialog = page.getByRole("dialog", { name: t("admin.revenue.review.approveTitle") });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t("admin.revenue.review.approveConfirm") }).click();
    await expect(page.getByText(t("admin.revenue.review.approved"))).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(
        async () =>
          (
            await adminGet<{ items: { status: string }[] }>(
              page,
              urls,
              `/admin/billing/orders?q=${number}`,
            )
          ).items[0]?.status,
        { timeout: 20_000 },
      )
      .toBe("paid");
  });

  test("issues a partial refund and shows its consequences before confirming", async ({
    browser,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    const paid = await seedPaidPayment(browser, urls, redis);
    await signedInSuperAdmin(page, urls, redis);

    await page.goto(`/admin/billing/payments?open=${paid.paymentId}`);
    await page.getByRole("button", { name: t("admin.revenue.payment.refund") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^المبلغ المسترد/).fill("10.00");
    // The consequences come from the API for exactly this amount, before anything can be confirmed.
    await expect(dialog.getByTestId("refund-consequences")).toBeVisible({ timeout: 20_000 });
    await expect(
      dialog.getByRole("button", { name: t("admin.revenue.refund.confirm") }),
    ).toBeDisabled();
    await dialog.getByLabel(/^مرجع التحويل الخارجي/).fill("E2E-REFUND-001");
    await dialog.getByLabel(/^السبب/).fill("E2E: partial goodwill refund");
    await expect(
      dialog.getByRole("button", { name: t("admin.revenue.refund.confirm") }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: t("admin.revenue.refund.confirm") }).click();
    await expect(page.getByText(t("admin.revenue.refund.done"))).toBeVisible({ timeout: 20_000 });

    await page.goto("/admin/billing/refunds");
    await expect(page.getByText(paid.number).first()).toBeVisible();
  });

  test("creates 50 coupons in bulk and downloads a CSV with 50 rows", async ({
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    await signedInSuperAdmin(page, urls, redis);
    await page.goto("/admin/billing/coupons");
    await page.getByRole("button", { name: t("admin.revenue.coupons.newBulk") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("admin.pricing.promo.name")).fill("E2E bulk");
    await dialog.getByLabel(t("admin.pricing.promo.titleAr")).fill("دفعة تجريبية");
    await dialog.getByLabel(t("admin.pricing.promo.titleEn")).fill("E2E batch");
    await dialog.getByLabel(t("admin.revenue.coupons.value.percent")).fill("5");
    await dialog.getByLabel(t("admin.revenue.coupons.count")).fill("50");
    await dialog.getByLabel(t("admin.revenue.coupons.prefix")).fill("E2EB");
    await dialog.getByRole("button", { name: t("admin.revenue.coupons.createBulk") }).click();
    await expect(dialog.getByTestId("bulk-done")).toBeVisible({ timeout: 60_000 });

    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: t("admin.revenue.coupons.downloadCsv") }).click();
    const file = await download;
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const lines = Buffer.concat(chunks)
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    expect(lines.length - 1).toBe(50);
  });

  test("changes the InstaPay number and sees the cooldown with a cancel option", async ({
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    const login = await signedInSuperAdmin(page, urls, redis);
    await page.goto("/admin/billing/methods");
    const card = page.getByTestId("method-card").filter({ hasText: "إنستاباي" });
    await expect(card).toBeVisible();
    await card.getByLabel(t("admin.pricing.account.newNumber")).fill("01099999999");
    await card.getByLabel(t("admin.pricing.account.holder")).first().fill("E2E Holder");
    await card.getByLabel(t("admin.pricing.account.totp")).fill(await login.code());
    await card.getByLabel(/^السبب/).fill("E2E: number rotation");
    await card.getByRole("button", { name: t("admin.pricing.account.submit") }).click();

    const pending = card.getByTestId("account-pending");
    await expect(pending).toBeVisible({ timeout: 20_000 });
    await expect(pending.getByTestId("account-countdown")).toHaveText(/^\d{2}:\d{2}$/);
    await expect(
      pending.getByRole("button", { name: t("admin.pricing.account.cancel") }),
    ).toBeVisible();
  });

  test("the command palette finds an order by a fragment of its number", async ({
    browser,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    const paid = await seedPaidPayment(browser, urls, redis);
    await signedInSuperAdmin(page, urls, redis);
    await page.goto("/admin/billing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: t("admin.palette.label") });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill(paid.number.replace(/^WSO-/, ""));
    const option = palette.getByRole("option").filter({ hasText: paid.number });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/billing\/orders\?open=/);
  });

  test("a role without billing.read sees a calm 403 and no payments nav item", async ({
    browser,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    await signedInSuperAdmin(page, urls, redis);
    await adminSend(page, urls, "POST", "/admin/roles", {
      key: "e2e_users_only",
      nameAr: "مستخدمون فقط",
      nameEn: "Users only",
      permissions: ["users.read"],
    });

    const limitedContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
    try {
      const login = await createAdminLogin(limitedContext, urls, redis, {
        label: "Limited",
        superAdmin: false,
      });
      await adminSend(page, urls, "PUT", `/admin/users/${login.userId}/roles/e2e_users_only`, {
        reason: "E2E: limited admin",
      });
      const limited = await limitedContext.newPage();
      await signInThroughUi(limited, login);
      await limited.goto("/admin/billing/payments");
      await expect(limited.getByText(t("admin.forbidden.title"))).toBeVisible();
      await expect(limited.getByRole("link", { name: t("admin.nav.payments") })).toHaveCount(0);
    } finally {
      await limitedContext.close();
    }
  });

  test("overview, review queue (360 and 1440) and plan editor have no serious axe violations", async ({
    browser,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(240_000);
    await seedReviewPayment(browser, urls, redis);
    await signedInSuperAdmin(page, urls, redis);

    await page.goto("/admin/billing");
    await expectAccessible(page, "admin billing overview");

    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/admin/billing/payments?view=review");
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({
        timeout: 20_000,
      });
      await expectAccessible(page, `payments review at ${String(width)}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/billing/plans?plan=plus");
    await expect(page.getByRole("tab", { name: t("admin.pricing.tabs.prices") })).toBeVisible();
    await expectAccessible(page, "plans editor");
  });
});
