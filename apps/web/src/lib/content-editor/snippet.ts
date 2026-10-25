/*
 * Google-style result snippet: where a title or description would be cut. Google truncates by PIXEL
 * width, not by characters, so this uses a per-script width heuristic (em fractions below) against
 * the budgets of a typical result card. It is a preview aid, not a promise: the limits are documented
 * constants so they are easy to retune when the SERP layout changes.
 */

export type SnippetDevice = "desktop" | "mobile";

/** Budgets in CSS pixels and the font sizes they assume (title 20 px, description 14 px). */
export const SNIPPET_BUDGETS = {
  desktop: { titlePx: 600, titleFont: 20, descriptionPx: 960, descriptionFont: 14 },
  // Mobile titles wrap on up to two lines of ~340 px; descriptions show ~2.5 lines.
  mobile: { titlePx: 680, titleFont: 20, descriptionPx: 780, descriptionFont: 14 },
} as const;

/** Character counts the SEO fields aim for (the counters); pixel truncation decides the real cut. */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MIN = 120;
export const SEO_DESCRIPTION_MAX = 160;

/** Length in code points (an Arabic letter with a mark or an emoji is not 2 or 3). */
export function codePointLength(text: string): number {
  return [...text].length;
}

const COMBINING = /\p{M}/u;
const ARABIC = /[؀-ۿݐ-ݿ]/u;
const WIDE = /[⺀-鿿가-힯\u{1F300}-\u{1FAFF}]/u;

/** Width of one code point in em fractions. */
function emWidth(char: string): number {
  if (COMBINING.test(char)) return 0;
  if (char === " ") return 0.28;
  if (WIDE.test(char)) return 1;
  if (ARABIC.test(char)) return 0.52;
  if (/[0-9]/.test(char)) return 0.56;
  if (/[A-Z]/.test(char)) return 0.66;
  if (/[a-z]/.test(char))
    return char === "i" || char === "l" || char === "j"
      ? 0.24
      : char === "m" || char === "w"
        ? 0.8
        : 0.52;
  if (/[.,:;'!|]/.test(char)) return 0.28;
  return 0.6;
}

export function estimateWidthPx(text: string, fontPx: number): number {
  let em = 0;
  for (const char of text) em += emWidth(char);
  return em * fontPx;
}

export interface Truncated {
  text: string;
  truncated: boolean;
}

/** Cuts at a word boundary where possible and appends an ellipsis when the text does not fit. */
export function truncateToWidth(text: string, maxPx: number, fontPx: number): Truncated {
  const clean = text.replace(/\s+/g, " ").trim();
  if (estimateWidthPx(clean, fontPx) <= maxPx) return { text: clean, truncated: false };
  const ellipsisPx = estimateWidthPx("…", fontPx);
  let width = 0;
  let cut = "";
  for (const char of clean) {
    const next = width + emWidth(char) * fontPx;
    if (next + ellipsisPx > maxPx) break;
    width = next;
    cut += char;
  }
  const lastSpace = cut.lastIndexOf(" ");
  const atWord = lastSpace > cut.length * 0.6 ? cut.slice(0, lastSpace) : cut;
  return { text: `${atWord.trimEnd()}…`, truncated: true };
}

export function snippetFor(
  input: { title: string; description: string },
  device: SnippetDevice,
): { title: Truncated; description: Truncated } {
  const budget = SNIPPET_BUDGETS[device];
  return {
    title: truncateToWidth(input.title, budget.titlePx, budget.titleFont),
    description: truncateToWidth(input.description, budget.descriptionPx, budget.descriptionFont),
  };
}

/** The visible breadcrumb-style URL of a result: `wasfa.online › blog › slug`. */
export function snippetUrl(origin: string, path: string): string {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // Keep the raw value for a malformed origin.
  }
  const parts = path.split("/").filter(Boolean);
  return [host, ...parts].join(" › ");
}
