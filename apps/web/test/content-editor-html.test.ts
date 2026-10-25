// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { MAX_PASTE_HTML_CHARS, htmlToMarkdown } from "../src/lib/content-editor/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, emphasis and links", () => {
    const md = htmlToMarkdown(
      '<h1>Main</h1><h3>Sub</h3><p>Some <b>bold</b> and <em>italic</em> and <a href="https://who.int/x">WHO</a>.</p>',
    );
    expect(md).toBe(
      "## Main\n\n### Sub\n\nSome **bold** and *italic* and [WHO](https://who.int/x).",
    );
  });

  it("handles a Google Docs fragment: normal-weight wrapper, bold spans, nested lists beside items", () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
      '<h2><span style="font-weight:700">عنوان</span></h2>' +
      '<p dir="rtl"><span style="font-weight:700">غامق</span><span> عادي</span></p>' +
      '<ul><li aria-level="1"><p><span>الأول</span></p></li><ul><li aria-level="2"><p><span>فرعي</span></p></li></ul>' +
      '<li aria-level="1"><p><span>الثاني</span></p></li></ul></b>';
    expect(htmlToMarkdown(html)).toBe("## عنوان\n\n**غامق** عادي\n\n- الأول\n  - فرعي\n- الثاني");
  });

  it("handles a Word fragment: MsoListParagraph fake lists and office tags", () => {
    const html =
      '<p class="MsoNormal">Intro<o:p></o:p></p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;</span></span>one</p>' +
      '<p class="MsoListParagraph" style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">o</span>two</p>';
    expect(htmlToMarkdown(html)).toBe("Intro\n\n- one\n  - two");
  });

  it("converts ordered and nested lists with the right indentation", () => {
    expect(htmlToMarkdown("<ol><li>a<ul><li>b</li></ul></li><li>c</li></ol>")).toBe(
      "1. a\n   - b\n2. c",
    );
  });

  it("converts a table to GFM and escapes pipes", () => {
    const md = htmlToMarkdown(
      "<table><tr><th>Drug</th><th>Dose</th></tr><tr><td>A|B</td><td>5 mg</td></tr></table>",
    );
    expect(md).toBe("| Drug | Dose |\n| --- | --- |\n| A\\|B | 5 mg |");
  });

  it("converts blockquotes and keeps RTL text", () => {
    expect(htmlToMarkdown("<blockquote><p>اقتباس</p></blockquote>")).toBe("> اقتباس");
  });

  it("drops images, scripts, styles, iframes, handlers and unsafe links", () => {
    const html =
      '<p onclick="x()">Hi <img src="https://evil/x.png" alt="x"> there</p>' +
      '<script>alert(1)</script><style>p{}</style><iframe src="https://e"></iframe>' +
      '<p><a href="javascript:alert(1)">bad</a> <a href="https://ok.com/a(b)">ok</a></p>';
    const md = htmlToMarkdown(html);
    expect(md).not.toMatch(/script|alert\(1\)|iframe|evil|onclick|javascript/);
    expect(md).toContain("Hi there");
    expect(md).toContain("bad");
    expect(md).toContain("[ok](https://ok.com/a(b%29)");
  });

  it("unwraps Google redirect links", () => {
    expect(
      htmlToMarkdown('<p><a href="https://www.google.com/url?q=https://who.int/a&sa=D">w</a></p>'),
    ).toBe("[w](https://who.int/a)");
  });

  it("ignores hidden elements and strips bidi control characters", () => {
    expect(htmlToMarkdown('<p>a‮ b</p><p style="display:none">secret</p>')).toBe("a b");
  });

  it("returns an empty string for huge input and for empty input", () => {
    expect(htmlToMarkdown(`<p>${"x".repeat(MAX_PASTE_HTML_CHARS)}</p>`)).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });
});
