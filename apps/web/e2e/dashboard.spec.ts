import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { expectAccessible } from "./support/axe";
import { expect, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

/*
 * Task 2.12 acceptance: the dashboard renders its cards without layout shift, a picture dropped or
 * pasted on the quick-capture card ends up on /analyze as an uploaded page, and a tool card opens
 * the assistant with its skill chosen. Axe at 360 and 1440 px is in `a11y.spec.ts` (/dashboard).
 */

/** A small crisp JPEG drawn in the page. */
async function picture(page: Page): Promise<{ name: string; mimeType: string; base64: string }> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#111111";
    ctx.font = "bold 30px monospace";
    for (let line = 0; line < 20; line += 1) {
      ctx.fillText(`Rx ${String(line)}  Amoxicillin 500 mg  1 x 3  7 days`, 40, 50 + line * 40);
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) throw new Error("no jpeg");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return { name: "rx.jpg", mimeType: "image/jpeg", base64 };
}

async function openDashboard(
  context: Parameters<typeof signedInAccount>[0],
  page: Page,
  urls: Parameters<typeof signedInAccount>[1],
  redis: Parameters<typeof signedInAccount>[2],
): Promise<void> {
  const account = await signedInAccount(context, urls, redis, newAccount("Dash"));
  await finishOnboarding(page.request, urls, account.name);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: t("dashboard.capture.title") })).toBeVisible();
}

test("a new account sees every card in its empty state, with no layout shift", async ({
  context,
  page,
  urls,
  redis,
}) => {
  await page.addInitScript(() => {
    const win = window as unknown as { __cls: number };
    win.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) win.__cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await openDashboard(context, page, urls, redis);

  await expect(page.getByRole("heading", { name: t("dashboard.rx.empty") })).toBeVisible();
  await expect(page.getByRole("heading", { name: t("dashboard.chats.empty") })).toBeVisible();
  await expect(page.getByText(/كريدت/).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  expect(cls).toBeLessThan(0.05);
  await expectAccessible(page, "/dashboard (loaded)");
});

test("a picture pasted on the dashboard becomes an uploaded page on /analyze", async ({
  context,
  page,
  urls,
  redis,
}) => {
  await openDashboard(context, page, urls, redis);
  const file = await picture(page);
  await page.evaluate(({ name, mimeType, base64 }) => {
    const data = new DataTransfer();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    data.items.add(new File([bytes], name, { type: mimeType }));
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, file);

  await page.waitForURL(/\/analyze$/, { timeout: 60_000 });
  await expect(page.locator('li[data-local-id][data-status="uploaded"]')).toHaveCount(1, {
    timeout: 30_000,
  });
  // The hand-over is single use: a reload starts empty.
  await page.reload();
  await expect(page.getByRole("heading", { name: t("capture.empty.title") })).toBeVisible();
});

test("a tool card opens the assistant with its skill chosen", async ({
  context,
  page,
  urls,
  redis,
}) => {
  await openDashboard(context, page, urls, redis);
  await page.getByRole("link", { name: new RegExp(t("dashboard.tools.drug-info.title")) }).click();
  await page.waitForURL(/\/ai\?skill=drug-info$/);
  // The suggestion cards share the label; only the skill chip carries aria-pressed.
  await expect(
    page.locator("button[aria-pressed]").filter({ hasText: t("chat.skill.drug-info") }),
  ).toHaveAttribute("aria-pressed", "true");
});
