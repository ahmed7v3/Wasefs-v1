import { randomUUID } from "node:crypto";

import {
  contentCategories,
  contentItemTags,
  contentItems,
  contentPeople,
  contentRevisions,
  contentTags,
  slugRedirects,
} from "@wasfa/db";
import { signPreviewToken } from "@wasfa/shared/content/preview-token";
import {
  publicGlossaryIndexSchema,
  publicListResponseSchema,
  publicPathStateSchema,
  publicPreviewResponseSchema,
  publicResolveResponseSchema,
  publicSitemapResponseSchema,
  publicTaxonomyListSchema,
  publicTaxonomyPageSchema,
} from "@wasfa/shared/schemas/content";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PublicContentController } from "../src/content/public/public-content.controller.js";

import { AdminTestContext } from "./support/admin-context.js";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/*
 * The public content read API against Postgres and the real app: published vs draft vs archived,
 * redirects and 410s, twins, taxonomy rules, sitemap, and the preview-token flow. Rows are seeded
 * straight through the owner connection (the admin API is another slice).
 */

const SECRET = "p".repeat(48);
const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start([], {
    CONTENT_PREVIEW_SECRET: SECRET,
    MEDIA_PUBLIC_ORIGIN: "https://media.test",
  });
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

beforeEach(async () => {
  const { db } = ctx.owner;
  await db.delete(slugRedirects);
  // Items and revisions are never deleted (append-only, FK-restricted): tests seed fresh random slugs.
});

interface SeedOptions {
  type?: ContentType;
  locale?: ContentLocale;
  slug: string;
  status?: "draft" | "published" | "archived";
  live?: boolean;
  groupId?: string;
  categoryId?: string | null;
  authorId?: string | null;
  seo?: Record<string, unknown>;
  firstPublished?: boolean;
  archivedRedirectTo?: string | null;
  title?: string;
}

/** Inserts an item with one revision; `live` points `published_revision_id` at it. */
async function seed(options: SeedOptions) {
  const itemId = randomUUID();
  const revisionId = randomUUID();
  const status = options.status ?? "published";
  const live = options.live ?? status === "published";
  const now = new Date();
  await ctx.owner.db.transaction(async (tx) => {
    await tx.insert(contentItems).values({
      id: itemId,
      type: options.type ?? "article",
      locale: options.locale ?? "ar",
      translationGroupId: options.groupId ?? randomUUID(),
      slug: options.slug,
      status,
      title: options.title ?? `title ${options.slug}`,
      categoryId: options.categoryId ?? null,
      primaryAuthorId: options.authorId ?? null,
      seo: options.seo ?? {},
      currentRevisionId: revisionId,
      publishedRevisionId: live ? revisionId : null,
      publishedAt: live ? now : null,
      firstPublishedAt: live || options.firstPublished ? now : null,
      contentUpdatedAt: now,
      archivedRedirectTo: options.archivedRedirectTo ?? null,
    });
    await tx.insert(contentRevisions).values({
      id: revisionId,
      itemId,
      number: 1,
      kind: "create",
      title: options.title ?? `title ${options.slug}`,
      excerpt: "excerpt",
      bodyMd: "SECRET-BODY-MD",
      bodyHtml: "<p>hello</p>",
      createdByName: "tester",
    });
  });
  return { itemId, revisionId };
}

const get = (url: string) => ctx.harness.call("GET", url);
const unique = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

describe("resolve", () => {
  it("serves a published item with cache headers and never leaks internals", async () => {
    const slug = unique("pub");
    await seed({ slug });
    const res = await get(`/public/content/resolve?type=article&locale=ar&slug=${slug}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=30, stale-while-revalidate=300");
    const body = publicResolveResponseSchema.parse(res.json());
    expect(body.kind).toBe("item");
    expect(res.body).not.toContain("SECRET-BODY-MD");
    expect(res.body).not.toMatch(/apiKeyId|bodyMd/);
  });

  it("never serves a draft, and answers not_found for unknown or never-published archives", async () => {
    const draft = unique("draft");
    const archived = unique("never");
    await seed({ slug: draft, status: "draft" });
    await seed({ slug: archived, status: "archived", live: false });
    for (const slug of [draft, archived, unique("missing")]) {
      const res = await get(`/public/content/resolve?type=article&locale=ar&slug=${slug}`);
      expect(publicResolveResponseSchema.parse(res.json())).toEqual({ kind: "not_found" });
    }
  });

  it("answers redirect for a slug_redirects row and gone for a once-published archive", async () => {
    const moved = unique("old");
    await ctx.owner.db
      .insert(slugRedirects)
      .values({ fromPath: `/blog/${moved}`, toPath: "/blog/new-home", reason: "slug_changed" });
    expect(
      (await get(`/public/content/resolve?type=article&locale=ar&slug=${moved}`)).json(),
    ).toEqual({ kind: "redirect", to: "/blog/new-home" });

    const gone = unique("gone");
    await seed({ slug: gone, status: "archived", live: false, firstPublished: true });
    expect(
      (await get(`/public/content/resolve?type=article&locale=ar&slug=${gone}`)).json(),
    ).toEqual({ kind: "gone" });
  });

  it("lists only published twins as alternates", async () => {
    const groupId = randomUUID();
    const slug = unique("twin");
    await seed({ slug, groupId });
    await seed({ slug: `${slug}-en`, locale: "en", groupId, status: "draft" });
    let res = await get(`/public/content/resolve?type=article&locale=ar&slug=${slug}`);
    let body = publicResolveResponseSchema.parse(res.json());
    expect(body.kind === "item" && body.item.alternates).toEqual({
      ar: `/blog/${slug}`,
      en: null,
    });

    await ctx.owner.db
      .update(contentItems)
      .set({ status: "published", publishedRevisionId: contentItems.currentRevisionId })
      .where(eq(contentItems.slug, `${slug}-en`));
    res = await get(`/public/content/resolve?type=article&locale=ar&slug=${slug}`);
    body = publicResolveResponseSchema.parse(res.json());
    expect(body.kind === "item" && body.item.alternates.en).toBe(`/en/blog/${slug}-en`);
  });

  it("validates the query and carries a rate limit on every route", async () => {
    expect((await get("/public/content/resolve?type=nope&locale=ar&slug=x")).statusCode).toBe(400);
    const proto = PublicContentController.prototype;
    for (const name of [
      "resolve",
      "list",
      "taxonomyPage",
      "taxonomyList",
      "glossaryIndex",
      "pathState",
      "sitemap",
      "preview",
    ] as const) {
      const config = Reflect.getMetadata("__fastify_route_config__", proto[name]) as {
        rateLimit?: { max: number };
      };
      expect(config.rateLimit?.max, name).toBe(name === "preview" ? 60 : 240);
    }
  });
});

describe("list, taxonomy, glossary", () => {
  it("lists published items only, newest first, filtered by category", async () => {
    const categoryId = randomUUID();
    const catSlug = unique("cat");
    await ctx.owner.db
      .insert(contentCategories)
      .values({ id: categoryId, slugAr: catSlug, nameAr: "تصنيف", descriptionAr: "وصف" });
    const a = unique("la");
    const b = unique("lb");
    const hidden = unique("lc");
    await seed({ slug: a, categoryId });
    await seed({ slug: b, categoryId });
    await seed({ slug: hidden, categoryId, status: "draft" });
    const res = await get(
      `/public/content/list?type=article&locale=ar&categorySlug=${catSlug}&pageSize=12`,
    );
    const body = publicListResponseSchema.parse(res.json());
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.slug)).toEqual([b, a]);
    expect(JSON.stringify(body)).not.toContain(hidden);

    const page = publicTaxonomyPageSchema.parse(
      (await get(`/public/content/taxonomy-page?kind=category&locale=ar&slug=${catSlug}`)).json(),
    );
    expect(page).toMatchObject({ indexable: true, itemCount: 2 });
    expect(
      (await get(`/public/content/taxonomy-page?kind=category&locale=en&slug=${catSlug}`))
        .statusCode,
    ).toBe(404);
    const list = publicTaxonomyListSchema.parse(
      (await get("/public/content/taxonomy-list?kind=category&locale=ar")).json(),
    );
    expect(list.items.find((i) => i.slug === catSlug)?.itemCount).toBe(2);
  });

  it("makes a tag indexable only from 5 published items", async () => {
    const tagId = randomUUID();
    const tagSlug = unique("tag");
    await ctx.owner.db
      .insert(contentTags)
      .values({ id: tagId, slugAr: tagSlug, nameAr: "وسم", descriptionAr: "مقدمة الوسم" });
    for (let i = 0; i < 5; i++) {
      const { itemId } = await seed({ slug: unique("t") });
      await ctx.owner.db.insert(contentItemTags).values({ itemId, tagId });
      if (i === 3) {
        const page = publicTaxonomyPageSchema.parse(
          (await get(`/public/content/taxonomy-page?kind=tag&locale=ar&slug=${tagSlug}`)).json(),
        );
        expect(page).toMatchObject({ itemCount: 4, indexable: false });
      }
    }
    const page = publicTaxonomyPageSchema.parse(
      (await get(`/public/content/taxonomy-page?kind=tag&locale=ar&slug=${tagSlug}`)).json(),
    );
    expect(page).toMatchObject({ itemCount: 5, indexable: true });
  });

  it("404s an inactive author and serves an active one with bio HTML", async () => {
    const active = unique("auth");
    const inactive = unique("off");
    await ctx.owner.db.insert(contentPeople).values([
      { slug: active, nameAr: "كاتب", role: "author", bioMdAr: "**bio**", credentialsAr: "صيدلي" },
      { slug: inactive, nameAr: "متوقف", role: "author", active: false },
    ]);
    const page = publicTaxonomyPageSchema.parse(
      (await get(`/public/content/taxonomy-page?kind=author&locale=ar&slug=${active}`)).json(),
    );
    expect(page.person?.bioHtml).toContain("<strong>bio</strong>");
    expect(page.indexable).toBe(true);
    expect(
      (await get(`/public/content/taxonomy-page?kind=author&locale=ar&slug=${inactive}`))
        .statusCode,
    ).toBe(404);
  });

  it("serves the glossary index with definitions", async () => {
    const slug = unique("term");
    await seed({ slug, type: "glossary" });
    const body = publicGlossaryIndexSchema.parse(
      (await get("/public/content/glossary-index?locale=ar")).json(),
    );
    expect(body.items.some((i) => i.slug === slug && i.path === `/glossary/${slug}`)).toBe(true);
  });
});

describe("path-state and sitemap", () => {
  it("lists redirects and gone paths, but not gone paths that a redirect covers", async () => {
    const gone = unique("g");
    const covered = unique("c");
    await seed({ slug: gone, status: "archived", live: false, firstPublished: true });
    await seed({ slug: covered, status: "archived", live: false, firstPublished: true });
    await ctx.owner.db
      .insert(slugRedirects)
      .values({ fromPath: `/blog/${covered}`, toPath: "/blog", reason: "archived" });
    const state = publicPathStateSchema.parse((await get("/public/content/path-state")).json());
    expect(state.gone).toContain(`/blog/${gone}`);
    expect(state.gone).not.toContain(`/blog/${covered}`);
    expect(state.redirects[`/blog/${covered}`]).toBe("/blog");
  });

  it("lists indexable published items only, with lastmod from content_updated_at", async () => {
    const shown = unique("sm");
    const noindex = unique("ni");
    const draft = unique("sd");
    await seed({ slug: shown });
    await seed({ slug: noindex, seo: { robots: "noindex" } });
    await seed({ slug: draft, status: "draft" });
    const res = await get("/public/content/sitemap?kind=article&locale=ar&page=1");
    expect(res.headers["cache-control"]).toContain("max-age=30");
    const body = publicSitemapResponseSchema.parse(res.json());
    const paths = body.urls.map((u) => u.path);
    expect(paths).toContain(`/blog/${shown}`);
    expect(paths).not.toContain(`/blog/${noindex}`);
    expect(paths).not.toContain(`/blog/${draft}`);
  });
});

describe("preview", () => {
  const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s;

  it("renders a draft for a valid token, with no-store and noindex headers", async () => {
    const { itemId } = await seed({ slug: unique("pv"), status: "draft" });
    const token = signPreviewToken(SECRET, { itemId, expiresAt: inSeconds(600) });
    const res = await get(`/public/content/preview/${token}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
    expect(publicPreviewResponseSchema.parse(res.json()).isDraft).toBe(true);
  });

  it("answers 404 for expired, tampered, foreign-secret and unknown-item tokens", async () => {
    const { itemId } = await seed({ slug: unique("pv2"), status: "draft" });
    const expired = signPreviewToken(SECRET, { itemId, expiresAt: inSeconds(-5) });
    const good = signPreviewToken(SECRET, { itemId, expiresAt: inSeconds(600) });
    const tampered = `${good[0] === "A" ? "B" : "A"}${good.slice(1)}`;
    const foreign = signPreviewToken("q".repeat(48), { itemId, expiresAt: inSeconds(600) });
    const unknown = signPreviewToken(SECRET, { itemId: randomUUID(), expiresAt: inSeconds(600) });
    for (const token of [expired, tampered, foreign, unknown]) {
      expect((await get(`/public/content/preview/${token}`)).statusCode).toBe(404);
    }
  });

  it("answers 404 when no preview secret is configured", async () => {
    const { itemId } = await seed({ slug: unique("pv3"), status: "draft" });
    const token = signPreviewToken(SECRET, { itemId, expiresAt: inSeconds(600) });
    const env = ctx.env as { CONTENT_PREVIEW_SECRET?: string | undefined };
    env.CONTENT_PREVIEW_SECRET = undefined;
    try {
      expect((await get(`/public/content/preview/${token}`)).statusCode).toBe(404);
    } finally {
      env.CONTENT_PREVIEW_SECRET = SECRET;
    }
  });
});
