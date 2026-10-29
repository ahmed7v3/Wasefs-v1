import { normalizeArabic, normalizeDrugName, type Strength } from "./normalize.js";

/*
 * Cleans a medicine name as it comes off a prescription line or a search box ("x - Glibimet 5
 * نصف ساعة قبل الاكل", "2) Rx Bepra 20 mg tab") down to the brand words the matcher should look up.
 * Pure and dependency-free like the normalizer it builds on; the matcher, the search and the chat
 * cards all start here so a note never reaches the database as part of the name.
 */

export interface CleanedDrugQuery {
  /** The Latin brand words, lowercase ("riopan", "actifed expectorant"); `null` when there are none. */
  latin: string | null;
  /**
   * The name when it is written in Arabic script, normalized. `null` when a Latin brand was found: the
   * Arabic left on such a line is the directions ("بعد الاكل"), not a second name.
   */
  arabic: string | null;
  /** A strength with a unit written next to the name. A bare "5 ml" is a dose, not a strength. */
  strength: Strength | null;
  /** The dosage form word found, canonical English ("tablet"). */
  form: string | null;
  /** The first number after the name that has no unit ("Glibimet 5"): probably a strength. */
  bareNumber: number | null;
  /** Every piece taken out of the text, for tests and the sandbox. */
  dropped: string[];
}

/** Arabic direction / dose words, already in the normalizer's spelling (ة→ه, أ→ا, ى→ي). */
const ARABIC_DIRECTION_WORDS: ReadonlySet<string> = new Set([
  // forms and measures
  "كبسوله",
  "كبسولات",
  "كبسول",
  "قرص",
  "اقراص",
  "حبه",
  "حبايه",
  "حبوب",
  "ملعقه",
  "ملاعق",
  "ملعقتين",
  "صغيره",
  "كبيره",
  "نقطه",
  "نقط",
  "نقطتين",
  "قطره",
  "قطرات",
  "حقنه",
  "حقن",
  "لبوس",
  "كيس",
  "اكياس",
  "بخه",
  "بخات",
  "فنجان",
  "كوب",
  // frequency
  "مره",
  "مرات",
  "مرتين",
  "يوميا",
  "صباحا",
  "مساء",
  "مساءا",
  "ظهرا",
  "ليلا",
  "فجرا",
  "كل",
  "يوم",
  "ايام",
  "يومين",
  "اسبوع",
  "اسبوعين",
  "اسابيع",
  "شهر",
  "شهرين",
  "اشهر",
  "ساعه",
  "ساعات",
  "ساعتين",
  "نصف",
  "ربع",
  "ثلث",
  "لمده",
  "مده",
  "عند",
  "اللزوم",
  "لزوم",
  "الحاجه",
  "حسب",
  "الحاله",
  "مستمر",
  "مستمره",
  // relation to food and time of day
  "قبل",
  "بعد",
  "مع",
  "الاكل",
  "اكل",
  "الاكله",
  "الوجبه",
  "الوجبات",
  "الفطار",
  "الافطار",
  "الغداء",
  "الغدا",
  "العشاء",
  "العشا",
  "الصباح",
  "المساء",
  "النوم",
  "الظهر",
  "الليل",
  "بالليل",
  "بالنهار",
  "الصبح",
  "وجبه",
  "وجبات",
  "فطار",
  "غداء",
  "عشاء",
  "نوم",
  // numbers in words and glue words
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
  "خمس",
  "خمسه",
  "ست",
  "سته",
  "سبع",
  "سبعه",
  "ثمان",
  "عشر",
  "عشره",
  "من",
  "الي",
  "او",
  "في",
  "على",
  "علي",
  "ب",
  "و",
  "ثم",
  "مدة",
  "فقط",
  "مباشره",
  "شرب",
  "يؤخذ",
  "يوخذ",
  "تؤخذ",
  "للاستعمال",
  "استعمال",
  "موضعي",
  "موضعيا",
  "تحت",
  "اللسان",
  "فمويا",
  "بالفم",
  "الي",
  "اذا",
  "لو",
  "احتاج",
  "الم",
  "الالم",
  "حراره",
  "الحراره",
  "ارتفاع",
  "دوا",
  "دواء",
  "علاج",
]);

/** Latin direction words: the name ends before the first one ("Panadol bid", "Augmentin after meals"). */
const LATIN_DIRECTION_WORDS: ReadonlySet<string> = new Set([
  "od",
  "bd",
  "bid",
  "tid",
  "tds",
  "qid",
  "qds",
  "prn",
  "stat",
  "pc",
  "ac",
  "hs",
  "qhs",
  "daily",
  "once",
  "twice",
  "thrice",
  "times",
  "time",
  "day",
  "days",
  "week",
  "weeks",
  "month",
  "months",
  "after",
  "before",
  "with",
  "meal",
  "meals",
  "food",
  "for",
  "every",
  "each",
  "hr",
  "hrs",
  "hour",
  "hours",
  "morning",
  "evening",
  "night",
  "nightly",
  "bedtime",
  "needed",
  "orally",
  "po",
  "x",
  "×",
  "then",
  "and",
  "or",
  "if",
  "when",
  "as",
  "daily.",
]);

/** Words that follow a name on a list but are not part of it (packs, routes). */
const LATIN_PACK_WORDS: ReadonlySet<string> = new Set([
  "f.c",
  "fc",
  "e.c",
  "ec",
  "i.v",
  "iv",
  "i.m",
  "im",
  "pack",
  "box",
  "bottle",
  "strip",
  "strips",
  "pcs",
  "pc",
  "piece",
  "pieces",
  "oral",
]);

// Leading bullets and numbering: "•", "-", "*", "x -", "1)", "2.", "(3)", "3-".
const LEADING_BULLET =
  /^\s*(?:[•·●▪■◦*>»›\-–—_.]+|x\s+[-–—:.)]\s*|x[-–—:.)]\s+|×\s*[-–—:.)]?)\s*/iu;
const LEADING_NUMBER = /^\s*\(?\d{1,2}\s*[).:\-–—]\s+/u;
// "Rx", "Rx:", "R/", "R/x", "℞": only when something follows.
const LEADING_RX = /^\s*(?:rx|r\s*\/\s*x?|℞)(?![\p{L}\p{N}])[\s:.\-–—]*/iu;

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const LETTERS_THEN_DIGITS = /^(\p{Script=Latin}{3,})(\d+(?:[.,]\d+)?)$/u;

/** Removes parenthesised notes, also an unclosed one at the end. */
function stripParentheses(text: string, dropped: string[]): string {
  return text.replace(/\([^)]*(?:\)|$)|\[[^\]]*(?:\]|$)/gu, (match) => {
    dropped.push(match.trim());
    return " ";
  });
}

function stripLeadingMarkers(text: string, dropped: string[]): string {
  let current = text;
  for (let guard = 0; guard < 6; guard++) {
    let next = current;
    for (const pattern of [LEADING_NUMBER, LEADING_RX, LEADING_BULLET]) {
      const match = pattern.exec(next);
      if (match !== null && match[0] !== "" && next.slice(match[0].length).trim() !== "") {
        dropped.push(match[0].trim());
        next = next.slice(match[0].length);
      }
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

const isNumberToken = (token: string): boolean => /^\d+(?:[.,]\d+)?$/u.test(token);

/**
 * The brand words of a line, with everything else reported as `dropped`. The name ends at the first
 * number, pack word or direction word (the same rule `brandKeyOf` uses for list names), so
 * "Riopan susp شراب" gives `riopan`, "Bepra 20 + Arabic" gives `bepra` with `bareNumber` 20.
 */
export function cleanDrugQuery(text: string): CleanedDrugQuery {
  const dropped: string[] = [];
  let work = normalizeArabic(text).replace(/[\p{Cf}\p{Zs}]/gu, " ");
  work = stripParentheses(work, dropped);
  work = stripLeadingMarkers(work, dropped);

  const parsed = normalizeDrugName(work);
  let strength = parsed.strength;
  if (strength !== null && strength.unit === "ml" && strength.per === undefined) {
    // "5 ml" next to a syrup is the dose to take, never the strength of the product.
    dropped.push(`${strength.value} ml`);
    strength = null;
  }

  // Split "Bepra20" and glued punctuation; "b12" stays whole (the letters part must be 3+).
  const tokens = parsed.name
    .split(" ")
    .filter((token) => token !== "")
    .flatMap((token) => {
      const glued = LETTERS_THEN_DIGITS.exec(token);
      return glued === null ? [token] : [glued[1] ?? token, glued[2] ?? ""];
    });

  // Numbers before the first word belong to the name ("1 2 3 syrup"); the rest of the numbers are doses.
  const lead: string[] = [];
  const latin: string[] = [];
  const arabic: string[] = [];
  let bareNumber: number | null = null;
  // Once the name is over (a number, a pack or direction word), only the numbers still matter.
  let ended = false;
  const named = (): boolean => latin.length > 0 || arabic.length > 0;
  for (const token of tokens) {
    if (isNumberToken(token)) {
      if (!named()) {
        lead.push(token);
        continue;
      }
      ended = true;
      bareNumber ??= Number(token.replace(",", "."));
      dropped.push(token);
      continue;
    }
    if (ARABIC_LETTER.test(token)) {
      if (ARABIC_DIRECTION_WORDS.has(token)) {
        // Directions after the name end it; before it ("قرص بانادول") they are just skipped.
        if (named()) ended = true;
        dropped.push(token);
      } else if ((ended && latin.length > 0) || /[a-z]/u.test(token)) {
        // After a Latin name it is a direction we have no word for; a token mixing scripts is no name.
        dropped.push(token);
      } else {
        arabic.push(token);
      }
      continue;
    }
    if (!LATIN_LETTER.test(token) && !/^\d/u.test(token)) {
      dropped.push(token);
      continue;
    }
    const terminator = LATIN_DIRECTION_WORDS.has(token) || LATIN_PACK_WORDS.has(token);
    if (named() && (ended || terminator)) {
      ended = true;
      dropped.push(token);
      continue;
    }
    // A lone t / c / s / i before the name is a leftover abbreviation ("t panadol"); "x plended" is a name.
    if (!named() && token.length === 1 && "tcsi".includes(token) && tokens.length > 1) {
      dropped.push(token);
      continue;
    }
    latin.push(token);
  }

  const hasLatin = latin.some((token) => LATIN_LETTER.test(token));
  // "1 2 3" has no letters but is a name when nothing else is (one lone number is a dose).
  const numbersOnly = !hasLatin && arabic.length === 0 && lead.length > 1;
  if (hasLatin && arabic.length > 0) dropped.push(...arabic);
  if (!hasLatin && !numbersOnly) dropped.push(...lead);
  return {
    latin: hasLatin ? [...lead, ...latin].join(" ") : numbersOnly ? lead.join(" ") : null,
    arabic: !hasLatin && arabic.length > 0 ? arabic.join(" ") : null,
    strength,
    form: parsed.form,
    bareNumber,
    dropped,
  };
}

