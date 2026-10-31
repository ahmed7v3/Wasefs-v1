/*
 * The WhatsApp command matcher (docs/WA-AGENT-RUNTIME.md §7.1, Decision 78). Pure and deterministic: it runs
 * on every inbound text before any model. A command fires only when the WHOLE message is an alias (at most
 * four words), so a sentence that merely contains a command word («عايز دوا جديد») never triggers one.
 * A false positive eats a real customer message, so every doubtful case resolves to "not a command".
 */
import {
  WA_ALIAS_ARGS,
  WA_COMMANDS,
  WA_COMMAND_ALIASES,
  WA_FUZZY_BLOCKLIST,
  type WaCommand,
} from "../i18n/wa-commands.js";

import { normalizeCommandText, wordsOf } from "./normalize.js";

/** After `help`, a reply «1»…«9» picks the matching entry of this list. */
export const MENU_ORDER: readonly WaCommand[] = [
  "analyze",
  "report",
  "balance",
  "schedule",
  "voice",
  "lang",
  "human",
  "new",
  "privacy",
];

export const MAX_COMMAND_WORDS = 4;
/** Fuzzy matching is only safe on aliases with at least this many letters (spaces not counted). */
export const MIN_FUZZY_LETTERS = 5;

export interface MatchOptions {
  /** Extra aliases (admin settings) merged with the defaults. */
  aliases?: Partial<Record<WaCommand, readonly string[]>>;
  /** The text is the caption of an image/PDF: only `analyze` may match. */
  isCaption?: boolean;
  /** The numbered menu was shown within its window: a lone digit 1-9 picks an entry. */
  menuActive?: boolean;
}

export interface CommandMatch {
  command: WaCommand;
  via: "alias" | "fuzzy" | "menu";
  /** `on|off` for voice/remind, `en|ar` for lang. */
  arg?: string;
}

interface AliasEntry {
  command: WaCommand;
  /** Normalised, without the leading slash. */
  text: string;
  arg: string | undefined;
}

const stripSlash = (s: string): string => (s.startsWith("/") ? s.slice(1).trim() : s);

/** All aliases flattened and normalised; empty ones (the lone «؟», handled separately) are dropped. */
function buildEntries(extra: MatchOptions["aliases"]): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const command of WA_COMMANDS) {
    const args = WA_ALIAS_ARGS[command] ?? {};
    const own = WA_COMMAND_ALIASES[command].map((alias): readonly [string, string | undefined] => [
      alias,
      args[alias],
    ]);
    const added = (extra?.[command] ?? []).map((alias): readonly [string, string | undefined] => [
      alias,
      undefined,
    ]);
    for (const [alias, arg] of [...own, ...added]) {
      const text = stripSlash(normalizeCommandText(alias));
      if (text !== "") entries.push({ command, text, arg });
    }
  }
  return entries;
}

let defaultEntries: AliasEntry[] | null = null;
const entriesFor = (extra: MatchOptions["aliases"]): AliasEntry[] => {
  if (extra !== undefined) return buildEntries(extra);
  return (defaultEntries ??= buildEntries(undefined));
};

const BLOCKED = new Set(WA_FUZZY_BLOCKLIST.map((w) => normalizeCommandText(w)));

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transposition), by code point. */
export function damerauDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  // Flat (rows+1) x (cols+1) table; `at` keeps indexing total without non-null assertions.
  const w = y.length + 1;
  const d = new Array<number>((x.length + 1) * w).fill(0);
  const at = (i: number, j: number): number => d[i * w + j] ?? 0;
  for (let i = 0; i <= x.length; i++) d[i * w] = i;
  for (let j = 0; j <= y.length; j++) d[j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) {
        v = Math.min(v, at(i - 2, j - 2) + 1);
      }
      d[i * w + j] = v;
    }
  }
  return at(x.length, y.length);
}

const letterCount = (s: string): number => Array.from(s.replace(/\s/g, "")).length;

const withinOne = (a: string, b: string): boolean =>
  Math.abs(a.length - b.length) <= 1 && damerauDistance(a, b) <= 1;

/**
 * The command a message is, or `null`. `via` says how: an exact alias, a one-typo alias, or the numbered menu.
 */
export function matchCommand(text: string, opts: MatchOptions = {}): CommandMatch | null {
  const allowed = (c: WaCommand): boolean => !opts.isCaption || c === "analyze";

  // The lone question mark is punctuation, which normalisation strips, so it is recognised before that.
  if (/^[?؟]+$/.test(text.trim()))
    return allowed("help") ? { command: "help", via: "alias" } : null;

  const body = stripSlash(normalizeCommandText(text));
  if (body === "") return null;
  if (wordsOf(body).length > MAX_COMMAND_WORDS) return null;

  if (opts.menuActive && !opts.isCaption && /^[1-9]$/.test(body)) {
    const command = MENU_ORDER[Number(body) - 1];
    return command === undefined ? null : { command, via: "menu" };
  }

  const entries = entriesFor(opts.aliases).filter((e) => allowed(e.command));

  const exact = entries.find((e) => e.text === body);
  if (exact) {
    return exact.arg === undefined
      ? { command: exact.command, via: "alias" }
      : { command: exact.command, via: "alias", arg: exact.arg };
  }

  if (BLOCKED.has(body)) return null;

  const hits = entries.filter(
    (e) => letterCount(e.text) >= MIN_FUZZY_LETTERS && withinOne(body, e.text),
  );
  const first = hits[0];
  if (first === undefined) return null;
  const command = first.command;
  // Ambiguous: another command's alias (any length, even outside the caption filter) is also one typo away.
  const rivals = entriesFor(opts.aliases).some(
    (e) => e.command !== command && withinOne(body, e.text),
  );
  if (rivals) return null;
  const arg = first.arg;
  return arg === undefined ? { command, via: "fuzzy" } : { command, via: "fuzzy", arg };
}
