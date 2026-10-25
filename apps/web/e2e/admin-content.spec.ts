import { t } from "@wasfa/shared/i18n";

import { adminGet, adminSend, signedInSuperAdmin } from "./support/admin-billing";
import { expectAccessible } from "./support/axe";
import { expect, test } from "./support/fixtures";

import type { Page } from "@playwright/test";

// Phase 4 / WP3 acceptance (admin screens other than the editor): the content list with its filters and
// bulk actions, the taxonomy CRUD and merge, the media upload, the review inbox and the axe pass on each.
// Runs in the `desktop` (1440 px) and `mobile` (360 px) projects. WRITTEN BUT NOT EXECUTED in the sandbox
// that produced it (no Docker, so no stack): run it with the rest of the e2e suite.

const unique = () => Math.random().toString(36).slice(2, 8);

/** No horizontal page scroll at any width the project runs (tables become cards on a phone). */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function seedArticle(
  page: Page,
  urls: Parameters<typeof adminSend>[1],
  title: string,
): Promise<void> {
  await adminSend(page, urls, "POST", "/admin/content/items", {
    type: "article",
    locale: "ar",
    payload: { title, excerpt: "", bodyMd: "نص تجريبي" },
    meta: { slug: `e2e-${unique()}` },
  });
}

test("content list: filters live in the URL, a row opens the editor, the page never scrolls sideways", async ({
  page,
  urls,
  redis,
}) => {
  await signedInSuperAdmin(page, urls, redis);
  const title = `مقال اختبار ${unique()}`;
  await seedArticle(page, urls, title);

  await page.goto("/admin/content?type=article");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("admin.nav.content.articles"));
  await expect(page.getByText(title).filter({ visible: true }).first()).toBeVisible();
  await expectNoSidewaysScroll(page);
  await expectAccessible(page, "/admin/content");

  // A status chip and a saved view write to the URL.
  await page
    .getByRole("group", { name: t("admin.content.filter.status") })
    .getByRole("button", { name: t("admin.content.status.draft") })
    .click();
  await expect(page).toHaveURL(/status=draft/);
  await page.getByRole("button", { name: t("admin.content.view.inReview") }).click();
  await expect(page).toHaveURL(/status=in_review/);
  await expect(page).not.toHaveURL(/status=draft/);
  await page.getByRole("button", { name: t("admin.content.view.inReview") }).click();

  // The search box narrows the list.
  await page.getByRole("searchbox", { name: t("admin.content.filter.q") }).fill(title);
  await expect(page).toHaveURL(/q=/);
  await page
    .getByRole("button", { name: t("admin.content.openItem", { title }) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/content\/[0-9a-f-]{36}/);
});

test("bulk: select rows, set a category, read the per-item result", async ({
  page,
  urls,
  redis,
}) => {
  await signedInSuperAdmin(page, urls, redis);
  const categoryName = `تصنيف ${unique()}`;
  await adminSend(page, urls, "POST", "/admin/content/categories", {
    slugAr: `cat-${unique()}`,
    nameAr: categoryName,
  });
  const a = `مقال أ ${unique()}`;
  const b = `مقال ب ${unique()}`;
  await seedArticle(page, urls, a);
  await seedArticle(page, urls, b);

  await page.goto("/admin/content?type=article");
  await page.getByRole("checkbox", { name: /^تحديد كل ما في الصفحة/ }).check();
  const bar = page.getByRole("region", { name: t("admin.content.bulk.bar") });
  await expect(bar).toBeVisible();
  await expectNoSidewaysScroll(page);

  await bar.getByRole("button", { name: t("admin.content.bulk.setCategory") }).click();
  const dialog = page.getByRole("dialog", { name: t("admin.content.bulk.setCategory") });
  await dialog.getByLabel(t("admin.content.bulk.category")).selectOption({ label: categoryName });
  await dialog.getByRole("button", { name: t("admin.content.bulk.apply") }).click();
  await expect(page.getByText(/تم تطبيق الإجراء على/)).toBeVisible();
});

test("taxonomy: create, edit and delete a category and a tag; merge two tags", async ({
  page,
  urls,
  redis,
}) => {
  await signedInSuperAdmin(page, urls, redis);
  await page.goto("/admin/content/taxonomy");
  await expectAccessible(page, "/admin/content/taxonomy");

  // Category: create with the transliteration suggestion, rename, delete.
  const name = `تصنيف ${unique()}`;
  await page.getByRole("button", { name: t("admin.content.category.new") }).click();
  const dialog = page.getByRole("dialog", { name: t("admin.content.category.newTitle") });
  await dialog.getByLabel(new RegExp(`^${t("admin.content.field.nameAr")}`)).fill(name);
  await dialog
    .getByRole("button", { name: t("admin.content.slug.suggest") })
    .first()
    .click();
  await expect(dialog.locator("input[name=slugAr]")).not.toHaveValue("");
  await dialog.getByRole("button", { name: t("common.save") }).click();
  await expect(page.getByText(name)).toBeVisible();

  await page.getByRole("button", { name: t("admin.content.edit", { name }) }).click();
  const edit = page.getByRole("dialog", { name: t("admin.content.category.editTitle", { name }) });
  await edit.getByLabel(new RegExp(`^${t("admin.content.field.nameAr")}`)).fill(`${name} 2`);
  await edit.getByRole("button", { name: t("common.save") }).click();
  await expect(page.getByText(`${name} 2`)).toBeVisible();

  await page
    .getByRole("button", { name: t("admin.content.delete", { name: `${name} 2` }) })
    .click();
  await page
    .getByRole("dialog", { name: t("admin.content.category.deleteTitle", { name: `${name} 2` }) })
    .getByRole("button", { name: t("admin.content.deleteVerb") })
    .click();
  await expect(page.getByText(`${name} 2`)).toHaveCount(0);

  // Tags: two tags, merge the first into the second.
  const from = `وسم ${unique()}`;
  const into = `وسم ${unique()}`;
  for (const tagName of [from, into]) {
    await adminSend(page, urls, "POST", "/admin/content/tags", {
      nameAr: tagName,
      slugAr: `tag-${unique()}`,
    });
  }
  await page.getByRole("tab", { name: t("admin.content.tab.tags") }).click();
  await expect(page.getByText(from).filter({ visible: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: t("admin.table.actionsFor", { name: from }) })
    .first()
    .click();
  await page.getByRole("button", { name: t("admin.content.tag.mergeVerb") }).click();
  const merge = page.getByRole("dialog", {
    name: t("admin.content.tag.mergeTitle", { name: from }),
  });
  await merge
    .getByLabel(new RegExp(t("admin.content.tag.mergeInto")))
    .selectOption({ label: into });
  await expect(merge.getByRole("status")).toBeVisible();
  await merge.getByRole("button", { name: t("admin.content.tag.mergeVerb") }).click();
  await expect(page.getByText(from)).toHaveCount(0);
  await expect(page.getByText(into).filter({ visible: true }).first()).toBeVisible();
});

test("media: upload a PNG, edit its alt text and focal point", async ({ page, urls, redis }) => {
  await signedInSuperAdmin(page, urls, redis);
  await page.goto("/admin/media");
  await expectAccessible(page, "/admin/media");

  // A 1x1 PNG straight into the file input (drag and drop uses the same code path).
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: `e2e-${unique()}.png`,
      mimeType: "image/png",
      buffer: png,
    });
  await expect(page.getByText(t("admin.media.phase.ready"))).toBeVisible({ timeout: 60_000 });

  const grid = page
    .getByRole("list")
    .filter({ has: page.getByRole("button") })
    .last();
  await grid.getByRole("button").first().click();
  const drawer = page.locator("dialog[open]").first();
  await expect(drawer).toBeVisible();
  await drawer.getByLabel(new RegExp(`^${t("admin.media.field.altAr")}`)).fill("صورة اختبار");
  // The focal point moves with the arrow keys.
  const marker = drawer.getByRole("button", { name: /نقطة التركيز/ });
  await marker.focus();
  await page.keyboard.press("ArrowRight");
  await drawer.getByRole("button", { name: t("common.save") }).click();
  await expect(page.getByText(t("admin.media.saved"))).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test("review inbox and calendar load and are accessible", async ({ page, urls, redis }) => {
  await signedInSuperAdmin(page, urls, redis);

  await page.goto("/admin/content/review");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("admin.nav.content.review"));
  await expectNoSidewaysScroll(page);
  await expectAccessible(page, "/admin/content/review");
  const inbox = await adminGet<{ items: unknown[] }>(page, urls, "/admin/content/review-inbox");
  expect(Array.isArray(inbox.items)).toBe(true);

  await page.goto("/admin/content/calendar");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("admin.nav.content.calendar"));
  await expectNoSidewaysScroll(page);
  await expectAccessible(page, "/admin/content/calendar");
  await page.getByRole("button", { name: t("admin.content.calendar.next") }).click();
  await expect(page).toHaveURL(/month=/);

  for (const path of ["/admin/content/people", "/admin/content/redirects"]) {
    await page.goto(path);
    await expectNoSidewaysScroll(page);
    await expectAccessible(page, path);
  }
});
