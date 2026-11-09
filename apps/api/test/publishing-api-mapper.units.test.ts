import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  publishingArticleInputSchema,
  publishingArticlePatchSchema,
} from "@wasfa/shared/schemas/publishing";
import { describe, expect, it } from "vitest";

import { apiActorFor, canPublishNow } from "../src/publishing/publishing-api-actor.js";
import {
  assertPrincipalAllows,
  assertSameIdentity,
  mapCreate,
  mapMediaMeta,
  mapPatch,
  putAsPatch,
} from "../src/publishing/publishing-api-mapper.js";

import type { PublishingPrincipal } from "../src/publishing/publishing-principal.js";

const principal = (over: Partial<PublishingPrincipal> = {}): PublishingPrincipal => ({
  keyId: "018f0000-0000-7000-8000-0000000000aa",
  keyName: "Agent",
  ownerUserId: "018f0000-0000-7000-8000-0000000000bb",
  scopes: ["content:read", "content:write", "content:publish"],
  canPublish: true,
  allowedTypes: [],
  allowedCategorySlugs: [],
  defaultAuthorId: null,
  defaultFeaturedMediaId: null,
  dailyPublishCap: null,
  requestsPerMinute: 60,
  ...over,
});

const article = {
  type: "article",
  locale: "ar",
  title: "كيف تتناول المضاد الحيوي بطريقة صحيحة",
  slug: "taking-antibiotics-correctly",
  excerpt: "خطوات بسيطة تساعدك على الالتزام بمواعيد المضاد الحيوي ومدته كما وصفها الطبيب.",
  body_markdown: "## لماذا\n\nنص المقال.\n",
  sources: [{ title: "WHO fact sheet", url: "https://www.who.int/x" }],
} as const;
const parse = (extra: Record<string, unknown> = {}) =>
  publishingArticleInputSchema.parse({ ...article, ...extra });

const medicalRefs = {
  categoryId: "cat-1",
  categorySlug: "medicines-basics",
  categoryRequiresReview: true,
};

describe("mapCreate", () => {
  it("maps snake_case input onto the content platform's create shape", () => {
    const mapped = mapCreate(
      parse({
        category: "medicines-basics",
        seo: { description: "وصف", focus_keyword: "مضاد حيوي", robots: "noindex" },
        ai_assisted: true,
        flags: { show_toc: true },
        external_id: "kb-1",
      }),
      { ...medicalRefs, tagIds: ["t1"], authorId: "p1", reviewerId: "p2" },
      principal(),
    );
    expect(mapped.externalId).toBe("kb-1");
    expect(mapped.requiresReview).toBe(true);
    expect(mapped.create).toMatchObject({
      type: "article",
      locale: "ar",
      payload: { title: article.title, excerpt: article.excerpt },
      meta: {
        slug: "taking-antibiotics-correctly",
        categoryId: "cat-1",
        tagIds: ["t1"],
        primaryAuthorId: "p1",
        reviewerId: "p2",
        seo: { description: "وصف", focusKeyword: "مضاد حيوي", robots: "noindex" },
        flags: { aiAssisted: true, showToc: true, autoLink: true },
      },
    });
    // ai_assisted maps onto the existing flag; sources become the references list.
    expect(mapped.create.payload.bodyMd).toContain("## المصادر / Sources");
    expect(mapped.create.payload.bodyMd).toContain("[WHO fact sheet](https://www.who.int/x)");
  });

  it("falls back to the key's default author and featured image, and says so", () => {
    const mapped = mapCreate(
      parse(),
      { ...medicalRefs },
      principal({ defaultAuthorId: "author-1", defaultFeaturedMediaId: "media-1" }),
    );
    expect(mapped.create.meta).toMatchObject({
      primaryAuthorId: "author-1",
      featuredMediaId: "media-1",
    });
    expect(mapped.notes.join(" ")).toMatch(/default author/);
    expect(mapped.notes.join(" ")).toMatch(/default featured image/);
  });

  it("the request's own author and image win over the key defaults", () => {
    const mapped = mapCreate(
      parse({ featured_media_id: "018f0000-0000-7000-8000-0000000000cc" }),
      { ...medicalRefs, authorId: "mine" },
      principal({ defaultAuthorId: "author-1", defaultFeaturedMediaId: "media-1" }),
    );
    expect(mapped.create.meta.primaryAuthorId).toBe("mine");
    expect(mapped.create.meta.featuredMediaId).toBe("018f0000-0000-7000-8000-0000000000cc");
  });

  it("requires a source for categories that need medical review", () => {
    expect(() =>
      mapCreate(parse({ sources: undefined }), { ...medicalRefs }, principal()),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
  });

  it("does not require sources for a category that needs no review", () => {
    const mapped = mapCreate(
      parse({ sources: undefined }),
      { categoryId: "c", categorySlug: "news", categoryRequiresReview: false },
      principal(),
    );
    expect(mapped.requiresReview).toBe(false);
  });

  it("guides always need sources: a type with mandatory review", () => {
    expect(() =>
      mapCreate(
        parse({ type: "guide", sources: undefined }),
        { categoryRequiresReview: false },
        principal(),
      ),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
  });

  it("ignores canonical_url (v1) with a note", () => {
    const mapped = mapCreate(
      parse({ seo: { canonical_url: "https://elsewhere.example/x" } }),
      { ...medicalRefs },
      principal(),
    );
    expect(mapped.create.meta.seo.canonical).toBe("");
    expect(mapped.notes.join(" ")).toMatch(/canonical_url was ignored/);
  });
});

describe("principal restrictions", () => {
  it("allowedTypes: a type outside the list is FORBIDDEN", () => {
    const restricted = principal({ allowedTypes: ["glossary"] });
    expect(() => mapCreate(parse(), { ...medicalRefs }, restricted)).toThrowError(
      expect.objectContaining({
        code: ErrorCode.FORBIDDEN,
        details: { reason: "type_not_allowed" },
      }),
    );
  });

  it("allowedCategorySlugs: another category, or none at all, is FORBIDDEN", () => {
    const restricted = principal({ allowedCategorySlugs: ["nutrition"] });
    expect(() => mapCreate(parse(), { ...medicalRefs }, restricted)).toThrowError(
      expect.objectContaining({
        code: ErrorCode.FORBIDDEN,
        details: { reason: "category_not_allowed" },
      }),
    );
    expect(() => mapCreate(parse(), { categoryRequiresReview: null }, restricted)).toThrowError(
      expect.objectContaining({ code: ErrorCode.FORBIDDEN }),
    );
    expect(() =>
      mapCreate(
        parse(),
        { categoryId: "c", categorySlug: "nutrition", categoryRequiresReview: true },
        restricted,
      ),
    ).not.toThrow();
  });

  it("an unrestricted key may use any type and category", () => {
    expect(() =>
      assertPrincipalAllows(principal(), { type: "guide", categorySlug: null }),
    ).not.toThrow();
  });

  it("a patch is checked against the category the item has (or moves to)", () => {
    const restricted = principal({ allowedCategorySlugs: ["nutrition"] });
    const existing = { type: "article" as const, bodyMd: "x", categorySlug: "nutrition" };
    expect(() =>
      mapPatch(
        { title: "عنوان جديد للمقال" },
        { categoryRequiresReview: false },
        restricted,
        existing,
      ),
    ).not.toThrow();
    expect(() =>
      mapPatch(
        { category: "other" },
        { categoryId: "c2", categorySlug: "other", categoryRequiresReview: false },
        restricted,
        existing,
      ),
    ).toThrowError(expect.objectContaining({ code: ErrorCode.FORBIDDEN }));
  });
});

describe("mapPatch (JSON Merge Patch)", () => {
  const existing = {
    type: "article" as const,
    bodyMd: "old body\n\n## المصادر / Sources\n\n1. [WHO](https://www.who.int/x)\n",
    categorySlug: "medicines-basics",
  };
  const refs = { categoryRequiresReview: true };

  it("absent keys stay untouched, present ones replace, null clears", () => {
    const patch = publishingArticlePatchSchema.parse({
      excerpt: "ملخص جديد للمقال يحتوي على وصف كامل لما يتناوله النص بوضوح تام.",
      featured_media_id: null,
      seo: { description: null, focus_keyword: "كلمة" },
    });
    const mapped = mapPatch(patch, refs, principal(), existing);
    expect(mapped.payload).toEqual({ excerpt: patch.excerpt });
    expect(mapped.meta).toEqual({
      featuredMediaId: null,
      seo: { description: "", focusKeyword: "كلمة" },
    });
  });

  it("a body-only patch keeps the references already in the body", () => {
    const mapped = mapPatch({ body_markdown: "new body" }, refs, principal(), existing);
    expect(mapped.payload?.bodyMd).toContain("new body");
    expect(mapped.payload?.bodyMd).toContain("1. [WHO](https://www.who.int/x)");
  });

  it("a patch that touches neither body nor sources is not blocked by an old item's missing sources", () => {
    const noSources = { ...existing, bodyMd: "body without references" };
    expect(() => mapPatch({ ai_assisted: true }, refs, principal(), noSources)).not.toThrow();
  });

  it("clearing the sources of a medical item is refused", () => {
    expect(() => mapPatch({ sources: [] }, refs, principal(), existing)).toThrowError(
      expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }),
    );
  });
});

describe("putAsPatch and identity", () => {
  it("only fields the PUT body names become part of the patch", () => {
    const patch = putAsPatch(parse({ tags: ["a"] }));
    expect(Object.keys(patch).sort()).toEqual(
      ["body_markdown", "desired_status", "excerpt", "slug", "sources", "tags", "title"].sort(),
    );
  });

  it("type and locale cannot change", () => {
    expect(() =>
      assertSameIdentity({ type: "article", locale: "ar" }, { type: "guide", locale: "ar" }),
    ).toThrow(AppError);
    expect(() =>
      assertSameIdentity({ type: "article", locale: "ar" }, { type: "article", locale: "ar" }),
    ).not.toThrow();
  });
});

describe("the API actor", () => {
  it("is never the owner and never a reviewer, whatever the scopes", () => {
    const actor = apiActorFor(principal());
    expect(actor.isOwner).toBe(false);
    expect(actor.isActiveReviewer).toBe(false);
    expect(actor.permissions.has("content.review")).toBe(false);
    expect(actor.permissions.has("content.manage")).toBe(false);
    expect(actor.machine).toMatchObject({
      type: "api_key",
      keyId: "018f0000-0000-7000-8000-0000000000aa",
    });
  });

  it("content.publish needs can_publish AND the content:publish scope", () => {
    expect(apiActorFor(principal()).permissions.has("content.publish")).toBe(true);
    expect(apiActorFor(principal({ canPublish: false })).permissions.has("content.publish")).toBe(
      false,
    );
    expect(
      apiActorFor(principal({ scopes: ["content:write"] })).permissions.has("content.publish"),
    ).toBe(false);
    expect(canPublishNow(principal({ scopes: ["content:write"] }))).toBe(false);
  });

  it("content.manage only when explicitly granted (archive of the key's own item)", () => {
    expect(apiActorFor(principal(), ["content.manage"]).permissions.has("content.manage")).toBe(
      true,
    );
  });
});

describe("mapMediaMeta", () => {
  it("maps alt, credit, licence and the focal point onto the library's patch", () => {
    expect(
      mapMediaMeta({
        alt: "علبة دواء",
        caption: "c",
        credit: "me",
        licence: "cc-by",
        licence_ref: "ref",
        filename_hint: "cover-image",
        focal_point: { x: 0.25, y: 0.755 },
      }),
    ).toEqual({
      altAr: "علبة دواء",
      caption: "c",
      credit: "me",
      licence: "cc-by",
      licenceRef: "ref",
      seoFilename: "cover-image",
      focalX: 25,
      focalY: 76,
    });
  });

  it("a Latin alt doubles as the English alt unless one is given", () => {
    expect(mapMediaMeta({ alt: "A medicine box" })).toEqual({
      altAr: "A medicine box",
      altEn: "A medicine box",
    });
    expect(mapMediaMeta({ alt: "A medicine box", alt_en: "Box" })).toMatchObject({ altEn: "Box" });
  });
});
