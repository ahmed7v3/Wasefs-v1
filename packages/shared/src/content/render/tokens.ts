/*
 * The `{{kind:arg|text}}` micro-syntax. remark-directive reads `:name` inside text as a directive, so
 * `{{drug:aspirin}}` would be torn apart by the Markdown parser. The tokens are therefore cut out of
 * the source BEFORE parsing and replaced by a private-use marker that survives Markdown untouched;
 * after parsing, markers in text become links/blocks and markers in code or URLs are put back.
 */

export const TOKEN_KINDS = ["drug", "glossary", "cta", "nolink"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export interface Token {
  raw: string;
  kind: TokenKind;
  arg: string;
  /** Text after `|`, when given. */
  label: string | null;
}

/** Hard cap so a hostile body cannot make the renderer call resolvers thousands of times. */
export const MAX_TOKENS = 500;

const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const MARKER_CHARS = new RegExp(`[${OPEN}${CLOSE}]`, "g");
const MARKER = new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g");
const TOKEN = new RegExp(
  String.raw`\{\{\s*(drug|glossary|cta|nolink)\s*:\s*([^{}|\n]*?)\s*(?:\|\s*([^{}\n]*?)\s*)?\}\}`,
  "giu",
);

/** Entity slugs follow the content slug rule; anything else is not looked up. */
export const ENTITY_SLUG = /^[a-z0-9][a-z0-9-]{0,119}$/;

export function extractTokens(source: string): { text: string; tokens: Token[] } {
  const tokens: Token[] = [];
  const clean = source.replace(MARKER_CHARS, "");
  const text = clean.replace(TOKEN, (raw, kind: string, arg: string, label: string | undefined) => {
    if (tokens.length >= MAX_TOKENS) return raw;
    tokens.push({
      raw,
      kind: kind.toLowerCase() as TokenKind,
      arg,
      label: label === undefined || label === "" ? null : label,
    });
    return `${OPEN}${String(tokens.length - 1)}${CLOSE}`;
  });
  return { text, tokens };
}

/** Puts the original `{{…}}` text back (used where a token must stay literal: code, URLs). */
export function restoreTokens(value: string, tokens: readonly Token[]): string {
  return value.replace(MARKER, (marker, index: string) => tokens[Number(index)]?.raw ?? marker);
}

export type TextPiece = { type: "text"; value: string } | { type: "token"; token: Token };

/** Splits a text node's value around its markers. */
export function splitTokens(value: string, tokens: readonly Token[]): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of value.matchAll(MARKER)) {
    const token = tokens[Number(match[1])];
    const start = match.index ?? 0;
    if (start > last) pieces.push({ type: "text", value: value.slice(last, start) });
    if (token !== undefined) pieces.push({ type: "token", token });
    last = start + match[0].length;
  }
  if (last < value.length) pieces.push({ type: "text", value: value.slice(last) });
  return pieces;
}

export function hasMarker(value: string): boolean {
  return new RegExp(`${OPEN}\\d+${CLOSE}`).test(value);
}
