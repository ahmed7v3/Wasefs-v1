import { describe, expect, it } from "vitest";

import {
  QUALITY_GATE_IDS,
  type ContentType,
  type QualityGateId,
} from "../../src/content/constants.js";
import {
  countPersonalDosing,
  evaluateGates,
  findForbiddenPhrases,
  gateIssueCounts,
  hasBlockingIssues,
  plainForMatching,
  type QualityInput,
} from "../../src/content/quality.js";
import { contentSeoSchema, contentFlagsSchema } from "../../src/schemas/content.js";
import { settingDefault } from "../../src/settings.js";

const settings = settingDefault("content");

const words = (count: number, seed = "كلمة"): string =>
  Array.from({ length: count }, (_, i) => `${seed}${String(i)}`).join(" ");

/** Readable prose: 12-word sentences, 4 sentences per paragraph. */
const prose = (count: number): string =>
  Array.from({ length: Math.ceil(count / 12) }, (_, i) => `${words(12, `w${String(i)}_`)}.`)
    .map((sentence, i) =>
      i % 4 === 3
        ? `${sentence}

`
        : sentence,
    )
    .join(" ");

function input(overrides: Partial<QualityInput> = {}, type: ContentType = "article"): QualityInput {
  const body = `${prose(700)}\n\n## عنوان فرعي\n\nنص`;
  return {
    type,
    payload: { title: "عنوان المقال", excerpt: "ملخص قصير للمقال", definition: "", bodyMd: body },
    meta: {
      slug: "article-slug",
      categoryId: "6f1c2f1e-0000-4000-8000-000000000001",
      primaryAuthorId: "6f1c2f1e-0000-4000-8000-000000000002",
      seo: contentSeoSchema.parse({ description: "وصف الصفحة لمحركات البحث" }),
      flags: contentFlagsSchema.parse({}),
    },
    featuredImage: { hasAlt: true, width: 1600 },
    render: {
      headings: [
        { level: 2, text: "أ" },
        { level: 3, text: "ب" },
      ],
      links: [
        { href: "/blog/a", internal: true },
        { href: "/blog/b", internal: true },
        { href: "https://www.who.int/x", internal: false },
      ],
      images: [{ alt: "وصف", decorative: false }],
      wordCount: 700,
      warningCodes: [],
    },
    settings,
    context: {
      similarity: null,
      titleDuplicate: false,
      descriptionDuplicate: false,
      keywordOwnerPath: null,
      brokenInternalLinks: 0,
      review: { required: true, approvedMatchesCurrent: true },
    },
    ...overrides,
  };
}

const gate = (gates: ReturnType<typeof evaluateGates>, id: QualityGateId) =>
  gates.find((entry) => entry.id === id);

describe("evaluateGates: shape", () => {
  it("returns one entry per applicable gate in QUALITY_GATE_IDS order", () => {
    const gates = evaluateGates(input());
    expect(gates.map((entry) => entry.id)).toEqual(
      QUALITY_GATE_IDS.filter((id) => id !== "keyword_ownership"),
    );
    const order = gates.map((entry) => QUALITY_GATE_IDS.indexOf(entry.id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(gates.map((entry) => entry.id)).size).toBe(gates.length);
  });

  it("passes a good article with no blocking issue", () => {
    const gates = evaluateGates(input());
    expect(gates.filter((entry) => !entry.ok)).toEqual([]);
    expect(hasBlockingIssues(gates)).toBe(false);
  });

  it("uses the documented levels", () => {
    const levels = Object.fromEntries(
      evaluateGates(
        input({
          meta: {
            ...input().meta,
            seo: contentSeoSchema.parse({ description: "d", focusKeyword: "كلمة" }),
          },
        }),
      ).map((entry) => [entry.id, entry.level]),
    );
    expect(levels).toMatchObject({
      required_fields: "block",
      medical_review: "block",
      min_words: "block",
      duplicate_content: "block",
      title_unique: "block",
      description_unique: "block",
      image_alt: "block",
      forbidden_claims: "block",
      keyword_ownership: "warn",
      headings: "warn",
      internal_links: "warn",
      broken_links: "warn",
      external_sources: "warn",
      image_size: "warn",
      personal_dosing: "warn",
      readability: "info",
    });
  });

  it("params carry only numbers, booleans and short ids", () => {
    const gates = evaluateGates(
      input({ context: { ...input().context, similarity: { score: 0.7, matchPath: "/blog/x" } } }),
    );
    for (const entry of gates) {
      for (const value of Object.values(entry.params)) {
        expect(["string", "number", "boolean"]).toContain(typeof value);
        if (typeof value === "string") expect(value.length).toBeLessThan(200);
      }
    }
  });
});

describe("required_fields", () => {
  it("lists what is missing", () => {
    const base = input();
    const gates = evaluateGates({
      ...base,
      payload: { ...base.payload, title: " ", excerpt: "" },
      meta: {
        ...base.meta,
        categoryId: null,
        primaryAuthorId: null,
        slug: "",
        seo: contentSeoSchema.parse({}),
      },
      featuredImage: null,
    });
    const result = gate(gates, "required_fields");
    expect(result).toMatchObject({ level: "block", ok: false });
    expect(String(result?.params["missing"]).split(",").sort()).toEqual(
      [
        "author",
        "category",
        "excerpt",
        "featured_image",
        "meta_description",
        "slug",
        "title",
      ].sort(),
    );
    expect(result?.params["count"]).toBe(7);
    expect(hasBlockingIssues(gates)).toBe(true);
  });

  it("requires a featured image with alt for articles and guides only", () => {
    const noAlt = evaluateGates(input({ featuredImage: { hasAlt: false, width: 1600 } }));
    expect(String(gate(noAlt, "required_fields")?.params["missing"])).toContain("featured_image");
    const page = evaluateGates(input({ featuredImage: null }, "page"));
    expect(gate(page, "required_fields")?.ok).toBe(true);
  });

  it("asks glossary entries for a definition instead of an excerpt", () => {
    const base = input({}, "glossary");
    const gates = evaluateGates({
      ...base,
      payload: { ...base.payload, excerpt: "", definition: "" },
      featuredImage: null,
    });
    const missing = String(gate(gates, "required_fields")?.params["missing"]);
    expect(missing).toContain("definition");
    expect(missing).not.toContain("excerpt");
    expect(missing).not.toContain("category");
  });
});

describe("medical_review", () => {
  it("blocks until the approved revision equals the current one", () => {
    const pending = evaluateGates(
      input({
        context: { ...input().context, review: { required: true, approvedMatchesCurrent: false } },
      }),
    );
    expect(gate(pending, "medical_review")).toMatchObject({ level: "block", ok: false });
    expect(hasBlockingIssues(pending)).toBe(true);
  });

  it("is absent when review is not required", () => {
    const gates = evaluateGates(
      input({
        context: { ...input().context, review: { required: false, approvedMatchesCurrent: false } },
      }),
    );
    expect(gate(gates, "medical_review")).toBeUndefined();
  });
});

describe("min_words", () => {
  it.each([
    ["article", 599, false],
    ["article", 600, true],
    ["guide", 1_199, false],
    ["guide", 1_200, true],
    ["glossary", 79, false],
    ["glossary", 80, true],
  ] as const)("%s with %i words -> ok %s", (type, count, ok) => {
    const base = input({}, type);
    const gates = evaluateGates({ ...base, render: { ...base.render, wordCount: count } });
    expect(gate(gates, "min_words")).toMatchObject({ level: "block", ok });
  });

  it("does not apply to pages and follows the settings", () => {
    expect(gate(evaluateGates(input({}, "page")), "min_words")).toBeUndefined();
    const lenient = { ...settings, minWords: { article: 10, guide: 10, glossary: 10 } };
    const base = input({ settings: lenient });
    expect(
      gate(evaluateGates({ ...base, render: { ...base.render, wordCount: 10 } }), "min_words")?.ok,
    ).toBe(true);
  });
});

describe("duplicate_content", () => {
  const withScore = (score: number | null) =>
    gate(
      evaluateGates(
        input({
          context: {
            ...input().context,
            similarity: score === null ? null : { score, matchPath: "/blog/original" },
          },
        }),
      ),
      "duplicate_content",
    );

  it("passes below the warn threshold", () => {
    expect(withScore(null)).toMatchObject({ ok: true });
    expect(withScore(0.39)).toMatchObject({ ok: true });
  });

  it("warns between the thresholds and names the match", () => {
    expect(withScore(0.4)).toMatchObject({
      level: "warn",
      ok: false,
      params: { matchPath: "/blog/original" },
    });
    expect(withScore(0.59)).toMatchObject({ level: "warn", ok: false });
  });

  it("blocks at the block threshold", () => {
    expect(withScore(0.6)).toMatchObject({
      level: "block",
      ok: false,
      params: { score: 0.6, matchPath: "/blog/original" },
    });
    expect(withScore(0.95)).toMatchObject({ level: "block", ok: false });
    expect(
      hasBlockingIssues(
        evaluateGates(
          input({ context: { ...input().context, similarity: { score: 0.8, matchPath: null } } }),
        ),
      ),
    ).toBe(true);
  });

  it("does not block a warn-level similarity", () => {
    const gates = evaluateGates(
      input({ context: { ...input().context, similarity: { score: 0.5, matchPath: "/blog/x" } } }),
    );
    expect(hasBlockingIssues(gates)).toBe(false);
    expect(gateIssueCounts(gates)).toEqual({ block: 0, warn: 1 });
  });

  it("uses the thresholds from settings", () => {
    const strict = { ...settings, duplicate: { warnAt: 0.1, blockAt: 0.2 } };
    const gates = evaluateGates(
      input({
        settings: strict,
        context: { ...input().context, similarity: { score: 0.25, matchPath: null } },
      }),
    );
    expect(gate(gates, "duplicate_content")).toMatchObject({ level: "block", ok: false });
  });
});

describe("title_unique and description_unique", () => {
  it("block on duplicates", () => {
    const gates = evaluateGates(
      input({ context: { ...input().context, titleDuplicate: true, descriptionDuplicate: true } }),
    );
    expect(gate(gates, "title_unique")).toMatchObject({ level: "block", ok: false });
    expect(gate(gates, "description_unique")).toMatchObject({ level: "block", ok: false });
    expect(gate(evaluateGates(input()), "title_unique")?.ok).toBe(true);
  });
});

describe("keyword_ownership", () => {
  const seo = (focusKeyword: string) => ({
    ...input().meta,
    seo: contentSeoSchema.parse({ description: "d", focusKeyword }),
  });
  it("is absent without a focus keyword, ok without an owner and a warning with one", () => {
    expect(gate(evaluateGates(input()), "keyword_ownership")).toBeUndefined();
    expect(gate(evaluateGates(input({ meta: seo("الصداع") })), "keyword_ownership")).toMatchObject({
      ok: true,
      level: "warn",
    });
    const owned = evaluateGates(
      input({
        meta: seo("الصداع"),
        context: { ...input().context, keywordOwnerPath: "/blog/headache" },
      }),
    );
    expect(gate(owned, "keyword_ownership")).toMatchObject({
      ok: false,
      level: "warn",
      params: { ownerPath: "/blog/headache" },
    });
    expect(hasBlockingIssues(owned)).toBe(false);
  });
});

describe("headings", () => {
  const withRender = (render: Partial<QualityInput["render"]>) =>
    gate(evaluateGates(input({ render: { ...input().render, ...render } })), "headings");

  it("passes h2 then h3, warns on h1 in the body and on skipped levels", () => {
    expect(withRender({})).toMatchObject({ level: "warn", ok: true });
    expect(withRender({ warningCodes: ["h1_in_body"] })).toMatchObject({
      ok: false,
      params: { h1InBody: 1 },
    });
    expect(
      withRender({
        headings: [
          { level: 2, text: "a" },
          { level: 4, text: "b" },
        ],
      }),
    ).toMatchObject({ ok: false, params: { skipped: 1 } });
    expect(withRender({ headings: [{ level: 3, text: "a" }] })).toMatchObject({ ok: false });
    expect(withRender({ warningCodes: ["heading_skip"] })).toMatchObject({ ok: false });
  });
});

describe("internal_links", () => {
  it("needs two distinct internal links, for articles only", () => {
    const links = (...hrefs: string[]) => hrefs.map((href) => ({ href, internal: true }));
    const check = (list: ReturnType<typeof links>, type: ContentType = "article") =>
      gate(
        evaluateGates(input({ render: { ...input().render, links: list } }, type)),
        "internal_links",
      );
    expect(check(links("/blog/a", "/blog/b"))).toMatchObject({
      level: "warn",
      ok: true,
      params: { count: 2, min: 2 },
    });
    expect(check(links("/blog/a"))).toMatchObject({ ok: false, params: { count: 1 } });
    expect(check(links("/blog/a", "/blog/a"))).toMatchObject({ ok: false, params: { count: 1 } });
    expect(check([], "guide")).toBeUndefined();
  });
});

describe("broken_links", () => {
  it("warns when the API found broken internal links", () => {
    const gates = evaluateGates(input({ context: { ...input().context, brokenInternalLinks: 2 } }));
    expect(gate(gates, "broken_links")).toMatchObject({
      level: "warn",
      ok: false,
      params: { count: 2 },
    });
    expect(gate(evaluateGates(input()), "broken_links")?.ok).toBe(true);
  });
});

describe("external_sources", () => {
  const check = (hrefs: string[]) =>
    gate(
      evaluateGates(
        input({
          render: {
            ...input().render,
            links: hrefs.map((href) => ({ href, internal: href.startsWith("/") })),
          },
        }),
      ),
      "external_sources",
    );

  it("wants a link to a trusted domain (subdomains included)", () => {
    expect(check(["https://www.who.int/a"])).toMatchObject({ level: "warn", ok: true });
    expect(check(["https://pubmed.ncbi.nlm.nih.gov/123"])).toMatchObject({ ok: true });
    expect(check(["https://random-blog.example/a"])).toMatchObject({
      ok: false,
      params: { trusted: 0, external: 1 },
    });
    expect(check(["https://notwho.int/a"])).toMatchObject({ ok: false });
    expect(check(["/blog/a"])).toMatchObject({ ok: false, params: { external: 0 } });
  });

  it("does not apply to glossary entries", () => {
    expect(gate(evaluateGates(input({}, "glossary")), "external_sources")).toBeUndefined();
  });
});

describe("image_alt and image_size", () => {
  it("blocks a featured image or body image without alt", () => {
    expect(
      gate(evaluateGates(input({ featuredImage: { hasAlt: false, width: 1600 } })), "image_alt"),
    ).toMatchObject({ level: "block", ok: false });
    const body = evaluateGates(
      input({
        render: {
          ...input().render,
          images: [
            { alt: "  ", decorative: false },
            { alt: "", decorative: true },
          ],
        },
      }),
    );
    expect(gate(body, "image_alt")).toMatchObject({ ok: false, params: { missing: 1 } });
  });

  it("is absent when there is no image at all", () => {
    const gates = evaluateGates(
      input({ featuredImage: null, render: { ...input().render, images: [] } }),
    );
    expect(gate(gates, "image_alt")).toBeUndefined();
    expect(gate(gates, "image_size")).toBeUndefined();
  });

  it("warns for a featured image narrower than 1200 px", () => {
    expect(
      gate(evaluateGates(input({ featuredImage: { hasAlt: true, width: 1199 } })), "image_size"),
    ).toMatchObject({
      level: "warn",
      ok: false,
      params: { width: 1199, min: 1200 },
    });
    expect(
      gate(evaluateGates(input({ featuredImage: { hasAlt: true, width: 1200 } })), "image_size")
        ?.ok,
    ).toBe(true);
  });
});

describe("forbidden_claims", () => {
  const body = (text: string) => {
    const base = input();
    return gate(
      evaluateGates({
        ...base,
        payload: { ...base.payload, bodyMd: `${base.payload.bodyMd}\n\n${text}` },
      }),
      "forbidden_claims",
    );
  };

  it.each([
    "هذا الدواء يشفي نهائي\u064Bا من الصداع",
    "العلاج بدون أي آثار جانبية",
    "العشبة بديل عن الطبيب في كل الحالات",
    "نقدم علاج مضمون للسكر",
    "وهو **يعالج جميع الأمراض** بسهولة",
    "تحقق شفاء تام خلال أسبوع",
    "Our tonic is a guaranteed cure for migraines.",
    "It has No Side Effects whatsoever",
    "This app replaces your doctor.",
    "A herb that cures all diseases",
  ])("blocks %s", (text) => {
    expect(body(text)).toMatchObject({ level: "block", ok: false });
  });

  it("matches across alef, hamza and tashkeel variants", () => {
    expect(body("ي\u064Eش\u0652ف\u0650ي ن\u0650ه\u064Eائ\u0650ي\u0651ا")).toMatchObject({
      ok: false,
    });
    expect(body("بدون ايه اثار جانبيه")).toMatchObject({ ok: true });
    expect(body("بدون أي اثار جانبيه")).toMatchObject({ ok: false });
  });

  it("checks the title, excerpt and definition too", () => {
    const base = input();
    const gates = evaluateGates({
      ...base,
      payload: { ...base.payload, title: "علاج مضمون لكل الأمراض" },
    });
    expect(gate(gates, "forbidden_claims")).toMatchObject({ ok: false });
    expect(hasBlockingIssues(gates)).toBe(true);
  });

  it("does not flag clean or merely similar text", () => {
    expect(body("The leaflet says it cures allergies in some people.")).toMatchObject({ ok: true });
    expect(body("استشر الطبيب قبل استخدام أي دواء")).toMatchObject({ ok: true });
    expect(body("")).toMatchObject({ ok: true });
  });

  it("uses the configured list", () => {
    const custom = { ...settings, forbiddenPhrases: ["معجزة"] };
    const base = input({ settings: custom });
    const gates = evaluateGates({ ...base, payload: { ...base.payload, bodyMd: "هذه معجزة" } });
    expect(gate(gates, "forbidden_claims")).toMatchObject({ ok: false });
    expect(
      gate(
        evaluateGates({ ...base, payload: { ...base.payload, bodyMd: "يشفي نهائيا" } }),
        "forbidden_claims",
      )?.ok,
    ).toBe(true);
  });

  it("default list has Arabic and English claims", () => {
    expect(settings.forbiddenPhrases.length).toBeGreaterThanOrEqual(10);
    expect(settings.forbiddenPhrases.some((phrase) => /[\u0600-ۿ]/.test(phrase))).toBe(true);
    expect(settings.forbiddenPhrases.some((phrase) => /^[a-z ]+$/i.test(phrase))).toBe(true);
  });
});

describe("findForbiddenPhrases / plainForMatching", () => {
  it("normalises markdown and Arabic spelling before matching", () => {
    expect(plainForMatching("**علاج\u064C** _مضمون_")).toBe("علاج مضمون");
    expect(findForbiddenPhrases(plainForMatching("هذا **علاج** مضمون"), ["علاج مضمون"])).toEqual([
      "علاج مضمون",
    ]);
  });

  it("respects Latin word boundaries", () => {
    expect(findForbiddenPhrases("a cures all b", ["cures all"])).toEqual(["cures all"]);
    expect(findForbiddenPhrases("it cures allergies", ["cures all"])).toEqual([]);
  });
});

describe("personal_dosing", () => {
  const dosing = (text: string) => {
    const base = input();
    return gate(
      evaluateGates({ ...base, payload: { ...base.payload, bodyMd: text } }),
      "personal_dosing",
    );
  };

  it.each([
    "خذ 500 مجم من الباراسيتامول كل ست ساعات",
    "تناول حبتين من الدواء صباحا",
    "استخدم ٥ مل من الشراب مرتين",
    "خذ ٢ قرص قبل النوم",
    "خذ الدواء 2 حبة يوميا",
    "Take 500 mg every six hours.",
    "You should take 2 tablets after food",
    "take 10 ml twice a day",
  ])("flags %s", (text) => {
    expect(dosing(text)).toMatchObject({ level: "warn", ok: false });
    expect(countPersonalDosing(plainForMatching(text))).toBeGreaterThan(0);
  });

  it.each([
    "يؤخذ الباراسيتامول حسب إرشاد الطبيب",
    "الجرعة المعتادة للبالغين 500 مجم وفق النشرة",
    "Paracetamol tablets contain 500 mg of active substance.",
    "Always take medicine as directed",
    "خذ قسطا من الراحة",
  ])("does not flag %s", (text) => {
    expect(dosing(text)).toMatchObject({ ok: true });
  });

  it("does not block publishing", () => {
    const gates = evaluateGates({
      ...input(),
      payload: { ...input().payload, bodyMd: "Take 500 mg now" },
    });
    expect(hasBlockingIssues(gates)).toBe(false);
  });
});

describe("readability", () => {
  it("is info-level and flags very long sentences or paragraphs", () => {
    const base = input();
    const long = `${words(60)}.`;
    const gates = evaluateGates({ ...base, payload: { ...base.payload, bodyMd: long } });
    expect(gate(gates, "readability")).toMatchObject({ level: "info", ok: false });
    expect(hasBlockingIssues(gates)).toBe(false);
    const short = Array.from({ length: 30 }, () => "جملة قصيرة هنا.").join("\n\n");
    expect(
      gate(evaluateGates({ ...base, payload: { ...base.payload, bodyMd: short } }), "readability")
        ?.ok,
    ).toBe(true);
  });

  it("applies to articles and guides only", () => {
    expect(gate(evaluateGates(input({}, "glossary")), "readability")).toBeUndefined();
    expect(gate(evaluateGates(input({}, "page")), "readability")).toBeUndefined();
  });
});

describe("applicability by type", () => {
  it("pages skip the editorial-only gates", () => {
    const ids = evaluateGates(input({ featuredImage: null }, "page")).map((entry) => entry.id);
    expect(ids).not.toContain("min_words");
    expect(ids).not.toContain("duplicate_content");
    expect(ids).not.toContain("internal_links");
    expect(ids).not.toContain("headings");
    expect(ids).toContain("required_fields");
    expect(ids).toContain("forbidden_claims");
  });
});

describe("hasBlockingIssues / gateIssueCounts", () => {
  it("only block-level failures block", () => {
    expect(hasBlockingIssues([{ id: "headings", level: "warn", ok: false, params: {} }])).toBe(
      false,
    );
    expect(hasBlockingIssues([{ id: "readability", level: "info", ok: false, params: {} }])).toBe(
      false,
    );
    expect(hasBlockingIssues([{ id: "min_words", level: "block", ok: true, params: {} }])).toBe(
      false,
    );
    expect(hasBlockingIssues([{ id: "min_words", level: "block", ok: false, params: {} }])).toBe(
      true,
    );
  });
});
