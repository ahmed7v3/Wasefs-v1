/*
 * Text normalisation for the WhatsApp command layer (docs/WA-AGENT-RUNTIME.md §7.1). Pure: both the typed
 * message and every alias run through `normalizeCommandText`, so they always compare in one shape.
 * The letter folding is the shared `normalizeArabic`; this adds the wider tashkeel range, case, and the
 * removal of emoji and punctuation that a chat message carries around a command.
 */
import { normalizeArabic } from "../normalize.js";

/** All Arabic points (U+064B-U+065F), the superscript alef (U+0670) and the tatweel (U+0640). */
const TASHKEEL = /[ً-ٰٟـ]/g;
/** Format characters (RTL marks, zero-width joiners, variation selectors) and combining marks: dropped, not spaced. */
const INVISIBLE = /[\p{Cf}\p{M}]/gu;
/** Anything that is not a letter, a digit or whitespace: emoji, punctuation (incl. ، ؛ ؟), symbols. */
const NOT_WORD = /[^\p{L}\p{N}\s]/gu;

/**
 * The comparison shape of a message: NFKC, no tashkeel/tatweel, alef/yeh/heh/waw folded, Arabic digits as
 * 0-9, lowercase, emoji and punctuation removed, whitespace collapsed. A leading `/` (a slash command) is
 * the only punctuation kept. Idempotent.
 */
export function normalizeCommandText(input: string): string {
  const folded = normalizeArabic(
    input.normalize("NFKC").replace(TASHKEEL, "").toLowerCase().normalize("NFKC"),
  );
  const slash = /^\s*\//.test(folded) ? "/" : "";
  const body = folded.replace(INVISIBLE, "").replace(NOT_WORD, " ").replace(/\s+/g, " ").trim();
  return slash + body;
}

/** The words of an already normalised string (a leading `/` stays attached to the first word). */
export function wordsOf(normalized: string): string[] {
  return normalized === "" ? [] : normalized.split(" ");
}
