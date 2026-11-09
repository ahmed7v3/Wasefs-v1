import { describe, expect, it } from "vitest";

import {
  SOURCES_HEADING,
  composeBody,
  countRenderedSources,
  renderSourcesBlock,
  splitSourcesBlock,
} from "../src/publishing/publishing-api-sources.js";

const WHO = {
  title: "WHO: Antimicrobial resistance",
  url: "https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance",
  publisher: "World Health Organization",
  accessed_at: "2026-11-01",
};
const NIH = { title: "MedlinePlus: Antibiotics", url: "https://medlineplus.gov/antibiotics.html" };

describe("renderSourcesBlock", () => {
  it("renders a numbered references list under the bilingual heading", () => {
    expect(renderSourcesBlock([WHO, NIH])).toBe(
      [
        SOURCES_HEADING,
        "",
        "1. [WHO: Antimicrobial resistance](https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance) — World Health Organization, accessed 2026-11-01",
        "2. [MedlinePlus: Antibiotics](https://medlineplus.gov/antibiotics.html)",
      ].join("\n"),
    );
  });

  it("is deterministic", () => {
    expect(renderSourcesBlock([WHO, NIH])).toBe(renderSourcesBlock([WHO, NIH]));
  });

  it("keeps a title or a url from breaking out of the link", () => {
    const block = renderSourcesBlock([
      { title: "A [tricky] <title>", url: "https://example.org/a_(b) c" },
    ]);
    expect(block).toContain("[A \\[tricky\\] \\<title\\>](https://example.org/a_%28b%29%20c)");
  });
});

describe("composeBody", () => {
  const body = "## A\n\nSome text.\n";

  it("appends the block at the very end", () => {
    const composed = composeBody(body, [WHO]);
    expect(composed.startsWith("## A\n\nSome text.\n\n## المصادر / Sources\n\n1. [")).toBe(true);
    expect(composed.endsWith("\n")).toBe(true);
    expect(countRenderedSources(composed)).toBe(1);
  });

  it("is idempotent: composing an already composed body replaces, never stacks", () => {
    const once = composeBody(body, [WHO, NIH]);
    expect(composeBody(once, [WHO, NIH])).toBe(once);
    expect(composeBody(once, [NIH])).toBe(composeBody(body, [NIH]));
  });

  it("keeps the previous block when a body-only patch sends no sources", () => {
    const stored = composeBody(body, [WHO, NIH]);
    const patched = composeBody("## B\n\nNew text.\n", undefined, stored);
    expect(patched).toContain("## B");
    expect(countRenderedSources(patched)).toBe(2);
  });

  it("removes the block when sources is an empty list", () => {
    const stored = composeBody(body, [WHO]);
    expect(composeBody(stored, [])).toBe("## A\n\nSome text.\n");
  });

  it("adds nothing without sources", () => {
    expect(composeBody(body, undefined)).toBe("## A\n\nSome text.\n");
  });
});

describe("splitSourcesBlock", () => {
  it("leaves a human-written Sources section that is not a numbered list alone", () => {
    const text = `## A\n\ntext\n\n${SOURCES_HEADING}\n\nSee the WHO website for details.\n`;
    expect(splitSourcesBlock(text)).toEqual({ main: text, block: null });
    expect(countRenderedSources(text)).toBe(0);
  });
});
