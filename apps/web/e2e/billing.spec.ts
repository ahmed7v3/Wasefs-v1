import { randomUUID } from "node:crypto";

import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import {
  adminSession,
  amountOf,
  createOrderViaApi,
  expireOrder,
  insertCoupon,
  orderStatus,
  payFakeOrder,
  plain,
  proofPicture,
} from "./support/billing";
import { expect, test } from "./support/fixtures";

import type { BrowserContext, Page } from "@playwright/test";

/*
 * Task 3.7 acceptance: pricing, checkout and the billing account against the real stack with the
 * scripted fake gateway (a signed webhook plays the provider) and the real admin review endpoints.
 * The paid plans are public and a `fake_card` method (2.75% + 3.00) exists from the stack setup;
 * InstaPay and Vodafone Cash come from the seed.
 */

const PLUS = "بلس";
const PAY = /^ادفع/;
const ORDER_URL = /\/checkout\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A verified, onboarded customer signed in on `context`. */
async function customer(
  context: BrowserContext,
  page: Page,
  urls: { web: string; api: string },
  redis: Parameters<typeof signedInAccount>[2],
  label = "Buyer",
) {
  const account = await signedInAccount(context, urls, redis, newAccount(label));
  await finishOnboarding(page.request, urls, account.name);
  return account;
}

/** Buys one month of Plus with the fake card: order through the API, then the provider's webhook. */
async function buyPlus(
  context: BrowserContext,
  urls: { web: string; api: string },
): Promise<string> {
  const order = await createOrderViaApi(context, urls, {
    planKey: "plus",
    months: 1,
    methodKey: "fake_card",
  });
  await payFakeOrder(context, urls, order.orderId);
  await expect
    .poll(async () => (await context.request.get(`${urls.api}/me/subscription`)).json(), {
      timeout: 20_000,
    })
    .toMatchObject({ subscription: { plan: { key: "plus" } } });
  return order.orderId;
}

test.describe("pricing", () => {
  test("shows the live plans with real prices to a signed-out visitor", async ({ page }) => {
    await page.goto("/pricing");
    await expect(
      page.getByRole("heading", { level: 1, name: t("billing.pricing.title") }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: t("billing.plan.choose", { name: PLUS }) }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: t("billing.plan.free.cta") })).toBeVisible();
    // Opens on the year (the best monthly rate); the switcher changes the period of every card.
    const choose = page.getByRole("link", { name: t("billing.plan.choose", { name: PLUS }) });
    await expect(choose).toHaveAttribute("href", /months=12/);
    await page.getByRole("radio", { name: new RegExp(`^${t("billing.pricing.monthly")}`) }).check();
    await expect(choose).toHaveAttribute("href", /months=1(&|$)/);
    await page.getByRole("radio", { name: new RegExp(`^${t("billing.pricing.annual")}`) }).check();
    await expect(choose).toHaveAttribute("href", /months=12/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(
      ld.some((json) => json.includes('"@type":"Product"') && json.includes('"@type":"Offer"')),
    ).toBe(true);
  });
});

test.describe("checkout", () => {
  test("free user: pricing, checkout, pay with the fake gateway, return page paid, plan active", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);

    await page.goto("/billing");
    await expect(page.getByTestId("current-plan")).not.toHaveText(PLUS);

    await page.goto("/pricing?period=1");
    await page.getByRole("link", { name: t("billing.plan.choose", { name: PLUS }) }).click();
    await expect(page).toHaveURL(/\/checkout\?plan=plus&months=1/);
    await page.getByRole("button", { name: PAY }).click();

    // The fake provider's page is the return URL itself: it forwards to the order page.
    await page.waitForURL(ORDER_URL);
    await expect(page.getByTestId("order-state-title")).toHaveText(
      t("billing.order.pending.title"),
    );

    await payFakeOrder(page, urls, page.url().split("/").at(-1) ?? "");
    await expect(page.getByTestId("order-state-title")).toHaveText(t("billing.order.paid.title"), {
      timeout: 20_000,
    });

    await expect(async () => {
      await page.goto("/billing");
      await expect(page.getByTestId("current-plan")).toHaveText(PLUS, { timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText(t("billing.account.status.active"))).toBeVisible();
  });

  test("a good coupon lowers the total with a discount line, a bad one gets the generic message", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    // 25%: more than any promotion an earlier spec leaves running (the better discount wins).
    insertCoupon("E2E25", 2_500);
    await page.goto("/checkout?plan=plus&months=1");

    const total = page.getByTestId("checkout-total");
    const before = amountOf(await total.textContent());
    const coupon = page.getByLabel(t("billing.coupon.label"));
    const apply = page.getByRole("button", { name: t("billing.coupon.apply") });

    await coupon.fill("NOPE1234");
    await apply.click();
    await expect(page.getByText(t("billing.coupon.invalid"))).toBeVisible();
    expect(amountOf(await total.textContent())).toBe(before);

    await coupon.fill("e2e25");
    await apply.click();
    await expect(page.getByText(t("billing.coupon.applied", { code: "E2E25" }))).toBeVisible();
    await expect(page.getByText(t("billing.line.coupon"), { exact: true })).toBeVisible();
    expect(amountOf(await total.textContent())).toBeLessThan(before);
  });

  test("changing the method moves the total and the Pay button text at once", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    await page.goto("/checkout?plan=plus&months=1");

    const total = page.getByTestId("checkout-total");
    const pay = page.getByRole("button", { name: PAY });
    const card = amountOf(await total.textContent());
    await expect(page.getByRole("radio", { name: /بطاقة تجريبية/ })).toBeChecked();
    await expect(page.getByText(t("billing.method.noFee")).first()).toBeVisible();

    await page.getByRole("radio", { name: /إنستاباي/ }).check();
    await expect(pay).toBeEnabled();
    const transfer = amountOf(await total.textContent());
    // The transfer has no fee: it is the cheaper total, and the button repeats it.
    expect(transfer).toBeLessThan(card);
    expect(amountOf(await pay.textContent())).toBe(transfer);

    await page.getByRole("radio", { name: /بطاقة تجريبية/ }).check();
    await expect(pay).toBeEnabled();
    expect(amountOf(await total.textContent())).toBe(card);
    expect(amountOf(await pay.textContent())).toBe(card);
  });

  test("the total and the tax-and-fees line are in the first HTML and equal the Pay button, before any click", async ({
    browser,
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);

    // (1) The very first response, no script running: read the HTML itself.
    const html = await (await page.request.get(`${urls.web}/checkout?plan=plus&months=1`)).text();
    expect(html).toContain(t("billing.summary.taxAndFees"));
    const shownTotal = /data-testid="checkout-total"[^>]*>\s*<bdi>([^<]+)<\/bdi>/.exec(html)?.[1];
    const buttonText = /<button[^>]*>\s*(ادفع[^<]*)</.exec(html)?.[1];
    expect(shownTotal, "the total is in the HTML").toBeTruthy();
    expect(plain(buttonText)).toBe(`ادفع ${plain(shownTotal)}`);

    // (2) The same page with JavaScript off: still visible and still equal.
    const bare = await browser.newContext({
      baseURL: urls.web,
      locale: "ar",
      javaScriptEnabled: false,
      storageState: await context.storageState(),
    });
    try {
      const barePage = await bare.newPage();
      await barePage.goto("/checkout?plan=plus&months=1");
      await expect(
        barePage.locator("summary", { hasText: t("billing.summary.taxAndFees") }),
      ).toBeVisible();
      await expect(barePage.getByTestId("checkout-total")).toBeVisible();
      expect(plain(await barePage.getByRole("button", { name: PAY }).textContent())).toBe(
        `ادفع ${plain(await barePage.getByTestId("checkout-total").textContent())}`,
      );
    } finally {
      await bare.close();
    }

    // (3) And in the live page, before the Pay click.
    await page.goto("/checkout?plan=plus&months=1");
    await expect(
      page.locator("summary", { hasText: t("billing.summary.taxAndFees") }),
    ).toBeVisible();
    const total = page.getByTestId("checkout-total");
    await expect(total).toBeVisible();
    expect(plain(await page.getByRole("button", { name: PAY }).textContent())).toBe(
      `ادفع ${plain(await total.textContent())}`,
    );
    // The itemisation opens on demand and adds up to the line's amount.
    await page.locator("summary", { hasText: t("billing.summary.taxAndFees") }).click();
    await expect(page.getByText(t("billing.fee.method"), { exact: true })).toBeVisible();
  });

  test("manual transfer: instructions, proof, rejection with its reason, resubmission, approval", async ({
    browser,
    context,
    page,
    urls,
    redis,
  }) => {
    test.setTimeout(180_000);
    await customer(context, page, urls, redis);
    const admin = await adminSession(browser, urls, redis);
    try {
      await page.goto("/checkout?plan=plus&months=1");
      await page.getByRole("radio", { name: /إنستاباي/ }).check();
      const pay = page.getByRole("button", { name: PAY });
      await expect(pay).toBeEnabled();
      await pay.click();
      await page.waitForURL(ORDER_URL);
      const orderId = page.url().split("/").at(-1) ?? "";

      // Instructions: amount, account and reference with copy buttons, expiry, review time.
      await expect(page.getByTestId("manual-amount")).toBeVisible();
      await expect(page.getByText("01014677026").first()).toBeVisible();
      await expect(page.getByRole("button", { name: t("billing.copy.action") })).toHaveCount(2);
      await expect(page.getByText(/ينتهي هذا الطلب في/)).toBeVisible();

      const send = async (txn: string) => {
        await page.getByTestId("capture-picker").setInputFiles(await proofPicture(page));
        await expect(page.locator('li[data-local-id][data-status="uploaded"]')).toBeVisible({
          timeout: 30_000,
        });
        await page.getByLabel(t("billing.proof.txnId")).fill(txn);
        await page.getByLabel(t("billing.proof.senderPhone")).fill("01012345678");
        await page.getByRole("button", { name: t("billing.proof.submit") }).click();
        await expect(page.getByText(t("billing.manual.submittedTitle"))).toBeVisible({
          timeout: 20_000,
        });
        await expect(page.getByText(/قيد المراجعة · نردّ عادةً خلال \d+ دقيقة/)).toBeVisible();
      };

      await send("E2E-TXN-0001");
      const paymentId = (await orderStatus(page, urls, orderId)).payments[0]?.id ?? "";

      await admin.review(paymentId, "reject");
      await expect(page.getByTestId("reject-reason")).toHaveText(
        t("billing.reject.unreadable_proof"),
        { timeout: 20_000 },
      );
      await expect(page.getByText(t("billing.manual.rejectedTitle"))).toBeVisible();

      await send("E2E-TXN-0002");
      await admin.review(paymentId, "approve");
      await expect(page.getByTestId("order-state-title")).toHaveText(
        t("billing.order.paid.title"),
        { timeout: 20_000 },
      );
      await expect(page.getByText(t("billing.order.paid.manualBody"))).toBeVisible();
    } finally {
      await admin.close();
    }
  });

  test("upgrade: the quote shows the remaining-period credit and says what it is", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    await buyPlus(context, urls);

    await page.goto("/checkout?plan=pro&months=1");
    await expect(page.getByText(t("billing.checkout.upgradeLead"))).toBeVisible();
    await expect(page.getByText(t("billing.line.proration"), { exact: true })).toBeVisible();
    await expect(page.getByText(t("billing.proration.explain"))).toBeVisible();

    // The account offers the same upgrade, with the same plain-words explanation.
    await page.goto("/billing");
    await expect(
      page.getByRole("link", { name: t("billing.account.upgradeTo", { name: "الاحترافية" }) }),
    ).toBeVisible();
    await expect(page.getByText(t("billing.account.upgradeExplain"))).toBeVisible();
  });

  test("renewal from the reminder link opens the renewal quote; a stranger's id does not", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    await buyPlus(context, urls);

    const mine = (await (await context.request.get(`${urls.api}/me/subscription`)).json()) as {
      subscription: { id: string };
    };
    await page.goto(`/billing/renew?sub=${mine.subscription.id}`);
    await expect(page).toHaveURL(/\/checkout\?renew=1/);
    await expect(page.getByText(new RegExp(`${PLUS} · `))).toBeVisible();
    await expect(page.getByLabel(t("billing.coupon.label"))).toHaveCount(0);

    await page.goto(`/billing/renew?sub=${randomUUID()}`);
    await expect(page.getByText(t("billing.renew.notFound"))).toBeVisible();
  });

  test("an expired order says so and offers to start again", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    const order = await createOrderViaApi(context, urls, {
      planKey: "plus",
      months: 1,
      methodKey: "fake_card",
    });
    expireOrder(order.orderId);

    await page.goto(`/checkout/${order.orderId}`);
    await expect(page.getByTestId("order-state-title")).toHaveText(
      t("billing.order.expired.title"),
    );
    await page.getByRole("link", { name: t("billing.order.startAgain") }).click();
    await expect(page).toHaveURL(/\/pricing/);
  });
});

test.describe("billing account", () => {
  test("lists orders with a printable receipt, cancels and resumes the renewal", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    await customer(context, page, urls, redis);
    const orderId = await buyPlus(context, urls);

    await page.goto("/billing");
    await expect(page.getByTestId("current-plan")).toHaveText(PLUS);
    const receipt = page.getByRole("link", { name: new RegExp(t("billing.orders.receipt")) });
    await expect(receipt).toBeVisible();
    await receipt.click();
    await expect(page).toHaveURL(new RegExp(`/billing/orders/${orderId}/receipt`));
    await expect(
      page.getByRole("heading", { level: 1, name: t("billing.receipt.title") }),
    ).toBeVisible();
    await expect(page.getByText(t("billing.receipt.total"))).toBeVisible();

    await page.goto("/billing");
    await page.getByRole("button", { name: t("billing.account.cancel") }).click();
    await page.getByRole("button", { name: t("billing.account.cancelConfirm") }).click();
    await expect(page.getByText(/لن تتجدد · تنتهي/)).toBeVisible();
    await page.getByRole("button", { name: t("billing.account.resume") }).click();
    await expect(page.getByText(/لن تتجدد · تنتهي/)).toHaveCount(0);
  });
});
