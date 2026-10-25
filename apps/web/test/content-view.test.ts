import { describe, expect, it } from "vitest";

import {
  glossaryLetter,
  groupGlossary,
  isPageSlugSegments,
  letterAnchor,
  pageHref,
  parsePageParam,
  sectionPath,
  shareLinks,
  totalPages,
} from "../src/lib/content-view";

describe("isPageSlugSegments (the catch-all guard)", () => {
  it("accepts one to three valid slug segments", () => {
    expect(isPageSlugSegments(["about-us"])).toBe(true);
    expect(isPageSlugSegments(["a", "b", "c"])).toBe(true);
  });

  it("rejects empty, deep, upper-case, dotted, encoded and oversized segments", () => {
    expect(isPageSlugSegments([])).toBe(false);
    expect(isPageSlugSegments(["a", "b", "c", "d"])).toBe(false);
    expect(isPageSlugSegments(["About"])).toBe(false);
    expect(isPageSlugSegments(["wp-login.php"])).toBe(false);
    expect(isPageSlugSegments([".."])).toBe(false);
    expect(isPageSlugSegments(["%D8%B3"])).toBe(false);
    expect(isPageSlugSegments(["a_b"])).toBe(false);
    expect(isPageSlugSegments(["a".repeat(121)])).toBe(false);
    expect(isPageSlugSegments(["ok", ""])).toBe(false);
  });
});

describe("pagination helpers", () => {
  it("reads ?page defensively", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["4", "5"])).toBe(4);
    for (const bad of ["0", "-1", "abc", "2.5", "99999", "1001", ""]) {
      expect(parsePageParam(bad)).toBe(1);
    }
  });

  it("keeps page 1 on the clean URL and numbers the rest", () => {
    expect(pageHref("/blog", 1)).toBe("/blog");
    expect(pageHref("/en/blog", 2)).toBe("/en/blog?page=2");
    expect(totalPages(0, 12)).toBe(1);
    expect(totalPages(25, 12)).toBe(3);
  });

  it("builds section paths per locale", () => {
    expect(sectionPath("blog", "ar")).toBe("/blog");
    expect(sectionPath("guides", "en")).toBe("/en/guides");
  });
});

describe("shareLinks", () => {
  it("builds plain third-party share URLs with the page URL encoded", () => {
    const links = shareLinks("https://wasfa.online/blog/x?a=1", "عنوان & more");
    expect(links.map((link) => link.id)).toEqual(["whatsapp", "facebook", "x", "telegram"]);
    expect(links[0]?.href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(links[1]?.href).toContain(encodeURIComponent("https://wasfa.online/blog/x?a=1"));
    for (const link of links) expect(link.href).not.toMatch(/\s/);
  });
});

describe("glossary grouping", () => {
  it("folds hamza forms of alef and strips marks", () => {
    for (const term of ["أمبيرول", "إبرة", "آلام", "ٱسم", "َاطلب"]) {
      expect(glossaryLetter(term)).toEqual({ letter: "ا", script: "arabic" });
    }
  });

  it("upper-cases Latin and skips leading punctuation", () => {
    expect(glossaryLetter("bid")).toEqual({ letter: "B", script: "latin" });
    expect(glossaryLetter("(PRN)")).toEqual({ letter: "P", script: "latin" });
    expect(glossaryLetter("123")).toEqual({ letter: "#", script: "other" });
  });

  it("groups Latin first, then Arabic in alphabet order, then the rest", () => {
    const groups = groupGlossary([
      { term: "ياء" },
      { term: "أول" },
      { term: "TID" },
      { term: "BID" },
      { term: "بعد" },
      { term: "إبرة" },
      { term: "99" },
    ]);
    expect(groups.map((group) => group.letter)).toEqual(["B", "T", "ا", "ب", "ي", "#"]);
    expect(groups.find((group) => group.letter === "ا")?.items).toHaveLength(2);
  });

  it("gives every group an ASCII anchor", () => {
    for (const group of groupGlossary([{ term: "BID" }, { term: "أول" }, { term: "1" }])) {
      expect(letterAnchor(group)).toMatch(/^letter-[a-z0-9-]+$/);
    }
  });
});
