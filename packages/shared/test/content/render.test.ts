import { describe, expect, it } from "vitest";

import { renderContent } from "../../src/content/render/index.js";
import { estimateJaccard, minhashSignature } from "../../src/content/similarity.js";

import {
  DECORATIVE_ID,
  MEDIA_ID,
  MEDIA_ORIGIN,
  NOT_READY_ID,
  TARGETS,
  renderInput,
  resolvers,
} from "./support/render-support.js";

const render = (bodyMd: string, overrides: Parameters<typeof renderInput>[1] = {}) =>
  renderContent(renderInput(bodyMd, overrides));
const codes = (result: Awaited<ReturnType<typeof render>>): string[] =>
  result.warnings.map((warning) => warning.code);

/** Filler that never contains an auto-link term. */
const filler = (count: number): string =>
  Array.from({ length: count }, (_, i) => `حشو${String(i)}`).join(" ");

describe("callouts", () => {
  it("renders :::note, :::warning and :::tip as labelled asides in Arabic", async () => {
    const result = await render(
      ":::note\nنص الملاحظة\n:::\n\n:::warning\nاحذر\n:::\n\n:::tip\nجر\u0651ب هذا\n:::",
    );
    expect(result.html).toContain(
      '<aside class="callout callout-note" role="note"><p><strong>ملاحظة</strong></p><p>نص الملاحظة</p></aside>',
    );
    expect(result.html).toContain(
      '<aside class="callout callout-warning" role="note"><p><strong>تنبيه طبي</strong></p><p>احذر</p></aside>',
    );
    expect(result.html).toContain(
      '<aside class="callout callout-tip" role="note"><p><strong>نصيحة</strong></p>',
    );
    expect(result.warnings).toEqual([]);
  });

  it("uses English labels for English content", async () => {
    const result = await render(":::warning\nCheck with your doctor.\n:::", { locale: "en" });
    expect(result.html).toContain("<strong>Medical caution</strong>");
  });

  it("takes a custom title from the directive label", async () => {
    const result = await render(":::note[تنبيه خاص]\nنص\n:::");
    expect(result.html).toContain("<strong>تنبيه خاص</strong>");
    expect(result.html).not.toContain("ملاحظة");
  });

  it("ignores attributes on the directive", async () => {
    const result = await render(':::note{#evil .x onclick="alert(1)"}\nنص\n:::');
    expect(result.html).toContain('<aside class="callout callout-note" role="note">');
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("evil");
  });

  it("unwraps unknown containers with a warning and keeps leaf directives as text", async () => {
    const result = await render(":::danger\nمحتوى\n:::\n\n::video[x]\n");
    expect(result.html).toContain("<p>محتوى</p>");
    expect(result.html).not.toContain("<aside");
    expect(result.warnings).toContainEqual({ code: "unknown_directive", detail: "danger" });
    expect(result.html).toContain("::video[x]");
  });

  it("gives prose containing a colon back untouched", async () => {
    const result = await render("Dose:morning and note:evening, time 10:30");
    expect(result.html).toBe("<p>Dose:morning and note:evening, time 10:30</p>");
  });

  it("nests blocks inside a callout", async () => {
    const result = await render(":::tip\n- واحد\n- اثنان\n:::");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<li>واحد</li>");
  });
});

describe("{{drug}} and {{glossary}}", () => {
  it("links known entities with the name as text and a title", async () => {
    const result = await render(
      "خذ {{drug:paracetamol}} عند الحاجة، ومعنى {{glossary:bid}} مرتين.",
    );
    expect(result.html).toContain(
      '<a href="/drugs/paracetamol" title="باراسيتامول" class="entity-link" data-entity="drug">باراسيتامول</a>',
    );
    expect(result.html).toContain(
      '<a href="/glossary/bid" title="مرتين يومي\u064Bا" class="entity-link" data-entity="glossary">BID</a>',
    );
    expect(result.entities).toEqual([
      { kind: "drug", slug: "paracetamol", source: "explicit" },
      { kind: "glossary", slug: "bid", source: "explicit" },
    ]);
  });

  it("uses the text after | as the link text", async () => {
    const result = await render("جرعة {{drug:paracetamol|البنادول}} الصغيرة");
    expect(result.html).toContain('data-entity="drug">البنادول</a>');
  });

  it("turns unknown entities into plain text with a warning", async () => {
    const result = await render("{{drug:nope}} و {{drug:nope2|نص مخصص}} و {{glossary:zzz}}");
    expect(result.html).toBe("<p>nope و نص مخصص و zzz</p>");
    expect(result.warnings).toEqual([
      { code: "unknown_drug", detail: "nope" },
      { code: "unknown_drug", detail: "nope2" },
      { code: "unknown_glossary", detail: "zzz" },
    ]);
    expect(result.entities).toEqual([]);
  });

  it("asks each resolver once per distinct slug", async () => {
    const { resolvers: r, calls } = resolvers();
    await render(
      "{{drug:paracetamol}} {{drug:paracetamol}} {{drug:ibuprofen}} {{glossary:bid}} {{glossary:bid}}",
      {
        resolvers: r,
      },
    );
    expect(calls.drug.sort()).toEqual(["ibuprofen", "paracetamol"]);
    expect(calls.glossary).toEqual(["bid"]);
    expect(calls.media).toEqual([]);
  });

  it("never calls a resolver for a malformed slug", async () => {
    const { resolvers: r, calls } = resolvers();
    const result = await render("{{drug:Bad Slug}} {{drug:../../etc}} {{glossary:UPPER}}", {
      resolvers: r,
    });
    expect(calls.drug).toEqual([]);
    expect(calls.glossary).toEqual([]);
    expect(codes(result)).toContain("invalid_directive");
  });

  it("keeps the literal text inside code spans and fences", async () => {
    const result = await render("نص `{{drug:paracetamol}}` ثم\n\n```\n{{glossary:bid}}\n```");
    expect(result.html).toContain("<code>{{drug:paracetamol}}</code>");
    expect(result.html).toContain("{{glossary:bid}}");
    expect(result.entities).toEqual([]);
  });

  it("does not nest a link inside a link", async () => {
    const result = await render("[انظر {{drug:paracetamol}}](/blog/x)");
    expect(result.html).toBe('<p><a href="/blog/x">انظر باراسيتامول</a></p>');
  });

  it("works inside headings, lists and tables", async () => {
    const result = await render(
      "## عن {{drug:paracetamol}}\n\n- {{glossary:bid}}\n\n| دواء |\n|--|\n| {{drug:ibuprofen}} |",
    );
    expect((result.html.match(/entity-link/g) ?? []).length).toBe(3);
    expect(result.headings[0]?.text).toBe("عن باراسيتامول");
  });

  it("strips tokens' stray markers from the source", async () => {
    const marker = String.fromCharCode(0xe000);
    const result = await render(`قبل ${marker}0${String.fromCharCode(0xe001)} بعد`);
    expect(result.html).toBe("<p>قبل 0 بعد</p>");
  });
});

describe("{{cta:analyze}} and {{nolink}}", () => {
  it("renders the fixed CTA block with a sign-up link (Arabic)", async () => {
    const result = await render("قبل\n\n{{cta:analyze}}\n\nبعد");
    expect(result.html).toContain(
      '<aside class="content-cta" data-cta="analyze"><p>هل لديك روشتة تحتاج إلى فهمها؟</p><p><a href="/register">جر\u0651ب تحليل روشتتك مجان\u064Bا</a></p></aside>',
    );
    expect(result.links).toEqual([]);
  });

  it("renders English copy for English content", async () => {
    const result = await render("{{cta:analyze}}", { locale: "en" });
    expect(result.html).toContain("Try the prescription reader free");
  });

  it("lifts the CTA out of a paragraph and allows only one", async () => {
    const result = await render("جملة {{cta:analyze}} أخرى\n\n{{cta:analyze}}");
    expect(result.html).toMatch(
      /<p>جملة<\/p>\s*<aside class="content-cta"[^>]*>.*<\/aside>\s*<p>أخرى<\/p>/s,
    );
    expect((result.html.match(/content-cta/g) ?? []).length).toBe(1);
    expect(codes(result)).toContain("cta_duplicate");
  });

  it("refuses unknown CTA kinds and a CTA inside a heading", async () => {
    const unknown = await render("{{cta:buy-now}}");
    expect(unknown.html).toBe("");
    expect(unknown.warnings).toContainEqual({ code: "unknown_cta", detail: "buy-now" });
    const inHeading = await render("## عنوان {{cta:analyze}}");
    expect(inHeading.html).not.toContain("content-cta");
    expect(codes(inHeading)).toContain("block_in_inline");
  });

  it("renders {{nolink:term}} as the plain term", async () => {
    const result = await render("نص {{nolink:باراسيتامول}} نص");
    expect(result.html).toBe("<p>نص باراسيتامول نص</p>");
  });
});

describe("images", () => {
  it("renders library images as figure/picture with AVIF and WebP sources and a JPEG fallback", async () => {
    const result = await render(`![صورة الدواء](media:${MEDIA_ID} "علبة الدواء")`);
    expect(result.html).toBe(
      `<figure><picture>` +
        `<source type="image/avif" srcset="${MEDIA_ORIGIN}/media/aa11/640.avif 640w, ${MEDIA_ORIGIN}/media/aa11/1280.avif 1280w" sizes="(min-width: 768px) 720px, 100vw">` +
        `<source type="image/webp" srcset="${MEDIA_ORIGIN}/media/aa11/640.webp 640w, ${MEDIA_ORIGIN}/media/aa11/1280.webp 1280w" sizes="(min-width: 768px) 720px, 100vw">` +
        `<img src="${MEDIA_ORIGIN}/media/aa11/1200.jpg" width="1200" height="675" alt="صورة الدواء" loading="lazy" decoding="async">` +
        `</picture><figcaption>علبة الدواء</figcaption></figure>`,
    );
    expect(result.images).toEqual([{ mediaId: MEDIA_ID, alt: "صورة الدواء", decorative: false }]);
  });

  it("falls back to the library alt and caption", async () => {
    const result = await render(`![](media:${MEDIA_ID})`);
    expect(result.html).toContain('alt="قرص دواء على طاولة"');
    expect(result.images[0]).toMatchObject({ alt: "قرص دواء على طاولة", decorative: false });
  });

  it("renders decorative images with an empty alt, exempt from the alt rule", async () => {
    const result = await render(`![نص ما](media:${DECORATIVE_ID})`);
    expect(result.html).toContain('alt=""');
    expect(result.images).toEqual([{ mediaId: DECORATIVE_ID, alt: "", decorative: true }]);
  });

  it("lifts the figure out of its paragraph", async () => {
    const result = await render(`قبل ![x](media:${MEDIA_ID}) بعد`);
    expect(result.html).toMatch(/^<p>قبل<\/p>\s*<figure>.*<\/figure>\s*<p>بعد<\/p>$/s);
    expect(result.html).not.toMatch(/<p>[^<]*<figure/);
  });

  it("warns and renders nothing for an unknown media id", async () => {
    const result = await render("![x](media:99999999-9999-4999-8999-999999999999)");
    expect(result.html).toBe("");
    expect(result.warnings).toEqual([
      { code: "unknown_media", detail: "99999999-9999-4999-8999-999999999999" },
    ]);
    expect(result.images).toEqual([]);
  });

  it("warns for an image that has no variants yet", async () => {
    const result = await render(`![x](media:${NOT_READY_ID})`);
    expect(result.html).toBe("");
    expect(codes(result)).toEqual(["media_not_ready"]);
  });

  it("refuses external images, reference-style ones included", async () => {
    const result = await render(
      "![a](https://evil.example/x.png)\n\n![b][ref]\n\n![c](//evil.example/y.png)\n\n![d](data:image/png;base64,AAAA)\n\n[ref]: https://evil.example/z.png",
    );
    expect(result.html).toBe("");
    expect(
      result.warnings.filter((warning) => warning.code === "external_image_refused"),
    ).toHaveLength(4);
  });

  it("asks the media resolver once with every distinct id", async () => {
    const { resolvers: r, calls } = resolvers();
    await render(
      `![a](media:${MEDIA_ID})\n\n![b](media:${MEDIA_ID})\n\n![c](media:${DECORATIVE_ID})`,
      { resolvers: r },
    );
    expect(calls.media).toHaveLength(1);
    expect([...(calls.media[0] ?? [])].sort()).toEqual([DECORATIVE_ID, MEDIA_ID].sort());
  });

  it("drops an image nested in a link", async () => {
    const result = await render(`[![x](media:${MEDIA_ID})](/blog/a)`);
    expect(result.html).not.toContain("<figure");
    expect(codes(result)).toContain("block_in_inline");
  });

  it("never emits an image host other than the media origin", async () => {
    const result = await render(`![a](media:${MEDIA_ID})`, {
      mediaOrigin: "https://cdn.example.org",
    });
    const hosts = [...result.html.matchAll(/https?:\/\/[^/"\s]+/g)].map((match) => match[0]);
    expect(new Set(hosts)).toEqual(new Set(["https://cdn.example.org"]));
  });
});

describe("headings, ids and TOC", () => {
  it("renders # as h2 with a warning", async () => {
    const result = await render("# عنوان رئيسي\n\nنص");
    expect(result.html).toContain("<h2 id=");
    expect(result.html).not.toContain("<h1");
    expect(result.warnings).toEqual([{ code: "h1_in_body" }]);
  });

  it("records skipped levels", async () => {
    const result = await render("## أ\n\n#### د\n\n### ج");
    expect(result.warnings).toEqual([{ code: "heading_skip", detail: "h2-h4" }]);
    const first = await render("### يبدأ من ثلاثة");
    expect(first.warnings).toEqual([{ code: "heading_skip", detail: "h1-h3" }]);
  });

  it("clamps h5 and h6 to h4", async () => {
    const result = await render("## أ\n\n### ب\n\n#### ج\n\n##### د\n\n###### هـ");
    expect(result.html).not.toMatch(/<h[56]/);
    expect(result.headings.map((heading) => heading.level)).toEqual([2, 3, 4, 4, 4]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "heading_clamped",
      "heading_clamped",
    ]);
  });

  it("makes stable, unique, transliterated ids and a matching TOC", async () => {
    const md =
      "## الأعراض\n\n### الصداع\n\n## الأعراض\n\n### Treatment options\n\n## Treatment options";
    const first = await render(md);
    const second = await render(md);
    expect(first.headings).toEqual(second.headings);
    expect(first.headings.map((heading) => heading.id)).toEqual([
      "alaarad",
      "alsdaa",
      "alaarad-2",
      "treatment-options",
      "treatment-options-2",
    ]);
    expect(first.toc).toEqual(first.headings.map(({ id, text, level }) => ({ id, text, level })));
    for (const entry of first.toc) expect(first.html).toContain(`id="${entry.id}"`);
  });

  it("keeps ids free of the clobber prefix", async () => {
    const result = await render("## Intro");
    expect(result.html).toBe('<h2 id="intro">Intro</h2>');
  });

  it("includes the footnotes heading in the TOC without colliding with a body heading", async () => {
    const result = await render("## Footnote label\n\nنص[^1]\n\n[^1]: مرجع");
    const ids = result.headings.map((heading) => heading.id);
    expect(ids).toEqual(["footnote-label-2", "footnote-label"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.html).toContain(
      '<section data-footnotes class="footnotes"><h2 id="footnote-label">المراجع والهوامش</h2>',
    );
    expect(result.html).toContain('href="#fn-1"');
    expect(result.html).toContain('id="fn-1"');
    expect(result.html).toContain('aria-label="العودة إلى المرجع 1"');
  });

  it("uses English footnote labels for English content", async () => {
    const result = await render("Text[^a]\n\n[^a]: Source", { locale: "en" });
    expect(result.html).toContain("References and footnotes");
    expect(result.html).toContain('aria-label="Back to reference 1"');
  });
});

describe("links", () => {
  it("adds noopener noreferrer nofollow to external links", async () => {
    const result = await render("[مصدر](https://example.com/page)");
    expect(result.html).toBe(
      '<p><a href="https://example.com/page" rel="noopener noreferrer nofollow">مصدر</a></p>',
    );
    expect(result.links).toEqual([
      {
        href: "https://example.com/page",
        internal: false,
        rel: "noopener noreferrer nofollow",
        anchor: "مصدر",
      },
    ]);
  });

  it("drops nofollow for allow-listed hosts and their subdomains", async () => {
    const result = await render(
      "[a](https://www.who.int/x) [b](https://pubmed.nih.gov/1) [c](https://notwho.int/x)",
    );
    expect(result.links.map((link) => link.rel)).toEqual([
      "noopener noreferrer",
      "noopener noreferrer",
      "noopener noreferrer nofollow",
    ]);
  });

  it("adds sponsored for sponsored content", async () => {
    const result = await render("[a](https://example.com)", {
      flags: { autoLink: false, sponsored: true },
    });
    expect(result.links[0]?.rel).toBe("noopener noreferrer sponsored nofollow");
  });

  it("keeps site-relative links and anchors without rel and marks relative links internal", async () => {
    const result = await render("[a](/blog/x) [b](#section) [c](/en/blog/y?z=1#h)");
    expect(result.html).toBe(
      '<p><a href="/blog/x">a</a> <a href="#section">b</a> <a href="/en/blog/y?z=1#h">c</a></p>',
    );
    expect(result.links.map((link) => [link.href, link.internal])).toEqual([
      ["/blog/x", true],
      ["/en/blog/y?z=1#h", true],
    ]);
  });

  it("autolinks bare URLs through the same policy", async () => {
    const result = await render("زر https://example.com/a و www.example.org");
    expect(result.links.map((link) => link.href)).toEqual([
      "https://example.com/a",
      "http://www.example.org/",
    ]);
    expect(result.links.every((link) => link.rel.includes("nofollow"))).toBe(true);
  });

  it("removes links with any other scheme, keeping the text", async () => {
    const result = await render(
      "[a](mailto:x@y.z) [b](tel:123) [c](ftp://x/y) [d](relative/path) [e](//evil.example/x)",
    );
    expect(result.html).toBe("<p>a b c d e</p>");
    expect(result.links).toEqual([]);
    expect(
      result.warnings.filter((warning) => warning.code === "unsafe_link_removed"),
    ).toHaveLength(5);
  });

  it("escapes quotes and drops angle brackets in link titles", async () => {
    const result = await render('[a](/x "عنوان \\"مقتبس\\" و <b>")');
    expect(result.html).toContain('title="عنوان &#x22;مقتبس&#x22; و b"');
  });
});

describe("bidi controls", () => {
  it("strips them with a warning and keeps the visible text", async () => {
    const rlo = String.fromCharCode(0x202e);
    const pdf = String.fromCharCode(0x202c);
    const result = await render(`نص ${rlo}مخفي${pdf} [رابط${rlo}](/x)`);
    expect(result.html).toBe('<p>نص مخفي <a href="/x">رابط</a></p>');
    expect(result.warnings).toEqual([{ code: "bidi_controls_removed" }]);
  });
});

describe("raw HTML, tables and other markdown", () => {
  it("drops raw HTML and warns", async () => {
    const result = await render(
      "قبل <b>غامق</b> بعد\n\n<div onclick=x>كتلة</div>\n\n<script>alert(1)</script>",
    );
    expect(result.html).not.toMatch(/<(b|div|script)/);
    expect(result.warnings).toContainEqual({ code: "raw_html_dropped" });
  });

  it("renders GFM tables with alignment, strikethrough and literal task markers", async () => {
    const result = await render(
      "| الدواء | الجرعة |\n|:--|--:|\n| أ | 5 |\n\n~~قديم~~\n\n- [ ] مهمة\n- [x] منجزة",
    );
    expect(result.html).toContain('<th align="left">الدواء</th>');
    expect(result.html).toContain('<th align="right">الجرعة</th>');
    expect(result.html).toContain("<del>قديم</del>");
    expect(result.html).toContain("<li>[ ] مهمة</li>");
    expect(result.html).toContain("<li>[x] منجزة</li>");
    expect(result.html).not.toContain("<input");
  });

  it("renders code blocks with a language class and nothing else", async () => {
    const result = await render("```js\nconst a = 1 < 2;\n```");
    expect(result.html).toBe('<pre><code class="language-js">const a = 1 &#x3C; 2;\n</code></pre>');
  });

  it("renders an empty body to an empty result", async () => {
    const result = await render("");
    expect(result).toMatchObject({
      html: "",
      toc: [],
      wordCount: 0,
      readingMinutes: 1,
      links: [],
      images: [],
      entities: [],
      warnings: [],
    });
  });
});

describe("auto-link", () => {
  const on = { flags: { autoLink: true } } as const;

  it("links only the first mention of each target", async () => {
    const result = await render(
      "باراسيتامول مسكن. وجرعة باراسيتامول صغيرة. و Ibuprofen ثم Ibuprofen",
      {
        ...on,
        settings: {
          autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
          dofollowDomains: [],
        },
      },
    );
    expect((result.html.match(/<a /g) ?? []).length).toBe(2);
    expect(result.html).toMatch(
      /^<p><a href="\/drugs\/paracetamol"[^>]*>باراسيتامول<\/a> مسكن\. وجرعة باراسيتامول صغيرة/,
    );
    expect(result.entities).toEqual([
      { kind: "drug", slug: "paracetamol", source: "auto" },
      { kind: "drug", slug: "ibuprofen", source: "auto" },
    ]);
  });

  it("honours maxPerTarget", async () => {
    const result = await render("باراسيتامول و باراسيتامول و باراسيتامول و باراسيتامول", {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 3, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect((result.html.match(/<a /g) ?? []).length).toBe(3);
  });

  it("keeps at least minWordsBetween words between two auto-links", async () => {
    const text = `باراسيتامول ${filler(30)} Ibuprofen ${filler(120)} دليل الصداع`;
    const tight = await render(text, {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 50 },
        dofollowDomains: [],
      },
    });
    // Ibuprofen is 31 words after the first link: too close. The third is far enough from the first.
    expect(tight.entities.map((entity) => entity.slug)).toEqual(["paracetamol"]);
    expect(tight.html).toContain('href="/guides/headache-guide"');
    const loose = await render(text, {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 10 },
        dofollowDomains: [],
      },
    });
    expect(loose.entities.map((entity) => entity.slug)).toEqual(["paracetamol", "ibuprofen"]);
  });

  it("defaults to a 120-word gap", async () => {
    const result = await render(
      `باراسيتامول ${filler(100)} Ibuprofen ${filler(130)} Ibuprofen`,
      on,
    );
    expect(result.entities.map((entity) => entity.slug)).toEqual(["paracetamol", "ibuprofen"]);
    expect(result.html.indexOf("/drugs/ibuprofen")).toBeGreaterThan(
      result.html.indexOf(filler(100).slice(-12)),
    );
  });

  it("never links inside headings, links, code, footnote definitions, callout titles or image alts", async () => {
    const md = [
      "## باراسيتامول في العنوان",
      "",
      "[باراسيتامول](/blog/x) و `باراسيتامول` ثم",
      "",
      "```",
      "باراسيتامول",
      "```",
      "",
      `![باراسيتامول](media:${MEDIA_ID})`,
      "",
      ":::note[باراسيتامول]\nنص\n:::",
      "",
      "نص[^1]",
      "",
      "[^1]: باراسيتامول في الهامش",
    ].join("\n");
    const result = await render(md, {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 5, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(result.html).not.toContain("/drugs/paracetamol");
    expect(result.entities).toEqual([]);
  });

  it("links inside callout bodies, lists and table cells", async () => {
    const result = await render(":::note\nيحتوي على باراسيتامول\n:::", {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(result.html).toContain('<a href="/drugs/paracetamol"');
  });

  it("respects Unicode word boundaries", async () => {
    const settings = {
      autoLink: { enabled: true, maxPerTarget: 5, minWordsBetween: 0 },
      dofollowDomains: [],
    };
    const none = await render(
      "باراسيتامولات و xباراسيتامول و Paracetamolx و 5باراسيتامول و Ibuprofen2",
      { ...on, settings },
    );
    expect(none.html).not.toContain("<a ");
    const some = await render("(باراسيتامول) و«باراسيتامول» و,Paracetamol.", { ...on, settings });
    expect((some.html.match(/<a /g) ?? []).length).toBe(3);
  });

  it("tolerates Arabic letter variants, tashkeel and the definite article", async () => {
    const settings = {
      autoLink: { enabled: true, maxPerTarget: 10, minWordsBetween: 0 },
      dofollowDomains: [],
    };
    const variants = [
      "استخدم أسيتامينوفين",
      "استخدم اسيتامينوفين",
      "استخدم إسيتامينوفين",
      "استخدم أ\u064Eس\u0650يت\u064Eام\u0650ين\u064Fوف\u0650ين",
      "استخدم الأسيتامينوفين",
      "استخدم بالأسيتامينوفين",
      "استخدم ايبوبروفين",
      "استخدم إيبوبروفين",
      "استخدم أيبوبروفين",
      "استخدم ايبوبروفىن",
    ];
    for (const text of variants) {
      const result = await render(text, { ...on, settings });
      expect(result.html, text).toContain('<a href="/drugs/');
    }
  });

  it("folds ta marbuta and ha and matches multi-word terms across spacing", async () => {
    const settings = {
      autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
      dofollowDomains: [],
    };
    const targets = [
      {
        kind: "glossary" as const,
        slug: "x",
        terms: ["جرعة زائدة"],
        path: "/glossary/x",
        title: "t",
      },
    ];
    const { resolvers: r } = resolvers(targets);
    const result = await render("حدثت جرعه   زائده بعد ذلك", { ...on, settings, resolvers: r });
    expect(result.html).toContain('<a href="/glossary/x"');
    expect(result.entities).toEqual([{ kind: "glossary", slug: "x", source: "auto" }]);
  });

  it("prefers the longer term when two start at the same place", async () => {
    const targets = [
      {
        kind: "drug" as const,
        slug: "short",
        terms: ["باراسيتامول"],
        path: "/drugs/short",
        title: "s",
      },
      {
        kind: "drug" as const,
        slug: "long",
        terms: ["باراسيتامول فوار"],
        path: "/drugs/long",
        title: "l",
      },
    ];
    const { resolvers: r } = resolvers(targets);
    const result = await render("نستخدم باراسيتامول فوار هنا", {
      ...on,
      resolvers: r,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(result.html).toContain('<a href="/drugs/long"');
    expect(result.html).not.toContain("/drugs/short");
  });

  it("skips {{nolink}} text and targets already linked explicitly", async () => {
    const settings = {
      autoLink: { enabled: true, maxPerTarget: 2, minWordsBetween: 0 },
      dofollowDomains: [],
    };
    const nolink = await render("{{nolink:باراسيتامول}} ثم باراسيتامول", { ...on, settings });
    expect((nolink.html.match(/<a /g) ?? []).length).toBe(1);
    const explicit = await render("هنا باراسيتامول وبعده {{drug:paracetamol}}", {
      ...on,
      settings,
    });
    expect((explicit.html.match(/<a /g) ?? []).length).toBe(1);
    expect(explicit.entities).toEqual([{ kind: "drug", slug: "paracetamol", source: "explicit" }]);
  });

  it("is off unless both the item flag and the setting allow it", async () => {
    const md = "باراسيتامول";
    expect((await render(md, { flags: { autoLink: false } })).html).toBe("<p>باراسيتامول</p>");
    const disabled = await render(md, {
      flags: { autoLink: true },
      settings: {
        autoLink: { enabled: false, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(disabled.html).toBe("<p>باراسيتامول</p>");
  });

  it("links content pages without recording an entity", async () => {
    const result = await render("اقرأ دليل الصداع", {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(result.html).toBe(
      '<p>اقرأ <a href="/guides/headache-guide" title="دليل الصداع">دليل الصداع</a></p>',
    );
    expect(result.entities).toEqual([]);
    expect(result.links).toEqual([
      { href: "/guides/headache-guide", internal: true, rel: "", anchor: "دليل الصداع" },
    ]);
  });

  it("keeps the original spelling as link text", async () => {
    const result = await render("جرعة الأسيتامينوفين", {
      ...on,
      settings: {
        autoLink: { enabled: true, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
    });
    expect(result.html).toContain(">الأسيتامينوفين</a>");
  });

  it("handles a large target list", async () => {
    const many = Array.from({ length: 800 }, (_, i) => ({
      kind: "drug" as const,
      slug: `drug-${String(i)}`,
      terms: [`دواء${String(i)}x`, `Drug${String(i)}`],
      path: `/drugs/drug-${String(i)}`,
      title: "t",
    }));
    const { resolvers: r } = resolvers([...many, ...TARGETS]);
    const started = performance.now();
    const result = await render(`${filler(3_000)} باراسيتامول`, { ...on, resolvers: r });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.html).toContain("/drugs/paracetamol");
  });
});

describe("result facts", () => {
  it("counts words from the author's text, not from markup, tokens or generated blocks", async () => {
    const result = await render(
      "## عنوان\n\nكلمة **غامقة** [رابط](/x) {{drug:paracetamol}}\n\n:::note\nثلاث كلمات هنا\n:::\n\n{{cta:analyze}}",
    );
    expect(result.wordCount).toBe(1 + 1 + 1 + 1 + 1 + 3);
    expect(result.readingMinutes).toBe(1);
  });

  it("counts words of separate blocks separately", async () => {
    const result = await render("## واحد\n\nاثنان\n\n- ثلاثة\n- أربعة");
    expect(result.wordCount).toBe(4);
  });

  it("computes reading minutes at 200 words per minute", async () => {
    const result = await render(filler(450));
    expect(result.wordCount).toBe(450);
    expect(result.readingMinutes).toBe(3);
  });

  it("returns a MinHash signature that matches the same text and not another", async () => {
    const a = await render(filler(60));
    const b = await render(filler(60));
    const other = await render(Array.from({ length: 60 }, (_, i) => `مختلف${String(i)}`).join(" "));
    expect(a.minhash).toHaveLength(512);
    expect(estimateJaccard(a.minhash, b.minhash)).toBe(1);
    expect(estimateJaccard(a.minhash, other.minhash)).toBeLessThan(0.1);
    expect(Array.from(a.minhash)).toEqual(Array.from(minhashSignature(filler(60))));
  });

  it("is deterministic: the same input gives byte-identical output", async () => {
    const md =
      "## أ\n\nباراسيتامول [x](https://example.com) {{drug:ibuprofen}}\n\n:::tip\nنص\n:::\n\n{{cta:analyze}}";
    const run = () => render(md, { flags: { autoLink: true } });
    const first = await run();
    const second = await run();
    expect(second.html).toBe(first.html);
    expect(second.toc).toEqual(first.toc);
    expect(second.warnings).toEqual(first.warnings);
  });

  it("dedupes repeated warnings", async () => {
    const result = await render("{{drug:nope}} {{drug:nope}} {{drug:nope}}");
    expect(result.warnings).toEqual([{ code: "unknown_drug", detail: "nope" }]);
  });
});
