/*
 * Deterministic clean-up of what the model reads from a prescription line. Egyptian prescriptions put
 * the drug on one line (a Latin brand, maybe with a strength) and the directions in Arabic underneath,
 * inside one box; the model sometimes copies the whole box into `name` ("نصف ساعة قبل الاكل x -
 * Glibimet 5"). This module puts each piece where it belongs, in code, so the result never shows
 * directions as a drug name.
 *
 * Rule for every function: only text that is present is moved; nothing is invented, translated or
 * respelled, and what cannot be placed stays where it was (or goes to `notes`).
 */
import { normalizeArabic } from "./normalize.js";

import type { Locale } from "./i18n/locales.js";

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const LATIN = /[A-Za-z]/;
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** A token that is only a list marker or a multiplication sign: "-", "x", "Rx", "1.", "(2)". */
const BULLET_TOKEN =
  /^(?:[-–—•·*#>:|]+|[xX×]|rx\.?|R\/|℞|(?:\d{1,2}|[٠-٩]{1,2})[.)]|\((?:\d{1,2}|[٠-٩]{1,2})\))$/i;
/** Marks at the very start of the text, applied until nothing more is removed. */
const LEADING_MARKS = [
  /^[-–—•·*#>:|]+\s*/,
  /^(?:rx|℞|R\/)\.?\s*[:\-–—]?\s+/i,
  /^[xX×]\s*[-–—:]\s*/,
  /^(?:\d{1,2}|[٠-٩]{1,2})\s*[.)]\s*/,
  /^(?:\d{1,2}|[٠-٩]{1,2})\s*[-–—:]\s+/,
];

const isBullet = (token: string): boolean => BULLET_TOKEN.test(token);
/** Digits in Arabic-Indic form are numbers, not Arabic words: they stay with the Latin name. */
const NUMERIC_ONLY = /^[\d٠-٩۰-۹.,/%]+$/;
const isArabicToken = (token: string): boolean => ARABIC.test(token) && !NUMERIC_ONLY.test(token);
const isLatinToken = (token: string): boolean => LATIN.test(token) && !isBullet(token);

function collapse(text: string): string {
  return text.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim();
}

function stripLeadingMarks(text: string): string {
  let current = collapse(text);
  for (let guard = 0; guard < 8; guard += 1) {
    const next = LEADING_MARKS.reduce((value, mark) => value.replace(mark, ""), current).trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

/** The text as one comparable spelling: Arabic folded, Latin lower-cased, no spaces. */
const compact = (text: string): string => normalizeArabic(text).toLowerCase().replace(/\s+/g, "");

interface Split {
  /** The Latin run (or the whole text when it has one script only), without list markers. */
  name: string;
  /** Arabic words that were mixed into the name. */
  arabic: string;
}

/**
 * Splits a name that mixes scripts: the Latin words (with the numbers beside them) stay the name, the
 * Arabic words are the directions. A line in one script is only stripped of its list markers.
 */
function splitScripts(text: string): Split {
  const cleaned = stripLeadingMarks(text);
  const tokens = cleaned === "" ? [] : cleaned.split(" ");
  if (!tokens.some(isArabicToken) || !tokens.some(isLatinToken)) {
    return { name: cleaned, arabic: "" };
  }
  const latin: string[] = [];
  const arabic: string[] = [];
  let side: "latin" | "arabic" | null = null;
  // Numbers and punctuation belong with the word before them; at the start, with the first word's side.
  const pending: string[] = [];
  const put = (target: "latin" | "arabic", token: string): void => {
    (target === "latin" ? latin : arabic).push(token);
  };
  for (const token of tokens) {
    if (isBullet(token)) continue;
    if (isArabicToken(token)) {
      for (const held of pending.splice(0)) put("arabic", held);
      side = "arabic";
      put("arabic", token);
    } else if (isLatinToken(token)) {
      for (const held of pending.splice(0)) put("latin", held);
      side = "latin";
      put("latin", token);
    } else if (side === null) {
      pending.push(token);
    } else {
      put(side, token);
    }
  }
  for (const held of pending) put("latin", held);
  return { name: latin.join(" "), arabic: arabic.join(" ") };
}

/** What to show as the line's name when the model gave none (or on an old stored result): never the directions. */
export function displayName(text: string): string {
  const { name } = splitScripts(text);
  return name === "" ? collapse(text) : name;
}

// ---- forms -----------------------------------------------------------------------------------------

interface FormRow {
  key: string;
  ar: string;
  aliases: readonly string[];
}

const FORM_ROWS: readonly FormRow[] = [
  { key: "capsule", ar: "كبسولات", aliases: ["capsule", "capsules", "cap", "caps"] },
  { key: "tablet", ar: "أقراص", aliases: ["tablet", "tablets", "tab", "tabs"] },
  { key: "suspension", ar: "معلق", aliases: ["suspension", "susp"] },
  { key: "syrup", ar: "شراب", aliases: ["syrup", "syp"] },
  { key: "ampoule", ar: "أمبول", aliases: ["ampoule", "ampoules", "ampule", "amp"] },
  { key: "vial", ar: "فيال", aliases: ["vial", "vials"] },
  { key: "cream", ar: "كريم", aliases: ["cream"] },
  { key: "ointment", ar: "مرهم", aliases: ["ointment", "oint"] },
  { key: "drops", ar: "نقط", aliases: ["drops", "drop", "gtt"] },
  { key: "sachet", ar: "أكياس", aliases: ["sachet", "sachets"] },
  { key: "effervescent", ar: "فوار", aliases: ["effervescent", "eff"] },
  { key: "suppository", ar: "لبوس", aliases: ["suppository", "suppositories", "supp"] },
  { key: "inhaler", ar: "بخاخ", aliases: ["inhaler"] },
  { key: "spray", ar: "بخاخ", aliases: ["spray"] },
  { key: "gel", ar: "جل", aliases: ["gel"] },
  { key: "injection", ar: "حقن", aliases: ["injection", "inj"] },
  { key: "lotion", ar: "لوشن", aliases: ["lotion"] },
  { key: "solution", ar: "محلول", aliases: ["solution"] },
  { key: "patch", ar: "لصقة", aliases: ["patch"] },
];

const FORM_BY_ALIAS: ReadonlyMap<string, FormRow> = new Map(
  FORM_ROWS.flatMap((row) => row.aliases.map((alias): [string, FormRow] => [alias, row])),
);

const bareWord = (token: string): string => token.replace(/^\.+|\.+$/g, "").toLowerCase();

/** Canonical key of a form written in Latin ("Caps." and "capsule" are both `capsule`), else `null`. */
export function formKey(form: string): string | null {
  const text = collapse(form);
  const whole = FORM_BY_ALIAS.get(bareWord(text));
  if (whole !== undefined) return whole.key;
  for (const token of text.split(/[\s/,-]+/)) {
    const found = FORM_BY_ALIAS.get(bareWord(token));
    if (found !== undefined) return found.key;
  }
  return null;
}

/**
 * How a form is shown. Arabic: the Arabic word for a known Latin form ("caps" → "كبسولات", "susp" →
 * "معلق"); anything else (including a form already in Arabic) as written. English: as written.
 */
export function formLabel(form: string | null | undefined, locale: Locale): string | null {
  if (form === null || form === undefined) return null;
  const text = collapse(form);
  if (text === "") return null;
  if (locale !== "ar") return text;
  const key = formKey(text);
  return FORM_ROWS.find((row) => row.key === key)?.ar ?? text;
}

// ---- dose units in Arabic directions ---------------------------------------------------------------

const UNIT_WORDS = new Set(
  [
    "قرص",
    "اقراص",
    "قرصين",
    "قرصان",
    "كبسوله",
    "كبسول",
    "كبسولات",
    "كبسولتين",
    "ملعقه",
    "ملاعق",
    "ملعقتين",
    "ملعقتان",
    "نقطه",
    "نقط",
    "نقاط",
    "نقطتين",
    "قطره",
    "قطرات",
    "قطرتين",
    "مل",
    "ملي",
    "ملل",
    "بخه",
    "بخات",
    "بختين",
    "بخ",
    "لبوس",
    "لبوسه",
    "تحميله",
    "تحاميل",
    "حقنه",
    "حقن",
    "امبول",
    "امبولتين",
    "كيس",
    "اكياس",
  ].map(normalizeArabic),
);
const QUANTITY_WORDS = new Set(
  [
    "نصف",
    "ربع",
    "ثلث",
    "ونصف",
    "واحد",
    "واحده",
    "اثنين",
    "اتنين",
    "ثلاث",
    "ثلاثه",
    "تلات",
    "تلاته",
    "اربع",
    "اربعه",
  ].map(normalizeArabic),
);
const SPOON_MODIFIERS = new Set(["صغيره", "كبيره", "شاي", "اكل", "طعام"].map(normalizeArabic));
const NUMBER_TOKEN = /^(?:\d+(?:[.,/]\d+)?|½|¼)$/;
const NUMBER_WITH_UNIT = /^\d+(?:[.,]\d+)?(?:قرص|كبسوله|ملعقه|مل|ملي|نقطه|نقط|بخه|بخات)$/;

/** Words that say when or how often (so the Arabic text is a direction and not a second name). */
const CUE_WORDS = new Set(
  [
    "قبل",
    "بعد",
    "مره",
    "مرات",
    "مرتين",
    "يوميا",
    "يوم",
    "ايام",
    "ساعه",
    "ساعات",
    "كل",
    "صباحا",
    "صباح",
    "مساء",
    "مساءا",
    "ليلا",
    "عشاء",
    "غداء",
    "فطار",
    "افطار",
    "اكل",
    "نوم",
    "اسبوع",
    "اسابيع",
    "شهر",
    "عند",
    "لمده",
    "الحاجه",
    "ظهرا",
    "فجرا",
    "وجبه",
    "وجبات",
    "الاكل",
  ].map(normalizeArabic),
);

/** A token without the article ("العشاء" → "عشاء") and a leading "و"/"ب", folded. */
function wordOf(token: string): string {
  const folded = normalizeArabic(token).replace(/[.,،؛:؟?!]+$/g, "");
  return folded.replace(/^(?:ال)/, "");
}
const foldedToken = (token: string): string => normalizeArabic(token).replace(/[.,،؛:؟?!]+$/g, "");

const isQuantity = (token: string): boolean => {
  const folded = foldedToken(token);
  return QUANTITY_WORDS.has(folded) || NUMBER_TOKEN.test(folded);
};

/**
 * Finds the first dose in Arabic directions ("قرص", "نصف قرص", "ملعقة", "٥ مل", "نقطتين") and returns
 * it as written together with the text that is left. "نصف ساعة" is a time, not a dose, so it stays.
 */
export function extractDose(text: string): { dose: string | null; rest: string } {
  const tokens = collapse(text) === "" ? [] : collapse(text).split(" ");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const folded = foldedToken(token);
    const attached = NUMBER_WITH_UNIT.test(folded);
    if (!attached && !UNIT_WORDS.has(folded)) continue;
    let start = index;
    let end = index;
    if (!attached && index > 0 && isQuantity(tokens[index - 1] ?? "")) start = index - 1;
    const isSpoon = folded.startsWith("ملعق") || folded.startsWith("ملاعق");
    const next = tokens[index + 1];
    if (isSpoon && next !== undefined && SPOON_MODIFIERS.has(foldedToken(next))) {
      end = index + 1;
      const after = tokens[index + 2];
      if (after !== undefined && SPOON_MODIFIERS.has(foldedToken(after))) end = index + 2;
    }
    return {
      dose: tokens.slice(start, end + 1).join(" "),
      rest: [...tokens.slice(0, start), ...tokens.slice(end + 1)].join(" ").trim(),
    };
  }
  return { dose: null, rest: tokens.join(" ") };
}

function hasDirectionCue(text: string): boolean {
  if (extractDose(text).dose !== null) return true;
  return collapse(text)
    .split(" ")
    .some((token) => CUE_WORDS.has(wordOf(token)) || CUE_WORDS.has(foldedToken(token)));
}

// ---- name parts ------------------------------------------------------------------------------------

const LEADING_FORM = /^(\S+?)\.?\s+(?=\S)/;
const TRAILING_STRENGTH =
  /\s+([\d٠-٩]+(?:[.,][\d٠-٩]+)?\s*(?:mg|mcg|µg|μg|gm|g|ml|iu|%)?(?:\s*\/\s*[\d٠-٩]+(?:[.,][\d٠-٩]+)?\s*(?:mg|mcg|g|ml|iu)?)?)$/i;

const firstNumber = (text: string): string | null =>
  /\d+(?:[.,]\d+)?/.exec(normalizeArabic(text))?.[0]?.replace(",", ".") ?? null;

const sameStrength = (a: string, b: string): boolean => {
  const first = firstNumber(a);
  return compact(a) === compact(b) || (first !== null && first === firstNumber(b));
};

const present = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

interface NameParts {
  name: string;
  strength: string | null;
  form: string | null;
}

/**
 * Moves a form word and a strength token off the end (and a form word off the start) of the name, for
 * as long as the field they would fill is empty or already says the same.
 */
function peelName(name: string, strength: string | null, form: string | null): NameParts {
  let rest = name;
  let strengthOut = strength;
  let formOut = form;
  const canTakeForm = (word: string): boolean =>
    !present(formOut) || formKey(formOut) === formKey(word);
  const canTakeStrength = (token: string): boolean =>
    !present(strengthOut) || sameStrength(strengthOut, token);

  const leading = LEADING_FORM.exec(rest);
  if (
    leading?.[1] !== undefined &&
    FORM_BY_ALIAS.has(bareWord(leading[1])) &&
    canTakeForm(leading[1])
  ) {
    const remaining = rest.slice(leading[0].length).trim();
    if (LATIN.test(remaining)) {
      if (!present(formOut)) formOut = leading[1];
      rest = remaining;
    }
  }
  for (let guard = 0; guard < 4; guard += 1) {
    let changed = false;
    const last = rest.split(" ").at(-1) ?? "";
    const head = rest.slice(0, rest.length - last.length).trim();
    if (head !== "" && LATIN.test(head) && FORM_BY_ALIAS.has(bareWord(last)) && canTakeForm(last)) {
      if (!present(formOut)) formOut = last.replace(/\.+$/, "");
      rest = head;
      changed = true;
    }
    const strengthMatch = TRAILING_STRENGTH.exec(rest);
    if (strengthMatch?.[1] !== undefined) {
      const remaining = rest.slice(0, rest.length - strengthMatch[0].length).trim();
      if (LATIN.test(remaining) && canTakeStrength(strengthMatch[1])) {
        if (!present(strengthOut)) strengthOut = strengthMatch[1].trim();
        rest = remaining;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { name: rest, strength: strengthOut, form: formOut };
}

/** Appends a piece of text to a field unless the field already says it. */
function appended(existing: string | null, extra: string, max: number): string {
  if (!present(existing)) return extra.slice(0, max);
  if (compact(existing).includes(compact(extra))) return existing;
  return `${existing.trim()}؛ ${extra}`.slice(0, max);
}

export interface SanitizableItem {
  name: string | null;
  strength: string | null;
  form: string | null;
  dose: string | null;
  frequency: string | null;
  notes: string | null;
  alternatives?: readonly string[] | undefined;
}

/**
 * One extracted line, put in order:
 * - `name` loses list markers ("-", "x -", "Rx", "1."); when it mixes Latin and Arabic the Latin words
 *   stay and the Arabic ones become the directions (frequency when empty, otherwise notes);
 * - a trailing form word ("caps", "susp") and strength token ("5", "500 mg") move to `form` and
 *   `strength` when those are empty;
 * - an Arabic dose unit ("قرص", "نصف قرص", "ملعقة", "٥ مل") in the directions fills `dose` when empty.
 * Nothing is added that was not on the line.
 */
export function sanitizeItem<T extends SanitizableItem>(item: T): T {
  let { strength, form, dose, frequency, notes } = item;
  let name = item.name;

  if (present(name)) {
    const split = splitScripts(name);
    const peeled = peelName(split.name, strength, form);
    name = peeled.name === "" ? null : peeled.name;
    strength = peeled.strength;
    form = peeled.form;
    if (split.arabic !== "") {
      let directions = split.arabic;
      if (!present(dose)) {
        const found = extractDose(directions);
        if (found.dose !== null) {
          dose = found.dose;
          directions = found.rest;
        }
      }
      if (directions !== "") {
        const known = [frequency, notes, dose].filter(present).map(compact);
        if (!known.some((text) => text.includes(compact(directions)))) {
          if (!present(frequency) && hasDirectionCue(directions))
            frequency = directions.slice(0, 200);
          else notes = appended(notes, directions, 200);
        }
      }
    }
  }

  // Directions the model put in `frequency` with the dose unit inside.
  if (!present(dose) && present(frequency) && ARABIC.test(frequency)) {
    const found = extractDose(frequency);
    if (found.dose !== null) {
      dose = found.dose;
      frequency = found.rest === "" ? null : found.rest;
    }
  }

  const result = { ...item, name, strength, form, dose, frequency, notes };
  if (item.alternatives === undefined) return result;
  const unique = new Map(
    item.alternatives
      .map((alternative) => splitScripts(alternative).name)
      .filter((alternative) => alternative !== "")
      .map((alternative): [string, string] => [compact(alternative), alternative]),
  );
  return { ...result, alternatives: [...unique.values()] };
}

/** `sanitizeItem` over every line of an extraction. */
export function sanitizeExtraction<E extends { items: readonly SanitizableItem[] }>(
  extraction: E,
): E {
  return { ...extraction, items: extraction.items.map((item) => sanitizeItem(item)) };
}
