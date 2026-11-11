import { describe, expect, it } from "vitest";

import { htmlToMarkdown } from "../src/html-to-markdown.js";

describe("htmlToMarkdown HTML5 import boundary", () => {
  it("uses parsed attributes correctly when quoted values contain >", () => {
    expect(htmlToMarkdown('<a href="https://example.test/a?x=>y" title="ignored">safe</a>')).toContain("[safe](https://example.test/a?x=%3Ey)");
    expect(htmlToMarkdown('<img data-alt="wrong" alt="right > here" src="https://never-fetch.test/x">')).toContain("right \\> here");
  });

  it("does not mistake comments or tag-like text for active markup", () => {
    const result = htmlToMarkdown('<!-- <script>comment</script> --><p>Text containing &lt;script&gt;literal&lt;/script&gt;.</p>');
    expect(result).toContain("literal");
    expect(result).not.toContain("comment");
  });

  it("handles HTML5 misnesting and drops nested or malformed active subtrees", () => {
    const result = htmlToMarkdown('<p>one<div>two</p>three</div><script>outer<script>inner</script>end</script><style>bad');
    expect(result).toContain("one");
    expect(result).toContain("three");
    expect(result).not.toMatch(/outer|inner|bad/);
  });

  it("drops SVG, MathML, forms, and media subtrees while ignoring non-exact attributes", () => {
    const result = htmlToMarkdown('<svg><text>svg-secret</text></svg><math><mi>math-secret</mi></math><form><p>form-secret</p></form><video><source src="x">media-secret</video><a data-href="https://bad.test" xhref="https://bad.test">plain</a><a href="//bad.test">relative?</a><a href="/safe/path">safe</a>');
    expect(result).not.toMatch(/svg-secret|math-secret|form-secret|media-secret|bad\.test/);
    expect(result).toContain("plain");
    expect(result).toContain("[safe](/safe/path)");
  });

  it("allows HTTP(S) and safe relative links, and rejects dangerous schemes", () => {
    const result = htmlToMarkdown('<a href="javascript:alert(1)">bad</a><a href="https://example.test/x">https</a><a href="../relative">relative</a><a href="data:text/html,x">data</a>');
    expect(result).toContain("https://example.test/x");
    expect(result).toContain("../relative");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("data:text");
  });

  it("bounds source, converted output, node count, and nesting", () => {
    expect(() => htmlToMarkdown("x".repeat(200 * 1024 + 1))).toThrow(/200 KB/);
    expect(() => htmlToMarkdown("#".repeat(110_000))).toThrow(/Markdown exceeds/);
    expect(() => htmlToMarkdown("<p>x</p>".repeat(16_001))).toThrow(/complex/);
    expect(() => htmlToMarkdown(`${"<div>".repeat(110)}x${"</div>".repeat(110)}`)).toThrow(/deeply nested/);
  });
});
