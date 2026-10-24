import { measureText, type OgFontWeight } from "./fonts.js";

export interface FitOptions {
  maxWidth: number;
  /** Candidate font sizes in px, largest first; the first that fits in `maxLines` wins. */
  sizes: readonly number[];
  maxLines: number;
  weight: OgFontWeight;
}

export interface Fitted {
  lines: string[];
  size: number;
  /** Distance between baselines in px. */
  lineHeight: number;
}

/** Latin and Arabic lines need the same breathing room; 1.35 keeps Arabic marks clear of the next line. */
export const LINE_HEIGHT_RATIO = 1.35;
const ELLIPSIS = "…";

async function breakLines(text: string, size: number, options: FitOptions): Promise<string[]> {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (
      current === "" ||
      (await measureText(candidate, size, options.weight)) <= options.maxWidth
    ) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Cuts `line` (words, then characters) until it plus an ellipsis fits `maxWidth`. */
async function ellipsize(line: string, size: number, options: FitOptions): Promise<string> {
  let text = line;
  while (text.length > 1) {
    const candidate = `${text.trimEnd()}${ELLIPSIS}`;
    if ((await measureText(candidate, size, options.weight)) <= options.maxWidth) {
      return candidate;
    }
    const lastSpace = text.lastIndexOf(" ");
    text = lastSpace > 0 ? text.slice(0, lastSpace) : text.slice(0, -1);
  }
  return `${text}${ELLIPSIS}`;
}

/**
 * Breaks `text` into at most `maxLines` lines no wider than `maxWidth`, at the largest of `sizes`
 * that allows it. If even the smallest overflows, the last line is cut with an ellipsis (a title
 * is never shrunk below the template's minimum). Widths come from real renders, not estimates.
 */
export async function fitText(text: string, options: FitOptions): Promise<Fitted> {
  const sizes = [...options.sizes].sort((a, b) => b - a);
  const smallest = sizes.at(-1);
  if (smallest === undefined) throw new Error("fitText needs at least one size");
  const done = (lines: string[], size: number): Fitted => ({
    lines,
    size,
    lineHeight: Math.round(size * LINE_HEIGHT_RATIO),
  });

  for (const size of sizes) {
    const lines = await breakLines(text, size, options);
    if (lines.length <= options.maxLines) {
      // A single word wider than the column is the only way a line can still overflow here.
      const overflowing = await Promise.all(
        lines.map(
          async (line) => (await measureText(line, size, options.weight)) > options.maxWidth,
        ),
      );
      if (!overflowing.some(Boolean) || size === smallest) {
        return done(
          await Promise.all(
            lines.map(async (line, index) =>
              overflowing[index] === true ? ellipsize(line, size, options) : line,
            ),
          ),
          size,
        );
      }
    }
  }

  const lines = await breakLines(text, smallest, options);
  const kept = lines.slice(0, options.maxLines - 1);
  const rest = lines.slice(options.maxLines - 1).join(" ");
  kept.push(await ellipsize(rest, smallest, options));
  return done(kept, smallest);
}
