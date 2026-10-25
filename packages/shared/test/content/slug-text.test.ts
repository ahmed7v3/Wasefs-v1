import { describe, expect, it } from "vitest";

import { CONTENT_SLUG_MAX, CONTENT_SLUG_PATTERN } from "../../src/content/constants.js";
import { headingIdFactory, slugify, transliterateArabic } from "../../src/content/slug.js";
import { countWords, readingMinutes, stripBidiControls } from "../../src/content/text.js";

describe("transliterateArabic", () => {
  it("maps letters to the documented ASCII skeleton", () => {
    expect(transliterateArabic("باراسيتامول")).toBe("barasytamwl");
    expect(transliterateArabic("شخص")).toBe("shkhs");
    expect(transliterateArabic("ثغر")).toBe("thghr");
    expect(transliterateArabic("ذهب")).toBe("dhhb");
    expect(transliterateArabic("قلب")).toBe("qlb");
  });

  it("folds alef forms, ya/alef-maqsura and ta-marbuta", () => {
    expect(transliterateArabic("أإآا")).toBe("aaaa");
    expect(transliterateArabic("على")).toBe("aly");
    expect(transliterateArabic("مدرسة")).toBe("mdrsa");
  });

  it("drops lone hamza and gives seated hamza its glide", () => {
    expect(transliterateArabic("سماء")).toBe("sma");
    expect(transliterateArabic("مسؤول")).toBe("mswwl");
    expect(transliterateArabic("رئيس")).toBe("ryys");
  });

  it("strips tashkeel and tatweel and converts Arabic-Indic digits", () => {
    expect(transliterateArabic("م\u064Fح\u064Eم\u064E\u0651د")).toBe("mhmd");
    expect(transliterateArabic("كــــتاب")).toBe("ktab");
    expect(transliterateArabic("جرعة ٥٠٠ مجم")).toBe("jraa 500 mjm");
    expect(transliterateArabic("۱۲۳")).toBe("123");
  });

  it("leaves Latin text and punctuation alone", () => {
    expect(transliterateArabic("Vitamin D3, 5%")).toBe("Vitamin D3, 5%");
  });
});

describe("slugify", () => {
  it("always matches the slug pattern", () => {
    const samples = [
      "دواء الضغط المرتفع",
      "What is Paracetamol? (500 mg)",
      "  --  ",
      "!!!",
      "Café crème",
      "مرحبا Hello ٣",
      "a".repeat(400),
      "كلمة ".repeat(80),
    ];
    for (const sample of samples) {
      const slug = slugify(sample);
      expect(slug, sample).toMatch(CONTENT_SLUG_PATTERN);
      expect(slug.length).toBeLessThanOrEqual(CONTENT_SLUG_MAX);
    }
  });

  it("transliterates Arabic titles", () => {
    expect(slugify("دواء الضغط")).toBe("dwa-aldght");
    expect(slugify("علاج الصداع النصفي")).toBe("alaj-alsdaa-alnsfy");
  });

  it("handles Latin accents, symbols and mixed scripts", () => {
    expect(slugify("Café & Crème")).toBe("cafe-and-creme");
    expect(slugify("Vitamin D3 للأطفال")).toBe("vitamin-d3-llatfal");
  });

  it("falls back to item when nothing usable is left", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("؟؟؟ !!!")).toBe("item");
  });

  it("cuts at a word boundary when it can, mid-word when it must", () => {
    expect(slugify("alpha beta gamma", 12)).toBe("alpha-beta");
    expect(slugify("alpha beta gamma", 10)).toBe("alpha-beta");
    expect(slugify("abcdefghijklmnop", 6)).toBe("abcdef");
    const slug = slugify("word ".repeat(100), 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("is stable: the same text always gives the same slug", () => {
    expect(slugify("مقال عن الصداع")).toBe(slugify("مقال عن الصداع"));
  });
});

describe("headingIdFactory", () => {
  it("gives repeated headings -2, -3 and never reuses an id", () => {
    const ids = headingIdFactory();
    expect(ids.next("الأعراض")).toBe("alaarad");
    expect(ids.next("الأعراض")).toBe("alaarad-2");
    expect(ids.next("الأعراض")).toBe("alaarad-3");
    expect(ids.next("Intro")).toBe("intro");
    expect(ids.next("Intro")).toBe("intro-2");
    // A heading that literally reads "intro 2" must not collide with the generated one.
    expect(ids.next("intro 2")).toBe("intro-2-2");
  });

  it("is deterministic per document and independent between documents", () => {
    const run = (): string[] => {
      const ids = headingIdFactory();
      return ["A", "B", "A", "C", "B"].map((text) => ids.next(text));
    };
    expect(run()).toEqual(["a", "b", "a-2", "c", "b-2"]);
    expect(run()).toEqual(run());
  });

  it("can reserve ids that other markup owns", () => {
    const ids = headingIdFactory();
    ids.reserve("footnote-label");
    expect(ids.next("Footnote label")).toBe("footnote-label-2");
  });

  it("keeps heading ids URL-safe even for punctuation-only text", () => {
    const ids = headingIdFactory();
    expect(ids.next("???")).toBe("item");
    expect(ids.next("???")).toBe("item-2");
  });
});

describe("countWords", () => {
  it("counts Arabic and Latin words", () => {
    expect(countWords("الصداع النصفي migraine headache")).toBe(4);
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });

  it("ignores markdown syntax and URLs", () => {
    expect(countWords("## عنوان **غامق** و _مائل_ [رابط](https://example.com/a/b?c=1)")).toBe(5);
    expect(countWords("see https://who.int/x and www.example.com now")).toBe(3);
    expect(countWords("- one\n- two\n> three")).toBe(3);
  });

  it("keeps hyphenated and apostrophed words whole and counts numbers", () => {
    expect(countWords("well-known doesn't take 500 mg")).toBe(5);
  });

  it("counts words that carry tashkeel as one", () => {
    expect(countWords("م\u064Fح\u064Eم\u064E\u0651د\u064C ر\u064Eس\u064Fول\u064F")).toBe(2);
  });
});

describe("readingMinutes", () => {
  it("is at least one and uses 200 words per minute", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(1_000)).toBe(5);
  });
});

describe("stripBidiControls", () => {
  const controls = [
    ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
    ...Array.from({ length: 4 }, (_, i) => 0x2066 + i),
    0x200e,
    0x200f,
    0x061c,
  ].map((code) => String.fromCharCode(code));

  it("removes every embedding, override, isolate and mark character", () => {
    for (const control of controls) {
      const result = stripBidiControls(`a${control}b`);
      expect(result).toEqual({ text: "ab", removed: true });
    }
  });

  it("reports nothing removed for clean text and leaves Arabic untouched", () => {
    expect(stripBidiControls("مرحبا hello")).toEqual({ text: "مرحبا hello", removed: false });
  });

  it("strips a whole trojan-source sequence", () => {
    const rlo = String.fromCharCode(0x202e);
    const pdf = String.fromCharCode(0x202c);
    expect(stripBidiControls(`safe ${rlo}evil${pdf}`).text).toBe("safe evil");
  });
});
