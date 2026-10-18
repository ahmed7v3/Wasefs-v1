import { randomUUID } from "node:crypto";

import { t } from "@wasfa/shared/i18n";

import {
  finishOnboarding,
  newAccount,
  registerVerified,
  signInContext,
  signedInAccount,
} from "./support/accounts";
import { createAdminLogin, signInThroughUi } from "./support/admin-billing";
import { adminSession, createOrderViaApi, payFakeOrder } from "./support/billing";
import { expect, test } from "./support/fixtures";
import { mergeSetting, seedOrganization } from "./support/growth";
import { waitForMailLink } from "./support/mail";
import { verifyPhoneViaApi } from "./support/phone";

// Tasks 3.10 and 3.13 acceptance: an admin creates an institution deal and its join link in the
// wizard in under two minutes of scripted steps; a new member joins through the link and sees the
// member price at checkout as an ordinary discount line.

test("institution deal + join link in the wizard, then a member sees the member price at checkout", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  const owner = newAccount("Pharmacy Owner");
  await registerVerified(urls, redis, owner);
  const orgName = `صيدلية النور ${randomUUID().slice(0, 6)}`;
  seedOrganization(orgName, owner.email);
  const slug = `alnour-${randomUUID().slice(0, 8)}`;

  const adminContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const login = await createAdminLogin(adminContext, urls, redis, { label: "Partnerships", superAdmin: true });
    const admin = await adminContext.newPage();
    await signInThroughUi(admin, login);

    const started = Date.now();
    await admin.goto("/admin/growth/deals");
    await admin.locator("button[name=new-deal]").click();
    await admin.locator("input[name=deal-name]").fill(`سعر أعضاء ${orgName}`);
    await admin.locator("select[name=target-kind]").selectOption("organization");
    await admin.locator("input[name=org-search]").fill(orgName.slice(0, 12));
    await admin.getByRole("button", { name: new RegExp(orgName) }).click();
    await expect(admin.getByTestId("picked-org")).toHaveText(orgName);
    await admin.locator("button[name=next-what]").click();
    await admin.locator("select[name=plan-0]").selectOption("plus");
    await admin.locator("select[name=mode-0]").selectOption("fixed");
    await admin.locator("input[name=price-0]").fill("79");
    await admin.locator("button[name=next-duration]").click();
    await admin.locator("input[name=membership-months]").fill("12");
    await admin.locator("input[name=link-slug]").fill(slug);
    await admin.locator("button[name=preview-deal]").click();
    await expect(admin.getByTestId("deal-preview")).toBeVisible();
    await admin.locator("button[name=activate-deal]").click();
    const password = admin.locator("dialog[open] input[type=password]");
    const asked = await password
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (asked) {
      await password.fill(login.account.password);
      await password.press("Enter");
    }
    await expect(admin.getByTestId("join-link-url")).toContainText(`/join/${slug}`);
    expect(Date.now() - started).toBeLessThan(120_000);
  } finally {
    await adminContext.close();
  }

  // A new member: verified, opens the link, joins, and sees the price at checkout.
  const member = await signedInAccount(context, urls, redis, newAccount("New Member"));
  await finishOnboarding(page.request, urls, member.name);
  await verifyPhoneViaApi(context, urls, redis);
  await page.goto(`/join/${slug}`);
  await expect(page.getByText(orgName).first()).toBeVisible();
  // The join is completed by the signed-in shell once the account is verified.
  await page.goto("/dashboard");
  await expect
    .poll(async () => {
      const orgs = (await (await page.request.get(`${urls.api}/me`)).json()) as { organizations?: { name: string }[] };
      return (orgs.organizations ?? []).map((org) => org.name);
    }, { timeout: 15_000 })
    .toContain(orgName);

  // The member price of 79 shows as an ordinary discount line: list price minus discount is 79.00
  // (the list price itself may have been changed by an earlier spec in the same stack).
  await page.goto("/checkout?plan=plus&months=1");
  const lines = page.getByRole("region", { name: t("billing.summary.title") }).getByRole("listitem");
  await expect(lines.nth(1)).toContainText("-");
  const amount = async (index: number) =>
    Number(/(\d[\d,]*\.\d{2})/.exec((await lines.nth(index).textContent()) ?? "")?.[1]?.replace(/,/g, "") ?? NaN);
  expect((await amount(0)) - (await amount(1))).toBeCloseTo(79, 2);
});

test("a partner code with a 30% deal: the partner's pending reward equals the what-if", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  test.setTimeout(240_000);
  await mergeSetting(redis, "rewards", { enabled: true, requireFirstUsage: false });

  // The partner (a doctor) has an account; an admin gives them a partner code with a 30% deal.
  const partner = await signedInAccount(context, urls, redis, newAccount("Doctor Partner"));
  await finishOnboarding(page.request, urls, partner.name);
  const partnerId = ((await (await page.request.get(`${urls.api}/me`)).json()) as { id: string }).id;

  const admin = await adminSession(browser, urls, redis);
  const headers = { Origin: urls.web };
  let code: string;
  let dealId: string;
  let programId: string;
  try {
    const deal = await admin.request.post(`${urls.api}/admin/growth/deals`, {
      headers,
      data: {
        name: "Dr. partner 30%",
        terms: { pricing: [], rewards: { referrerSignupPoints: 0, referrerPaymentBps: 3_000, refereeSignupCredits: 0, maxRenewals: 6 } },
      },
    });
    expect(deal.ok(), await deal.text()).toBe(true);
    dealId = ((await deal.json()) as { id: string }).id;
    const created = await admin.request.post(`${urls.api}/admin/growth/codes`, {
      headers,
      data: { kind: "partner", ownerUserId: partnerId, dealId },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const body = (await created.json()) as { code?: string | { code: string } };
    code = typeof body.code === "string" ? body.code : (body.code?.code ?? "");
    expect((await admin.request.post(`${urls.api}/admin/growth/deals/${dealId}/activate`, { headers, data: {} })).ok()).toBe(true);
    const programs = (await (await admin.request.get(`${urls.api}/admin/growth/programs`)).json()) as {
      items: { id: string; key: string }[];
    };
    programId = programs.items.find((program) => program.key === "standard")?.id ?? "";
  } finally {
    await admin.close();
  }
  expect(code).not.toBe("");

  // The friend arrives through the code, verifies, and subscribes with the (fake) card.
  const friendContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  let netMinor: number;
  try {
    const friend = await friendContext.newPage();
    await friend.goto(`/r/${code}`);
    const account = newAccount("Referred Friend");
    const form = friend.getByRole("form", { name: t("auth.tab.email") });
    await expect(form.locator("input[name=referralCode]")).toHaveValue(code);
    await form.locator("input[name=name]").fill(account.name);
    await form.locator("input[name=email]").fill(account.email);
    await form.locator("input[name=password]").fill(account.password);
    await form.locator("input[name=terms]").check();
    await form.getByRole("button", { name: t("auth.register.submit") }).click();
    await friend.goto(await waitForMailLink(redis, account.email, "verify-email"));
    await signInContext(friendContext, urls, account);
    await finishOnboarding(friend.request, urls, account.name);
    await verifyPhoneViaApi(friendContext, urls, redis);
    const order = await createOrderViaApi(friendContext, urls, { planKey: "plus", months: 1, methodKey: "fake_card" });
    await payFakeOrder(friendContext, urls, order.orderId);
    // Rewards are computed on the paid subtotal (no tax, no fees): read it from the receipt.
    await expect
      .poll(async () => (await friend.request.get(`${urls.api}/me/orders/${order.orderId}/receipt`)).status(), {
        timeout: 15_000,
      })
      .toBe(200);
    const receipt = (await (await friend.request.get(`${urls.api}/me/orders/${order.orderId}/receipt`)).json()) as {
      totals: { subtotalMinor: number };
    };
    netMinor = receipt.totals.subtotalMinor;
  } finally {
    await friendContext.close();
  }

  // The worker turns the payment into pending points for the partner; they equal the what-if.
  const admin2 = await adminSession(browser, urls, redis);
  try {
    const whatIf = (await (
      await admin2.request.post(`${urls.api}/admin/growth/rules/what-if`, {
        headers,
        data: { programId, event: "first_payment", netMinor, dealId },
      })
    ).json()) as { beneficiaries: { beneficiary: string; points: number }[] };
    const expected = whatIf.beneficiaries.find((row) => row.beneficiary === "referrer")?.points ?? -1;
    expect(expected).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          ((await (await page.request.get(`${urls.api}/me/rewards`)).json()) as { balances: { pending: number } })
            .balances.pending,
        // Through the outbox, drained every 30 s by the worker.
        { timeout: 90_000 },
      )
      .toBe(expected);
  } finally {
    await admin2.close();
  }
});
