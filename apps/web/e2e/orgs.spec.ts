import { t } from "@wasfa/shared/i18n";
import { orgListResponseSchema } from "@wasfa/shared/schemas/org";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { waitForMailLink } from "./support/mail";
import { verifyPhoneViaApi } from "./support/phone";

// Task 3.9 acceptance: an org admin creates a join link from the dashboard; a new user opens
// /join/<slug>, registers, verifies the email and the phone, lands on the dashboard and appears in
// the members tab. The slug survives the whole detour in the `wasfa_join` cookie.

test("an org admin creates a join link and a new user joins through it", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  // --- The admin of a new organization creates the link from the console.
  const admin = await signedInAccount(context, urls, redis, newAccount("OrgAdmin"));
  await finishOnboarding(page.request, urls, admin.name, "organization");
  const orgs = orgListResponseSchema.parse(
    await (await page.request.get(`${urls.api}/orgs`)).json(),
  );
  const org = orgs.items[0];
  if (!org) throw new Error("the organization was not created");

  const slug = `e2e-${Math.random().toString(16).slice(2, 10)}`;
  await page.goto(`/org/${org.id}`);
  await expect(page.getByRole("heading", { level: 1, name: org.name })).toBeVisible();
  await page.getByRole("tab", { name: t("org.tabs.links") }).click();
  await page.locator("button[name=new-link]").click();
  await page.locator("input[name=slug]").fill(slug);
  await page.locator("button[name=create-link]").click();
  await expect(page.getByTestId("join-link").filter({ hasText: `/join/${slug}` })).toBeVisible();

  // --- A stranger opens the link.
  const guestContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/join/${slug}`);
    await expect(
      guest.getByRole("heading", { level: 1, name: t("join.heading", { org: org.name }) }),
    ).toBeVisible();
    await guest.getByRole("link", { name: t("join.register") }).click();
    await expect(guest).toHaveURL(new RegExp(`/register\\?join=${slug}$`));

    const account = newAccount("Joiner");
    const form = guest.getByRole("form", { name: t("auth.tab.email") });
    await form.locator("input[name=name]").fill(account.name);
    await form.locator("input[name=email]").fill(account.email);
    await form.locator("input[name=password]").fill(account.password);
    await form.locator("input[name=terms]").check();
    await form.getByRole("button", { name: t("auth.register.submit") }).click();
    await expect(guest).toHaveURL(/\/verify-email$/);

    await guest.goto(await waitForMailLink(redis, account.email, "verify-email"));
    await expect(guest).toHaveURL(/\/login\?verified=1$/);
    const login = guest.getByRole("form", { name: t("auth.tab.email") });
    await login.locator("input[name=email]").fill(account.email);
    await login.locator("input[name=password]").fill(account.password);
    await login.getByRole("button", { name: t("auth.login.submit") }).click();
    await expect(guest).toHaveURL(/\/welcome$/);

    // The welcome card and the phone are covered by their own specs; here they are answered through the API.
    await finishOnboarding(guest.request, urls, account.name);
    await verifyPhoneViaApi(guestContext, urls, redis);

    // The first shell page after verification finishes the join and says so.
    await guest.goto("/dashboard");
    await expect(guest.getByText(t("join.accepted.joined", { org: org.name }))).toBeVisible({
      timeout: 20_000,
    });

    // --- The admin sees the new member.
    await page.goto(`/org/${org.id}`);
    await page.getByRole("tab", { name: t("org.tabs.members") }).click();
    await expect(page.getByTestId("member-row").filter({ hasText: account.name })).toBeVisible();
  } finally {
    await guestContext.close();
  }
});

test("a join link that does not exist shows one calm message", async ({ page }) => {
  await page.goto("/join/no-such-link-here");
  await expect(
    page.getByRole("heading", { level: 1, name: t("join.invalid.title") }),
  ).toBeVisible();
  await expect(page.getByText(t("join.invalid"), { exact: true })).toBeVisible();
});

test("someone who is not an admin sees the calm no-access page on an organization console", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const account = await signedInAccount(context, urls, redis, newAccount("Plain"));
  await finishOnboarding(page.request, urls, account.name);
  await page.goto("/org/00000000-0000-4000-8000-000000000001");
  await expect(page.getByRole("heading", { name: t("org.noAccess.title") })).toBeVisible();
});
