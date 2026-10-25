/*
 * Small text measurements shared by the editor (live counters), the renderer and the quality gates,
 * so a number shown while typing is the number that gates the publish.
 */

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/giu;
/** Letters (any script), combining marks (Arabic tashkeel), digits; inner hyphen/apostrophe stay in one word. */
const WORD_PATTERN = /[\p{L}\p{M}\p{N}]+(?:['’‐-][\p{L}\p{M}\p{N}]+)*/gu;

/** Words in Arabic and Latin text; markdown punctuation and bare URLs do not count. */
export function countWords(text: string): number {
  return text.replace(URL_PATTERN, " ").match(WORD_PATTERN)?.length ?? 0;
}

export const WORDS_PER_MINUTE = 200;

/** Reading time in whole minutes, never below one. */
export function readingMinutes(words: number): number {
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/**
 * Bidi embedding/override/isolate controls, LRM/RLM and the Arabic letter mark. Pasted text can use
 * them to make a link or a claim read differently from how it is stored ("trojan source"); the
 * renderer sets direction with `dir` attributes instead.
 */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

export function stripBidiControls(text: string): { text: string; removed: boolean } {
  const cleaned = text.replace(BIDI_CONTROLS, "");
  return { text: cleaned, removed: cleaned.length !== text.length };
}
