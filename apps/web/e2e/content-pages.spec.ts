import { adminGet, createAdminLogin, signInThroughUi } from "./support/admin-billing";
import { expectAccessible } from "./support/axe";
import { createReadyMedia, sendJson, wordsOf } from "./support/content";
import { expect, test } from "./support/fixtures";
import { stackUrls } from "./support/runtime";

import type { Page } from "@playwright/test";

// Public content templates (WP3): axe on the blog, guides, glossary and author pages in both languages and
// a no-horizontal-overflow check. They need published content: the suite publishes its own (an article, a
// guide and a glossary term in Arabic and English, one author) before the first test. Set
// `E2E_CONTENT_SEEDED=1` to run against a stack that already has content at the slugs below instead
// (override them with the E2E_CONTENT_* variables).

const ARTICLE = process.env["E2E_CONTENT_ARTICLE"] ?? "how-to-read-a-prescription";
const GUIDE = process.env["E2E_CONTENT_GUIDE"] ?? "prescription-guide";
const GLOSSARY = process.env["E2E_CONTENT_GLOSSARY"] ?? "bid";
const AUTHOR = process.env["E2E_CONTENT_AUTHOR"] ?? "editorial-team";

const PATHS = [
  "/blog",
  `/blog/${ARTICLE}`,
  "/guides",
  `/guides/${GUIDE}`,
  "/glossary",
  `/glossary/${GLOSSARY}`,
  `/authors/${AUTHOR}`,
];

interface Created {
  id: string;
}

const SEED_TYPES = [
  { type: "article", slug: ARTICLE, words: 650, needsTaxonomy: true, needsReview: false },
  { type: "guide", slug: GUIDE, words: 1_250, needsTaxonomy: true, needsReview: true },
  { type: "glossary", slug: GLOSSARY, words: 90, needsTaxonomy: false, needsReview: true },
] as const;

/** Publishes one item per type in both languages: the Arabic original, then its English twin. */
async function seedContent(page: Page, reviewer: Page): Promise<void> {
  const urls = stackUrls("default");
  const category = await sendJson<Created>(page, urls, "POST", "/admin/content/categories", {
    slugAr: "e2e-health",
    slugEn: "e2e-health",
    nameAr: "صحة الاختبار",
    nameEn: "Test health",
    // Articles of this category skip review; guides and glossary entries always need it.
    requiresMedicalReview: false,
  });
  const author = await sendJson<Created>(page, urls, "POST", "/admin/content/people", {
    slug: AUTHOR,
    nameAr: "فريق التحرير",
    nameEn: "Editorial team",
    role: "author",
  });
  const mediaId = await createReadyMedia(page, urls);

  for (const { type, slug, words, needsTaxonomy, needsReview } of SEED_TYPES) {
    let arabicId: string | null = null;
    for (const locale of ["ar", "en"] as const) {
      const tag = `${type}${locale}`;
      const body = `## ${locale === "ar" ? "المقدمة" : "Introduction"}

${wordsOf(tag, words)}`;
      const created: Created = await sendJson<Created>(page, urls, "POST", "/admin/content/items", {
        type,
        locale,
        ...(arabicId ? { translationOf: arabicId } : {}),
        payload: {
          title: locale === "ar" ? `عنوان ${type} للاختبار` : `Test ${type} title`,
          excerpt: `${tag} excerpt`,
          definition: type === "glossary" ? `${tag} definition` : "",
          bodyMd: body,
        },
        meta: {
          slug,
          primaryAuthorId: author.id,
          seo: { description: `${tag} description for the e2e content seed` },
          ...(needsTaxonomy ? { categoryId: category.id, featuredMediaId: mediaId } : {}),
        },
      });
      if (locale === "ar") arabicId = created.id;
      const act = (who: Page, action: string) =>
        sendJson(who, urls, "POST", `/admin/content/items/${created.id}/actions/${action}`, {});
      if (needsReview) {
        // Four eyes: the second account (with a reviewer profile) approves what the first submitted.
        await act(page, "submit");
        await act(reviewer, "approve");
      }
      await act(page, "publish");
    }
  }
}

test.beforeAll(async ({ browser, redis }) => {
  if (process.env["E2E_CONTENT_SEEDED"] === "1") return;
  test.setTimeout(300_000);
  const urls = stackUrls("default");
  const context = await browser.newContext({ baseURL: urls.web, locale: "ar" });
  try {
    const login = await createAdminLogin(context, urls, redis, {
      label: "Content seeder",
      superAdmin: true,
    });
    const page = await context.newPage();
    await signInThroughUi(page, login);

    const reviewerContext = await browser.newContext({ baseURL: urls.web, locale: "ar" });
    try {
      const reviewerLogin = await createAdminLogin(reviewerContext, urls, redis, {
        label: "Content reviewer",
        superAdmin: true,
      });
      const reviewer = await reviewerContext.newPage();
      await signInThroughUi(reviewer, reviewerLogin);
      const me = await adminGet<{ id: string }>(reviewer, urls, "/me");
      await sendJson(reviewer, urls, "POST", "/admin/content/people", {
        slug: `reviewer-${me.id.slice(-8)}`,
        nameAr: "مراجع",
        role: "reviewer",
        userId: me.id,
      });
      await seedContent(page, reviewer);
    } finally {
      await reviewerContext.close();
    }
  } finally {
    await context.close();
  }
});

for (const prefix of ["", "/en"]) {
  for (const path of PATHS) {
    test(`${prefix}${path} is accessible and does not overflow`, async ({ page }) => {
      const response = await page.goto(`${prefix}${path}`);
      // The English twin of a seeded Arabic-only item legitimately 404s; only assert pages that exist.
      test.skip(response?.status() === 404, "no content at this path in this locale");
      expect(response?.status()).toBe(200);
      await expectAccessible(page, `${prefix}${path}`);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
