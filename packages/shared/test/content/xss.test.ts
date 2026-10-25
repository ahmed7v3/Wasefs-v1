import { describe, expect, it } from "vitest";

import { renderContent, SANITIZE_SCHEMA } from "../../src/content/render/index.js";

import { MEDIA_ID, MEDIA_ORIGIN, renderInput } from "./support/render-support.js";

/*
 * XSS corpus for the Markdown renderer + sanitiser (CONTENT-PLATFORM §11.3). Every payload is rendered
 * alone and inside a list item, a blockquote and a table cell; the output is then parsed with a small
 * HTML tokenizer (not a regex over text) so that an attack hidden inside an escaped attribute value
 * is told apart from an attribute that really exists.
 */

const TAB = String.fromCharCode(9);
const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);
const LRO = String.fromCharCode(0x202d);
const PDF = String.fromCharCode(0x202c);
const RLI = String.fromCharCode(0x2067);
const PDI = String.fromCharCode(0x2069);
const RLM = String.fromCharCode(0x200f);
const ALM = String.fromCharCode(0x061c);

const PAYLOADS: string[] = [
  // Script, frames, embeds, SVG/MathML, style
  "<script>alert(1)</script>",
  "<SCRIPT SRC=//evil.example/x.js></SCRIPT>",
  '<iframe src="https://evil.example"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  "<svg onload=alert(1)>",
  "<svg><script>alert(1)</script></svg>",
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  "<style>body{display:none}</style>",
  '<div style="background:url(javascript:alert(1))">x</div>',
  // Raw event handlers
  "<img src=x onerror=alert(1)>",
  '<img src="x" onerror="alert(1)">',
  "<body onload=alert(1)>",
  '<div onmouseover="alert(1)">hover</div>',
  "<details open ontoggle=alert(1)>",
  "<video><source onerror=alert(1)></video>",
  '<a href="x" onclick="alert(1)">*em*</a>',
  // Other dangerous elements
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  "<link rel=stylesheet href=//evil.example/x.css>",
  "<form action=javascript:alert(1)><input type=submit></form>",
  '<base href="https://evil.example/">',
  "<template><script>alert(1)</script></template>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  "<textarea><script>alert(1)</script></textarea>",
  // javascript: in every disguise
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  `[x](<java${TAB}script:alert(1)>)`,
  "[x](jav&#x09;ascript:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](javascript&colon;alert(1))",
  "[x](&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#58;alert(1))",
  "[x](  javascript:alert(1))",
  `[x](java${NUL}script:alert(1))`,
  "[x][r]\n\n[r]: javascript:alert(1)",
  "<javascript:alert(1)>",
  "<JAVASCRIPT:alert(1)>",
  // data:, vbscript:, protocol-relative and other schemes
  "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[x](<data:text/html,<script>alert(1)</script>>)",
  "<data:text/html,x>",
  "[x](vbscript:msgbox(1))",
  "[x](//evil.example/path)",
  "[x]( /\\evil.example)",
  "[x][r]\n\n[r]: //evil.example",
  "[x](file:///etc/passwd)",
  "[x](http://user:pass@evil.example/)",
  // Attribute injection through titles, URLs and labels
  '[x](https://evil.example/ "t\\" onmouseover=\\"alert(1)")',
  '[x](/a "<script>alert(1)</script>")',
  '[x](https://evil.example/?q="onmouseover="alert(1))',
  'www.evil.example/"onmouseover="alert(1)',
  'a"onmouseover="alert(1)@evil.example',
  // Images
  "![x](https://evil.example/x.png)",
  '![x](https://evil.example/x.png "t")',
  "![x](javascript:alert(1))",
  "![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
  "![x][r]\n\n[r]: https://evil.example/i.png",
  "![x](//evil.example/i.png)",
  "![x](media:../../etc/passwd)",
  '![x](media:" onerror="alert(1))',
  `![x](media:${MEDIA_ID} "\\" onerror=\\"alert(1)")`,
  `![<script>alert(1)</script>](media:${MEDIA_ID})`,
  // Directives and the micro-syntax
  ':::note{onclick="alert(1)"}\nx\n:::',
  ':::note{#x .y style="display:none" onmouseover=alert(1)}\nx\n:::',
  ":::note[<img src=x onerror=alert(1)>]\nx\n:::",
  "::leaf{onclick=alert(1)}",
  ":text{onclick=alert(1)}",
  '{{drug:x" onclick="alert(1)}}',
  "{{glossary:<script>alert(1)</script>}}",
  "{{drug:paracetamol|<img src=x onerror=alert(1)>}}",
  '{{drug:paracetamol|"><script>alert(1)</script>}}',
  "{{nolink:<script>alert(1)</script>}}",
  // Footnote id injection
  'x[^a"onfocus="alert(1)]\n\n[^a"onfocus="alert(1)]: y',
  'x[^"><script>alert(1)</script>]\n\n[^"><script>alert(1)</script>]: y',
  "x[^1]\n\n[^1]: <img src=x onerror=alert(1)>",
  // Bidi tricks
  `safe ${RLO}txt.exe${PDF}`,
  `[click${RLO}lave${PDF}](javascript:alert(1))`,
  `${LRO}${RLI}text${PDI}${RLM}${ALM}`,
  `[a${RLO}](/x "${RLO}title")`,
  // Entities, NUL bytes, nested and unclosed markup
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;script&#62;alert(1)&#60;/script&#62;",
  `<scr${NUL}ipt>alert(1)</scr${NUL}ipt>`,
  "<div><p><b><i>unclosed",
  "<<script>script>alert(1)<</script>/script>",
  '<img src="x"',
  "<!-- <script>alert(1)</script> -->",
  "<!--[if IE]><script>alert(1)</script><![endif]-->",
  "<![CDATA[<script>alert(1)</script>]]>",
  "<?php echo 1; ?>",
  // Code, headings, emphasis
  "```html\n<script>alert(1)</script>\n```",
  "`<img src=x onerror=alert(1)>`",
  "## <script>alert(1)</script>",
  '# "><img src=x onerror=alert(1)>',
  "**<script>**alert(1)**</script>**",
  // Arabic
  "[اضغط هنا](javascript:alert(1))",
  "<img src=x onerror=alert('مرحبا')>",
  "نص <script>alert('مرحبا')</script> نص",
];

const CONTEXTS: { name: string; wrap: (payload: string) => string }[] = [
  { name: "paragraph", wrap: (payload) => payload },
  { name: "list item", wrap: (payload) => `- ${payload.replaceAll("\n", "\n  ")}` },
  {
    name: "blockquote",
    wrap: (payload) =>
      payload
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
  },
  { name: "table cell", wrap: (payload) => `| h |\n|--|\n| ${payload.replaceAll("\n", " ")} |` },
  { name: "callout", wrap: (payload) => `:::tip\n${payload}\n:::` },
];

const ALLOWED_TAGS = new Set(SANITIZE_SCHEMA.tagNames);
const ALLOWED_ATTRIBUTES = new Set([
  "href",
  "title",
  "rel",
  "id",
  "class",
  "data-entity",
  "data-footnote-ref",
  "data-footnote-backref",
  "data-footnotes",
  "data-cta",
  "aria-label",
  "aria-describedby",
  "align",
  "role",
  "type",
  "srcset",
  "sizes",
  "src",
  "width",
  "height",
  "alt",
  "loading",
  "decoding",
  "start",
]);
const BIDI = new RegExp(
  `[${String.fromCharCode(0x202a)}-${String.fromCharCode(0x202e)}${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}${String.fromCharCode(0x200e)}${String.fromCharCode(0x200f)}${String.fromCharCode(0x061c)}]`,
);
const TAG = /<(\/?)([a-zA-Z][^\s/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTRIBUTE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

interface ParsedTag {
  name: string;
  attributes: [string, string][];
}

function parse(html: string): { tags: ParsedTag[]; text: string } {
  const tags: ParsedTag[] = [];
  const text = html.replace(TAG, (_whole, closing: string, name: string, rest: string) => {
    if (closing === "") {
      const attributes: [string, string][] = [];
      for (const match of rest.matchAll(ATTRIBUTE)) {
        attributes.push([match[1] ?? "", match[2] ?? match[3] ?? match[4] ?? ""]);
      }
      tags.push({ name: name.toLowerCase(), attributes });
    } else tags.push({ name: `/${name.toLowerCase()}`, attributes: [] });
    return "\u0001";
  });
  return { tags, text };
}

/** Asserts the properties an attacker must not be able to reach, on the parsed output. */
function assertSafe(html: string, label: string): void {
  const { tags, text } = parse(html);

  // 1. Only allow-listed elements, and no attribute outside the allow-list (no on*, style, srcdoc...).
  for (const tag of tags) {
    const name = tag.name.replace(/^\//, "");
    expect(ALLOWED_TAGS.has(name), `${label}: element <${name}> in ${html}`).toBe(true);
    for (const [attribute, value] of tag.attributes) {
      expect(ALLOWED_ATTRIBUTES.has(attribute), `${label}: attribute ${attribute} in ${html}`).toBe(
        true,
      );
      expect(attribute.startsWith("on"), `${label}: ${attribute}`).toBe(false);
      expect(attribute).not.toBe("style");

      // 2. URL-carrying attributes: only http(s) absolute, site-relative paths and fragments.
      if (attribute === "href") {
        const cleaned = value.replace(/[\p{Cc}\s]/gu, "");
        expect(/^(?:#|\/(?![/\\])|https?:\/\/)/i.test(cleaned), `${label}: href ${value}`).toBe(
          true,
        );
        expect(/^(?:javascript|data|vbscript):/i.test(cleaned)).toBe(false);
      }
      if (attribute === "src") {
        expect(value.startsWith(`${MEDIA_ORIGIN}/`), `${label}: src ${value}`).toBe(true);
      }
      if (attribute === "srcset") {
        for (const candidate of value.split(",")) {
          expect(
            (candidate.trim().split(/\s+/)[0] ?? "").startsWith(`${MEDIA_ORIGIN}/`),
            `${label}: srcset ${value}`,
          ).toBe(true);
        }
      }
    }
    if (
      name === "a" &&
      tag.attributes.some(([attribute, value]) => attribute === "href" && /^https?:/i.test(value))
    ) {
      const rel = tag.attributes.find(([attribute]) => attribute === "rel")?.[1] ?? "";
      expect(rel, `${label}: external link without rel`).toContain("noopener");
    }
  }

  // 3. No raw angle bracket can start markup in the text between tags.
  expect(text, `${label}: markup in text`).not.toMatch(/<[a-zA-Z/!?]/);

  // 4. The textual patterns of the brief, on the part of the output where they would be live: the tags themselves.
  const live = tags
    .map((tag) => `<${tag.name} ${tag.attributes.map(([name]) => `${name}=`).join(" ")}>`)
    .join("");
  for (const pattern of [
    /<script/i,
    /\bon\w+\s*=/i,
    /<iframe/i,
    /<object/i,
    /<embed/i,
    /<svg/i,
    /<math/i,
    /<style/i,
    /\bstyle\s*=/i,
    /<link/i,
    /<meta/i,
    /<base/i,
    /<form/i,
  ]) {
    expect(live, `${label}: ${String(pattern)}`).not.toMatch(pattern);
  }
  // Escaped, they may only appear as text, never as a tag opener.
  expect(html, `${label}: raw <script`).not.toMatch(/<script/i);
  expect(html, `${label}: raw <iframe`).not.toMatch(/<(iframe|object|embed|svg|math|style)/i);
  expect(BIDI.test(html), `${label}: bidi control`).toBe(false);
  expect(html.includes(NUL), `${label}: NUL`).toBe(false);
}

describe(`XSS corpus (${String(PAYLOADS.length)} payloads x ${String(CONTEXTS.length)} contexts)`, () => {
  it("has at least 50 payloads", () => {
    expect(PAYLOADS.length).toBeGreaterThanOrEqual(50);
  });

  for (const context of CONTEXTS) {
    it(`renders every payload safely inside a ${context.name}`, async () => {
      for (const [index, payload] of PAYLOADS.entries()) {
        for (const locale of ["ar", "en"] as const) {
          const result = await renderContent(
            renderInput(context.wrap(payload), { locale, flags: { autoLink: true } }),
          );
          assertSafe(
            result.html,
            `#${String(index)} ${JSON.stringify(payload)} (${context.name}, ${locale})`,
          );
        }
      }
    });
  }

  it("never renders an image or link target outside the allow-list, whatever the surrounding markdown", async () => {
    const hostile = PAYLOADS.join("\n\n");
    const result = await renderContent(renderInput(hostile, { flags: { autoLink: true } }));
    assertSafe(result.html, "all payloads in one document");
    for (const link of result.links) {
      expect(/^(?:\/(?![/\\])|https?:\/\/)/.test(link.href), link.href).toBe(true);
    }
    expect(result.images.every((image) => image.mediaId === MEDIA_ID)).toBe(true);
  });
});

describe("targeted XSS assertions", () => {
  const render = (md: string) => renderContent(renderInput(md));

  it("drops raw HTML blocks entirely and inline tags but not their text", async () => {
    expect((await render('<script>alert(1)</script><b onclick="x">bold</b>')).html).toBe("");
    expect((await render('a <b onclick="x">bold</b> c <i>d</i>')).html).toBe("<p>a bold c d</p>");
  });

  it("turns a javascript: link into its label and an autolink into nothing", async () => {
    expect((await render("[click me](javascript:alert(1))")).html).toBe("<p>click me</p>");
    const autolink = await render("<javascript:alert(1)>");
    expect(autolink.html).not.toMatch(/javascript/i);
  });

  it("refuses schemes hidden by tabs, entities and mixed case", async () => {
    for (const href of [
      "jav&#x09;ascript:alert(1)",
      "&#106;avascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "javascript&colon;alert(1)",
    ]) {
      const result = await render(`[x](${href})`);
      expect(result.html, href).toBe("<p>x</p>");
      expect(result.links).toEqual([]);
    }
  });

  it("refuses protocol-relative and backslash URLs", async () => {
    expect((await render("[x](<//evil.example/x>)")).html).toBe("<p>x</p>");
    // A backslash is percent-encoded by the Markdown layer, so a path starting /\\host can never act as //host.
    const backslash = await render("[x](</\\evil.example/x>)");
    expect(backslash.html).toBe('<p><a href="/%5Cevil.example/x">x</a></p>');
  });

  it("escapes quotes in titles so they cannot close the attribute", async () => {
    const result = await render('[x](/a "t\\" onmouseover=\\"alert(1)")');
    const { tags } = parse(result.html);
    const anchor = tags.find((tag) => tag.name === "a");
    expect(anchor?.attributes.map(([name]) => name)).toEqual(["href", "title"]);
    expect(anchor?.attributes[1]?.[1]).toContain("onmouseover");
  });

  it("neutralises directive attributes", async () => {
    const result = await render(':::note{onclick="alert(1)" style="x" id="evil"}\ntext\n:::');
    expect(result.html).toBe(
      '<aside class="callout callout-note" role="note"><p><strong>ملاحظة</strong></p><p>text</p></aside>',
    );
  });

  it("encodes footnote ids so a crafted label cannot break out of the attribute", async () => {
    const result = await render('x[^a"onfocus="alert(1)]\n\n[^a"onfocus="alert(1)]: y');
    const { tags } = parse(result.html);
    expect(tags.flatMap((tag) => tag.attributes).every(([name]) => !name.startsWith("on"))).toBe(
      true,
    );
    expect(result.html).not.toMatch(/id="[^"]*"[^>]*onfocus/);
  });

  it("renders nothing for an external image and never contacts the media host with a foreign URL", async () => {
    const result = await render("![x](https://evil.example/pixel.png)");
    expect(result.html).toBe("");
    expect(result.warnings).toContainEqual({
      code: "external_image_refused",
      detail: "https://evil.example/pixel.png",
    });
  });

  it("removes bidi controls from text, link text and titles", async () => {
    const result = await render(`${RLO}abc${PDF} [x${RLO}](/y "${LRO}t")`);
    expect(BIDI.test(result.html)).toBe(false);
    expect(result.warnings).toContainEqual({ code: "bidi_controls_removed" });
  });

  it("restricts image hosts to the configured media origin", async () => {
    const result = await renderContent(
      renderInput(`![x](media:${MEDIA_ID})`, { mediaOrigin: "https://media.example" }),
    );
    const { tags } = parse(result.html);
    const urls = tags
      .flatMap((tag) => tag.attributes)
      .filter(([name]) => name === "src" || name === "srcset");
    expect(urls.length).toBeGreaterThan(0);
    for (const [, value] of urls) expect(value).toContain("https://media.example/");
    // An unusable media origin renders no image at all.
    const none = await renderContent(
      renderInput(`![x](media:${MEDIA_ID})`, { mediaOrigin: "javascript:alert(1)" }),
    );
    expect(none.html).toBe("");
  });
});
