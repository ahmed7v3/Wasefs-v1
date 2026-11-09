import { describe, expect, it } from "vitest";

import { countTopLevelParagraphs, splitHtmlAfterParagraphs } from "../src/lib/html-split";

describe("splitHtmlAfterParagraphs", () => {
  it("splits after the Nth paragraph and concatenates back", () => {
    const html = "<p>a</p><p>b</p><p>c</p><p>d</p>";
    const chunks = splitHtmlAfterParagraphs(html, [2, 3]);
    expect(chunks).toEqual(["<p>a</p><p>b</p>", "<p>c</p>", "<p>d</p>"]);
    expect(chunks.join("")).toBe(html);
  });

  it("does not count paragraphs inside a blockquote", () => {
    const html = "<p>a</p><blockquote><p>q1</p><p>q2</p></blockquote><p>b</p><p>c</p>";
    expect(countTopLevelParagraphs(html)).toBe(3);
    expect(splitHtmlAfterParagraphs(html, [2])).toEqual([
      "<p>a</p><blockquote><p>q1</p><p>q2</p></blockquote><p>b</p>",
      "<p>c</p>",
    ]);
  });

  it("does not split inside lists", () => {
    const html = "<ul><li><p>x</p></li><li><p>y</p></li></ul><p>a</p>";
    expect(splitHtmlAfterParagraphs(html, [1])).toEqual([html, ""]);
  });

  it("returns one chunk when there are too few paragraphs", () => {
    const html = "<p>a</p><p>b</p>";
    expect(splitHtmlAfterParagraphs(html, [3])).toEqual([html]);
  });

  it("returns one chunk for an empty string", () => {
    expect(splitHtmlAfterParagraphs("", [3, 7])).toEqual([""]);
  });
});
