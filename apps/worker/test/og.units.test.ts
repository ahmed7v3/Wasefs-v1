import { OG_TEMPLATE_IDS, ogCardKey, ogRenderPayloadSchema } from "@wasfa/shared/schemas/og";
import { describe, expect, it } from "vitest";

import { fitText } from "../src/og/fit.js";
import { measureText } from "../src/og/fonts.js";
import { canonicalJson, OG_TEMPLATES, ogCardHash } from "../src/og/render.js";

import { OG_CASES } from "./support/og-cases.js";

import type { OgAssets } from "../src/og/templates/index.js";

const LONG_TITLE =
  "دليل شامل لفهم الروشتة الطبية وقراءة أسماء الأدوية وجرعاتها ومواعيدها وتجنب الأخطاء الشائعة عند صرف الدواء من الصيدلية";

describe("og input schemas", () => {
  it("has one template per id, each with its own id and a version", () => {
    for (const id of OG_TEMPLATE_IDS) {
      expect(OG_TEMPLATES[id].id).toBe(id);
      expect(OG_TEMPLATES[id].version).toBeGreaterThanOrEqual(1);
    }
  });

  it("requires a locale and a title, and rejects unknown locales and empty or oversized text", () => {
    const { schema } = OG_TEMPLATES.page;
    expect(schema.safeParse({ title: "x" }).success).toBe(false);
    expect(schema.safeParse({ locale: "fr", title: "x" }).success).toBe(false);
    expect(schema.safeParse({ locale: "ar", title: "  " }).success).toBe(false);
    expect(schema.safeParse({ locale: "ar", title: "x".repeat(141) }).success).toBe(false);
    expect(schema.safeParse({ locale: "ar", title: "x" }).success).toBe(true);
  });

  it("validates every template's own fields", () => {
    expect(OG_TEMPLATES.article.schema.safeParse({ locale: "ar", title: "x" }).success).toBe(false);
    expect(
      OG_TEMPLATES.guide.schema.safeParse({ locale: "ar", title: "x", sectionCount: 0 }).success,
    ).toBe(false);
    expect(OG_TEMPLATES.glossary.schema.safeParse({ locale: "ar", term: "BID" }).success).toBe(
      false,
    );
    expect(
      OG_TEMPLATES.drug.schema.safeParse({
        locale: "ar",
        nameAr: "أ",
        nameEn: "A",
        dosageForm: "x",
      }).success,
    ).toBe(false);
    expect(
      OG_TEMPLATES.author.schema.safeParse({ locale: "ar", name: "x", photo: { sha256: "nope" } })
        .success,
    ).toBe(false);
  });

  it("validates the og.render job payload by template", () => {
    expect(
      ogRenderPayloadSchema.safeParse({ template: "page", input: { locale: "ar", title: "x" } })
        .success,
    ).toBe(true);
    expect(
      ogRenderPayloadSchema.safeParse({ template: "guide", input: { locale: "ar", title: "x" } })
        .success,
    ).toBe(false);
    expect(ogRenderPayloadSchema.safeParse({ template: "nope", input: {} }).success).toBe(false);
  });
});

describe("og line fitting", () => {
  const options = {
    maxWidth: 1100,
    sizes: [56, 52, 48, 44, 40],
    maxLines: 3,
    weight: 700,
  } as const;

  it("keeps a short title on one line at the largest size", async () => {
    const fitted = await fitText("اتصل بنا", options);
    expect(fitted.lines).toEqual(["اتصل بنا"]);
    expect(fitted.size).toBe(56);
  });

  it("never exceeds three lines, never goes below 40 px and never overflows the column", async () => {
    for (const text of [
      LONG_TITLE,
      `${LONG_TITLE} ${LONG_TITLE}`,
      `${LONG_TITLE} ${LONG_TITLE} ${LONG_TITLE}`,
    ]) {
      const fitted = await fitText(text, options);
      expect(fitted.lines.length).toBeLessThanOrEqual(3);
      expect(fitted.size).toBeGreaterThanOrEqual(40);
      for (const line of fitted.lines) {
        expect(await measureText(line, fitted.size, 700)).toBeLessThanOrEqual(options.maxWidth);
      }
    }
  });

  it("cuts the last line with an ellipsis when even 40 px needs more than three lines", async () => {
    const fitted = await fitText(`${LONG_TITLE} ${LONG_TITLE} ${LONG_TITLE}`, options);
    expect(fitted.lines).toHaveLength(3);
    expect(fitted.lines[2]?.endsWith("…")).toBe(true);
  });

  it("shortens a single word wider than the column instead of overflowing", async () => {
    const fitted = await fitText("x".repeat(200), options);
    expect(fitted.lines).toHaveLength(1);
    expect(await measureText(fitted.lines[0] ?? "", fitted.size, 700)).toBeLessThanOrEqual(
      options.maxWidth,
    );
  });
});

describe("og templates", () => {
  const svgOf = async (index: number): Promise<string> => {
    const ogCase = OG_CASES[index];
    if (ogCase === undefined) throw new Error("missing case");
    const template = OG_TEMPLATES[ogCase.template];
    const assets: OgAssets = {};
    return (template.render as (input: unknown, assets: OgAssets) => Promise<string>)(
      template.schema.parse(ogCase.input),
      assets,
    );
  };

  it("lays an Arabic card out right-to-left at the right edge of the safe area", async () => {
    const svg = await svgOf(0);
    expect(svg).toContain('x="1150"');
    expect(svg).toMatch(
      /<text x="1150"[^>]*direction="rtl" text-anchor="start">افهم روشتتك في ثوانٍ</,
    );
    expect(svg).not.toMatch(/<text x="50"[^>]*direction="rtl"/);
  });

  it("lays an English card out left-to-right from the left edge of the safe area", async () => {
    const svg = await svgOf(1);
    expect(svg).toMatch(
      /<text x="50"[^>]*direction="ltr" text-anchor="start">Understand your prescription in seconds</,
    );
  });

  it("draws nothing smaller than 28 px", async () => {
    for (let index = 0; index < OG_CASES.length; index += 1) {
      const sizes = [...(await svgOf(index)).matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map(
        (match) => Number(match[1]),
      );
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(28);
    }
  });

  it("escapes markup in titles", async () => {
    const template = OG_TEMPLATES.page;
    const svg = await template.render(
      template.schema.parse({ locale: "en", title: "<b>A & B</b>" }),
      {},
    );
    expect(svg).toContain("&lt;b&gt;A &amp; B&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });
});

describe("og card hash and key", () => {
  const template = { id: "page", version: 1 };

  it("ignores key order and undefined fields", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
    expect(ogCardHash(template, { a: 1, b: 2 })).toBe(ogCardHash(template, { b: 2, a: 1 }));
  });

  it("changes with the template, its version and any input field", () => {
    const base = ogCardHash(template, { title: "x" });
    expect(ogCardHash({ id: "guide", version: 1 }, { title: "x" })).not.toBe(base);
    expect(ogCardHash({ id: "page", version: 2 }, { title: "x" })).not.toBe(base);
    expect(ogCardHash(template, { title: "y" })).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores cards under og/<template>/<hash>.png", () => {
    expect(ogCardKey("glossary", "abc")).toBe("og/glossary/abc.png");
  });
});
