import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isolateBidi, stripBidi } from "../src/wa-agent/bidi.js";
import { composeText } from "../src/wa-agent/compose.js";
import { toWhatsApp } from "../src/wa-agent/format.js";
import { splitReply } from "../src/wa-agent/split.js";

const RLM = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";

const count = (text: string, ch: string): number => text.split(ch).length - 1;
const squash = (text: string): string => text.replace(/\s+/g, "");

describe("toWhatsApp", () => {
  it("rewrites bold and strike", () => {
    expect(toWhatsApp("هذا **مهم** و __برضه__ و ~~غلط~~")).toBe("هذا *مهم* و *برضه* و ~غلط~");
  });

  it("turns headings into bold lines", () => {
    expect(toWhatsApp("# Title\n## Sub **x**\n###### Deep\ntext")).toBe(
      "*Title*\n*Sub x*\n*Deep*\ntext",
    );
  });

  it("turns tables into bullet lines, dropping header and separator", () => {
    const table =
      "| Drug | Price |\n| --- | ---: |\n| Bepra | 20 |\n| Panadol | 15 |\n\nبعد الجدول";
    expect(toWhatsApp(table)).toBe("• Bepra — 20\n• Panadol — 15\n\nبعد الجدول");
  });

  it("normalises list markers and numbering", () => {
    expect(toWhatsApp("- a\n* b\n+ c\n1) one\n2. two")).toBe("• a\n• b\n• c\n1. one\n2. two");
  });

  it("keeps fenced and inline code as written", () => {
    const text = "```js\n# not a heading\n- not a bullet **x**\n```\nuse `**raw**` here";
    expect(toWhatsApp(text)).toBe(
      "```\n# not a heading\n- not a bullet **x**\n```\nuse `**raw**` here",
    );
  });

  it("rewrites links", () => {
    expect(toWhatsApp("see [the site](https://wasfa.online/x) now")).toBe(
      "see the site (https://wasfa.online/x) now",
    );
  });

  it("collapses blank runs and trims", () => {
    expect(toWhatsApp("\n\na\n\n\n\n\nb  \n\n")).toBe("a\n\nb");
    expect(toWhatsApp("a\n\nb")).toBe("a\n\nb");
  });

  it("is idempotent", () => {
    const token = fc.constantFrom(
      "**",
      "__",
      "~~",
      "*",
      "_",
      "~",
      "# ",
      "## ",
      "- ",
      "* ",
      "+ ",
      "1. ",
      "2) ",
      "|",
      " | ",
      "---",
      ":--:",
      "\n",
      "\n\n",
      "\n\n\n",
      "`",
      "```",
      "[a](b)",
      "[",
      "](",
      ")",
      " ",
      "word",
      "كلمة",
      "x",
      "\r\n",
    );
    fc.assert(
      fc.property(fc.array(token, { maxLength: 40 }), (tokens) => {
        const once = toWhatsApp(tokens.join(""));
        expect(toWhatsApp(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });
});

describe("isolateBidi", () => {
  it("isolates a Latin drug name inside an Arabic line", () => {
    expect(isolateBidi("خد Bepra 20 mg قبل العشاء")).toBe(
      `${RLM}خد ${FSI}Bepra 20 mg${PDI} قبل العشاء`,
    );
  });

  it("isolates numbers and units in mixed lines", () => {
    expect(isolateBidi("الجرعة 500 mg مرتين")).toBe(`${RLM}الجرعة ${FSI}500 mg${PDI} مرتين`);
  });

  it("isolates separate runs separately and keeps punctuation outside", () => {
    expect(isolateBidi("خد Bepra 20, وبعدين Panadol.")).toBe(
      `${RLM}خد ${FSI}Bepra 20${PDI}, وبعدين ${FSI}Panadol${PDI}.`,
    );
  });

  it("leaves English-only lines untouched and handles lines independently", () => {
    expect(isolateBidi("Take Bepra 20 mg daily")).toBe("Take Bepra 20 mg daily");
    expect(isolateBidi("Take 20 mg\nخد Bepra")).toBe(`Take 20 mg\n${RLM}خد ${FSI}Bepra${PDI}`);
  });

  it("does not wrap inside an existing isolate or add a second RLM", () => {
    const line = `${RLM}خد ${FSI}Bepra 20 mg${PDI} قبل`;
    expect(isolateBidi(line)).toBe(line);
  });

  const bidiChar = fc.constantFrom(
    ..."خدالجرعةقبلمرتين",
    ..."Bepra",
    ..."0123",
    " ",
    ".",
    "-",
    "/",
    "%",
    "+",
    ",",
    "\n",
    "!",
  );
  const bidiText = fc.array(bidiChar, { maxLength: 60 }).map((chars) => chars.join(""));

  it("is idempotent", () => {
    fc.assert(
      fc.property(bidiText, (text) => {
        const once = isolateBidi(text);
        expect(isolateBidi(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("stripBidi undoes it and isolates stay balanced per line", () => {
    fc.assert(
      fc.property(bidiText, (text) => {
        const once = isolateBidi(text);
        expect(stripBidi(once)).toBe(text);
        for (const line of once.split("\n")) expect(count(line, FSI)).toBe(count(line, PDI));
      }),
      { numRuns: 500 },
    );
  });
});

describe("splitReply", () => {
  it("returns one part when it fits and none for empty text", () => {
    expect(splitReply("short", { maxChars: 50, maxParts: 3 })).toEqual(["short"]);
    expect(splitReply("  \n ", { maxChars: 50, maxParts: 3 })).toEqual([]);
  });

  it("packs paragraphs greedily", () => {
    const text = "aaaa aaaa\n\nbbbb bbbb\n\ncccc cccc";
    expect(splitReply(text, { maxChars: 22, maxParts: 5 })).toEqual([
      "aaaa aaaa\n\nbbbb bbbb",
      "cccc cccc",
    ]);
  });

  it("splits a long paragraph at sentence ends, then spaces, then hard", () => {
    expect(splitReply("One two. Three four. Five six.", { maxChars: 20, maxParts: 5 })).toEqual([
      "One two. Three four.",
      "Five six.",
    ]);
    expect(splitReply("aaa bbb ccc ddd", { maxChars: 8, maxParts: 5 })).toEqual([
      "aaa bbb",
      "ccc ddd",
    ]);
    expect(splitReply("abcdefghij", { maxChars: 4, maxParts: 5 })).toEqual(["abcd", "efgh", "ij"]);
  });

  it("does not cut inside a bold span or an isolate when a boundary outside exists", () => {
    expect(splitReply("aaa *bold text* bbb", { maxChars: 12, maxParts: 5 })).toEqual([
      "aaa",
      "*bold text*",
      "bbb",
    ]);
    const isolated = `خد ${FSI}Bepra 20${PDI} قبل العشاء`;
    for (const part of splitReply(isolated, { maxChars: 20, maxParts: 5 })) {
      expect(count(part, FSI)).toBe(count(part, PDI));
    }
  });

  it("cuts the last allowed part with an ellipsis", () => {
    const parts = splitReply("aaaa bbbb cccc dddd eeee", { maxChars: 10, maxParts: 2 });
    expect(parts).toEqual(["aaaa bbbb", "cccc dddd…"]);
  });

  const piece = fc.constantFrom(
    "كلمة",
    "دواء",
    "word",
    "text",
    " ",
    " ",
    " ",
    ". ",
    "! ",
    "؟ ",
    "\n",
    "\n\n",
    "*bold text*",
    "_it_",
    "~st~",
    `${FSI}Bepra 20 mg${PDI}`,
    `${FSI}500 mg${PDI}`,
    "```\ncode\n```",
    "x",
  );
  const text = fc.array(piece, { maxLength: 80 }).map((p) => p.join(""));
  const opts = fc.record({
    maxChars: fc.integer({ min: 40, max: 120 }),
    maxParts: fc.integer({ min: 1, max: 6 }),
  });

  it("keeps every part within limits, non-empty, balanced and in order", () => {
    fc.assert(
      fc.property(text, opts, (input, o) => {
        const parts = splitReply(input, o);
        expect(parts.length).toBeLessThanOrEqual(o.maxParts);
        for (const part of parts) {
          expect(part.length).toBeGreaterThan(0);
          expect(part.length).toBeLessThanOrEqual(o.maxChars);
          expect(part).toBe(part.trim());
          expect(count(part, FSI)).toBe(count(part, PDI));
        }
        const joined = squash(parts.join(""));
        const original = squash(input);
        const body = joined.endsWith("…") ? joined.slice(0, -1) : joined;
        expect(original.startsWith(body)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("loses nothing when maxParts is large", () => {
    fc.assert(
      fc.property(text, fc.integer({ min: 40, max: 120 }), (input, maxChars) => {
        const parts = splitReply(input, { maxChars, maxParts: 1000 });
        expect(squash(parts.join(""))).toBe(squash(input));
      }),
      { numRuns: 300 },
    );
  });
});

describe("composeText", () => {
  it("formats, isolates and splits", () => {
    expect(composeText("## نصيحة\n- خد Bepra 20 mg", { maxChars: 100, maxParts: 2 })).toEqual([
      `${RLM}*نصيحة*\n${RLM}• خد ${FSI}Bepra 20 mg${PDI}`,
    ]);
  });
});
