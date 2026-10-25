import { t } from "@wasfa/shared/i18n";

import { createAdminLogin, signInThroughUi, adminGet, adminSend } from "./support/admin-billing";
import { expectAccessible } from "./support/axe";
import { createReadyMedia, sendJson } from "./support/content";
import { expect, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

/*
 * The content editor (CONTENT-PLATFORM §8, WP3 Web-Admin-2). WRITTEN BUT NOT RUN on the machine that
 * authored it (no Docker, so no e2e stack). Runs in the `desktop` (1440 px) and `mobile` (360 px)
 * projects. The flows are the same; the layout assertions branch on the project name.
 */

const isMobile = (name: string): boolean => name === "mobile";

async function openNewArticle(page: Page): Promise<void> {
  await page.goto("/admin/content/new?type=article&locale=ar");
  await expect(
    page.getByLabel(t("admin.editor.field.title"), { exact: false }).first(),
  ).toBeVisible();
}

async function writeArticle(page: Page, title: string, body: string): Promise<void> {
  await page.getByLabel(t("admin.editor.field.title"), { exact: false }).first().fill(title);
  await page.getByLabel(t("admin.editor.field.body"), { exact: false }).fill(body);
}

/** Saves the first draft and waits for the URL to become `/admin/content/<id>`. */
async function createDraft(page: Page): Promise<string> {
  await page.getByTestId("primary-action").click();
  await expect(page).toHaveURL(/\/admin\/content\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1) ?? "";
}

type Urls = Parameters<typeof adminSend>[1];

/**
 * Scheduling is blocked until every `block` quality gate passes (an excerpt, a category, an author, a
 * featured image with alt text, a meta description and the minimum word count). The editor only
 * types the title and body, so the rest is filled through the API on the saved draft.
 */
async function satisfyPublishGates(page: Page, urls: Urls, id: string): Promise<void> {
  const tag = Math.random().toString(36).slice(2, 8);
  const category = await sendJson<{ id: string }>(page, urls, "POST", "/admin/content/categories", {
    slugAr: `e2e-${tag}`,
    nameAr: `تصنيف ${tag}`,
  });
  const author = await sendJson<{ id: string }>(page, urls, "POST", "/admin/content/people", {
    slug: `author-${tag}`,
    nameAr: "كاتب",
    role: "author",
  });
  const mediaId = await createReadyMedia(page, urls);

  const detail = await adminGet<{ lockVersion: number }>(page, urls, `/admin/content/items/${id}`);
  await sendJson(page, urls, "PATCH", `/admin/content/items/${id}`, {
    lockVersion: detail.lockVersion,
    payload: {
      excerpt: "ملخص قصير عن جرعة الباراسيتامول.",
      bodyMd: `## المقدمة

نص تجريبي عن الجرعة.

${"كلمة ".repeat(650)}`,
    },
    meta: {
      categoryId: category.id,
      primaryAuthorId: author.id,
      featuredMediaId: mediaId,
      seo: { description: "وصف تجريبي لمقال عن جرعة الباراسيتامول." },
    },
  });
}

test.describe("content editor", () => {
  test.beforeEach(async ({ page, urls, redis }) => {
    const login = await createAdminLogin(page.context(), urls, redis, {
      label: "Editor",
      superAdmin: true,
    });
    await signInThroughUi(page, login);
  });

  test("write → autosave → preview → submit → review by a second account → schedule", async ({
    page,
    browser,
    urls,
    redis,
  }, testInfo) => {
    await openNewArticle(page);
    await writeArticle(page, "جرعة الباراسيتامول", "## المقدمة\n\nنص تجريبي عن الجرعة.");
    const id = await createDraft(page);
    await satisfyPublishGates(page, urls, id);
    await page.reload();

    // Autosave: type more, wait past the 10 s interval, the indicator reports a save.
    await page.getByLabel(t("admin.editor.field.body"), { exact: false }).press("End");
    await page
      .getByLabel(t("admin.editor.field.body"), { exact: false })
      .pressSequentially(" وزيادة");
    await expect(page.getByTestId("autosave")).toContainText(t("admin.editor.autosave.justNow"), {
      timeout: 20_000,
    });

    // Preview: split view on a wide desktop, full screen elsewhere; both show the server render.
    await page
      .getByRole("button", { name: t("admin.editor.bar.preview") })
      .first()
      .click();
    await expect(page.locator(".content-prose h2").first()).toContainText("المقدمة", {
      timeout: 10_000,
    });
    await page.keyboard.press("Escape");

    // Save, then submit for review (the primary button becomes «إرسال للمراجعة» once clean).
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("primary-action")).toHaveText(t("admin.editor.action.submit"), {
      timeout: 15_000,
    });
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("status-chip").first()).toHaveText(
      t("admin.editor.status.in_review"),
    );

    // A second account with a reviewer profile approves it.
    const reviewerContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
    try {
      const reviewerLogin = await createAdminLogin(reviewerContext, urls, redis, {
        label: "Reviewer",
        superAdmin: true,
      });
      const reviewerPage = await reviewerContext.newPage();
      await signInThroughUi(reviewerPage, reviewerLogin);
      const me = await adminGet<{ id: string }>(reviewerPage, urls, "/me");
      await adminSend(reviewerPage, urls, "POST", "/admin/content/people", {
        slug: `reviewer-${me.id.slice(-8)}`,
        nameAr: "مراجع",
        role: "reviewer",
        userId: me.id,
      });
      await reviewerPage.goto(`/admin/content/${id}`);
      if (isMobile(testInfo.project.name)) {
        await reviewerPage.getByRole("button", { name: t("admin.editor.tab.publish") }).click();
      }
      await reviewerPage.getByRole("tab", { name: t("admin.editor.tab.review") }).click();
      await reviewerPage
        .getByRole("button", { name: t("admin.editor.action.approve"), exact: true })
        .last()
        .click();
      await expect(reviewerPage.getByTestId("status-chip").first()).toHaveText(
        t("admin.editor.status.approved"),
      );
    } finally {
      await reviewerContext.close();
    }

    // Schedule from the overflow menu: the time is typed on the Cairo wall clock.
    await page.reload();
    await page.getByRole("button", { name: t("admin.editor.menu.label") }).click();
    await page.getByRole("menuitem", { name: t("admin.editor.action.schedule") }).click();
    const dialog = page.getByRole("dialog", { name: t("admin.editor.schedule.title") });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t("admin.editor.action.schedule") }).click();
    await expect(page.getByTestId("status-chip").first()).toHaveText(
      t("admin.editor.status.scheduled"),
      {
        timeout: 15_000,
      },
    );
  });

  test("the formatting toolbar rides above the on-screen keyboard (mobile)", async ({
    page,
  }, testInfo) => {
    test.skip(
      !isMobile(testInfo.project.name),
      "the keyboard strip only exists on the phone layout",
    );
    await openNewArticle(page);
    const body = page.getByLabel(t("admin.editor.field.body"), { exact: false });
    await body.focus();
    // Emulate a 300 px keyboard through the Visual Viewport the hook listens to.
    await page.evaluate(() => {
      const vv = window.visualViewport;
      if (!vv) throw new Error("no visualViewport");
      Object.defineProperty(vv, "height", { value: window.innerHeight - 300, configurable: true });
      vv.dispatchEvent(new Event("resize"));
    });
    const toolbar = page.getByRole("toolbar", { name: t("admin.editor.toolbar.label") });
    await expect(toolbar).toBeVisible();
    const box = await toolbar.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual((viewport?.height ?? 0) - 299);
    // Buttons are 44 px and the row scrolls sideways instead of overflowing the page.
    const button = toolbar.getByRole("button").first();
    expect((await button.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // The bottom bar gives way to the keyboard while writing.
    await expect(page.getByRole("navigation", { name: t("admin.editor.bar.label") })).toBeHidden();
  });

  test("restore a previous revision", async ({ page }) => {
    await openNewArticle(page);
    await writeArticle(page, "عنوان", "النسخة الأولى");
    await createDraft(page);
    const body = page.getByLabel(t("admin.editor.field.body"), { exact: false });
    await body.fill("النسخة الثانية");
    await page.getByTestId("primary-action").click();
    await expect(page.getByTestId("primary-action")).toBeDisabled({ timeout: 15_000 });

    await openPanelTab(page, "history");
    await page
      .getByRole("button", { name: t("admin.editor.history.restoreNumber", { number: 1 }) })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t("admin.editor.history.restore"), exact: true })
      .click();
    await expect(body).toHaveValue("النسخة الأولى", { timeout: 15_000 });
  });

  test("a conflicting save shows the conflict dialog with its four ways out", async ({
    page,
    urls,
  }) => {
    await openNewArticle(page);
    await writeArticle(page, "عنوان التعارض", "نص أصلي");
    const id = await createDraft(page);

    // Somebody else saves first (same account, a second request: the lock version moves on).
    const detail = await adminGet<{ lockVersion: number }>(
      page,
      urls,
      `/admin/content/items/${id}`,
    );
    const response = await page.request.patch(`${urls.api}/admin/content/items/${id}`, {
      data: { lockVersion: detail.lockVersion, payload: { bodyMd: "نص زميل" } },
      headers: { origin: urls.web },
    });
    expect(response.ok()).toBe(true);

    await page.getByLabel(t("admin.editor.field.body"), { exact: false }).fill("نصي أنا");
    await page.getByTestId("primary-action").click();
    const dialog = page.getByRole("dialog", { name: t("admin.editor.conflict.title") });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t("admin.editor.conflict.viewDiff") }).click();
    await expect(dialog.locator("ins:visible, del:visible").first()).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: t("admin.editor.conflict.copy") }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: t("admin.editor.conflict.reload") }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: t("admin.editor.conflict.overwrite") }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByLabel(t("admin.editor.field.body"), { exact: false })).toHaveValue(
      "نصي أنا",
    );
  });

  test("axe: the editor and its panels have no serious violations", async ({ page }, testInfo) => {
    await openNewArticle(page);
    await writeArticle(page, "عنوان للفحص", "## عنوان\n\nنص.");
    await createDraft(page);
    await expectAccessible(page, "editor");
    await openPanelTab(page, "seo");
    await expectAccessible(page, "editor SEO panel");
    await openPanelTab(page, "publish");
    await expectAccessible(
      page,
      isMobile(testInfo.project.name) ? "editor publish sheet" : "editor publish panel",
    );
  });
});

/** Opens a panel tab: the side panel on desktop, the bottom sheet on the phone. */
async function openPanelTab(
  page: Page,
  tab: "publish" | "seo" | "media" | "review" | "history",
): Promise<void> {
  const label = t(`admin.editor.tab.${tab}`);
  const bar = page.getByRole("navigation", { name: t("admin.editor.bar.label") });
  // The sheet may already be open from an earlier step (it covers the bar): then just switch tabs.
  if ((await bar.isVisible()) && !(await page.getByRole("tab", { name: label }).isVisible())) {
    // The phone layout: any bar button opens the sheet; the sheet's own tab list reaches the rest.
    await bar.getByRole("button", { name: t("admin.editor.tab.publish") }).click();
  }
  await page.getByRole("tab", { name: label }).click();
}
