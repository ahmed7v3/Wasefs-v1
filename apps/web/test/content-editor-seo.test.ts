import { describe, expect, it } from "vitest";

import {
  extractHeadings,
  extractImages,
  extractLinks,
  linkQueryAt,
} from "../src/lib/content-editor/markdown-facts";
import { seoChecklist, type ChecklistInput } from "../src/lib/content-editor/seo-checklist";
import {
  SNIPPET_BUDGETS,
  codePointLength,
  estimateWidthPx,
  snippetFor,
  snippetUrl,
  truncateToWidth,
} from "../src/lib/content-editor/snippet";
import { buildStructuredData } from "../src/lib/content-editor/structured-data";

const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${String(i)}`).join(" ");

const base: ChecklistInput = {
  type: "article",
  title: "Paracetamol dosage for adults",
  bodyMd: "",
  slug: "paracetamol-dosage",
  seo: { title: "", description: "", focusKeyword: "paracetamol dosage" },
  featuredAltMissing: null,
  gates: [],
  minWords: { article: 600, guide: 1200, glossary: 80 },
};

const statusOf = (input: ChecklistInput, id: string): string | undefined =>
  seoChecklist(input).find((item) => item.id === id)?.status;

describe("seoChecklist", () => {
  it("asks for a focus keyword and then skips keyword checks", () => {
    const items = seoChecklist({ ...base, seo: { ...base.seo, focusKeyword: "" } });
    expect(items.find((i) => i.id === "focus_keyword")?.status).toBe("improve");
    expect(items.some((i) => i.id === "keyword_title")).toBe(false);
  });

  it("keyword in title: English and Arabic (normalised letters)", () => {
    expect(statusOf(base, "keyword_title")).toBe("pass");
    expect(statusOf({ ...base, title: "Something else" }, "keyword_title")).toBe("improve");
    const ar = {
      ...base,
      title: "جرعة الباراسيتامول للكبار",
      seo: { ...base.seo, focusKeyword: "الباراسيتامول" },
    };
    expect(statusOf(ar, "keyword_title")).toBe("pass");
    expect(statusOf({ ...ar, title: "جرعة اسيتامينوفين" }, "keyword_title")).toBe("improve");
  });

  it("keyword in the first 100 words only", () => {
    const early = `Paracetamol dosage ${words(200)}`;
    const late = `${words(150)} paracetamol dosage`;
    expect(statusOf({ ...base, bodyMd: early }, "keyword_intro")).toBe("pass");
    expect(statusOf({ ...base, bodyMd: late }, "keyword_intro")).toBe("improve");
  });

  it("keyword in an H2, not in H3", () => {
    expect(statusOf({ ...base, bodyMd: "## Paracetamol dosage\n\ntext" }, "keyword_h2")).toBe(
      "pass",
    );
    expect(statusOf({ ...base, bodyMd: "### Paracetamol dosage\n\ntext" }, "keyword_h2")).toBe(
      "improve",
    );
  });

  it("keyword in the slug via transliteration", () => {
    expect(statusOf(base, "keyword_slug")).toBe("pass");
    expect(statusOf({ ...base, slug: "other" }, "keyword_slug")).toBe("improve");
  });

  it("keyword in the description, and description length 120-160", () => {
    const good = "p".repeat(10) + " paracetamol dosage " + "x".repeat(110);
    expect(
      statusOf({ ...base, seo: { ...base.seo, description: good } }, "keyword_description"),
    ).toBe("pass");
    expect(statusOf({ ...base, seo: { ...base.seo, description: good } }, "meta_description")).toBe(
      "pass",
    );
    expect(statusOf(base, "meta_description")).toBe("improve");
    expect(
      statusOf({ ...base, seo: { ...base.seo, description: "x".repeat(200) } }, "meta_description"),
    ).toBe("improve");
  });

  it("meta title: at most 60 code points, falling back to the title", () => {
    expect(statusOf(base, "meta_title")).toBe("pass");
    expect(statusOf({ ...base, seo: { ...base.seo, title: "t".repeat(61) } }, "meta_title")).toBe(
      "improve",
    );
    expect(statusOf({ ...base, title: "" }, "meta_title")).toBe("improve");
  });

  it("heading structure: no H1 in the body, no skipped level, an H2 for long text", () => {
    expect(statusOf({ ...base, bodyMd: "## A\n\n### B" }, "headings")).toBe("pass");
    expect(statusOf({ ...base, bodyMd: "# A" }, "headings")).toBe("improve");
    expect(statusOf({ ...base, bodyMd: "## A\n\n#### B" }, "headings")).toBe("improve");
    expect(statusOf({ ...base, bodyMd: words(400) }, "headings")).toBe("improve");
  });

  it("needs two internal links on articles (entity directives count)", () => {
    expect(statusOf({ ...base, bodyMd: "[a](/blog/a) [b](/guides/b)" }, "internal_links")).toBe(
      "pass",
    );
    expect(statusOf({ ...base, bodyMd: "[a](/blog/a) [x](https://x.com)" }, "internal_links")).toBe(
      "improve",
    );
    expect(statusOf({ ...base, bodyMd: "[a](/blog/a) {{drug:aspirin}}" }, "internal_links")).toBe(
      "pass",
    );
    expect(statusOf({ ...base, type: "glossary" }, "internal_links")).toBeUndefined();
  });

  it("image alts: body images and the featured image", () => {
    expect(statusOf({ ...base, bodyMd: "![alt](media:1)" }, "image_alts")).toBe("pass");
    expect(statusOf({ ...base, bodyMd: "![](media:1)" }, "image_alts")).toBe("improve");
    expect(statusOf({ ...base, featuredAltMissing: true }, "image_alts")).toBe("improve");
    expect(statusOf(base, "image_alts")).toBeUndefined();
  });

  it("length against the minimum words of the type", () => {
    expect(statusOf({ ...base, bodyMd: words(700) }, "length")).toBe("pass");
    expect(statusOf({ ...base, bodyMd: words(100) }, "length")).toBe("improve");
    expect(statusOf({ ...base, type: "page" }, "length")).toBeUndefined();
  });

  it("duplicate and uniqueness come from the gates", () => {
    const gates = [
      {
        id: "duplicate_content" as const,
        level: "block" as const,
        ok: false,
        params: { score: 0.7, matchPath: "/blog/x" },
      },
      { id: "title_unique" as const, level: "block" as const, ok: false, params: {} },
    ];
    expect(statusOf({ ...base, gates }, "duplicate")).toBe("improve");
    expect(statusOf({ ...base, gates }, "unique_meta")).toBe("improve");
    expect(statusOf({ ...base, gates: [] }, "duplicate")).toBeUndefined();
  });

  it("readability flags very long sentences and never produces a numeric score", () => {
    expect(statusOf({ ...base, bodyMd: `${words(60)}.` }, "readability")).toBe("improve");
    expect(statusOf({ ...base, bodyMd: "Short one. Short two." }, "readability")).toBe("pass");
    for (const item of seoChecklist(base)) {
      expect(["pass", "improve"]).toContain(item.status);
      expect(item).not.toHaveProperty("score");
    }
  });
});

describe("snippet", () => {
  it("counts code points, not UTF-16 units", () => {
    expect(codePointLength("😀a")).toBe(2);
    expect(codePointLength("دواء")).toBe(4);
  });

  it("does not truncate text that fits and truncates with an ellipsis otherwise", () => {
    expect(truncateToWidth("short title", 600, 20)).toEqual({
      text: "short title",
      truncated: false,
    });
    const cut = truncateToWidth("كلمة ".repeat(60), SNIPPET_BUDGETS.desktop.titlePx, 20);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(estimateWidthPx(cut.text, 20)).toBeLessThanOrEqual(SNIPPET_BUDGETS.desktop.titlePx);
  });

  it("mobile gets a different description budget than desktop", () => {
    const text = "word ".repeat(80);
    const desktop = snippetFor({ title: "t", description: text }, "desktop");
    const mobile = snippetFor({ title: "t", description: text }, "mobile");
    expect(mobile.description.text.length).toBeLessThan(desktop.description.text.length);
  });

  it("formats the visible URL as a breadcrumb", () => {
    expect(snippetUrl("https://wasfa.online", "/blog/x")).toBe("wasfa.online › blog › x");
  });
});

describe("markdown facts and structured data", () => {
  it("finds headings outside code fences, links, images and the link query", () => {
    const md = '## One\n```\n## no\n```\n### Two\n[a](/x) [b](https://y.com) ![alt](media:7 "cap")';
    expect(extractHeadings(md).map((h) => [h.level, h.text])).toEqual([
      [2, "One"],
      [3, "Two"],
    ]);
    expect(extractLinks(md).map((l) => l.internal)).toEqual([true, false]);
    expect(extractImages(md)[0]).toMatchObject({ alt: "alt", mediaId: "7", caption: "cap" });
    expect(linkQueryAt(md, md.indexOf("[a]"), md.indexOf("[a]"), "T")).toBe("Two");
    expect(linkQueryAt("hello brave world", 6, 11, "T")).toBe("brave");
  });

  it("builds a BlogPosting from the editor fields", () => {
    const data = buildStructuredData({
      type: "article",
      locale: "ar",
      slug: "x",
      title: "T",
      excerpt: "E",
      definition: "",
      seoTitle: "",
      seoDescription: "D",
      publishedAt: null,
      updatedAt: "2026-01-01T00:00:00Z",
      author: { name: "A", slug: "a" },
      reviewer: null,
      publicPath: null,
      featuredMediaId: null,
      origin: "https://wasfa.online",
    });
    expect(data).toMatchObject({
      "@type": "BlogPosting",
      headline: "T",
      description: "D",
      mainEntityOfPage: "https://wasfa.online/blog/x",
    });
    expect(data).not.toHaveProperty("datePublished");
  });
});
