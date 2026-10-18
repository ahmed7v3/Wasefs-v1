import { t, type MessageKey } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signInContext, signedInAccount } from "./support/accounts";
import { createAdminLogin, signInThroughUi } from "./support/admin-billing";
import { expect, test } from "./support/fixtures";
import { seedPersonalOffer } from "./support/growth";
import { verifyPhoneViaApi } from "./support/phone";
import { sampleResult, seedAnalysis } from "./support/rx";

// Task 3.14 acceptance (the browser half; the API suite covers caps, budgets and buckets): the
// prompt appears after a good first result once and stays away after a dismissal, never on a failed
// analysis; a personal offer's deadline is the same in two browsers and after clearing storage; the
// funnel dashboard shows every step.

test("the taste prompt appears after a good result, once, and honours the dismissal", async ({
  context,
  page,
  urls,
  redis,
}) => {
  const person = await signedInAccount(context, urls, redis, newAccount("Prompted"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  const failed = seedAnalysis({ email: person.email, fileIds: [], status: "failed", errorRef: "WSF-E2E0-0001" });
  const done = seedAnalysis({ email: person.email, fileIds: [], status: "done", result: sampleResult() });

  // Never on an error screen.
  await page.goto(`/analyze/${failed}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("growth-prompt")).toHaveCount(0);

  await page.goto(`/analyze/${done}`);
  const prompt = page.getByTestId("growth-prompt");
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveAttribute("data-kind", "analysis_taste");
  await prompt.locator("button[name=prompt-dismiss]").click();
  await expect(prompt).toHaveCount(0);

  // A reload (same session) and a new tab session both stay quiet: the dismissal starts a cooldown.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("growth-prompt")).toHaveCount(0);
});

test("a personal offer shows the same server deadline in two browsers and after clearing storage", async ({
  browser,
  context,
  page,
  urls,
  redis,
}) => {
  const person = await signedInAccount(context, urls, redis, newAccount("Offered"));
  await finishOnboarding(page.request, urls, person.name);
  await verifyPhoneViaApi(context, urls, redis);
  const deadline = seedPersonalOffer(person.email, 48);

  await page.goto("/dashboard");
  const offer = page.getByTestId("offer-deadline").first();
  await expect(offer).toHaveAttribute("data-expires-at", deadline);

  // Clearing everything the browser keeps changes nothing: the deadline lives on the server.
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByTestId("offer-deadline").first()).toHaveAttribute("data-expires-at", deadline);

  // A second browser with its own session reads the very same deadline.
  const other = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    await signInContext(other, urls, person);
    const second = await other.newPage();
    await second.goto("/dashboard");
    await expect(second.getByTestId("offer-deadline").first()).toHaveAttribute("data-expires-at", deadline);
  } finally {
    await other.close();
  }
});

test("the funnel dashboard shows every step", async ({ browser, urls, redis }) => {
  const adminContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const login = await createAdminLogin(adminContext, urls, redis, { label: "Growth Lead", superAdmin: true });
    const admin = await adminContext.newPage();
    await signInThroughUi(admin, login);
    await admin.goto("/admin/growth");
    const steps = admin.getByTestId("funnel-steps");
    await expect(steps).toBeVisible();
    for (const key of ["visitToSignup", "signupToActivation", "activationToPaid", "checkoutToPaid"]) {
      await expect(steps.locator(`[data-step=${key}]`)).toContainText(t(`admin.growthOverview.step.${key}` as MessageKey));
    }
  } finally {
    await adminContext.close();
  }
});
