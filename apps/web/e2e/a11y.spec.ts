import { t } from "@wasfa/shared/i18n";

import {
  enableTwoFactor,
  finishOnboarding,
  grantSuperAdmin,
  newAccount,
  newPhone,
  registerVerified,
  signInContext,
  signedInAccount,
} from "./support/accounts";
import { expectAccessible } from "./support/axe";
import { createOrderViaApi } from "./support/billing";
import { expect, test } from "./support/fixtures";
import {
  answerAccountType,
  answerName,
  answerOrganization,
  answerPlan,
  answerProfession,
  stepHeading,
} from "./support/onboarding-ui";
import { bridgeConnected, bridgeGone } from "./support/whatsapp";

// Task 1.9 / 1.10 / 1.11 acceptance: no serious or critical axe violations on the auth, onboarding,
// dashboard, account, admin and public pages. Runs in the `desktop` (1440 px) and `mobile` (360 px)
// projects, so every page is checked at both widths.

const PUBLIC_PAGES = ["/login", "/register", "/forgot-password", "/verify-email"];
/** Pages another part of the product adds; they are checked as soon as they exist. */
const MARKETING_PAGES = ["/", "/pricing", "/contact", "/privacy"];

for (const path of PUBLIC_PAGES) {
  test(`public page ${path}`, async ({ page }) => {
    await page.goto(path);
    await expectAccessible(page, path);
  });
}

for (const path of MARKETING_PAGES) {
  test(`public page ${path}`, async ({ page, urls }) => {
    const probe = await page.request.get(`${urls.web}${path}`);
    test.skip(!probe.ok(), `${path} does not exist yet`);
    await page.goto(path);
    await expectAccessible(page, path);
  });
}

test("login and register: phone tabs and the two-factor screen", async ({ page }) => {
  await page.goto("/register");
  await page.locator('[data-value="phone"]').click();
  await expectAccessible(page, "/register (phone)");
  await page.goto("/login");
  await page.locator('[data-value="phone"]').click();
  await expectAccessible(page, "/login (phone)");
  await page.goto("/login/two-factor");
  await expectAccessible(page, "/login/two-factor");
});

test("every onboarding step (organization path, with the phone step)", async ({
  context,
  page,
  urls,
  redis,
}) => {
  await bridgeConnected(redis);
  const account = await signedInAccount(context, urls, redis, newAccount("A11y"));

  await page.goto("/onboarding");
  await expectAccessible(page, "onboarding: account type");
  await answerAccountType(page, "organization");

  // The bridge is up, so the phone step asks for a number...
  await expect(stepHeading(page, "phone")).toBeVisible();
  await expectAccessible(page, "onboarding: phone form");
  await page.locator("input[name=phoneNumber]").fill(newPhone().national);
  await page.locator("button[name=start-verification]").click();
  // ...and then shows the code to send.
  await expect(page.getByText(t("phone.waiting.status"))).toBeVisible();
  await expectAccessible(page, "onboarding: phone waiting");

  // With the bridge gone and a verified email the phone step can be passed.
  await bridgeGone(redis);
  await page.reload();
  await answerName(page, account.name);
  await expectAccessible(page, "onboarding: organization");
  await answerOrganization(page, "A11y Pharmacy");
  await expectAccessible(page, "onboarding: profession and intent");
  await answerProfession(page);
  await expectAccessible(page, "onboarding: plan");
  await answerPlan(page);
  await expect(stepHeading(page, "social_follow")).toBeVisible();
  await expectAccessible(page, "onboarding: social");
});

test("onboarding steps of an individual: name step", async ({ context, page, urls, redis }) => {
  await signedInAccount(context, urls, redis, newAccount("A11y"));
  await page.goto("/onboarding");
  await answerAccountType(page, "individual");
  await expect(stepHeading(page, "name")).toBeVisible();
  await expectAccessible(page, "onboarding: name");
});

test("signed-in pages: dashboard and account", async ({ context, page, urls, redis }) => {
  const account = await signedInAccount(context, urls, redis, newAccount("A11y"));
  await finishOnboarding(page.request, urls, account.name);

  for (const path of ["/dashboard", "/account", "/account/security", "/account/delete"]) {
    await page.goto(path);
    await expectAccessible(page, path);
  }
});

test("admin pages", async ({ context, page, urls, redis }) => {
  const admin = newAccount("A11yAdmin");
  await registerVerified(urls, redis, admin);
  grantSuperAdmin(admin.email);
  await signInContext(context, urls, admin);
  await finishOnboarding(page.request, urls, admin.name);
  await enableTwoFactor(context, urls, admin);

  for (const path of [
    "/admin",
    "/admin/users",
    "/admin/orgs",
    "/admin/roles",
    "/admin/settings",
    "/admin/flags",
    "/admin/audit",
    "/admin/issues",
  ]) {
    await page.goto(path);
    await expectAccessible(page, path);
  }
});

test("billing pages: checkout, both order states and the billing account", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const account = await signedInAccount(context, urls, redis, newAccount("A11yBill"));
  await finishOnboarding(page.request, urls, account.name);

  await page.goto("/checkout?plan=plus&months=1");
  await expectAccessible(page, "/checkout");

  // A card order waiting for the provider, and a transfer order showing its instructions.
  const card = await createOrderViaApi(context, urls, {
    planKey: "plus",
    months: 1,
    methodKey: "fake_card",
  });
  await page.goto(`/checkout/${card.orderId}`);
  await expect(page.getByTestId("order-state-title")).toBeVisible();
  await expectAccessible(page, "/checkout/<order> (card, waiting)");

  const transfer = await createOrderViaApi(context, urls, {
    planKey: "pro",
    months: 1,
    methodKey: "instapay",
  });
  await page.goto(`/checkout/${transfer.orderId}`);
  await expect(page.getByTestId("manual-amount")).toBeVisible();
  await expectAccessible(page, "/checkout/<order> (transfer instructions)");

  await page.goto("/billing");
  await expect(page.getByTestId("current-plan")).toBeVisible();
  await expect(page.getByText(t("billing.orders.complete")).first()).toBeVisible();
  await expectAccessible(page, "/billing");
});

test("rewards page, organization console (every tab), the dialogs and the join page", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const account = await signedInAccount(context, urls, redis, newAccount("A11yOrg"));
  await finishOnboarding(page.request, urls, account.name, "organization");
  const orgs = (await (await page.request.get(`${urls.api}/orgs`)).json()) as {
    items: Array<{ id: string }>;
  };
  const orgId = orgs.items[0]?.id;
  if (!orgId) throw new Error("the organization was not created");
  const slug = `a11y-${Math.random().toString(16).slice(2, 10)}`;
  const created = await page.request.post(`${urls.api}/orgs/${orgId}/join-links`, {
    data: { slug },
    headers: { Origin: urls.web },
  });
  expect(created.ok()).toBe(true);

  await page.goto("/rewards");
  await expect(page.getByTestId("count-invited")).toBeVisible();
  await expectAccessible(page, "/rewards");

  await page.goto(`/org/${orgId}`);
  for (const tab of ["overview", "members", "links", "orders"] as const) {
    await page.getByRole("tab", { name: t(`org.tabs.${tab}`) }).click();
    await expectAccessible(page, `/org/<id> (${tab})`);
  }
  await page.getByRole("tab", { name: t("org.tabs.links") }).click();
  await page.locator("button[name=new-link]").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAccessible(page, "/org/<id> (new link dialog)");
  await page.keyboard.press("Escape");

  await page.goto("/pricing");
  await page.locator("button[name=open-lead]").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAccessible(page, "/pricing (lead dialog)");

  // The join page is public: a signed-out visitor sees it.
  await context.clearCookies();
  await page.goto(`/join/${slug}`);
  await expectAccessible(page, "/join/<slug>");
  await page.goto("/join/no-such-link-here");
  await expectAccessible(page, "/join/<invalid>");
});
