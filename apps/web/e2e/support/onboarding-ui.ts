import { t, type MessageKey } from "@wasfa/shared/i18n";

import { expect } from "./fixtures";

import type { Page } from "@playwright/test";
import type { Profession } from "@wasfa/shared/identity";
import type { OnboardingInputStep } from "@wasfa/shared/schemas/onboarding";

/** The `h1` of a wizard step, which is also where focus lands when the step changes. */
export function stepHeading(page: Page, step: OnboardingInputStep) {
  const key = `onboarding.step.${step}.title` as MessageKey;
  return page.getByRole("heading", { level: 1, name: t(key) });
}

/** The start button of the one-screen onboarding at `/welcome`. */
export function welcomeStart(page: Page) {
  return page.locator("button[name=start]");
}

/** The segmented "for me / for an organization" toggle of the welcome card. */
export function welcomeAccountType(page: Page, type: "individual" | "organization") {
  return page.getByRole("radio", {
    name: t(type === "individual" ? "welcome.forMe" : "welcome.forOrg"),
  });
}

/**
 * Answers the one-screen onboarding and presses "start": the name is prefilled (pass `name` to change
 * it), "for me" is the default, the profession is optional and skipped unless given. For an
 * organization the inline fields are filled and the organization is created.
 */
export async function finishWelcome(
  page: Page,
  options: { name?: string; organization?: string; profession?: Profession } = {},
): Promise<void> {
  await expect(welcomeStart(page)).toBeVisible();
  if (options.name !== undefined) await page.locator("input[name=name]").fill(options.name);
  if (options.organization !== undefined) {
    await welcomeAccountType(page, "organization").click();
    await page.locator("input[name=orgName]").fill(options.organization);
    await page.locator("select[name=orgType]").selectOption("pharmacy");
    await page.locator("select[name=orgCountry]").selectOption("EG");
    await page.locator("input[name=orgCity]").fill("Cairo");
  }
  if (options.profession !== undefined) {
    await page.locator(`button[name=profession-${options.profession}]`).click();
  }
  await welcomeStart(page).click();
}

/** Picks a radio card or a checkbox by its input's name and value (the real inputs are visually hidden). */
export async function choose(page: Page, name: string, value: string): Promise<void> {
  const option = page.locator(`label:has(input[name="${name}"][value="${value}"])`);
  await option.click();
  await expect(page.locator(`input[name="${name}"][value="${value}"]`)).toBeChecked();
}

export async function next(page: Page): Promise<void> {
  await page.locator("button[name=next]").click();
}

/** Account type, then name: the two steps every account answers first (phone is skipped without a bridge). */
export async function answerAccountType(
  page: Page,
  type: "individual" | "organization",
): Promise<void> {
  await expect(stepHeading(page, "account_type")).toBeVisible();
  await choose(page, "accountType", type);
  await next(page);
}

export async function answerName(page: Page, name: string): Promise<void> {
  await expect(stepHeading(page, "name")).toBeVisible();
  await page.locator("input[name=name]").fill(name);
  await next(page);
}

export async function answerOrganization(page: Page, name: string): Promise<void> {
  await expect(stepHeading(page, "organization")).toBeVisible();
  await page.locator("input[name=name]").fill(name);
  await page.locator("select[name=type]").selectOption("pharmacy");
  await page.locator("select[name=country]").selectOption("EG");
  await page.locator("input[name=city]").fill("Cairo");
  await next(page);
}

export async function answerProfession(page: Page): Promise<void> {
  await expect(stepHeading(page, "profession_intent")).toBeVisible();
  await choose(page, "profession", "pharmacist");
  await choose(page, "usageIntent", "pharmacy_work");
  await page.locator("select[name=country]").selectOption("EG");
  await next(page);
}

/** The last step: the free plan is preselected, so "start free" finishes onboarding. */
export async function answerPlan(page: Page): Promise<void> {
  await expect(stepHeading(page, "plan_picker")).toBeVisible();
  await next(page);
}

/** The optional step before the plan: there is no Facebook page configured in the seed, so "next" passes it. */
export async function skipSocial(page: Page): Promise<void> {
  await expect(stepHeading(page, "social_follow")).toBeVisible();
  const skip = page.locator("button[name=skip-social]");
  if (await skip.count()) await skip.click();
  else await next(page);
}
