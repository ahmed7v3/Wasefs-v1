import { describe, expect, it } from "vitest";

import { checkItemSlug } from "../../src/content/slug-rules.js";

describe("checkItemSlug", () => {
  it.each(["how-to-read", "bid", "a1", "x".repeat(120)])("accepts %s for an article", (slug) => {
    expect(checkItemSlug("article", slug)).toBe("ok");
  });

  it.each(["", "Upper", "two--hyphens", "-lead", "trail-", "a/b", "with space", "عربي"])(
    "refuses %j for an article",
    (slug) => {
      expect(checkItemSlug("article", slug)).toBe("bad_format");
    },
  );

  it("refuses an over-long single-segment slug", () => {
    expect(checkItemSlug("guide", "x".repeat(121))).toBe("too_long");
  });

  it.each(["new-feature", "features/new-feature", "for/doctors/uae", "tools/dose-calculator"])(
    "accepts the page path %s",
    (slug) => {
      expect(checkItemSlug("page", slug)).toBe("ok");
    },
  );

  it.each(["a/b/c/d", "/lead", "trail/", "a//b", "Up/per", "a/-b"])(
    "refuses the malformed page path %j",
    (slug) => {
      expect(checkItemSlug("page", slug)).toBe("bad_format");
    },
  );

  it.each([
    "admin",
    "admin/anything",
    "blog/my-post",
    "en/about",
    "api/v1",
    "dashboard",
    "login",
    "glossary/x",
    "about",
    "pricing",
    "editorial-policy",
  ])("reserves %s for pages", (slug) => {
    expect(checkItemSlug("page", slug)).toBe("reserved");
  });

  it("still allows a page under a marketing section that has no template of its own", () => {
    expect(checkItemSlug("page", "features/ai-assistant-v2")).toBe("ok");
    expect(checkItemSlug("page", "about-us")).toBe("ok");
  });

  it("only reserves roots for pages, not for sectioned types", () => {
    expect(checkItemSlug("article", "admin")).toBe("ok");
  });
});
