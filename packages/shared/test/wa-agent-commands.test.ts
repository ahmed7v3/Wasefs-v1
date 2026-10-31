import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  WA_COMMANDS,
  WA_COMMAND_ALIASES,
  WA_FUZZY_BLOCKLIST,
  WA_PRIVACY_CONFIRM,
  type WaCommand,
} from "../src/i18n/wa-commands.js";
import { MENU_ORDER, damerauDistance, matchCommand } from "../src/wa-agent/commands.js";
import { normalizeCommandText, wordsOf } from "../src/wa-agent/normalize.js";

const corpus = readFileSync(
  fileURLToPath(new URL("./fixtures/egyptian-arabic-corpus.txt", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter((l) => l.trim() !== "");

const m = (text: string, opts: Parameters<typeof matchCommand>[1] = {}) => matchCommand(text, opts);

/** Every default alias with a non-empty normalised form, paired with its command. */
const ALIAS_PAIRS: (readonly [WaCommand, string])[] = WA_COMMANDS.flatMap((c) =>
  WA_COMMAND_ALIASES[c]
    .filter((a) => normalizeCommandText(a).replace("/", "") !== "")
    .map((a) => [c, a] as const),
);
const NORMALIZED_ALIASES = new Set(
  ALIAS_PAIRS.map(([, a]) => normalizeCommandText(a).replace(/^\//, "")),
);

describe("normalizeCommandText", () => {
  it("folds Arabic spelling, digits and case", () => {
    expect(normalizeCommandText("أدويتي")).toBe("ادويتي");
    expect(normalizeCommandText("مُسَاعَدَة")).toBe("مساعده");
    expect(normalizeCommandText("جـــديد")).toBe("جديد");
    expect(normalizeCommandText("١٢٣ ۴۵")).toBe("123 45");
    expect(normalizeCommandText("HeLP")).toBe("help");
  });

  it("drops emoji and punctuation but keeps a leading slash", () => {
    expect(normalizeCommandText("/New!!")).toBe("/new");
    expect(normalizeCommandText("حلل، الروشتة؟ 😊")).toBe("حلل الروشته");
    expect(normalizeCommandText("a/b")).toBe("a b");
    expect(normalizeCommandText("  كلم   موظف ")).toBe("كلم موظف");
  });

  it("wordsOf splits on single spaces", () => {
    expect(wordsOf("")).toEqual([]);
    expect(wordsOf("ابدا من جديد")).toEqual(["ابدا", "من", "جديد"]);
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 60 }), (s) => {
        const once = normalizeCommandText(s);
        expect(normalizeCommandText(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 40 }), (s) => {
        const once = normalizeCommandText(s);
        expect(normalizeCommandText(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });
});

describe("damerauDistance", () => {
  it("counts substitution, insertion, deletion and adjacent transposition as one", () => {
    expect(damerauDistance("help", "halp")).toBe(1);
    expect(damerauDistance("help", "hel")).toBe(1);
    expect(damerauDistance("help", "helps")).toBe(1);
    expect(damerauDistance("help", "hepl")).toBe(1);
    expect(damerauDistance("help", "hlpe")).toBe(2);
  });
});

describe("matchCommand: positives", () => {
  const cases: [string, WaCommand, string?][] = [
    ["جديد", "new"],
    ["ابدأ من جديد", "new"],
    ["ابدا من جديد", "new"],
    ["محادثة جديدة", "new"],
    ["/new", "new"],
    ["new", "new"],
    ["Reset", "new"],
    ["حلل", "analyze"],
    ["حلل الروشتة", "analyze"],
    ["حَلِّل الروشته", "analyze"],
    ["تحليل", "analyze"],
    ["اقرا الروشتة", "analyze"],
    ["/analyze", "analyze"],
    ["analyze", "analyze"],
    ["مساعدة", "help"],
    ["القائمة", "help"],
    ["help", "help"],
    ["menu", "help"],
    ["؟", "help"],
    ["?", "help"],
    ["؟؟", "help"],
    ["رصيدي", "balance"],
    ["باقتي", "balance"],
    ["balance", "balance"],
    ["التقرير", "report"],
    ["PDF", "report"],
    ["الملف", "report"],
    ["مواعيدي", "schedule"],
    ["الجدول", "schedule"],
    ["أدويتي", "meds"],
    ["ادويتي", "meds"],
    ["خزانتي", "meds"],
    ["فعل التذكير", "remind", "on"],
    ["وقف التذكير", "remind", "off"],
    ["صوت", "voice", "on"],
    ["بدون صوت", "voice", "off"],
    ["english", "lang", "en"],
    ["عربي", "lang", "ar"],
    ["عربى", "lang", "ar"],
    ["كلم موظف", "human"],
    ["خدمة العملاء", "human"],
    ["خدمه العملاء", "human"],
    ["human", "human"],
    ["امسح بياناتي", "privacy"],
    ["delete my data", "privacy"],
  ];

  it.each(cases)("%s -> %s", (text, command, arg) => {
    const r = m(text);
    expect(r?.command).toBe(command);
    expect(r?.arg).toBe(arg);
  });

  it("matches around emoji, punctuation, a slash and Arabic digits noise", () => {
    expect(m("حلل الروشتة 🙏")?.command).toBe("analyze");
    expect(m("  رصيدي؟؟ ")?.command).toBe("balance");
    expect(m("/help")?.command).toBe("help");
    expect(m("/رصيدي")?.command).toBe("balance");
    expect(m("new!")?.command).toBe("new");
  });

  it("allows one typo only on aliases of five letters or more", () => {
    expect(m("مساعده")).toEqual({ command: "help", via: "alias" });
    expect(m("مساعدا")).toEqual({ command: "help", via: "fuzzy" });
    expect(m("ابدا من جيد")).toEqual({ command: "new", via: "fuzzy" });
    expect(m("ابدا من جديد")?.via).toBe("alias");
    expect(m("analyse")?.via).toBe("alias");
    expect(m("english", {})?.via).toBe("alias");
    // Latin aliases match exactly only: English near-words are common chat
    for (const w of ["anlyze", "blance", "engilsh", "rest", "menus", "helps", "news", "repot"]) {
      expect(m(w)).toBeNull();
    }
    // 1-4 letter aliases never fuzzy
    expect(m("hepl")).toBeNull();
    expect(m("nwe")).toBeNull();
    expect(m("pdg")).toBeNull();
    expect(m("حلك")).toBeNull();
    expect(m("جديه")).toBeNull();
    // two typos
    expect(m("مساعدتن")).toBeNull();
  });

  it("refuses a fuzzy hit that is one typo from two commands", () => {
    // Both aliases are within 1 of «كككككن»: ambiguous, so no match.
    const aliases = { new: ["كككككك"], help: ["كككككم"] };
    expect(m("كككككن", { aliases })).toBeNull();
    expect(m("كككككك", { aliases })?.command).toBe("new");
  });

  it("does not fuzzy-match ordinary words that sit one typo from an alias", () => {
    for (const word of WA_FUZZY_BLOCKLIST) expect(m(word)).toBeNull();
  });

  it("keeps every blocklist word in the corpus as a hard negative", () => {
    const normalizedCorpus = new Set(corpus.map((l) => normalizeCommandText(l)));
    const missing = WA_FUZZY_BLOCKLIST.filter(
      (w) => !normalizedCorpus.has(normalizeCommandText(w)),
    );
    expect(missing).toEqual([]);
  });

  it("merges extra aliases with the defaults, normalised the same way", () => {
    const aliases = { balance: ["كام فلوسي", "/Rasidi"], new: ["اعادة"] };
    expect(m("كام فلوسي؟", { aliases })?.command).toBe("balance");
    expect(m("rasidi", { aliases })?.command).toBe("balance");
    expect(m("اعادة", { aliases })?.command).toBe("new");
    expect(m("رصيدي", { aliases })?.command).toBe("balance");
    expect(m("كام فلوسي")).toBeNull();
  });

  it("in a caption only analyze aliases match", () => {
    expect(m("حلل", { isCaption: true })?.command).toBe("analyze");
    expect(m("تحليل", { isCaption: true })?.command).toBe("analyze");
    expect(m("رصيدي", { isCaption: true })).toBeNull();
    expect(m("new", { isCaption: true })).toBeNull();
    expect(m("؟", { isCaption: true })).toBeNull();
    expect(m("1", { isCaption: true, menuActive: true })).toBeNull();
  });

  it("exports the confirm words for privacy", () => {
    expect(WA_PRIVACY_CONFIRM.map(normalizeCommandText)).toContain("تاكيد");
  });
});

describe("matchCommand: menu", () => {
  it("maps a lone digit to the menu entry only when the menu is active", () => {
    MENU_ORDER.forEach((command, i) => {
      expect(m(String(i + 1), { menuActive: true })).toEqual({ command, via: "menu" });
      expect(m(String(i + 1))).toBeNull();
    });
  });

  it("takes Arabic-Indic digits, emoji and punctuation around the digit", () => {
    expect(m("١", { menuActive: true })).toEqual({ command: "analyze", via: "menu" });
    expect(m("۳", { menuActive: true })?.command).toBe("balance");
    expect(m("2️⃣", { menuActive: true })?.command).toBe("report");
    expect(m("5.", { menuActive: true })?.command).toBe("voice");
  });

  it("ignores 0, multi-digit numbers and digits inside sentences", () => {
    for (const t of ["0", "10", "12", "1 2", "رقم 1", "99"]) {
      expect(m(t, { menuActive: true })).toBeNull();
    }
  });
});

describe("matchCommand: negatives", () => {
  it("never matches a sentence that merely contains an alias", () => {
    const sentences = [
      "عايز دوا جديد",
      "ممكن تحلل لي الصورة دي بكرة؟ لا خلاص",
      "الجدول بتاع الدوا فين في الروشتة اللي فاتت ولا ايه",
      "رصيدي خلص امتى؟",
      "هو التقرير ده رسمي؟",
      "ابعتلي pdf تاني لو سمحت يا دكتور",
      "help me please",
      "حلل الروشتة دي لو سمحت",
      "new new",
      "",
      "   ",
      "😊",
      "/",
    ];
    for (const s of sentences) expect(m(s)).toBeNull();
  });

  it("matches none of the Egyptian Arabic corpus", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(2000);
    expect(new Set(corpus).size).toBe(corpus.length);
    const hits = corpus.filter(
      (line) => m(line) !== null || m(line, { menuActive: true }) !== null,
    );
    expect(hits).toEqual([]);
  });

  it("matches none of the corpus with an emoji appended, nor as a caption", () => {
    const hits = corpus.filter(
      (line) => m(`${line} 😊`) !== null || m(`${line} 🙏`, { menuActive: true }) !== null,
    );
    expect(hits).toEqual([]);
    const captions = corpus.filter((line) => m(line, { isCaption: true }) !== null);
    expect(captions).toEqual([]);
  });
});

describe("matchCommand: properties", () => {
  const TASHKEEL_CHARS = [
    ...Array.from({ length: 0x15 }, (_, i) => String.fromCharCode(0x064b + i)),
    "ٰ",
    "ـ",
  ];
  const NOISE = ["😊", "👍", "🙏", "💊", ".", "!", "،", "؟", "؛", "…", "-", "_", " ", "🏥"];

  const aliasArb = fc.constantFrom(...ALIAS_PAIRS);
  const noise = fc.array(fc.constantFrom(...NOISE), { maxLength: 4 }).map((a) => a.join(""));
  const marks = fc
    .array(fc.constantFrom(...TASHKEEL_CHARS), { maxLength: 2 })
    .map((a) => a.join(""));

  it("(b) an alias wrapped in tashkeel, tatweel, emoji and punctuation still matches its command", () => {
    fc.assert(
      fc.property(
        aliasArb,
        noise,
        noise,
        fc.array(marks, { minLength: 40, maxLength: 40 }),
        ([c, a], pre, post, ms) => {
          let i = 0;
          const decorated = Array.from(a)
            .map((ch) => (ch === " " || ch === "/" ? ch : ch + (ms[i++] ?? "")))
            .join("");
          const r = m(`${pre}${decorated}${post}`);
          expect(r?.command).toBe(c);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("(c) any string with more than four words never matches", () => {
    const word = fc.stringMatching(/^[a-zء-ي]{1,7}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 5, maxLength: 9 }), (words) => {
        expect(m(words.join(" "))).toBeNull();
        expect(m(words.join(" "), { menuActive: true })).toBeNull();
      }),
      { numRuns: 500 },
    );
    // also with an alias as the head: still more than four words
    fc.assert(
      fc.property(aliasArb, fc.array(word, { minLength: 5, maxLength: 5 }), ([, a], extra) => {
        expect(m(`${a} ${extra.join(" ")}`)).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("(d) an alias plus an extra Arabic word is not an exact match unless the result is an alias", () => {
    const arabicWord = fc.stringMatching(/^[ا-ي]{1,6}$/);
    const shortAlias = ALIAS_PAIRS.filter(([, a]) => wordsOf(normalizeCommandText(a)).length <= 3);
    fc.assert(
      fc.property(fc.constantFrom(...shortAlias), arabicWord, ([, a], w) => {
        const text = `${a} ${w}`;
        const r = m(text);
        if (r?.via === "alias") {
          expect(NORMALIZED_ALIASES.has(normalizeCommandText(text).replace(/^\//, ""))).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it("(e) menu digits only match with menuActive", () => {
    const arabicDigit = (d: number, style: number): string =>
      style === 0 ? String(d) : String.fromCharCode((style === 1 ? 0x0660 : 0x06f0) + d);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), fc.constantFrom(0, 1, 2), (n, style) => {
        const text = String(n)
          .split("")
          .map((d) => arabicDigit(Number(d), style))
          .join("");
        expect(m(text)).toBeNull();
        const r = m(text, { menuActive: true });
        if (n >= 1 && n <= 9) expect(r).toEqual({ command: MENU_ORDER[n - 1], via: "menu" });
        else expect(r).toBeNull();
      }),
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        expect(m(s)).toEqual(m(s));
      }),
      { numRuns: 200 },
    );
  });
});
