/*
 * Split a WhatsApp reply into messages (docs/WA-AGENT-RUNTIME.md §11, §18.6). Each part is at most `maxChars`
 * UTF-16 code units (`.length`), parts are trimmed and non-empty, order is preserved. Greedy: from the start of a
 * part, take the last boundary inside the window, preferring paragraph, then sentence, then space, then a hard
 * cut. A boundary inside an FSI…PDI isolate or a `*…*`, `_…_`, `~…~`, ``` span is skipped while a boundary
 * outside exists ("tiers": outside every span, then outside isolates only, then anywhere). When `maxParts` is
 * reached the last part is cut to fit and ends with "…".
 */

export interface SplitOptions {
  maxChars: number;
  maxParts: number;
}

const FSI = "\u2068";
const PDI = "\u2069";
const ELLIPSIS = "…";
const SENTENCE_END = new Set([".", "!", "?", "؟", "…"]);
const PARAGRAPH_BREAK = /[ \t]*\n[ \t]*\n/y;

const isWs = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

interface Masks {
  /** `iso[p]` = a cut before index `p` would fall inside an FSI…PDI isolate (isolates end at a newline). */
  iso: Uint8Array;
  /** `md[p]` = a cut before index `p` would fall inside a ``` block or a `*`, `_`, `~` span. */
  md: Uint8Array;
}

function buildMasks(text: string): Masks {
  const n = text.length;
  const iso = new Uint8Array(n + 1);
  const md = new Uint8Array(n + 1);

  let depth = 0;
  for (let i = 0; i < n; i += 1) {
    iso[i] = depth > 0 ? 1 : 0;
    const ch = text[i];
    if (ch === FSI) depth += 1;
    else if (ch === PDI) depth = Math.max(0, depth - 1);
    else if (ch === "\n") depth = 0;
  }

  // Fenced blocks: fences pair up in order; an unclosed fence protects nothing.
  const inCode = new Uint8Array(n);
  const fences = [...text.matchAll(/```/g)].map((match) => match.index ?? 0);
  for (let k = 0; k + 1 < fences.length; k += 2) {
    const open = fences[k] ?? 0;
    const close = (fences[k + 1] ?? 0) + 2;
    for (let p = open + 1; p <= close; p += 1) md[p] = 1;
    for (let p = open; p <= close; p += 1) inCode[p] = 1;
  }

  // Inline spans never cross a line: an opener needs a non-word char before and a non-space after, a closer the
  // reverse. An opener with no closer on its line protects nothing.
  let lineStart = 0;
  while (lineStart <= n) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? n : newline;
    const open: Record<string, number> = { "*": -1, _: -1, "~": -1 };
    for (let i = lineStart; i < lineEnd; i += 1) {
      const ch = text[i] ?? "";
      if (inCode[i] === 1 || !(ch in open)) continue;
      const opened = open[ch] ?? -1;
      if (
        opened >= 0 &&
        i > opened + 1 &&
        !isWs(text[i - 1]) &&
        (i + 1 === lineEnd || !isWordChar(text[i + 1]))
      ) {
        for (let p = opened + 1; p <= i; p += 1) md[p] = 1;
        open[ch] = -1;
      } else if (
        opened < 0 &&
        (i === lineStart || !isWordChar(text[i - 1])) &&
        i + 1 < lineEnd &&
        !isWs(text[i + 1]) &&
        text[i + 1] !== ch
      ) {
        open[ch] = i;
      }
    }
    lineStart = lineEnd + 1;
  }
  return { iso, md };
}

type Level = "paragraph" | "sentence" | "space" | "any";
const LEVELS: Level[] = ["paragraph", "sentence", "space", "any"];

function isBoundary(text: string, p: number, level: Level): boolean {
  switch (level) {
    case "paragraph":
      PARAGRAPH_BREAK.lastIndex = p;
      return PARAGRAPH_BREAK.test(text);
    case "sentence": {
      const prev = text[p - 1] ?? "";
      if (prev === "\n") return true;
      return SENTENCE_END.has(prev) && (p >= text.length || isWs(text[p]));
    }
    case "space":
      return p < text.length && isWs(text[p]);
    case "any":
      return true;
  }
}

/** The cut (start < cut <= limit) for the part beginning at `start`, or `limit` when nothing better exists. */
function chooseCut(text: string, masks: Masks, start: number, limit: number): number {
  const tiers: Array<(p: number) => boolean> = [
    (p) => masks.iso[p] === 0 && masks.md[p] === 0,
    (p) => masks.iso[p] === 0,
  ];
  for (const allowed of tiers) {
    for (const level of LEVELS) {
      for (let p = limit; p > start; p -= 1) {
        if (allowed(p) && isBoundary(text, p, level)) return p;
      }
    }
  }
  // Last resort: a hard cut, but never between the halves of a surrogate pair.
  const high = text.charCodeAt(limit - 1);
  return limit - 1 > start && high >= 0xd800 && high <= 0xdbff ? limit - 1 : limit;
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && isWs(text[i])) i += 1;
  return i;
}

/** Split `text` into messages of at most `maxChars` each, at most `maxParts` of them. Empty text gives no parts. */
export function splitReply(text: string, opts: SplitOptions): string[] {
  const maxChars = Math.max(2, Math.floor(opts.maxChars));
  const maxParts = Math.max(1, Math.floor(opts.maxParts));
  const source = text.trim();
  if (source === "") return [];

  const masks = buildMasks(source);
  const parts: string[] = [];
  let start = 0;
  while (start < source.length) {
    if (source.length - start <= maxChars) {
      parts.push(source.slice(start));
      break;
    }
    if (parts.length === maxParts - 1) {
      // Out of messages: fill the last one and mark the cut.
      const cut = chooseCut(source, masks, start, start + maxChars - 1);
      parts.push(`${source.slice(start, cut).trimEnd()}${ELLIPSIS}`);
      break;
    }
    const cut = chooseCut(source, masks, start, start + maxChars);
    parts.push(source.slice(start, cut).trimEnd());
    start = skipWhitespace(source, cut);
  }
  return parts;
}
