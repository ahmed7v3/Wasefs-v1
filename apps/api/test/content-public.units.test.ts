import { signPreviewToken } from "@wasfa/shared/content/preview-token";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import {
  publicItemSchema,
  publicPathStateSchema,
  publicPreviewResponseSchema,
  publicResolveResponseSchema,
  publicSitemapResponseSchema,
  publicTaxonomyPageSchema,
} from "@wasfa/shared/schemas/content";
import { describe, expect, it } from "vitest";

import {
  alternatesOf,
  authorIndexable,
  canonicalOf,
  largestJpegUrl,
  pickRelated,
  publicImage,
  shapePathState,
  sitemapEntry,
  tagIndexable,
  toCard,
  toItem,
} from "../src/content/public/public-content.mapper.js";
import { PublicContentService } from "../src/content/public/public-content.service.js";

import type { PublicContentStore } from "../src/content/public/public-content.repo.js";
import type {
  CategoryRow,
  ItemParts,
  ItemRow,
  MediaRow,
  PersonRow,
  RelatedCandidate,
  TagRow,
} from "../src/content/public/public-content.types.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");
const T2 = new Date("2026-03-01T00:00:00Z");

function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: uuid(1),
    type: "article",
    locale: "ar",
    translationGroupId: uuid(100),
    slug: "hello",
    status: "published",
    categoryId: null,
    primaryAuthorId: null,
    reviewerId: null,
    featuredMediaId: null,
    seo: {},
    flags: {},
    currentRevisionId: uuid(11),
    reviewedRevisionId: null,
    publishedRevisionId: uuid(11),
    reviewedAt: null,
    publishedAt: T1,
    firstPublishedAt: T0,
    contentUpdatedAt: T2,
    updatedAt: T2,
    archivedRedirectTo: null,
    ...over,
  };
}

const revision = (id = uuid(11)) => ({
  id,
  title: "عنوان",
  excerpt: "مقتطف",
  definition: "",
  bodyHtml: "<p>x</p>",
  toc: [{ id: "a", text: "A", level: 2 }],
  wordCount: 10,
  readingMinutes: 1,
  createdAt: T0,
});

const person = (over: Partial<PersonRow> = {}): PersonRow => ({
  id: uuid(50),
  slug: "dr-a",
  nameAr: "د. أحمد",
  nameEn: null,
  credentialsAr: "صيدلي",
  credentialsEn: "",
  licenceNumber: "L-1",
  showLicence: true,
  bioMdAr: "",
  bioMdEn: "",
  sameAs: [],
  photoMediaId: null,
  active: true,
  updatedAt: T0,
  ...over,
});

const category = (over: Partial<CategoryRow> = {}): CategoryRow => ({
  id: uuid(60),
  slugAr: "adwiya",
  slugEn: "drugs",
  nameAr: "أدوية",
  nameEn: "Drugs",
  descriptionAr: "وصف",
  descriptionEn: "",
  requiresMedicalReview: true,
  seoTitleAr: "",
  seoDescriptionAr: "",
  seoTitleEn: "",
  seoDescriptionEn: "",
  updatedAt: T0,
  ...over,
});

const tag = (over: Partial<TagRow> = {}): TagRow => ({
  id: uuid(70),
  slugAr: "wasm",
  slugEn: null,
  nameAr: "وسم",
  nameEn: null,
  descriptionAr: "مقدمة",
  descriptionEn: "",
  updatedAt: T0,
  ...over,
});

const media = (over: Partial<MediaRow> = {}): MediaRow => ({
  id: uuid(80),
  status: "ready",
  width: 1600,
  height: 900,
  focalX: 50,
  focalY: 50,
  altAr: "",
  altEn: "english alt",
  blurDataUrl: null,
  variants: [
    { format: "jpeg", width: 640, key: "media/aa/640.jpg", bytes: 10 },
    { format: "jpeg", width: 1280, key: "media/aa/1280.jpg", bytes: 20 },
    { format: "webp", width: 1600, key: "media/aa/1600.webp", bytes: 20 },
  ],
  caption: "cap",
  credit: null,
  ...over,
});

function parts(over: Partial<ItemParts> = {}): ItemParts {
  const base = item();
  return {
    item: base,
    revision: revision(),
    category: null,
    author: null,
    image: null,
    tags: [],
    authorPhoto: null,
    reviewer: null,
    reviewerPhoto: null,
    corrections: [],
    ogImage: null,
    twins: [],
    ...over,
  };
}

describe("mapper: card and item", () => {
  it("maps every field of a fully populated item and parses with the shared schema", () => {
    const full = parts({
      item: item({
        seo: { title: "SEO", description: "D", canonical: "/blog/other", ogTitle: "OG" },
        categoryId: uuid(60),
        reviewerId: uuid(51),
        reviewedRevisionId: uuid(11),
        reviewedAt: T1,
        featuredMediaId: uuid(80),
      }),
      category: category(),
      author: person(),
      image: media(),
      tags: [tag(), tag({ id: uuid(71), slugAr: null, slugEn: "only-en" })],
      reviewer: person({ id: uuid(51), slug: "dr-b" }),
      corrections: [
        { summary: "old", createdAt: T0 },
        { summary: "new", createdAt: T2 },
      ],
      twins: [{ type: "article", locale: "en", slug: "hello-en", publishedRevisionId: uuid(99) }],
    });
    const dto = toItem(full, [toCard(parts())]);
    expect(publicItemSchema.parse(dto)).toEqual(dto);
    expect(dto.path).toBe("/blog/hello");
    expect(dto.title).toBe("عنوان");
    expect(dto.category).toEqual({ slug: "adwiya", name: "أدوية", path: "/blog/c/adwiya" });
    expect(dto.tags).toEqual([{ slug: "wasm", name: "وسم", path: "/blog/t/wasm" }]);
    expect(dto.author).toMatchObject({ path: "/authors/dr-a", credentials: "صيدلي" });
    expect(dto.reviewer).toMatchObject({
      slug: "dr-b",
      licence: "L-1",
      reviewedAt: T1.toISOString(),
    });
    expect(dto.corrections.map((c) => c.summary)).toEqual(["new", "old"]);
    expect(dto.seo).toMatchObject({
      title: "SEO",
      description: "D",
      canonical: "/blog/other",
      ogTitle: "OG",
      ogDescription: "D",
      robots: "index",
    });
    expect(dto.seo.ogImage?.alt).toBe("english alt");
    expect(dto.alternates).toEqual({ ar: "/blog/hello", en: "/en/blog/hello-en" });
    expect(dto.related).toHaveLength(1);
    expect(dto.firstPublishedAt).toBe(T0.toISOString());
    expect(dto.contentUpdatedAt).toBe(T2.toISOString());
    expect(JSON.stringify(dto)).not.toMatch(/apiKey|bodyMd|body_md/);
  });

  it("falls back: seo title/description to the item, OG image to featured, null canonical", () => {
    const dto = toItem(parts({ image: media() }), []);
    expect(dto.seo.title).toBe("عنوان");
    expect(dto.seo.description).toBe("مقتطف");
    expect(dto.seo.canonical).toBeNull();
    expect(dto.seo.ogImage).not.toBeNull();
  });

  it("uses English text with an Arabic fallback and the other locale alt", () => {
    const en = item({ locale: "en", slug: "x" });
    const dto = toItem(
      parts({ item: en, author: person({ nameEn: "Dr A" }), category: category(), image: media() }),
      [],
    );
    expect(dto.path).toBe("/en/blog/x");
    expect(dto.author?.name).toBe("Dr A");
    expect(dto.author?.credentials).toBe("صيدلي");
    expect(dto.category?.path).toBe("/en/blog/c/drugs");
    // Arabic alt is empty, so Arabic locale falls back to the English alt.
    expect(publicImage(media(), "ar")?.alt).toBe("english alt");
    expect(publicImage(media({ altEn: null }), "en")?.alt).toBe("");
    expect(publicImage(media({ status: "processing" }), "en")).toBeNull();
  });

  it("drops a category without a slug for the locale", () => {
    const dto = toItem(
      parts({ item: item({ locale: "en" }), category: category({ slugEn: null }) }),
      [],
    );
    expect(dto.category).toBeNull();
  });

  describe("reviewer rule", () => {
    const base = {
      item: item({ reviewerId: uuid(51), reviewedAt: T1, reviewedRevisionId: uuid(11) }),
      reviewer: person({ id: uuid(51), showLicence: false }),
    };
    it("shows only when the reviewed revision is the served one", () => {
      expect(toItem(parts(base), []).reviewer).not.toBeNull();
      expect(toItem(parts(base), []).reviewer?.licence).toBeNull();
      const other = parts({ ...base, item: { ...base.item, reviewedRevisionId: uuid(12) } });
      expect(toItem(other, []).reviewer).toBeNull();
    });
    it("shows on a draft preview of the approved revision", () => {
      const draft = parts({
        ...base,
        item: { ...base.item, reviewedRevisionId: uuid(12), publishedRevisionId: uuid(11) },
        revision: revision(uuid(12)),
      });
      expect(toItem(draft, []).reviewer).not.toBeNull();
    });
    it("is hidden where review does not apply (page, or a category without review)", () => {
      expect(
        toItem(parts({ ...base, item: { ...base.item, type: "page" } }), []).reviewer,
      ).toBeNull();
      expect(
        toItem(parts({ ...base, category: category({ requiresMedicalReview: false }) }), [])
          .reviewer,
      ).toBeNull();
    });
  });

  it("lists alternates only for PUBLISHED twins and always the item itself", () => {
    const own = item();
    expect(
      alternatesOf(own, [{ type: "article", locale: "en", slug: "e", publishedRevisionId: null }]),
    ).toEqual({ ar: "/blog/hello", en: null });
    expect(alternatesOf(item({ type: "page", slug: "about" }), [])).toEqual({
      ar: "/about",
      en: null,
    });
  });

  it("accepts only site paths and https URLs as canonical", () => {
    expect(canonicalOf("/a/b")).toBe("/a/b");
    expect(canonicalOf("https://x.example/a")).toBe("https://x.example/a");
    expect(canonicalOf("http://x.example")).toBeNull();
    expect(canonicalOf("//evil.example")).toBeNull();
    expect(canonicalOf("javascript:alert(1)")).toBeNull();
  });
});

describe("related scoring", () => {
  const c = (n: number, over: Partial<RelatedCandidate> = {}): RelatedCandidate => ({
    id: uuid(n),
    publishedAt: new Date(2026, 0, n),
    sameCategory: false,
    sharedTags: 0,
    sharedEntities: 0,
    ...over,
  });
  it("weights entities 3, category 2, tags 1, then recency, and excludes the item", () => {
    const ids = pickRelated(
      [
        c(1, { sharedEntities: 5 }),
        c(2, { sharedEntities: 1 }), // 3
        c(3, { sameCategory: true, sharedTags: 1 }), // 3, newer than 2
        c(4, { sameCategory: true }), // 2
        c(5, { sharedTags: 1 }), // 1
        c(6),
      ],
      uuid(1),
    );
    expect(ids).toEqual([uuid(3), uuid(2), uuid(4), uuid(5)]);
  });
  it("fills with the newest when nothing scores", () => {
    expect(pickRelated([c(1), c(2), c(3)], uuid(9), 2)).toEqual([uuid(3), uuid(2)]);
  });
});

describe("taxonomy indexable rules", () => {
  it("tag needs 5 items AND a description", () => {
    expect(tagIndexable(tag(), "ar", 4)).toBe(false);
    expect(tagIndexable(tag(), "ar", 5)).toBe(true);
    expect(tagIndexable(tag({ descriptionAr: " " }), "ar", 9)).toBe(false);
    expect(tagIndexable(tag(), "en", 9)).toBe(false);
  });
  it("author needs to be active with credentials or a bio", () => {
    expect(authorIndexable(person(), "ar")).toBe(true);
    expect(authorIndexable(person({ credentialsAr: "", bioMdAr: "bio" }), "ar")).toBe(true);
    expect(authorIndexable(person({ credentialsAr: "" }), "ar")).toBe(false);
    expect(authorIndexable(person({ active: false }), "ar")).toBe(false);
  });
});

describe("path state and sitemap shaping", () => {
  it("keeps well-formed paths only", () => {
    const state = shapePathState(
      [
        { fromPath: "/a", toPath: "/b" },
        { fromPath: "/bad path", toPath: "/b" },
        { fromPath: "/c", toPath: "//evil.example" },
      ],
      ["/gone", "nope"],
    );
    expect(state).toEqual({ redirects: { "/a": "/b" }, gone: ["/gone"] });
    expect(publicPathStateSchema.parse(state)).toEqual(state);
  });
  it("builds sitemap entries from the largest JPEG under the media origin", () => {
    expect(largestJpegUrl(media(), "https://m.example/bucket/")).toBe(
      "https://m.example/bucket/media/aa/1280.jpg",
    );
    expect(largestJpegUrl(media(), undefined)).toBeNull();
    const entry = sitemapEntry(
      {
        path: "/blog/x",
        lastmod: T2,
        alternates: { ar: "/blog/x", en: null },
        image: media(),
        locale: "en",
      },
      "https://m.example",
    );
    expect(entry).toMatchObject({
      lastmod: T2.toISOString(),
      image: { url: "https://m.example/media/aa/1280.jpg", alt: "english alt" },
    });
    expect(publicSitemapResponseSchema.parse({ urls: [entry], hasMore: false }).urls).toHaveLength(
      1,
    );
  });
});

// --- service with a fake store --------------------------------------------------------------------

const SECRET = "s".repeat(40);

function fakeStore(over: Partial<PublicContentStore> = {}): PublicContentStore {
  const unused = () => Promise.reject(new Error("unexpected store call"));
  return {
    findItem: () => Promise.resolve(undefined),
    findItemById: () => Promise.resolve(undefined),
    redirectFor: () => Promise.resolve(null),
    itemParts: (it, revisionId) =>
      Promise.resolve(parts({ item: it, revision: revision(revisionId) })),
    cardsByIds: () => Promise.resolve([]),
    relatedCandidates: () => Promise.resolve([]),
    list: unused,
    findCategory: () => Promise.resolve(undefined),
    findTag: () => Promise.resolve(undefined),
    findAuthor: () => Promise.resolve(undefined),
    countPublished: () => Promise.resolve(0),
    listCategories: unused,
    listTags: unused,
    listAuthors: unused,
    glossaryIndex: unused,
    redirects: () => Promise.resolve([]),
    gonePaths: () => Promise.resolve([]),
    sitemapItems: () => Promise.resolve([]),
    publishedTwins: () => Promise.resolve([]),
    ...over,
  };
}

const service = (store: PublicContentStore, secret: string | null = SECRET) =>
  new PublicContentService(store, {
    MEDIA_PUBLIC_ORIGIN: "https://m.example",
    CONTENT_PREVIEW_SECRET: secret ?? undefined,
  });

describe("resolve decision table", () => {
  const q = { type: "article", locale: "ar", slug: "hello" } as const;

  it("serves a published item", async () => {
    const svc = service(fakeStore({ findItem: () => Promise.resolve(item()) }));
    const res = publicResolveResponseSchema.parse(await svc.resolve(q));
    expect(res.kind).toBe("item");
  });
  it("redirects when a slug_redirects row matches", async () => {
    let asked = "";
    const svc = service(
      fakeStore({
        redirectFor: (path) => {
          asked = path;
          return Promise.resolve("/blog/new");
        },
      }),
    );
    expect(await svc.resolve(q)).toEqual({ kind: "redirect", to: "/blog/new" });
    expect(asked).toBe("/blog/hello");
  });
  it("answers gone for an archived, once-published item without redirect", async () => {
    const archived = item({ status: "archived", publishedRevisionId: null });
    const svc = service(fakeStore({ findItem: () => Promise.resolve(archived) }));
    expect(await svc.resolve(q)).toEqual({ kind: "gone" });
  });
  it("answers not_found for a never-published archive, a draft, and unknown slugs", async () => {
    const never = item({ status: "archived", publishedRevisionId: null, firstPublishedAt: null });
    expect(await service(fakeStore({ findItem: () => Promise.resolve(never) })).resolve(q)).toEqual(
      {
        kind: "not_found",
      },
    );
    const draft = item({ status: "draft", publishedRevisionId: null });
    expect(await service(fakeStore({ findItem: () => Promise.resolve(draft) })).resolve(q)).toEqual(
      {
        kind: "not_found",
      },
    );
    expect(await service(fakeStore()).resolve(q)).toEqual({ kind: "not_found" });
  });
  it("normalises a page slug to the path below the root", async () => {
    let asked = "";
    const svc = service(
      fakeStore({
        findItem: (_t, _l, slug) => {
          asked = slug;
          return Promise.resolve(undefined);
        },
      }),
    );
    await svc.resolve({ type: "page", locale: "ar", slug: "/features/x/" });
    expect(asked).toBe("features/x");
  });
});

describe("taxonomy page", () => {
  it("renders the intro Markdown to HTML and flags indexability", async () => {
    const svc = service(
      fakeStore({
        findTag: () => Promise.resolve(tag({ descriptionAr: "**bold** <script>x</script>" })),
        countPublished: () => Promise.resolve(5),
      }),
    );
    const page = publicTaxonomyPageSchema.parse(
      await svc.taxonomyPage({ kind: "tag", locale: "ar", slug: "wasm" }),
    );
    expect(page.indexable).toBe(true);
    expect(page.introHtml).toContain("<strong>bold</strong>");
    expect(page.introHtml).not.toContain("<script");
  });
  it("404s for an unknown entry", async () => {
    await expect(
      service(fakeStore()).taxonomyPage({ kind: "category", locale: "en", slug: "nope" }),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });
});

describe("preview", () => {
  const now = new Date();
  const token = (over: { revisionId?: string; expiresAt?: number; secret?: string } = {}) =>
    signPreviewToken(over.secret ?? SECRET, {
      itemId: uuid(1),
      revisionId: over.revisionId,
      expiresAt: over.expiresAt ?? Math.floor(now.getTime() / 1000) + 600,
    });
  const draftItem = item({ status: "draft", currentRevisionId: uuid(12) });
  const store = () => fakeStore({ findItemById: () => Promise.resolve(draftItem) });

  it("renders the current revision as a draft", async () => {
    const res = publicPreviewResponseSchema.parse(await service(store()).preview(token(), now));
    expect(res.isDraft).toBe(true);
  });
  it("renders the published revision as not a draft when the token names it", async () => {
    const res = await service(store()).preview(token({ revisionId: uuid(11) }), now);
    expect(res.isDraft).toBe(false);
  });
  it("answers 404 for expired, tampered, wrong-secret, missing-secret and unknown-item tokens", async () => {
    const notFound = async (svc: PublicContentService, t: string) => {
      const error: unknown = await svc.preview(t, now).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    };
    await notFound(service(store()), token({ expiresAt: Math.floor(now.getTime() / 1000) - 1 }));
    const good = token();
    await notFound(service(store()), `${good[0] === "A" ? "B" : "A"}${good.slice(1)}`);
    await notFound(service(store()), token({ secret: "z".repeat(40) }));
    await notFound(service(store(), null), token());
    await notFound(service(fakeStore()), token());
  });
});
