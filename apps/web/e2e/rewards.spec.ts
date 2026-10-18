import { t } from "@wasfa/shared/i18n";
import {
  convertPreviewSchema,
  meReferralSchema,
  meRewardsSchema,
} from "@wasfa/shared/schemas/rewards";

import { finishOnboarding, newAccount, signInContext, signedInAccount } from "./support/accounts";
import { createOrderViaApi, payFakeOrder } from "./support/billing";
import { expect, test } from "./support/fixtures";
import { endRewardHolds, mergeSetting, runWorkerJob } from "./support/growth";
import { waitForMailLink } from "./support/mail";
import { verifyPhoneViaApi } from "./support/phone";

import type { APIRequestContext } from "@playwright/test";

// Task 3.11 acceptance: the inviter shares the link; the friend opens /r/<code>, registers with the
// code prefilled, and the inviter /rewards counts the invite. Points need the friend verified phone
// and first analysis (`rewards.requireFirstUsage`), which the reward specs of the API cover; the
// page job here is the code, the link, the attribution count and the honest disabled withdraw button.

test("an invite link reaches the register form prefilled, and the inviter sees the invite counted", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  // --- The inviter has a code and a link on the page.
  const inviter = await signedInAccount(context, urls, redis, newAccount("Inviter"));
  await finishOnboarding(page.request, urls, inviter.name);
  const mine = meReferralSchema.parse(
    await (await page.request.get(`${urls.api}/me/referral`)).json(),
  );

  await page.goto("/rewards");
  await expect(page.getByRole("heading", { level: 1, name: t("rewardsPage.title") })).toBeVisible();
  await expect(page.getByText(mine.code, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(mine.link, { exact: true })).toBeVisible();
  await expect(page.locator("button[name=withdraw]")).toBeDisabled();
  await expect(page.getByTestId("count-invited")).toHaveText("0");

  // --- The friend opens the link, lands on the register form with the code, and registers.
  const friendContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const friend = await friendContext.newPage();
    await friend.goto(`/r/${mine.code.toLowerCase()}`);
    await expect(friend).toHaveURL(new RegExp(`/register\\?ref=${mine.code}$`));
    const cookies = await friendContext.cookies();
    expect(cookies.find((cookie) => cookie.name === "wasfa_ref")?.value).toBe(mine.code);

    const account = newAccount("Friend");
    const form = friend.getByRole("form", { name: t("auth.tab.email") });
    await expect(form.locator("input[name=referralCode]")).toHaveValue(mine.code);
    await form.locator("input[name=name]").fill(account.name);
    await form.locator("input[name=email]").fill(account.email);
    await form.locator("input[name=password]").fill(account.password);
    await form.locator("input[name=terms]").check();
    await form.getByRole("button", { name: t("auth.register.submit") }).click();
    await expect(friend).toHaveURL(/\/verify-email$/);

    await friend.goto(await waitForMailLink(redis, account.email, "verify-email"));
    await expect(friend).toHaveURL(/\/login\?verified=1$/);
  } finally {
    await friendContext.close();
  }

  // --- The inviter page counts the invite.
  await page.goto("/rewards");
  await expect(page.getByTestId("count-invited")).toHaveText("1");
});

test("an invite link with a malformed code sets no cookie and opens a plain register page", async ({
  context,
  page,
}) => {
  await page.goto("/r/x");
  await expect(page).toHaveURL(/\/register$/);
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === "wasfa_ref")).toBe(false);
});

test("invite → both rewarded on verification → the friend pays → pending → the hold ends → the inviter converts to credits", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  test.setTimeout(240_000);
  // No first analysis needed here (the API and db suites cover requireFirstUsage). Both browsers
  // share 127.0.0.1 and one user agent, which the same-device rule rightly holds: switched off for
  // this journey (the fraud rules have their own suites) and restored at the end.
  const fraudDefaults = {
    holdSamePhone: true,
    holdSamePayer: true,
    holdSameDevice: true,
    velocityPerHour: 10,
  };
  await mergeSetting(redis, "rewards", {
    enabled: true,
    requireFirstUsage: false,
    fraud: { ...fraudDefaults, holdSameDevice: false },
  });
  try {
    await inviteToCredits();
  } finally {
    await mergeSetting(redis, "rewards", { fraud: fraudDefaults });
  }

  async function inviteToCredits(): Promise<void> {
    const balanceOf = async (request: APIRequestContext) =>
      (
        (await (await request.get(`${urls.api}/me/credits`)).json()) as {
          wallet: { balance: number };
        }
      ).wallet.balance;
    const rewardsOf = async () =>
      meRewardsSchema.parse(await (await page.request.get(`${urls.api}/me/rewards`)).json())
        .balances;

    const inviter = await signedInAccount(context, urls, redis, newAccount("Inviter"));
    await finishOnboarding(page.request, urls, inviter.name);
    await verifyPhoneViaApi(context, urls, redis);
    const mine = meReferralSchema.parse(
      await (await page.request.get(`${urls.api}/me/referral`)).json(),
    );

    // --- The friend registers through the link, verifies e-mail and phone: 20 credits for the friend,
    // 50 pending points (3-day hold) for the inviter (the standard program, REFERRALS-REWARDS §3.3).
    const friendContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
    try {
      const friend = await friendContext.newPage();
      await friend.goto(`/r/${mine.code}`);
      const account = newAccount("Friend");
      const form = friend.getByRole("form", { name: t("auth.tab.email") });
      await expect(form.locator("input[name=referralCode]")).toHaveValue(mine.code);
      await form.locator("input[name=name]").fill(account.name);
      await form.locator("input[name=email]").fill(account.email);
      await form.locator("input[name=password]").fill(account.password);
      await form.locator("input[name=terms]").check();
      await form.getByRole("button", { name: t("auth.register.submit") }).click();
      await expect(friend).toHaveURL(/\/verify-email$/);
      await friend.goto(await waitForMailLink(redis, account.email, "verify-email"));
      await signInContext(friendContext, urls, account);
      await finishOnboarding(friend.request, urls, account.name);
      const before = await balanceOf(friend.request);
      await verifyPhoneViaApi(friendContext, urls, redis);
      await expect.poll(() => balanceOf(friend.request), { timeout: 30_000 }).toBe(before + 20);
      await expect.poll(async () => (await rewardsOf()).pending, { timeout: 30_000 }).toBe(50);

      // --- The friend subscribes: 20% of the net joins the inviter's pending points (14-day hold).
      const order = await createOrderViaApi(friendContext, urls, {
        planKey: "plus",
        months: 1,
        methodKey: "fake_card",
      });
      await payFakeOrder(friendContext, urls, order.orderId);
    } finally {
      await friendContext.close();
    }
    await expect
      .poll(async () => (await rewardsOf()).pending, { timeout: 30_000 })
      .toBeGreaterThan(50);
    const pending = (await rewardsOf()).pending;

    // --- The holds end (simulated clock) and the release job runs: nothing pending, all usable.
    endRewardHolds(inviter.email);
    runWorkerJob("payments", "rewards.release");
    const released = await rewardsOf();
    expect(released.pending).toBe(0);
    expect(released.creditOnly + released.cash).toBe(pending);

    // --- The inviter converts every point to credits on /rewards; the wallet grows by the preview.
    const points = released.creditOnly + released.cash;
    const preview = convertPreviewSchema.parse(
      await (
        await page.request.get(`${urls.api}/me/rewards/convert/preview?points=${String(points)}`)
      ).json(),
    );
    expect(preview.possible).toBe(true);
    const wallet = await balanceOf(page.request);
    await page.goto("/rewards");
    await page.locator("button[name=open-convert]").click();
    await page.locator("input[name=points]").fill(String(points));
    await expect(page.getByTestId("preview-credits")).toContainText(String(preview.credits));
    await page.locator("button[name=confirm-convert]").click();
    const password = page.locator("dialog[open] input[type=password]");
    if (
      await password.waitFor({ state: "visible", timeout: 3_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await password.fill(inviter.password);
      await password.press("Enter");
    }
    await expect
      .poll(() => balanceOf(page.request), { timeout: 15_000 })
      .toBe(wallet + preview.credits);
    expect((await rewardsOf()).creditOnly + (await rewardsOf()).cash).toBe(0);
  }
});
