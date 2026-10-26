import { t } from "@wasfa/shared/i18n";
import { orgListResponseSchema } from "@wasfa/shared/schemas/org";

import { newAccount, registerVerified, signInContext } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import {
  answerAccountType,
  answerName,
  answerOrganization,
  answerPlan,
  answerProfession,
  skipSocial,
  stepHeading,
} from "./support/onboarding-ui";

// Task 1.9 acceptance: the organization path of the wizard, with the organization fields, ends on
// the dashboard and leaves a real organization behind with the new user as its admin.

test("organization onboarding creates the organization and reaches the dashboard", async ({
  page,
  context,
  urls,
  redis,
}) => {
  const account = newAccount("Org");
  await registerVerified(urls, redis, account);
  await signInContext(context, urls, account);

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/onboarding$/);

  await answerAccountType(page, "organization");
  await answerName(page, account.name);
  await answerOrganization(page, "E2E Pharmacy");

  // Going back from the next step re-opens the organization step with what was answered.
  await expect(stepHeading(page, "profession_intent")).toBeVisible();
  await page.getByRole("button", { name: t("common.back") }).click();
  await expect(stepHeading(page, "organization")).toBeVisible();
  await expect(page.locator("input[name=name]")).toHaveValue("E2E Pharmacy");
  await page.locator("button[name=next]").click();

  await answerProfession(page);
  await skipSocial(page);
  await answerPlan(page);

  await expect(page).toHaveURL(/\/dashboard$/);
  const firstName = account.name.split(" ")[0] ?? "";
  await expect(
    page.getByRole("heading", { level: 1, name: t("dashboard.greeting", { name: firstName }) }),
  ).toBeVisible();

  const orgs = orgListResponseSchema.parse(
    await (await page.request.get(`${urls.api}/orgs`)).json(),
  );
  expect(orgs.items).toHaveLength(1);
  expect(orgs.items[0]).toMatchObject({
    name: "E2E Pharmacy",
    type: "pharmacy",
    country: "EG",
    city: "Cairo",
    myRole: "org_admin",
  });
});
