import type {
  PublicImage,
  PublicItem,
  PublicItemCard,
  PublicTaxonomyPage,
} from "@wasfa/shared/schemas/content";

export const IMAGE: PublicImage = {
  width: 2000,
  height: 1000,
  focalX: 50,
  focalY: 50,
  blurDataUrl: null,
  alt: "A box of tablets",
  caption: null,
  credit: null,
  variants: [
    { format: "webp", width: 640, key: "media/abc/640.webp", bytes: 20_000 },
    { format: "webp", width: 1280, key: "media/abc/1280.webp", bytes: 60_000 },
    { format: "avif", width: 1280, key: "media/abc/1280.avif", bytes: 30_000 },
    { format: "jpeg", width: 1600, key: "media/abc/1600.jpg", bytes: 120_000 },
  ],
};

const ID = "11111111-1111-4111-8111-111111111111";

export function card(overrides: Partial<PublicItemCard> = {}): PublicItemCard {
  return {
    id: ID,
    type: "article",
    locale: "ar",
    slug: "reading-a-prescription",
    path: "/blog/reading-a-prescription",
    title: "Reading <a> prescription & more",
    excerpt: "How to read it.",
    definition: "",
    publishedAt: "2026-10-01T08:00:00.000Z",
    contentUpdatedAt: "2026-10-05T08:00:00.000Z",
    readingMinutes: 4,
    category: { slug: "basics", name: "Basics", path: "/blog/c/basics" },
    author: { name: "Dr. Sara", path: "/authors/sara" },
    image: IMAGE,
    ...overrides,
  };
}

export function item(overrides: Partial<PublicItem> = {}): PublicItem {
  return {
    ...card(),
    bodyHtml: "<p>Body</p>",
    toc: [],
    wordCount: 812,
    firstPublishedAt: "2026-10-01T08:00:00.000Z",
    tags: [],
    author: {
      slug: "sara",
      name: "Dr. Sara",
      credentials: "PharmD",
      path: "/authors/sara",
      photo: null,
    },
    reviewer: null,
    corrections: [],
    seo: {
      title: "Reading a prescription",
      description: "A short guide.",
      canonical: null,
      robots: "index",
      ogTitle: "",
      ogDescription: "",
      ogImage: null,
    },
    flags: {
      autoLink: true,
      showToc: false,
      showRelated: true,
      sponsored: false,
      aiAssisted: false,
    },
    alternates: { ar: "/blog/reading-a-prescription", en: "/en/blog/reading-a-prescription" },
    related: [],
    ...overrides,
  };
}

export function authorPage(overrides: Partial<PublicTaxonomyPage> = {}): PublicTaxonomyPage {
  return {
    kind: "author",
    slug: "sara",
    name: "Dr. Sara",
    path: "/authors/sara",
    introHtml: "",
    seoTitle: "Dr. Sara",
    seoDescription: "Pharmacist",
    indexable: true,
    itemCount: 3,
    person: {
      slug: "sara",
      name: "Dr. Sara",
      credentials: "PharmD",
      path: "/authors/sara",
      photo: null,
      sameAs: ["https://example.org/sara"],
      bioHtml: "<p>Bio</p>",
    },
    alternates: { ar: "/authors/sara", en: null },
    ...overrides,
  };
}
