import { t } from "@wasfa/shared/i18n";

import { finishOnboarding, newAccount, signedInAccount } from "./support/accounts";
import { expectAccessible } from "./support/axe";
import { expect, test } from "./support/fixtures";
import {
  finishAnalysis,
  publishRxEvent,
  sampleResult,
  seedAnalysis,
  uploadRxPage,
} from "./support/rx";

import type { BrowserContext, Page } from "@playwright/test";
import type { Redis } from "ioredis";

/*
 * Task 2.9 acceptance: the result screen at 360 and 1440 px against the real stack. Analyses are
 * seeded straight into the database (no provider); the picture goes through the real upload
 * pipeline. Covers row <-> region highlighting by mouse and keyboard, the correction flow, the print
 * sheet, the insufficient-credits path of the deep re-run, and a reload in the middle of an analysis.
 */

interface Ctx {
  context: BrowserContext;
  page: Page;
  urls: { web: string; api: string };
  redis: Redis;
}

async function seeded(
  { context, page, urls, redis }: Ctx,
  status: "queued" | "done" | "refunded" | "failed" = "done",
  extra: { errorRef?: string } = {},
) {
  const account = await signedInAccount(context, urls, redis, newAccount("Rx"));
  await finishOnboarding(page.request, urls, account.name);
  await page.goto("/analyze");
  await expect(page.locator("h1").first()).toBeVisible();
  const fileId = await uploadRxPage(context, page, urls);
  const id = seedAnalysis({
    email: account.email,
    fileIds: [fileId],
    status,
    result: status === "done" ? sampleResult() : null,
    ...extra,
  });
  return { account, id, fileId };
}

const row = (page: Page, index: number) => page.locator(`tr[data-row-index="${String(index)}"]`);
const region = (page: Page, index: number) =>
  page.locator(`[data-region-id="item-${String(index)}"]`);

for (const [label, width, height] of [
  ["360", 360, 800],
  ["1440", 1440, 900],
] as const) {
  test.describe(`result at ${label} px`, () => {
    test.use({ viewport: { width, height } });

    test("shows the table, the notices and the disclaimer, and is accessible", async ({
      context,
      page,
      urls,
      redis,
    }) => {
      const ctx = { context, page, urls, redis };
      const { id } = await seeded(ctx);
      await page.goto(`/analyze/${id}`);
      await expect(page.getByRole("table")).toBeVisible();
      // Strength and form sit beside the name; columns no row fills are not drawn.
      await expect(page.getByRole("columnheader")).toHaveCount(4);
      await expect(page.getByRole("rowheader")).toHaveCount(3);
      await expect(page.getByTestId("rx-disclaimer")).toBeVisible();
      await expect(page.getByTestId("rx-unreadable-note")).toBeVisible();
      await expect(page.getByTestId("rx-findings")).toContainText(t("rx.finding.title"));
      // The unmatched line is shown as read, with "unconfirmed", and offers a review.
      await expect(row(page, 2)).toContainText(t("rx.unmatched"));
      await expect(row(page, 2).getByRole("button", { name: /راجع/ })).toBeVisible();
      await expect(row(page, 0).getByRole("button", { name: /راجع/ })).toHaveCount(0);
      await expect(page.getByTestId("rx-viewer-stage")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const review = await row(page, 2).getByRole("button", { name: /راجع/ }).boundingBox();
      expect(review?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expectAccessible(page, `/analyze/[id] at ${label} px`);
    });

    test("a row and its region highlight each other by mouse and by keyboard", async ({
      context,
      page,
      urls,
      redis,
    }) => {
      const ctx = { context, page, urls, redis };
      const { id } = await seeded(ctx);
      await page.goto(`/analyze/${id}`);
      const stage = page.getByTestId("rx-viewer-stage");
      await expect(region(page, 0)).toBeAttached();
      // Wait for the picture to be fitted into the stage.
      await expect(async () => {
        const box = await region(page, 0).boundingBox();
        expect(box?.width ?? 0).toBeGreaterThan(10);
      }).toPass();

      // Mouse: hovering a row draws its region.
      await row(page, 1).hover();
      await expect(region(page, 1)).toHaveAttribute("data-active", "true");
      await expect(region(page, 0)).not.toHaveAttribute("data-active", "true");

      // Mouse: hovering a region highlights its row; clicking it selects the row.
      await stage.scrollIntoViewIfNeeded();
      const box = await region(page, 2).boundingBox();
      if (!box) throw new Error("region 2 has no box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await expect(row(page, 2)).toHaveAttribute("data-active", "true");
      await page.mouse.down();
      await page.mouse.up();
      await expect(row(page, 2)).toHaveAttribute("data-selected", "true");

      // Keyboard: focusing a row's name draws its region, Enter selects it.
      const name = row(page, 0).getByRole("button", { name: /إظهار موضع/ });
      await name.focus();
      await expect(region(page, 0)).toHaveAttribute("data-active", "true");
      await page.keyboard.press("Enter");
      await expect(row(page, 0)).toHaveAttribute("data-selected", "true");

      // Keyboard zoom in the viewer.
      await stage.focus();
      await page.keyboard.press("+");
      await expect(stage).toHaveAttribute("data-scale", "1.250");
      await page.keyboard.press("0");
      await expect(stage).toHaveAttribute("data-scale", "1.000");
    });

    test("a typed correction updates the row at once and survives a reload", async ({
      context,
      page,
      urls,
      redis,
    }) => {
      const ctx = { context, page, urls, redis };
      const { id } = await seeded(ctx);
      await page.goto(`/analyze/${id}`);
      await row(page, 2).getByRole("button", { name: /راجع/ }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByTestId("picker-raw")).toHaveText("Zyr?ec");
      await expect(dialog.getByRole("checkbox")).not.toBeChecked();
      await dialog.getByRole("button", { name: t("rx.picker.none") }).click();
      await dialog.getByLabel(t("rx.picker.freeText")).fill("Zyrtec");
      await dialog.getByRole("button", { name: t("rx.picker.save") }).click();
      await expect(row(page, 2)).toContainText("Zyrtec");
      await expect(row(page, 2)).toContainText(t("rx.item.corrected"));
      await expect(page.getByText(t("rx.correction.saved"))).toBeVisible();
      await page.reload();
      await expect(row(page, 2)).toContainText("Zyrtec");
      await expect(row(page, 2)).toContainText(t("rx.unmatched"));
    });

    test("the deep re-run shows its price and is blocked without credits", async ({
      context,
      page,
      urls,
      redis,
    }) => {
      const ctx = { context, page, urls, redis };
      const { id } = await seeded(ctx);
      await page.goto(`/analyze/${id}`);
      const deep = page.getByTestId("rx-deep");
      await expect(deep).toContainText(t("rx.action.deepPrice", { price: 1 }));
      // A new account has no credits: the short balance is said, and the button waits.
      await expect(deep.getByRole("alert")).toBeVisible();
      await expect(deep.getByRole("button", { name: t("rx.action.deep") })).toBeDisabled();
    });
  });
}

test.describe("print and share", () => {
  test("the print media shows only the sheet", async ({ context, page, urls, redis }) => {
    const ctx = { context, page, urls, redis };
    const { id } = await seeded(ctx);
    await page.goto(`/analyze/${id}`);
    await expect(page.getByRole("table")).toBeVisible();
    await page.emulateMedia({ media: "print" });
    const sheet = page.locator("[data-rx-print]");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(t("rx.disclaimer"));
    // No picture of the prescription: the only images are inline SVG (the QR code to the site).
    await expect(sheet.locator('img:not([src^="data:image/svg"])')).toHaveCount(0);
    await expect(sheet).toContainText(t("rx.print.heading"));
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.locator(".page-backdrop > header")).toBeHidden();
    await expect(page.getByTestId("rx-viewer")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(sheet).toBeHidden();
  });

  test("share is a wa.me text link", async ({ context, page, urls, redis }) => {
    const ctx = { context, page, urls, redis };
    const { id } = await seeded(ctx);
    await page.goto(`/analyze/${id}`);
    const link = page.getByRole("link", { name: t("rx.action.share") });
    const href = (await link.getAttribute("href")) ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href);
    expect(text).toContain("Augmentin");
    // The report ends with the link to the site, and carries no link to the prescription picture.
    expect(text.trimEnd().endsWith(new URL(page.url()).origin)).toBe(true);
    expect(text).not.toContain("X-Amz");
    expect(text).not.toContain("/files/");
  });
});

test.describe("progress", () => {
  test("a reload in the middle of an analysis reconnects and finishes without another reload", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    const ctx = { context, page, urls, redis };
    const { id } = await seeded(ctx, "queued");
    await page.goto(`/analyze/${id}`);
    const progress = page.getByTestId("rx-progress");
    await expect(progress).toBeVisible();
    await expect(progress).toContainText(t("rx.leaveHint"));
    // (axe waits for an idle network, which an open live stream never gives; the refunded state below is checked instead.)

    await page.reload();
    await expect(progress).toBeVisible();

    // The worker moves on: the matching step becomes current (published until the stream listens).
    await expect
      .poll(async () => {
        await publishRxEvent(redis, id, { type: "step", step: "match" });
        return progress.locator('li[data-step="match"]').getAttribute("data-state");
      })
      .toBe("current");
    await expect(progress.locator('li[data-step="read"]')).toHaveAttribute("data-state", "done");

    // It ends: the row is written first, then the event; the table appears with no reload.
    finishAnalysis(id, "done", sampleResult());
    await expect
      .poll(async () => {
        await publishRxEvent(redis, id, { type: "done", status: "done" });
        return page.getByRole("table").count();
      })
      .toBe(1);
    await expect(progress).toBeHidden();
  });

  test("a refunded analysis explains and says nothing was charged", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    const ctx = { context, page, urls, redis };
    const { id } = await seeded(ctx, "refunded");
    await page.goto(`/analyze/${id}`);
    await expect(page.getByTestId("rx-refunded")).toContainText(t("rx.empty.guidance"));
    await expect(page.getByTestId("rx-disclaimer")).toBeVisible();
    await expectAccessible(page, "/analyze/[id] refunded");
  });

  test("a failed analysis shows the error reference", async ({ context, page, urls, redis }) => {
    const ctx = { context, page, urls, redis };
    const { id } = await seeded(ctx, "failed", { errorRef: "WSF-ABCD-2345" });
    await page.goto(`/analyze/${id}`);
    await expect(page.getByTestId("rx-failed")).toContainText("WSF-ABCD-2345");
  });
});

test.describe("history", () => {
  test("lists, searches and deletes with a confirmation", async ({
    context,
    page,
    urls,
    redis,
  }) => {
    const ctx = { context, page, urls, redis };
    await seeded(ctx);
    await page.goto("/analyze/history");
    await expect(page.getByRole("link", { name: /فتح تحليل/ }).first()).toBeVisible();
    await expect(page.getByText("Augmentin")).toBeVisible();
    await expectAccessible(page, "/analyze/history");

    await page.getByRole("searchbox").fill("nomatch-xyz");
    await expect(page.getByText(t("rx.history.noResults.title"))).toBeVisible();
    await page.getByRole("searchbox").fill("Augmentin");
    await expect(page.getByRole("link", { name: /فتح تحليل/ }).first()).toBeVisible();

    await page.getByRole("button", { name: /حذف تحليل/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(t("rx.history.delete.body"));
    await dialog.getByRole("button", { name: t("rx.history.delete.confirm") }).click();
    await expect(page.getByText(t("rx.history.deleted"))).toBeVisible();
    await page.getByRole("searchbox").fill("");
    await expect(page.getByText(t("rx.history.empty.title"))).toBeVisible();
  });
});
