import { describe, expect, it } from "vitest";

import { normalizeDose, normalizeDuration, normalizeFrequency } from "../src/rx-normalize.js";

/*
 * The dictionary is a draft for the pharmacist review: each row below is one abbreviation. The
 * rule that matters most is the last block of each table: text we do not fully understand comes
 * back exactly as written (trimmed), never half-translated.
 */

const frequency: [input: string, expected: string][] = [
  ["1x3", "3 مرات يوميًا"],
  ["1×3", "3 مرات يوميًا"],
  ["3x1", "3 مرات يوميًا"],
  ["3 × 1", "3 مرات يوميًا"],
  ["١×٣", "3 مرات يوميًا"],
  ["2x2", "مرتين يوميًا"],
  ["1x1", "مرة يوميًا"],
  ["1x4", "4 مرات يوميًا"],
  ["bid", "مرتين يوميًا"],
  ["b.i.d", "مرتين يوميًا"],
  ["B.I.D.", "مرتين يوميًا"],
  ["BD", "مرتين يوميًا"],
  ["tid", "3 مرات يوميًا"],
  ["t.i.d", "3 مرات يوميًا"],
  ["qid", "4 مرات يوميًا"],
  ["q.i.d", "4 مرات يوميًا"],
  ["od", "مرة يوميًا"],
  ["qd", "مرة يوميًا"],
  ["daily", "مرة يوميًا"],
  ["once daily", "مرة يوميًا"],
  ["twice a day", "مرتين يوميًا"],
  ["3 times daily", "3 مرات يوميًا"],
  ["three times a day", "3 مرات يوميًا"],
  ["3 مرات يوميا", "3 مرات يوميًا"],
  ["ثلاث مرات يوميًا", "3 مرات يوميًا"],
  ["مرتين يوميا", "مرتين يوميًا"],
  ["مرة يوميا", "مرة يوميًا"],
  ["يوميًا", "مرة يوميًا"],
  ["q8h", "كل 8 ساعات"],
  ["every 12 hours", "كل 12 ساعة"],
  ["كل 6 ساعات", "كل 6 ساعات"],
  ["qod", "يومًا بعد يوم"],
  ["prn", "عند اللزوم"],
  ["P.R.N", "عند اللزوم"],
  ["as needed", "عند اللزوم"],
  ["عند اللزوم", "عند اللزوم"],
  ["hs", "قبل النوم"],
  ["at bedtime", "قبل النوم"],
  ["قبل النوم", "قبل النوم"],
  ["ac", "قبل الأكل"],
  ["ق.أ", "قبل الأكل"],
  ["قبل الأكل", "قبل الأكل"],
  ["قبل الاكل", "قبل الأكل"],
  ["pc", "بعد الأكل"],
  ["ب.أ", "بعد الأكل"],
  ["بعد الأكل", "بعد الأكل"],
  ["after meals", "بعد الأكل"],
  ["with food", "مع الأكل"],
  ["على الريق", "على الريق"],
  // Combinations come out in one fixed order: how often, then when, then "if needed".
  ["bid pc", "مرتين يوميًا بعد الأكل"],
  ["pc bid", "مرتين يوميًا بعد الأكل"],
  ["1x3 ق.أ", "3 مرات يوميًا قبل الأكل"],
  ["tid prn", "3 مرات يوميًا عند اللزوم"],
  ["1x2, بعد الأكل", "مرتين يوميًا بعد الأكل"],
  ["bid bid", "مرتين يوميًا"],
];

const frequencyKept = [
  "every other morning",
  "bid x 3",
  "1x3 with a glass of water",
  "حسب توجيه الطبيب",
  "1x30",
  "bid 1x3",
];

const duration: [input: string, expected: string][] = [
  ["x 5 days", "5 أيام"],
  ["x5 days", "5 أيام"],
  ["× 7 days", "7 أيام"],
  ["for 5 days", "5 أيام"],
  ["5 days", "5 أيام"],
  ["5d", "5 أيام"],
  ["10 days", "10 أيام"],
  ["14 days", "14 يومًا"],
  ["1 day", "يوم"],
  ["2 days", "يومان"],
  ["for 1 week", "أسبوع"],
  ["1 week", "أسبوع"],
  ["a week", "أسبوع"],
  ["2 weeks", "أسبوعان"],
  ["x 3 weeks", "3 أسابيع"],
  ["1 month", "شهر"],
  ["3 months", "3 أشهر"],
  ["لمدة 5 أيام", "5 أيام"],
  ["لمدة ٥ أيام", "5 أيام"],
  ["5 ايام", "5 أيام"],
  ["مدة 3 أيام", "3 أيام"],
  ["أسبوع", "أسبوع"],
  ["اسبوعين", "أسبوعان"],
  ["لمدة اسبوعين", "أسبوعان"],
  ["شهر", "شهر"],
  ["شهرين", "شهران"],
  ["يومين", "يومان"],
  ["لمدة ثلاثة أيام", "3 أيام"],
  ["continuous", "بشكل مستمر"],
  ["مستمر", "بشكل مستمر"],
];

const durationKept = ["until finished", "5 days then 3 days", "حتى الشفاء", "x 400 days"];

const dose: [input: string, expected: string][] = [
  ["1 tab", "قرص واحد"],
  ["1 tablet", "قرص واحد"],
  ["2 tabs", "قرصان"],
  ["3 tablets", "3 أقراص"],
  ["12 tabs", "12 قرصًا"],
  ["½ tab", "نصف قرص"],
  ["1/2 tab", "نصف قرص"],
  ["half tablet", "نصف قرص"],
  ["1 1/2 tab", "1.5 قرص"],
  ["1.5 tabs", "1.5 قرص"],
  ["١ قرص", "قرص واحد"],
  ["نصف قرص", "نصف قرص"],
  ["1 cap", "كبسولة واحدة"],
  ["2 capsules", "كبسولتان"],
  ["1 amp", "أمبولة واحدة"],
  ["5 ml", "5 مل"],
  ["2.5 ml", "2.5 مل"],
  ["10 drops", "10 نقاط"],
  ["1 tsp", "ملعقة صغيرة"],
  ["2 tbsp", "ملعقتان كبيرتان"],
];

const doseKept = ["قرصين", "1", "as directed", "1 tab with water", "٢٠٠ mg"];

describe("normalizeFrequency", () => {
  it.each(frequency)("%s -> %s", (input, expected) => {
    expect(normalizeFrequency(input)).toBe(expected);
  });

  it.each(frequencyKept)("keeps text it does not fully understand: %s", (input) => {
    expect(normalizeFrequency(input)).toBe(input);
  });

  it("passes null through and treats blank text as missing", () => {
    expect(normalizeFrequency(null)).toBeNull();
    expect(normalizeFrequency(undefined)).toBeNull();
    expect(normalizeFrequency("   ")).toBeNull();
  });

  it("trims and collapses whitespace in text it keeps", () => {
    expect(normalizeFrequency("  as   the doctor   said ")).toBe("as the doctor said");
  });
});

describe("normalizeDuration", () => {
  it.each(duration)("%s -> %s", (input, expected) => {
    expect(normalizeDuration(input)).toBe(expected);
  });

  it.each(durationKept)("keeps text it does not fully understand: %s", (input) => {
    expect(normalizeDuration(input)).toBe(input);
  });

  it("passes null through", () => {
    expect(normalizeDuration(null)).toBeNull();
    expect(normalizeDuration("")).toBeNull();
  });
});

describe("normalizeDose", () => {
  it.each(dose)("%s -> %s", (input, expected) => {
    expect(normalizeDose(input)).toBe(expected);
  });

  it.each(doseKept)("keeps text it does not fully understand: %s", (input) => {
    expect(normalizeDose(input)).toBe(input);
  });

  it("passes null through", () => {
    expect(normalizeDose(null)).toBeNull();
  });
});
