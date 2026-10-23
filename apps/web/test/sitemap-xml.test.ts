import { describe, expect, it } from "vitest";

import {
  MAX_URLS_PER_SITEMAP,
  buildSitemapIndex,
  buildUrlset,
  escapeXml,
  pageSitemapUrls,
  sitemapIndexFor,
} from "../src/lib/sitemap-xml";

const SITE = "https://wasfa.online";

describe("sitemap xml", () => {
  it("escapes XML specials", () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;");
  });

  it("lists the index children with lastmod", () => {
    const xml = sitemapIndexFor(SITE);
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("<loc>https://wasfa.online/sitemap-pages.xml</loc><lastmod>2026-10-20</lastmod>");
  });

  it("escapes locations in the index", () => {
    expect(buildSitemapIndex([{ loc: "https://x.test/a?b=1&c=2", lastModified: "2026-01-01" }])).toContain(
      "a?b=1&amp;c=2",
    );
  });

  it("lists both language URLs with reciprocal hreflang and one-language pages without", () => {
    const urls = pageSitemapUrls(SITE);
    const home = urls.filter((u) => u.url === `${SITE}/` || u.url === `${SITE}/en`);
    expect(home).toHaveLength(2);
    for (const entry of home) {
      expect(entry.alternates).toEqual({
        ar: `${SITE}/`,
        en: `${SITE}/en`,
        "x-default": `${SITE}/`,
      });
    }
    expect(urls.find((u) => u.url === `${SITE}/privacy`)?.alternates).toBeUndefined();
    const xml = buildUrlset(urls);
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="en" href="https://wasfa.online/en/contact"/>');
    expect(xml).not.toContain("/en/pricing");
    expect(xml).not.toContain("/en/privacy");
  });

  it("refuses more than the per-file cap", () => {
    const many = Array.from({ length: MAX_URLS_PER_SITEMAP + 1 }, (_, i) => ({
      url: `${SITE}/${i}`,
      lastModified: "2026-01-01",
    }));
    expect(() => buildUrlset(many)).toThrow();
  });
});
