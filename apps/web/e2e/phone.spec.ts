import { t } from "@wasfa/shared/i18n";
import { PHONE_CODE_LENGTH } from "@wasfa/shared/schemas/phone";

import { newAccount, newPhone } from "./support/accounts";
import { WHATSAPP_NUMBER } from "./support/config";
import { expect, test } from "./support/fixtures";
import { stepHeading } from "./support/onboarding-ui";
import { bridgeConnected, sendInbound } from "./support/whatsapp";

// Task 1.9 acceptance: phone registration -> the onboarding phone step shows a code -> the
// (faked) WhatsApp bridge reports an inbound message from that number -> verified -> continue.

test("phone sign-up verifies the number through the WhatsApp inbound stream", async ({
  page,
  redis,
  urls,
}) => {
  await bridgeConnected(redis);
  const account = newAccount("Phone");
  const phone = newPhone();

  await page.goto("/register");
  await page.locator('[data-value="phone"]').click();
  const form = page.getByRole("form", { name: t("auth.tab.phone") });
  await form.locator("input[name=name]").fill(account.name);
  await form.locator("input[name=phoneNumber]").fill(phone.national);
  await form.locator("input[name=password]").fill(account.password);
  await form.locator("input[name=terms]").check();
  await form.getByRole("button", { name: t("auth.register.submit") }).click();

  // Phone sign-up signs the person in and goes straight to the wizard.
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.locator("label:has(input[name=accountType][value=individual])").click();
  await page.locator("button[name=next]").click();

  await expect(stepHeading(page, "phone")).toBeVisible();
  await page.locator("input[name=phoneNumber]").fill(phone.national);
  await page.locator("button[name=start-verification]").click();

  // The page shows the code to send and the number to send it to.
  const code = page.getByText(new RegExp(String.raw`^\d{${String(PHONE_CODE_LENGTH)}}$`));
  await expect(code).toBeVisible();
  await expect(page.getByText(WHATSAPP_NUMBER)).toBeVisible();
  const shown = (await code.textContent()) ?? "";

  // What the bridge would push after the user's WhatsApp message arrives.
  await sendInbound(redis, phone.e164, shown);

  // Verified: the wizard shows the success note and moves on by itself, so the next step is the
  // stable thing to wait for (the note can be gone before a check could see it).
  await expect(stepHeading(page, "name")).toBeVisible({ timeout: 20_000 });
  const me = (await (await page.request.get(`${urls.api}/me`)).json()) as {
    phone: string | null;
    phoneVerified: boolean;
  };
  expect(me).toMatchObject({ phone: phone.e164, phoneVerified: true });
});
