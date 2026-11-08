import type { Page } from "@playwright/test";

/*
 * The growth prompt slot may open a calm-moment modal on /analyze and /dashboard as soon as the page
 * loads. Specs that are about something else dismiss it first so it cannot intercept their clicks.
 */

/** Closes the growth prompt modal if one is open; a no-op when none shows up. */
export async function dismissGrowthPrompt(page: Page): Promise<void> {
  const dialog = page.locator("dialog[open]");
  // The prompt arrives from an async request, so give it a short moment to appear.
  const appeared = await dialog
    .first()
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(
      () => true,
      () => false,
    );
  if (!appeared) return;
  await dialog.first().locator('button[name="prompt-dismiss"]').click();
  await dialog.first().waitFor({ state: "hidden" });
}
