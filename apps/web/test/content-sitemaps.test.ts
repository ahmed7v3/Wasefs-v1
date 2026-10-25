import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MEDIA_ORIGIN = "https://media.test/bucket";
});
vi.mock("server-only", () => ({}));

type Url = {
  path: string;
  lastmod: string;
  alternates: { ar: string | null; en: string | null };
  image: { url: string; alt: string } | null;
};
type Page = { urls: Url[]; hasMore: boolean };
const pages = vi.hoisted(() => ({ data: new Map<string, Page>() }));
vi.mock("../src/lib/content-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/content-api")>()),
  getSitemapPage: (kind: string, locale: string, page: number) =>
    Promise.resolve(
      pages.data.get(`${kind}:${locale}:${String(page)}`) ?? { urls: [], hasMore: false },
    ),
}));

const { articleSitemapChunk, contentIndexChildren, contentSitemapUrls } =
  await import("../src/lib/content-sitemaps");
const { buildUrlset, sitemapIndexFor } = await import("../src/lib/sitemap-xml");

const SITE = "https://wasfa.online";
const url = (path: string, lastmod: string, over: Partial<Url> = {}): Url => ({
  path,
  lastmod,
  alternates: { ar: null, en: null },
  image: null,
  ...over,
});

beforeEach(() => {
  pages.data.clear();
});

describe("content sitemaps", () => {
  it("merges both locales with reciprocal hreflang and an image tag", async () => {
    const alt = { ar: "/blog/a", en: "/en/blog/a" };
    pages.data.set("article:ar:1", {
      hasMore: false,
      urls: [
        url("/blog/a", "2026-10-02T00:00:00.000Z", {
          alternates: alt,
          image: { url: "media/abc/1280.webp", alt: "x" },
        }),
        url("/blog/b&c", "2026-10-03T00:00:00.000Z"),
      ],
    });
    pages.data.set("article:en:1", {
      hasMore: false,
      urls: [url("/en/blog/a", "2026-10-02T00:00:00.000Z", { alternates: alt })],
    });
    const urls = (await articleSitemapChunk(1, SITE)) ?? [];
    expect(urls.map((entry) => entry.url)).toEqual([
      `${SITE}/blog/a`,
      `${SITE}/blog/b&c`,
      `${SITE}/en/blog/a`,
    ]);
    const xml = buildUrlset(urls);
    expect(xml).toContain('hreflang="en" href="https://wasfa.online/en/blog/a"');
    expect(xml).toContain('hreflang="x-default" href="https://wasfa.online/blog/a"');
    expect(xml).toContain(
      "<image:image><image:loc>https://media.test/bucket/media/abc/1280.webp</image:loc></image:image>",
    );
    expect(xml).toContain("<loc>https://wasfa.online/blog/b&amp;c</loc>");
    expect(xml).toContain("<lastmod>2026-10-03T00:00:00.000Z</lastmod>");
    expect(urls[1]?.alternates).toBeUndefined();
  });

  it("follows hasMore across pages", async () => {
    pages.data.set("glossary:ar:1", {
      hasMore: true,
      urls: [url("/glossary/a", "2026-01-01T00:00:00.000Z")],
    });
    pages.data.set("glossary:ar:2", {
      hasMore: false,
      urls: [url("/glossary/b", "2026-01-02T00:00:00.000Z")],
    });
    expect((await contentSitemapUrls("glossary", SITE)).map((entry) => entry.url)).toEqual([
      `${SITE}/glossary/a`,
      `${SITE}/glossary/b`,
    ]);
  });

  it("taxonomy merges categories and tags", async () => {
    pages.data.set("category:ar:1", {
      hasMore: false,
      urls: [url("/blog/c/x", "2026-01-01T00:00:00.000Z")],
    });
    pages.data.set("tag:ar:1", {
      hasMore: false,
      urls: [url("/blog/t/y", "2026-01-01T00:00:00.000Z")],
    });
    expect(await contentSitemapUrls("taxonomy", SITE)).toHaveLength(2);
  });

  it("empty set: valid empty urlset, and no index children", async () => {
    expect(buildUrlset(await contentSitemapUrls("authors", SITE))).toContain("</urlset>");
    expect(await contentIndexChildren(SITE)).toEqual([]);
    expect(await articleSitemapChunk(1, SITE)).toEqual([]);
    expect(await articleSitemapChunk(2, SITE)).toBeNull();
  });

  it("the index lists article chunks and non-empty files with the newest lastmod", async () => {
    pages.data.set("article:ar:1", {
      hasMore: false,
      urls: [
        url("/blog/a", "2026-10-02T00:00:00.000Z"),
        url("/blog/b", "2026-10-09T00:00:00.000Z"),
      ],
    });
    pages.data.set("guide:en:1", {
      hasMore: false,
      urls: [url("/en/guides/g", "2026-10-04T00:00:00.000Z")],
    });
    const xml = sitemapIndexFor(SITE, await contentIndexChildren(SITE));
    expect(xml).toContain(
      "<loc>https://wasfa.online/sitemap-articles-1.xml</loc><lastmod>2026-10-09T00:00:00.000Z</lastmod>",
    );
    expect(xml).toContain("<loc>https://wasfa.online/sitemap-guides.xml</loc>");
    expect(xml).not.toContain("sitemap-glossary.xml");
    expect(xml).toContain("sitemap-pages.xml");
  });
});
