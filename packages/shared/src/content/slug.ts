import { CONTENT_SLUG_MAX } from "./constants.js";

/*
 * Slugs and heading ids. Content URLs are lower-case ASCII (CONTENT_SLUG_PATTERN) even for Arabic
 * titles, so links survive copy-paste into chats and mail clients; the transliteration is a plain
 * consonant skeleton ("دواء" -> "dwaa"), not a pronunciation guide. Pure, deterministic, no deps.
 */

const LETTERS: Readonly<Record<string, string>> = {
  ا: "a",
  أ: "a",
  إ: "a",
  آ: "a",
  ٱ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ى: "y",
  ة: "a",
  // Hamza alone carries no sound worth keeping; on a seat it takes the seat's glide.
  ء: "",
  ئ: "y",
  ؤ: "w",
  // Persian/Urdu letters that appear in pasted text.
  پ: "p",
  چ: "ch",
  ژ: "zh",
  گ: "g",
  ک: "k",
  ی: "y",
};

/** Harakat, superscript alef and Quranic marks are all combining marks (Mn); the tatweel U+0640 is the stretch letter. */
const MARKS = /[\p{Mn}ـ]/gu;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

function asciiDigit(char: string): string {
  const code = char.charCodeAt(0);
  return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
}

/** Arabic text as ASCII letters; every other character passes through unchanged. */
export function transliterateArabic(text: string): string {
  const cleaned = text.replace(MARKS, "").replace(ARABIC_INDIC_DIGITS, asciiDigit);
  let out = "";
  for (const char of cleaned) out += LETTERS[char] ?? char;
  return out;
}

/** Lower-case ASCII words joined by single hyphens, at most `max` characters; `"item"` when nothing is left. */
export function slugify(text: string, max: number = CONTENT_SLUG_MAX): string {
  const ascii = transliterateArabic(text)
    // Strip accents from Latin letters ("café" -> "cafe") after Arabic is gone, so NFKD cannot split alef-hamza.
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii === "") return "item";
  let cut = ascii.slice(0, max);
  // Prefer ending on a whole word; a single word longer than `max` is cut mid-word rather than dropped.
  if (ascii.length > max && ascii[max] !== "-") {
    const lastHyphen = cut.lastIndexOf("-");
    if (lastHyphen > 0) cut = cut.slice(0, lastHyphen);
  }
  const trimmed = cut.replace(/-+$/, "");
  return trimmed === "" ? "item" : trimmed;
}

/**
 * Stable, unique heading ids for one document: the same text twice gets `-2`, `-3`, and an id is
 * never reused even when a later heading literally reads "intro-2". Create one per render.
 */
export function headingIdFactory(): { next(text: string): string; reserve(id: string): void } {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return {
    /** Marks an id as taken by markup the factory did not create (the footnotes heading). */
    reserve(id: string): void {
      used.add(id);
    },
    next(text: string): string {
      const base = slugify(text, 80);
      let n = counts.get(base) ?? 0;
      let candidate: string;
      do {
        n += 1;
        candidate = n === 1 ? base : `${base}-${n}`;
      } while (used.has(candidate));
      counts.set(base, n);
      used.add(candidate);
      return candidate;
    },
  };
}
