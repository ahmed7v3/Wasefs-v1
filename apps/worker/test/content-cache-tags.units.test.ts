import { describe, expect, it } from "vitest";

import { deriveCacheTags } from "../src/content/cache-tags.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("deriveCacheTags", () => {
  it("published article: item, list, taxonomy, sitemaps, feed, no path state", () => {
    const tags = deriveCacheTags({
      kind: "published",
      itemId: ID,
      item: { type: "article", locale: "ar" },
    });
    expect(tags).toEqual(
      expect.arrayContaining([
        `content:item:${ID}`,
        "content:list:article:ar",
        "content:taxonomy:ar",
        "content:taxonomy:en",
        "sitemap:article",
        "sitemap:category",
        "sitemap:tag",
        "sitemap:author",
        "content:feed:ar",
      ]),
    );
    expect(tags).not.toContain("content:path-state");
    expect(tags).not.toContain("content:list:article:en");
    expect(tags).not.toContain("content:glossary:ar");
  });

  it("updated page touches only its own list and sitemap", () => {
    const tags = deriveCacheTags({
      kind: "updated",
      itemId: ID,
      item: { type: "page", locale: "en" },
    });
    expect([...tags].sort()).toEqual(
      [`content:item:${ID}`, "content:list:page:en", "sitemap:page"].sort(),
    );
  });

  it("glossary adds its glossary tag; moved adds path state", () => {
    const tags = deriveCacheTags({
      kind: "moved",
      itemId: ID,
      item: { type: "glossary", locale: "en" },
    });
    expect(tags).toEqual(
      expect.arrayContaining(["content:glossary:en", "content:path-state", "sitemap:glossary"]),
    );
  });

  it("a gone item purges every type and locale", () => {
    const tags = deriveCacheTags({ kind: "archived", itemId: ID, item: null });
    expect(tags.filter((t) => t.startsWith("content:list:"))).toHaveLength(8);
    expect(tags).toEqual(
      expect.arrayContaining([
        "content:glossary:ar",
        "content:glossary:en",
        "content:feed:ar",
        "content:feed:en",
        "content:path-state",
      ]),
    );
  });

  it("taxonomy and redirects have no item tag", () => {
    const taxonomy = deriveCacheTags({ kind: "taxonomy", itemId: null, item: null });
    expect(taxonomy.some((t) => t.startsWith("content:item:"))).toBe(false);
    expect(taxonomy).toEqual(expect.arrayContaining(["content:path-state", "sitemap:category"]));
    const redirects = deriveCacheTags({ kind: "redirects", itemId: null, item: null });
    expect(redirects).toContain("content:path-state");
    expect(redirects).not.toContain("sitemap:category");
  });

  it("returns no duplicates", () => {
    const tags = deriveCacheTags({ kind: "unpublished", itemId: ID, item: null });
    expect(new Set(tags).size).toBe(tags.length);
  });
});
