/** Tags whose inner `</p>` must not count: splitting there would cut the element in two. */
const CONTAINERS = new Set(["blockquote", "li", "ul", "ol", "table", "figure", "details", "aside"]);

/** Number of top-level `</p>` in `html` (same rule as `splitHtmlAfterParagraphs`). */
export function countTopLevelParagraphs(html: string): number {
  return topLevelParagraphEnds(html).length;
}

/** Offsets just after each top-level `</p>`. */
function topLevelParagraphEnds(html: string): number[] {
  const ends: number[] = [];
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let depth = 0;
  for (let match = tag.exec(html); match !== null; match = tag.exec(html)) {
    const name = (match[2] ?? "").toLowerCase();
    const closing = match[1] === "/";
    if (CONTAINERS.has(name)) {
      if (closing) depth = Math.max(0, depth - 1);
      else if (match[3] !== "/") depth += 1;
    } else if (name === "p" && closing && depth === 0) {
      ends.push(match.index + match[0].length);
    }
  }
  return ends;
}

/**
 * Splits server-rendered (sanitised) HTML after the Nth top-level closing `</p>` for each 1-based,
 * ascending position. A `</p>` inside a blockquote, list, table or figure does not count. When
 * there are fewer paragraphs than a position needs, that split (and the later ones) is skipped, so
 * the result is always `html` cut into at most `positions.length + 1` chunks that concatenate back to it.
 */
export function splitHtmlAfterParagraphs(html: string, positions: number[]): string[] {
  const ends = topLevelParagraphEnds(html);
  const chunks: string[] = [];
  let from = 0;
  for (const position of positions) {
    const end = ends[position - 1];
    if (end === undefined || end <= from) break;
    chunks.push(html.slice(from, end));
    from = end;
  }
  chunks.push(html.slice(from));
  return chunks;
}
