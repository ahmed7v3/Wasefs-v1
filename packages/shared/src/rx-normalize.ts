/*
 * Dose / frequency / duration normalization for prescriptions (Phase 2, Task 2.8, Decision 8):
 * deterministic code, not the model, turns "1x3", "bid", "ق.أ" or "x 5 days" into one standard
 * Arabic phrase. The dictionary below is a DRAFT for the pharmacist review (phase2.md owner
 * prerequisites): every abbreviation is one row, so a correction is a one-line change.
 *
 * Rule for every function: if ANY part of the text is not understood, the original text is
 * returned unchanged (trimmed). Normalizing must never drop information the doctor wrote.
 */
import { normalizeArabic } from "./normalize.js";

/** Not inside a word: Arabic letters have no `\b`, so the boundary is spelled out. */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;

/** The pattern sources are written in natural spelling and folded like the input (أ→ا, ة→ه, ى→ي). */
const fold = (source: string): string => normalizeArabic(source);

const NUMBER_WORD_ROWS: readonly (readonly [number, string])[] = [
  [1, "one a an واحد واحده"],
  [2, "two اثنين اثنان اتنين"],
  [3, "three ثلاث ثلاثه تلات تلاته"],
  [4, "four اربع اربعه"],
  [5, "five خمس خمسه"],
  [6, "six ست سته"],
  [7, "seven سبع سبعه"],
  [8, "eight ثمان ثمانيه تمان تمانيه"],
  [9, "nine تسع تسعه"],
  [10, "ten عشر عشره"],
];

const NUMBER_WORDS: Readonly<Record<string, number>> = Object.fromEntries(
  NUMBER_WORD_ROWS.flatMap(([value, words]) =>
    words.split(" ").map((word): [string, number] => [fold(word), value]),
  ),
);

const COUNT = String.raw`(\d+(?:[.,]\d+)?|${Object.keys(NUMBER_WORDS)
  .filter((word) => word !== "a" && word !== "an")
  .join("|")})`;

function toCount(raw: string): number {
  const word = NUMBER_WORDS[raw];
  return word ?? Number(raw.replace(",", "."));
}

/** The text as the rules see it: one spelling, `x` for every multiplication sign, abbreviations without dots. */
function prepare(text: string): string {
  return normalizeArabic(text)
    .toLowerCase()
    .replace(/[×✕✖*]/g, "x")
    .replace(/(?<=\p{L})\.(?=\p{L})/gu, "")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Capture groups of one match (`[0]` is the whole match); unmatched optional groups are `undefined`. */
type Groups = readonly (string | undefined)[];

/** A rule consumes the text it understands and says what it means; `null` = not understood, left in place. */
interface Rule<Slot extends string> {
  /** Documentation only: what the row stands for. */
  id: string;
  pattern: RegExp;
  slot: Slot;
  render: (groups: Groups) => string | null;
}

function rule<Slot extends string>(
  id: string,
  source: string,
  slot: Slot,
  render: Rule<Slot>["render"],
): Rule<Slot> {
  return { id, pattern: new RegExp(fold(source), "giu"), slot, render };
}

/**
 * Runs the rules in order over `prepared`. Returns the rendered phrases per slot, or `null` when
 * something was left over (so the caller keeps the original text).
 */
function apply<Slot extends string>(
  prepared: string,
  rules: readonly Rule<Slot>[],
): { slot: Slot; text: string }[] | null {
  const found: { slot: Slot; text: string }[] = [];
  let rest = prepared;
  for (const { pattern, slot, render } of rules) {
    rest = rest.replace(pattern, (...args: unknown[]) => {
      // replace() passes (match, ...groups, offset, string): the last two are not groups.
      const groups = args.slice(0, -2) as Groups;
      const text = render(groups);
      if (text === null) return groups[0] ?? "";
      found.push({ slot, text });
      return " ";
    });
  }
  const leftover = rest.replace(/[\s,،+/-]+/g, " ").trim();
  return leftover === "" ? found : null;
}

// ---------------------------------------------------------------------------------------------
// Frequency
// ---------------------------------------------------------------------------------------------

type FrequencySlot = "times" | "timing" | "prn";
const FREQUENCY_ORDER: Record<FrequencySlot, number> = { times: 0, timing: 1, prn: 2 };

/** "Once a day" in the standard phrase; up to 12 a day is plausible, anything else is not understood. */
export function timesPerDay(count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > 12) return null;
  if (count === 1) return "مرة يوميًا";
  if (count === 2) return "مرتين يوميًا";
  return count <= 10 ? `${count} مرات يوميًا` : `${count} مرة يوميًا`;
}

/** Latin abbreviations that mean "N times a day". */
const TIMES_ABBREVIATIONS: Readonly<Record<string, number>> = {
  od: 1,
  qd: 1,
  bid: 2,
  bd: 2,
  tid: 3,
  tds: 3,
  qid: 4,
  qds: 4,
};

const PER_DAY = String.raw`(?:a\s*day|per\s*day|/\s*day|daily|يوميا|في اليوم|باليوم)`;

function hoursPhrase(count: number): string | null {
  if (!Number.isInteger(count) || count < 1 || count > 48) return null;
  if (count === 1) return "كل ساعة";
  if (count === 2) return "كل ساعتين";
  return count <= 10 ? `كل ${count} ساعات` : `كل ${count} ساعة`;
}

const FREQUENCY_RULES: readonly Rule<FrequencySlot>[] = [
  // 1x3, 1×3, 3x1, 2x2: the larger number is the number of doses a day.
  rule("a x b", `${START}(\\d+)\\s*x\\s*(\\d+)${END}`, "times", (m) =>
    timesPerDay(Math.max(Number(m[1]), Number(m[2]))),
  ),
  rule("q8h / every 8 hours / كل 8 ساعات", `${START}(?:q\\s*(\\d+)\\s*h(?:rs?|ours?)?|every\\s*(\\d+)\\s*(?:h|hrs?|hours?)|كل\\s*(\\d+)\\s*ساع(?:ات|ة))${END}`, "times", (m) =>
    hoursPhrase(Number(m[1] ?? m[2] ?? m[3])),
  ),
  rule("N times a day", `${START}${COUNT}\\s*(?:times?|مرات|مرة)\\s*${PER_DAY}${END}`, "times", (m) =>
    timesPerDay(toCount(m[1] ?? "")),
  ),
  rule("once / twice / thrice a day", `${START}(once|twice|thrice)\\s*${PER_DAY}${END}`, "times", (m) =>
    timesPerDay({ once: 1, twice: 2, thrice: 3 }[m[1] ?? ""] ?? 0),
  ),
  rule("مرة / مرتين يوميًا", `${START}(مرة|مرتين)\\s*(?:واحدة\\s*)?${PER_DAY}${END}`, "times", (m) =>
    timesPerDay(m[1] === fold("مرتين") ? 2 : 1),
  ),
  rule("od qd bid bd tid tds qid qds", `${START}(od|qd|bid|bd|tid|tds|qid|qds)${END}`, "times", (m) =>
    timesPerDay(TIMES_ABBREVIATIONS[m[1] ?? ""] ?? 0),
  ),
  rule("qod", `${START}qod${END}`, "times", () => "يومًا بعد يوم"),
  rule("daily", `${START}(?:daily|every\\s*day|كل يوم|يوميا)${END}`, "times", () => "مرة يوميًا"),
  rule("hs / qhs / bedtime", `${START}(?:q?hs|at\\s*bed\\s*time|bed\\s*time|before\\s*(?:sleep|bed)|قبل النوم)${END}`, "timing", () => "قبل النوم"),
  rule("ac / ق.أ / before meals", `${START}(?:ac|before\\s*(?:meals?|food|eating)|قبل الاكل|قبل الطعام|قا)${END}`, "timing", () => "قبل الأكل"),
  rule("pc / ب.أ / after meals", `${START}(?:pc|after\\s*(?:meals?|food|eating)|بعد الاكل|بعد الطعام|با)${END}`, "timing", () => "بعد الأكل"),
  rule("with meals", `${START}(?:with\\s*(?:meals?|food)|مع الاكل|مع الطعام)${END}`, "timing", () => "مع الأكل"),
  rule("empty stomach", `${START}(?:empty\\s*stomach|على الريق|على معدة فارغة)${END}`, "timing", () => "على الريق"),
  rule("prn / as needed", `${START}(?:prn|sos|as\\s*needed|when\\s*needed|if\\s*needed|عند اللزوم|عند الحاجة|اذا لزم الامر|اذا لزم)${END}`, "prn", () => "عند اللزوم"),
];

function compose(parts: { slot: FrequencySlot; text: string }[]): string | null {
  const unique = [...new Map(parts.map((part) => [part.text, part])).values()];
  // Two different answers for "times" ("bid" and "1x3") contradict each other: keep the original.
  if (unique.filter((part) => part.slot === "times").length > 1) return null;
  return unique
    .sort((a, b) => FREQUENCY_ORDER[a.slot] - FREQUENCY_ORDER[b.slot])
    .map((part) => part.text)
    .join(" ");
}

const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * "1x3", "3x1", "tid", "t.i.d", "ثلاث مرات يوميا" -> "3 مرات يوميًا"; "bid pc" -> "مرتين يوميًا
 * بعد الأكل". Unknown text comes back as written.
 */
export function normalizeFrequency(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const original = tidy(text);
  if (original === "") return null;
  const parts = apply(prepare(original), FREQUENCY_RULES);
  if (parts === null || parts.length === 0) return original;
  return compose(parts) ?? original;
}

// ---------------------------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------------------------

type DurationUnit = "day" | "week" | "month";

const DURATION_UNIT_WORDS: Readonly<Record<DurationUnit, readonly string[]>> = {
  day: ["days", "day", "d", "ايام", "يوم"],
  week: ["weeks", "week", "wks", "wk", "w", "اسابيع", "اسبوع"],
  month: ["months", "month", "mo", "اشهر", "شهور", "شهر"],
};
const DURATION_UNIT_LOOKUP = new Map<string, DurationUnit>(
  (Object.entries(DURATION_UNIT_WORDS) as [DurationUnit, readonly string[]][]).flatMap(
    ([unit, words]) => words.map((word): [string, DurationUnit] => [fold(word), unit]),
  ),
);
const DURATION_UNIT_ALTERNATIVES = [...DURATION_UNIT_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|");
const DUAL: Readonly<Record<string, DurationUnit>> = {
  [fold("يومين")]: "day",
  [fold("اسبوعين")]: "week",
  [fold("شهرين")]: "month",
};

/** "for", "x", "لمدة", "مدة", "خلال": words that introduce a duration and carry no meaning of their own. */
const DURATION_LEAD = String.raw`(?:(?:for|x|لمدة|مدة|خلال)\s*)?`;

const DURATION_PHRASES: Readonly<Record<DurationUnit, readonly [string, string, string, string]>> = {
  // one, two, 3-10 (the number goes in front), 11+
  day: ["يوم", "يومان", "أيام", "يومًا"],
  week: ["أسبوع", "أسبوعان", "أسابيع", "أسبوعًا"],
  month: ["شهر", "شهران", "أشهر", "شهرًا"],
};

function durationPhrase(count: number, unit: DurationUnit): string | null {
  if (!Number.isInteger(count) || count < 1 || count > 365) return null;
  const [one, two, few, many] = DURATION_PHRASES[unit];
  if (count === 1) return one;
  if (count === 2) return two;
  return count <= 10 ? `${count} ${few}` : `${count} ${many}`;
}

const DURATION_RULES: readonly Rule<"duration">[] = [
  rule("يومين / أسبوعين / شهرين", `${START}${DURATION_LEAD}(يومين|اسبوعين|شهرين)${END}`, "duration", (m) => {
    const unit = DUAL[m[1] ?? ""];
    return unit === undefined ? null : durationPhrase(2, unit);
  }),
  rule("N days / weeks / months", `${START}${DURATION_LEAD}${COUNT}\\s*(${DURATION_UNIT_ALTERNATIVES})${END}`, "duration", (m) => {
    const unit = DURATION_UNIT_LOOKUP.get(m[2] ?? "");
    return unit === undefined ? null : durationPhrase(toCount(m[1] ?? ""), unit);
  }),
  rule("a week / اسبوع", `${START}${DURATION_LEAD}(?:(?:a|an|one)\\s+)?(day|week|month|يوم|اسبوع|شهر)${END}`, "duration", (m) => {
    const unit = DURATION_UNIT_LOOKUP.get(m[1] ?? "");
    return unit === undefined ? null : durationPhrase(1, unit);
  }),
  rule("continuous", `${START}(?:continuous(?:ly)?|ongoing|long\\s*term|مستمر|باستمرار)${END}`, "duration", () => "بشكل مستمر"),
];

/** "x 5 days", "for 1 week", "لمدة 5 أيام", "اسبوعين" -> "5 أيام", "أسبوع", "أسبوعان". Unknown text comes back as written. */
export function normalizeDuration(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const original = tidy(text);
  if (original === "") return null;
  const parts = apply(prepare(original), DURATION_RULES);
  if (parts === null || parts.length !== 1) return original;
  return parts[0]?.text ?? original;
}

// ---------------------------------------------------------------------------------------------
// Dose
// ---------------------------------------------------------------------------------------------

interface DoseUnit {
  /** Spellings of the unit (natural Arabic spelling; folded when the table is built). */
  words: readonly string[];
  /** "one", "two", "3-10", "11+" renderings; `fixed` units print `<n> <unit>` always. */
  forms: readonly [string, string, string, string] | { fixed: string };
  /** The bare noun, for halves and decimals. */
  noun: string;
}

const DOSE_UNITS: readonly DoseUnit[] = [
  {
    words: ["tablets", "tablet", "tabs", "tab", "tb", "قرص", "اقراص"],
    forms: ["قرص واحد", "قرصان", "أقراص", "قرصًا"],
    noun: "قرص",
  },
  {
    words: ["capsules", "capsule", "caps", "cap", "كبسولة", "كبسولات", "كبسوله"],
    forms: ["كبسولة واحدة", "كبسولتان", "كبسولات", "كبسولة"],
    noun: "كبسولة",
  },
  {
    words: ["ampoules", "ampoule", "amps", "amp", "أمبولة", "امبولة", "امبولات", "أمبولات"],
    forms: ["أمبولة واحدة", "أمبولتان", "أمبولات", "أمبولة"],
    noun: "أمبولة",
  },
  {
    words: ["sachets", "sachet", "كيس", "اكياس", "أكياس"],
    forms: ["كيس واحد", "كيسان", "أكياس", "كيسًا"],
    noun: "كيس",
  },
  {
    words: ["drops", "drop", "gtt", "نقطة", "نقط", "نقاط"],
    forms: ["نقطة واحدة", "نقطتان", "نقاط", "نقطة"],
    noun: "نقطة",
  },
  {
    words: ["puffs", "puff", "بخة", "بخات"],
    forms: ["بخة واحدة", "بختان", "بخات", "بخة"],
    noun: "بخة",
  },
  {
    words: ["teaspoons", "teaspoon", "tsp", "ملعقة صغيرة", "ملاعق صغيرة"],
    forms: ["ملعقة صغيرة", "ملعقتان صغيرتان", "ملاعق صغيرة", "ملعقة صغيرة"],
    noun: "ملعقة صغيرة",
  },
  {
    words: ["tablespoons", "tablespoon", "tbsp", "ملعقة كبيرة", "ملاعق كبيرة"],
    forms: ["ملعقة كبيرة", "ملعقتان كبيرتان", "ملاعق كبيرة", "ملعقة كبيرة"],
    noun: "ملعقة كبيرة",
  },
  { words: ["ml", "مل"], forms: { fixed: "مل" }, noun: "مل" },
];

const DOSE_UNIT_LOOKUP = new Map<string, DoseUnit>(
  DOSE_UNITS.flatMap((unit) => unit.words.map((word): [string, DoseUnit] => [fold(word), unit])),
);
const DOSE_UNIT_ALTERNATIVES = [...DOSE_UNIT_LOOKUP.keys()]
  .sort((a, b) => b.length - a.length)
  .join("|");
const DOSE_PATTERN = new RegExp(
  String.raw`^(?:(\d+)\s+(?=\d+\s*/))?(?:(\d+)\s*/\s*(\d+)|(\d+(?:[.,]\d+)?)|(½|نصف|half))?\s*(${DOSE_UNIT_ALTERNATIVES})$`,
  "iu",
);

function doseCount(match: RegExpMatchArray): number | null {
  const [, whole, numerator, denominator, decimal, half] = match;
  if (numerator !== undefined && denominator !== undefined) {
    const fraction = Number(numerator) / Number(denominator);
    return Number.isFinite(fraction) ? fraction + Number(whole ?? 0) : null;
  }
  if (decimal !== undefined) return Number(decimal.replace(",", "."));
  if (half !== undefined) return 0.5;
  return 1;
}

/** "1 tab", "2 tablets", "½ قرص", "1/2 tab", "5 ml" -> "قرص واحد", "قرصان", "نصف قرص", "5 مل". Unknown text comes back as written. */
export function normalizeDose(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const original = tidy(text);
  if (original === "") return null;
  const match = DOSE_PATTERN.exec(prepare(original));
  const unit = match === null ? undefined : DOSE_UNIT_LOOKUP.get(match[6] ?? "");
  if (match === null || unit === undefined) return original;
  const count = doseCount(match);
  if (count === null || count <= 0 || count > 100) return original;

  if ("fixed" in unit.forms) return `${count} ${unit.forms.fixed}`;
  if (count === 0.5) return `نصف ${unit.noun}`;
  if (!Number.isInteger(count)) return `${count} ${unit.noun}`;
  const [one, two, few, many] = unit.forms;
  if (count === 1) return one;
  if (count === 2) return two;
  return count <= 10 ? `${count} ${few}` : `${count} ${many}`;
}
