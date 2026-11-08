import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { useUpMonthlyGrant } from "./support/billing";
import { expect, test } from "./support/fixtures";
import { verifyPhoneViaApi } from "./support/phone";
import { seedAnalysis } from "./support/rx";

// home-ads-conversion, tasks 4.2-4.4 (the browser half; growth-prompts.units.test.ts covers the rules):
// after the first free credits are spent the dashboard opens one closable modal naming a real plan;
// it never opens during an analysis; and there is at most one per browser session.
// Needs at least one public paid plan with a monthly price (the seeded "pro" plan).

test("the trial-ended modal opens on the dashboard after the free credits are used up, and closes in one tap", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const person = await signedInAccount(context, urls, redis, newAccount("Trial over"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  useUpMonthlyGrant(person.email);

  await page.goto("/dashboard");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Real values, never a template.
  await expect(dialog).not.toContainText(/\{\w+\}/);
  await expect(dialog.getByTestId("prompt-cta")).toHaveAttribute("href", "/pricing");

  await dialog.locator("button[name=prompt-dismiss]").click();
  await expect(dialog).toBeHidden();
});

test("no prompt opens while an analysis runs", async ({ context, page, urls, redis }) => {
  const person = await signedInAccount(context, urls, redis, newAccount("Busy"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  useUpMonthlyGrant(person.email);
  const running = seedAnalysis({ email: person.email, fileIds: [], status: "processing" });

  await page.goto(`/analyze/${running}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("growth-prompt")).toHaveCount(0);
});

test("at most one prompt per session: the analyze start screen stays quiet after the dashboard's", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const person = await signedInAccount(context, urls, redis, newAccount("Once"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  useUpMonthlyGrant(person.email);

  await page.goto("/dashboard");
  await expect(page.getByRole("dialog")).toBeVisible();
  // Closing it is the dismissal; the tab session already had its prompt.
  await page.getByRole("dialog").locator("button[name=prompt-dismiss]").click();

  await page.goto("/analyze");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
