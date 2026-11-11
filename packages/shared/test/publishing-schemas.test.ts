import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../src/html-to-markdown.js";
import { buildPublishingGuide } from "../src/publishing-guide.js";
import { PUBLISHING_DEFAULTS } from "../src/publishing.js";
import {
  SLUG_REQUIRED_MESSAGE,
  publishingArticleInputSchema,
  publishingArticlePatchSchema,
  publishingListQuerySchema,
  publishingMediaFetchSchema,
  publishingMediaFieldsSchema,
  titleIsArabic,
} from "../src/schemas/publishing.js";

const english = {
  type: "article",
  locale: "en",
  title: "How to take antibiotics correctly",
  excerpt:
    "Simple steps that help you follow the schedule and the length of your antibiotic course.",
  body_markdown: "## Why\n\nText.\n",
};
const arabic = {
  type: "article",
  locale: "ar",
  title: "كيف تتناول المضاد الحيوي بطريقة صحيحة",
  excerpt: "خطوات بسيطة تساعدك على الالتزام بمواعيد المضاد الحيوي ومدته كما وصفها الطبيب.",
  body_markdown: "## لماذا\n\nنص.\n",
};

const issues = (value: unknown) => {
  const result = publishingArticleInputSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
};

describe("create input", () => {
  it("accepts a minimal English article, defaulting desired_status to draft", () => {
    const parsed = publishingArticleInputSchema.parse(english);
    expect(parsed.desired_status).toBe("draft");
    expect(parsed.slug).toBeUndefined();
  });

  it("requires a slug when the title is Arabic, with a message that tells the agent what to do", () => {
    expect(issues(arabic)).toEqual([{ path: "slug", message: SLUG_REQUIRED_MESSAGE }]);
    expect(SLUG_REQUIRED_MESSAGE).toMatch(/English slug/);
    expect(issues({ ...arabic, slug: "taking-antibiotics-correctly" })).toEqual([]);
  });

  it("slug rules: a-z, 0-9 and single hyphens, 3 to 80 characters", () => {
    for (const bad of [
      "ab",
      "Has-Capitals",
      "double--hyphen",
      "-lead",
      "trail-",
      "space here",
      "a".repeat(81),
      "عربي-slug",
    ]) {
      expect(
        issues({ ...english, slug: bad }).map((entry) => entry.path),
        bad,
      ).toEqual(["slug"]);
    }
    expect(issues({ ...english, slug: "a".repeat(80) })).toEqual([]);
    expect(issues({ ...english, slug: "abc" })).toEqual([]);
  });

  it("title is 10 to 110 characters (glossary entries may be shorter)", () => {
    expect(issues({ ...english, title: "Too short" }).map((entry) => entry.path)).toEqual([
      "title",
    ]);
    expect(issues({ ...english, title: "x".repeat(111) }).map((entry) => entry.path)).toContain(
      "title",
    );
    expect(issues({ ...english, title: "x".repeat(110) })).toEqual([]);
    expect(
      issues({
        type: "glossary",
        locale: "en",
        title: "Dose",
        definition: "The amount taken at once.",
        body_markdown: "x",
      }),
    ).toEqual([]);
  });

  it("excerpt is 50 to 300 characters and required for articles", () => {
    expect(issues({ ...english, excerpt: "short" }).map((entry) => entry.path)).toEqual([
      "excerpt",
    ]);
    expect(issues({ ...english, excerpt: "x".repeat(301) }).map((entry) => entry.path)).toEqual([
      "excerpt",
    ]);
    expect(issues({ ...english, excerpt: undefined }).map((entry) => entry.path)).toEqual([
      "excerpt",
    ]);
  });

  it("glossary entries need a definition", () => {
    expect(
      issues({ type: "glossary", locale: "en", title: "Dose", body_markdown: "x" }).map(
        (entry) => entry.path,
      ),
    ).toEqual(["definition"]);
  });

  it("only article, guide and glossary are writable (no pages)", () => {
    expect(issues({ ...english, type: "page" }).map((entry) => entry.path)).toContain("type");
  });

  it("unknown fields are refused, not silently dropped (a typo must not lose content)", () => {
    expect(issues({ ...english, bodyMarkdown: "x" })).toEqual([
      expect.objectContaining({ path: "" }),
    ]);
  });

  it("sources are https only and carry a title", () => {
    expect(
      issues({ ...english, sources: [{ title: "WHO", url: "http://who.int/x" }] }).map(
        (e) => e.path,
      ),
    ).toEqual(["sources.0.url"]);
    expect(
      issues({ ...english, sources: [{ title: "WHO", url: "javascript:alert(1)" }] }),
    ).not.toEqual([]);
    expect(
      issues({
        ...english,
        sources: [
          { title: "WHO", url: "https://who.int/x", publisher: "WHO", accessed_at: "2026-11-01" },
        ],
      }),
    ).toEqual([]);
  });

  it("the markdown body is capped at 200 KB (bytes, not characters)", () => {
    expect(
      issues({ ...english, body_markdown: "x".repeat(PUBLISHING_DEFAULTS.maxMarkdownBytes) }),
    ).toEqual([]);
    expect(
      issues({
        ...english,
        body_markdown: "x".repeat(PUBLISHING_DEFAULTS.maxMarkdownBytes + 1),
      }).map((e) => e.path),
    ).toEqual(["body_markdown"]);
    // Two bytes per Arabic letter: 100,001 letters are over the cap although under 200,000 characters.
    expect(issues({ ...english, body_markdown: "ب".repeat(100_001) }).map((e) => e.path)).toEqual([
      "body_markdown",
    ]);
  });

  it("scheduled needs scheduled_at", () => {
    expect(issues({ ...english, desired_status: "scheduled" }).map((e) => e.path)).toEqual([
      "scheduled_at",
    ]);
    expect(
      issues({ ...english, desired_status: "scheduled", scheduled_at: "2027-01-01T07:00:00Z" }),
    ).toEqual([]);
  });

  it("tags are at most 10, external_id uses the documented alphabet", () => {
    expect(
      issues({ ...english, tags: Array.from({ length: 11 }, (_, i) => `t${String(i)}`) }).map(
        (e) => e.path,
      ),
    ).toEqual(["tags"]);
    expect(issues({ ...english, external_id: "kb 1042" }).map((e) => e.path)).toEqual([
      "external_id",
    ]);
    expect(issues({ ...english, external_id: "kb-1042:v2.a_b" })).toEqual([]);
  });

  it("seo limits: description up to 320, secondary keywords up to 10", () => {
    expect(
      issues({ ...english, seo: { description: "x".repeat(321) } }).map((e) => e.path),
    ).toEqual(["seo.description"]);
    expect(issues({ ...english, seo: { description: "x".repeat(320) } })).toEqual([]);
  });

  it("accepts HTML instead of Markdown and stores only converted Markdown", () => {
    const parsed = publishingArticleInputSchema.parse({ ...english, body_markdown: undefined, body_html_import: "<h1>Heading</h1><p>Hello <strong>world</strong><script>alert(1)</script><a href=\"javascript:alert(2)\">bad</a><a href=\"https://example.com/a\">safe</a></p>" });
    expect(parsed.body_markdown).toContain("## Heading");
    expect(parsed.body_markdown).toContain("**world**");
    expect(parsed.body_markdown).not.toContain("script");
    expect(parsed.body_markdown).not.toContain("javascript:");
    expect(parsed.body_markdown).toContain("[safe](https://example.com/a)");
    expect("body_html_import" in parsed).toBe(false);
    expect(issues({ ...english, body_html_import: "<p>x</p>" }).some((e) => e.path === "body_markdown")).toBe(true);
  });

  it("converts and removes dangerous content without fetching images", () => {
    expect(htmlToMarkdown("<style>x</style><iframe>y</iframe><img src=\"https://bad.example/x\" alt=\"photo\"><ul><li>one</li></ul>")).toContain("photo");
    expect(htmlToMarkdown("<script>secret</script><svg><text>active</text></svg>")).not.toMatch(/secret|active/);
  });

  it("publish_on_approval is an optional boolean", () => {
    expect(
      publishingArticleInputSchema.parse({ ...english, publish_on_approval: true })
        .publish_on_approval,
    ).toBe(true);
    expect(issues({ ...english, publish_on_approval: "yes" })).not.toEqual([]);
  });
});

describe("merge patch", () => {
  it("accepts a partial body and null to clear", () => {
    const parsed = publishingArticlePatchSchema.parse({
      category: null,
      featured_media_id: null,
      seo: { description: null, robots: "noindex" },
    });
    expect(parsed.category).toBeNull();
    expect(parsed.seo?.description).toBeNull();
    expect(parsed.title).toBeUndefined();
  });

  it("normalizes patch HTML to Markdown and rejects two supplied body formats", () => {
    const normalized = publishingArticlePatchSchema.parse({ body_html_import: "<p><em>hello</em></p>" });
    expect(normalized.body_markdown).toContain("*hello*");
    expect("body_html_import" in normalized).toBe(false);
    expect(publishingArticlePatchSchema.safeParse({ body_markdown: "x", body_html_import: "<p>x</p>" }).success).toBe(false);
  });

  it("refuses an empty patch, type/locale changes and unknown fields", () => {
    expect(publishingArticlePatchSchema.safeParse({}).success).toBe(false);
    expect(publishingArticlePatchSchema.safeParse({ type: "guide" }).success).toBe(false);
    expect(publishingArticlePatchSchema.safeParse({ locale: "en" }).success).toBe(false);
    expect(publishingArticlePatchSchema.safeParse({ nonsense: 1 }).success).toBe(false);
  });
});

describe("list query", () => {
  it("coerces limit, caps it at 100, and validates the filters", () => {
    expect(publishingListQuerySchema.parse({}).limit).toBe(25);
    expect(publishingListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(publishingListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(publishingListQuerySchema.safeParse({ status: "nope" }).success).toBe(false);
    expect(
      publishingListQuerySchema.safeParse({ updated_since: "2026-11-01T00:00:00Z" }).success,
    ).toBe(true);
    expect(publishingListQuerySchema.safeParse({ updated_since: "yesterday" }).success).toBe(false);
    expect(publishingListQuerySchema.safeParse({ cursor: "not valid!" }).success).toBe(false);
  });
});

describe("media input", () => {
  it("alt is required unless the image is decorative", () => {
    expect(
      publishingMediaFetchSchema.safeParse({ source_url: "https://x.example/a.jpg" }).success,
    ).toBe(false);
    expect(
      publishingMediaFetchSchema.safeParse({
        source_url: "https://x.example/a.jpg",
        decorative: true,
      }).success,
    ).toBe(true);
    expect(
      publishingMediaFetchSchema.safeParse({
        source_url: "https://x.example/a.jpg",
        alt: "علبة دواء",
      }).success,
    ).toBe(true);
    expect(publishingMediaFieldsSchema.safeParse({}).success).toBe(false);
  });

  it("licence is one of the library's, focal point is 0 to 1", () => {
    expect(publishingMediaFieldsSchema.safeParse({ alt: "x", licence: "stolen" }).success).toBe(
      false,
    );
    expect(
      publishingMediaFieldsSchema.safeParse({ alt: "x", licence: "cc-by", credit: "me" }).success,
    ).toBe(true);
    expect(
      publishingMediaFieldsSchema.safeParse({ alt: "x", focal_point: { x: 1.5, y: 0 } }).success,
    ).toBe(false);
  });
});

describe("titleIsArabic", () => {
  it("detects Arabic letters", () => {
    expect(titleIsArabic("كيف تتناول الدواء")).toBe(true);
    expect(titleIsArabic("Take your medicine (دواء)")).toBe(true);
    expect(titleIsArabic("Take your medicine")).toBe(false);
  });
});

describe("agent guide", () => {
  const guide = buildPublishingGuide({ apiBase: "https://api.example.org/" });
  it("fills in the base URL without doubling slashes", () => {
    expect(guide).toContain("https://api.example.org/publishing/v1/me");
    expect(guide).not.toContain("//publishing");
  });
});
