/*
 * Text normalization for drug matching (Task 2.7). The same functions run when the drug list is
 * imported and when a name is looked up, so both sides always compare the same shape of text.
 * Pure and dependency-free: the api, the worker and the web can all use it.
 */

/** Arabic points (U+064B-U+0652), the superscript alef (U+0670) and the tatweel (U+0640). */
const ARABIC_MARKS = /[ً-ْٰـ]/g;
const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

const LETTER_MAP: Readonly<Record<string, string>> = {
  أ: "ا",
  إ: "ا",
  آ: "ا",
  ٱ: "ا",
  ى: "ي",
  ة: "ه",
  ؤ: "و",
  ئ: "ي",
};

/** Arabic-Indic (U+0660-0669) and Persian (U+06F0-06F9) digits to 0-9. */
function westernDigit(char: string): string {
  const code = char.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
}

/**
 * Arabic text in one canonical spelling: no tashkeel or tatweel, the alef/yeh/heh/waw variants
 * folded (أإآٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي), Arabic digits as 0-9, whitespace collapsed and trimmed.
 * Latin text passes through unchanged (no lowercasing: see `normalizeDrugName`).
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(ARABIC_MARKS, "")
    .replace(/[أإآٱىةؤئ]/g, (char) => LETTER_MAP[char] ?? char)
    .replace(/[٠-٩۰-۹]/g, westernDigit)
    .replace(/\s+/g, " ")
    .trim();
}

export const STRENGTH_UNITS = ["mg", "g", "mcg", "ml", "%", "iu"] as const;
export type StrengthUnit = (typeof STRENGTH_UNITS)[number];

export interface Strength {
  value: number;
  unit: StrengthUnit;
  /** Set for "250mg/5ml": the strength is per this volume. */
  per?: { value: number; unit: "ml" };
}

/** Spellings (already run through `normalizeArabic` and lowercased) of every unit we recognise. */
const UNIT_SPELLINGS: readonly (readonly [string, StrengthUnit])[] = [
  ["mg", "mg"],
  ["ملجم", "mg"],
  ["مجم", "mg"],
  ["ملغ", "mg"],
  ["ملغم", "mg"],
  ["gm", "g"],
  ["gr", "g"],
  ["g", "g"],
  ["جم", "g"],
  ["غم", "g"],
  ["جرام", "g"],
  ["mcg", "mcg"],
  ["µg", "mcg"],
  ["μg", "mcg"],
  ["ug", "mcg"],
  ["ميكروجرام", "mcg"],
  ["ml", "ml"],
  ["مل", "ml"],
  ["%", "%"],
  ["٪", "%"],
  ["iu", "iu"],
  ["i.u.", "iu"],
  ["i.u", "iu"],
  ["وحده دوليه", "iu"],
  ["وحده", "iu"],
];

const UNIT_LOOKUP = new Map<string, StrengthUnit>(UNIT_SPELLINGS);
// Longest spelling first so "mcg" is not read as "m" and "ملجم" is not cut at "مل".
const UNIT_PATTERN = [...UNIT_SPELLINGS]
  .map(([spelling]) => spelling)
  .sort((a, b) => b.length - a.length)
  .map((spelling) => spelling.replaceAll(".", String.raw`\.`))
  .join("|");

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
// "500 mg", "0.5%", "250mg/5ml", "125 mg / ml". The unit must not run into more letters ("mgx").
const STRENGTH_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<!\d[.,])(${NUMBER})\s*(${UNIT_PATTERN})(?![\p{L}])` +
    String.raw`(?:\s*/\s*(${NUMBER})?\s*(ml|مل)(?![\p{L}]))?`,
  "giu",
);

/** "1,000" is a thousand, "0,5" is a half. */
function toNumber(raw: string): number {
  return Number(/^\d+,\d{3}$/.test(raw) ? raw.replace(",", "") : raw.replace(",", "."));
}

interface StrengthMatch {
  strength: Strength;
  start: number;
  end: number;
}

function findStrengths(prepared: string): StrengthMatch[] {
  const found: StrengthMatch[] = [];
  for (const match of prepared.matchAll(STRENGTH_PATTERN)) {
    const [whole, rawValue, rawUnit, rawPer] = match;
    const unit = UNIT_LOOKUP.get((rawUnit ?? "").toLowerCase());
    if (rawValue === undefined || unit === undefined) continue;
    const strength: Strength = { value: toNumber(rawValue), unit };
    // A trailing "/ml" (the optional group matched) means "per this volume"; no number is 1 ml.
    if (match[4] !== undefined) {
      strength.per = { value: rawPer === undefined ? 1 : toNumber(rawPer), unit: "ml" };
    }
    found.push({ strength, start: match.index, end: match.index + whole.length });
  }
  return found;
}

const prepare = (text: string): string => normalizeArabic(text).toLowerCase();

/** The first strength in the text, units normalized (`ملجم` → mg, `µg` → mcg), or `null`. */
export function parseStrength(text: string): Strength | null {
  return findStrengths(prepare(text))[0]?.strength ?? null;
}

/** Strength value as the integer the database stores (`value x 10^6`). */
export function strengthMicro(value: number): number {
  return Math.round(value * 1_000_000);
}

export const DRUG_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "ampoule",
  "vial",
  "injection",
  "cream",
  "ointment",
  "gel",
  "drops",
  "eye drops",
  "ear drops",
  "spray",
  "sachet",
  "suppository",
  "effervescent",
] as const;
export type DrugForm = (typeof DRUG_FORMS)[number];

/** Form words, as written in lists, to the canonical form. Arabic entries are already normalized. */
const FORM_WORDS: readonly (readonly [string, DrugForm])[] = [
  ["tab", "tablet"],
  ["tabs", "tablet"],
  ["tablet", "tablet"],
  ["tablets", "tablet"],
  ["اقراص", "tablet"],
  ["قرص", "tablet"],
  ["cap", "capsule"],
  ["caps", "capsule"],
  ["capsule", "capsule"],
  ["capsules", "capsule"],
  ["كبسول", "capsule"],
  ["كبسولات", "capsule"],
  ["syrup", "syrup"],
  ["شراب", "syrup"],
  ["susp", "suspension"],
  ["suspension", "suspension"],
  ["معلق", "suspension"],
  ["amp", "ampoule"],
  ["ampoule", "ampoule"],
  ["امبول", "ampoule"],
  ["vial", "vial"],
  ["inj", "injection"],
  ["injection", "injection"],
  ["حقن", "injection"],
  ["cream", "cream"],
  ["كريم", "cream"],
  ["oint", "ointment"],
  ["ointment", "ointment"],
  ["مرهم", "ointment"],
  ["gel", "gel"],
  ["جل", "gel"],
  ["drops", "drops"],
  ["نقط", "drops"],
  ["قطره", "drops"],
  ["spray", "spray"],
  ["بخاخ", "spray"],
  ["sachet", "sachet"],
  ["اكياس", "sachet"],
  ["supp", "suppository"],
  ["suppository", "suppository"],
  ["لبوس", "suppository"],
  ["effervescent", "effervescent"],
  ["فوار", "effervescent"],
];
const FORM_LOOKUP = new Map<string, DrugForm>(FORM_WORDS);
const TWO_WORD_FORMS = new Map<string, DrugForm>([
  ["eye drops", "eye drops"],
  ["ear drops", "ear drops"],
]);

export interface NormalizedDrugName {
  /** Lowercased, marks and punctuation removed, strength and form words taken out. */
  name: string;
  /** The first dosage-form word found, in its canonical English spelling. */
  form: DrugForm | null;
  /** `ar` when the text has any Arabic letter, else `en`. */
  lang: "ar" | "en";
  /** The first strength found in the text (already taken out of `name`). */
  strength: Strength | null;
}

/** Cuts every `[start, end)` span out of the text, leaving a space. */
function cutSpans(text: string, spans: readonly { start: number; end: number }[]): string {
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += `${text.slice(cursor, span.start)} `;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

/**
 * Turns a brand/generic name as printed on a box or list into the text we match on: lowercase,
 * Arabic folded, strength expressions and dosage-form words moved out, punctuation dropped except
 * `%` and `.` ("0.5%" survives). If nothing is left after that (the text was just "tablets"), the
 * form words stay in the name so a name is never empty.
 */
export function normalizeDrugName(text: string): NormalizedDrugName {
  const prepared = prepare(text);
  const lang = ARABIC_LETTER.test(prepared) ? "ar" : "en";
  const strengths = findStrengths(prepared);
  const withoutStrength = cutSpans(prepared, strengths);

  const tokens = withoutStrength
    .replace(/[^\p{L}\p{N}\s%.]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ""))
    .filter((token) => token !== "");

  let form: DrugForm | null = null;
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    const twoWord = TWO_WORD_FORMS.get(`${token} ${tokens[i + 1] ?? ""}`);
    if (twoWord !== undefined) {
      form ??= twoWord;
      i++;
      continue;
    }
    const single = FORM_LOOKUP.get(token);
    if (single !== undefined) {
      form ??= single;
      continue;
    }
    kept.push(token);
  }
  const name = (kept.length > 0 ? kept : tokens).join(" ");
  return { name, form, lang, strength: strengths[0]?.strength ?? null };
}
