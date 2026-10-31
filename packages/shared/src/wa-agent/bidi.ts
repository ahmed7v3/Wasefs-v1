/*
 * Bidi safety for WhatsApp replies (docs/WA-AGENT-RUNTIME.md §11, §18.6). An Arabic line that contains a Latin
 * drug name or a dose ("خد Bepra 20 mg قبل العشاء") renders scrambled unless the Latin run is isolated. Lines whose
 * first strong character is Arabic start with RLM (U+200F) and every maximal Latin run inside them is wrapped in
 * FSI…PDI (U+2068…U+2069). Lines that start Latin are untouched. Pure and idempotent: existing isolates are
 * copied as they are, never wrapped again and never nested.
 */

const RLM = "\u200F";
const FSI = "\u2068";
const PDI = "\u2069";

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/;
/** Starts and ends with a Latin letter or digit; letters, digits, space and `.-/%+,` may sit between. */
const LATIN_RUN = /[A-Za-z0-9](?:[A-Za-z0-9 .\-/%+,]*[A-Za-z0-9])?/g;

function startsArabic(line: string): boolean {
  for (const ch of line) {
    if (ARABIC.test(ch)) return true;
    if (LATIN_LETTER.test(ch)) return false;
  }
  return false;
}

function wrapLatinRuns(segment: string): string {
  return segment.replace(LATIN_RUN, (run) => `${FSI}${run}${PDI}`);
}

/** Wrap Latin runs outside existing isolates; an existing FSI…PDI pair (nesting included) is copied verbatim. */
function isolateLine(line: string): string {
  let out = "";
  let outside = "";
  let depth = 0;
  for (const ch of line) {
    if (ch === FSI) {
      if (depth === 0) {
        out += wrapLatinRuns(outside);
        outside = "";
      }
      depth += 1;
      out += ch;
    } else if (depth > 0) {
      if (ch === PDI) depth -= 1;
      out += ch;
    } else {
      outside += ch;
    }
  }
  return out + wrapLatinRuns(outside);
}

/** Make mixed Arabic/Latin text render in the right order. Idempotent. */
export function isolateBidi(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      if (!startsArabic(line)) return line;
      const body = isolateLine(line);
      return body.startsWith(RLM) ? body : `${RLM}${body}`;
    })
    .join("\n");
}

/** Remove the direction marks `isolateBidi` adds (U+200E/U+200F, U+2066–U+2069), for tests and logs. */
export function stripBidi(text: string): string {
  return text.replace(/[\u200E\u200F\u2066-\u2069]/g, "");
}
