/*
 * The editor's formatting commands as pure text transforms: `(value, selection) -> (value, selection)`.
 * No DOM here, so the table of behaviours (wrap/unwrap, line prefixes over several lines, blocks,
 * Arabic text) is unit tested; `textarea-edit.ts` applies a result to the real textarea through the
 * browser's undo stack. Markdown dialect: CONTENT-PLATFORM §7 (`:::note`, `{{drug:slug}}`, `media:<id>`).
 */

export interface TextState {
  value: string;
  selStart: number;
  selEnd: number;
}

export const TOOLBAR_ACTIONS = [
  "h2",
  "h3",
  "bold",
  "italic",
  "link",
  "bullet",
  "numbered",
  "quote",
  "table",
  "image",
  "note",
  "warning",
  "tip",
  "drug",
  "glossary",
  "footnote",
  "cta",
] as const;
export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

export interface ToolbarParams {
  /** `link`: the target (a suggested link, a prompted URL). */
  url?: string | undefined;
  /** `link`: the text when nothing is selected. */
  label?: string | undefined;
  /** `drug` / `glossary`: the entity slug. */
  slug?: string | undefined;
  /** `image`: library asset id, alt text (required) and optional caption. */
  mediaId?: string | undefined;
  alt?: string | undefined;
  caption?: string | undefined;
  /** `table`: localized header labels. */
  tableLabels?: readonly [string, string] | undefined;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function lineStartOf(value: string, pos: number): number {
  return pos <= 0 ? 0 : value.lastIndexOf("\n", pos - 1) + 1;
}

function lineEndOf(value: string, pos: number): number {
  const index = value.indexOf("\n", pos);
  return index === -1 ? value.length : index;
}

/** Lines touched by a selection; a selection that ends at the very start of a line does not include it. */
function lineRange(state: TextState): { from: number; to: number } {
  const { value, selStart, selEnd } = state;
  const from = lineStartOf(value, selStart);
  const endPos = selEnd > selStart && value[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
  return { from, to: lineEndOf(value, endPos) };
}

/** Replaces `[from, to)` and reports the new selection (offsets are relative to the inserted text). */
function splice(
  state: TextState,
  from: number,
  to: number,
  text: string,
  selectFrom: number,
  selectTo: number,
): TextState {
  return {
    value: state.value.slice(0, from) + text + state.value.slice(to),
    selStart: from + selectFrom,
    selEnd: from + selectTo,
  };
}

/** Inserts text at the caret (replacing the selection) and puts the caret after it. */
export function insertAtCaret(state: TextState, text: string): TextState {
  return splice(state, state.selStart, state.selEnd, text, text.length, text.length);
}

// ---------------------------------------------------------------------------------------------
// Inline markers (bold, italic)
// ---------------------------------------------------------------------------------------------

function trailingRun(text: string, char: string): number {
  let n = 0;
  while (n < text.length && text[text.length - 1 - n] === char) n += 1;
  return n;
}

function leadingRun(text: string, char: string): number {
  let n = 0;
  while (n < text.length && text[n] === char) n += 1;
  return n;
}

/** Whether a run of `*` of this length carries the marker: `**` = bold, `*` = italic, `***` = both. */
function runHasMarker(run: number, marker: string): boolean {
  return marker === "**" ? run >= 2 : run % 2 === 1;
}

function toggleInline(state: TextState, marker: "**" | "*"): TextState {
  const { value, selStart: a, selEnd: b } = state;
  const m = marker.length;
  const before = value.slice(0, a);
  const sel = value.slice(a, b);
  const after = value.slice(b);

  // Selected text includes the markers: `**word**` selected -> `word`.
  const innerRun = Math.min(leadingRun(sel, "*"), trailingRun(sel, "*"));
  if (sel.length > 2 * innerRun && runHasMarker(innerRun, marker)) {
    const inner = sel.slice(m, sel.length - m);
    return { value: before + inner + after, selStart: a, selEnd: a + inner.length };
  }
  // Markers sit just outside the selection: `**|word|**` -> `word`.
  const outerRun = Math.min(trailingRun(before, "*"), leadingRun(after, "*"));
  if (runHasMarker(outerRun, marker)) {
    return {
      value: before.slice(0, before.length - m) + sel + after.slice(m),
      selStart: a - m,
      selEnd: b - m,
    };
  }

  if (a === b) {
    return { value: before + marker + marker + after, selStart: a + m, selEnd: a + m };
  }
  // Markdown emphasis cannot span a blank line: wrap each paragraph, keep surrounding whitespace outside.
  let out = "";
  let firstStart = -1;
  let lastEnd = 0;
  for (const part of sel.split(/(\n{2,})/)) {
    if (/^\n{2,}$/.test(part) || part.trim() === "") {
      out += part;
      continue;
    }
    const lead = part.length - part.trimStart().length;
    const core = part.trim();
    const trail = part.length - lead - core.length;
    out += part.slice(0, lead) + marker;
    if (firstStart === -1) firstStart = out.length;
    out += core;
    lastEnd = out.length;
    out += marker + part.slice(part.length - trail);
  }
  return {
    value: before + out + after,
    selStart: a + (firstStart === -1 ? 0 : firstStart),
    selEnd: a + lastEnd,
  };
}

// ---------------------------------------------------------------------------------------------
// Line prefixes (headings, lists, quote)
// ---------------------------------------------------------------------------------------------

type PrefixKind = "h2" | "h3" | "bullet" | "numbered" | "quote";

/** Heading, bullet and numbered markers exclude each other; the quote marker stacks outside them. */
const BLOCK_MARKER = /^(\s*)(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)?/;
const QUOTE_MARKER = /^>[ \t]?/;

function hasKind(line: string, kind: PrefixKind): boolean {
  switch (kind) {
    case "h2":
      return /^\s*#{2}(?!#)[ \t]+/.test(line);
    case "h3":
      return /^\s*#{3}(?!#)[ \t]+/.test(line);
    case "bullet":
      return /^\s*[-*+][ \t]+/.test(line);
    case "numbered":
      return /^\s*\d+[.)][ \t]+/.test(line);
    case "quote":
      return QUOTE_MARKER.test(line);
  }
}

function toggleLinePrefix(state: TextState, kind: PrefixKind): TextState {
  const { value, selStart, selEnd } = state;
  const { from, to } = lineRange(state);
  const lines = value.slice(from, to).split("\n");
  const anyText = lines.some((line) => line.trim() !== "");
  const isActive = (line: string): boolean => !anyText || line.trim() !== "";
  const active = lines.filter(isActive);
  const removing = active.length > 0 && active.every((line) => hasKind(line, kind));

  let counter = 0;
  const next = lines.map((line) => {
    if (!isActive(line)) return line;
    if (kind === "quote") {
      return removing ? line.replace(QUOTE_MARKER, "") : `> ${line}`;
    }
    const indent = BLOCK_MARKER.exec(line)?.[1] ?? "";
    const rest = line.replace(BLOCK_MARKER, "");
    if (removing) return indent + rest;
    counter += 1;
    const marker =
      kind === "h2"
        ? "## "
        : kind === "h3"
          ? "### "
          : kind === "bullet"
            ? "- "
            : `${String(counter)}. `;
    return indent + marker + rest;
  });

  const text = next.join("\n");
  const firstDelta = (next[0] ?? "").length - (lines[0] ?? "").length;
  const totalDelta = text.length - (to - from);
  const newStart = Math.max(from, selStart + firstDelta);
  const newEnd = selStart === selEnd ? newStart : Math.max(newStart, selEnd + totalDelta);
  return {
    value: value.slice(0, from) + text + value.slice(to),
    selStart: newStart,
    selEnd: newEnd,
  };
}

// ---------------------------------------------------------------------------------------------
// Blocks (callouts, table, CTA)
// ---------------------------------------------------------------------------------------------

/** Replaces `[from, to)` with a block that has a blank line on both sides; returns where the text starts. */
function replaceBlock(
  value: string,
  from: number,
  to: number,
  text: string,
): { value: string; start: number } {
  const before = value.slice(0, from);
  const after = value.slice(to);
  const lead =
    before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail =
    after === "" ? "\n" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return { value: before + lead + text + trail + after, start: before.length + lead.length };
}

interface EnclosingBlock {
  kind: string;
  openerFrom: number;
  openerTo: number;
  closerFrom: number;
  closerTo: number;
}

/** The `:::kind … :::` container the caret line is inside (or on), if any. */
function findEnclosingBlock(value: string, pos: number): EnclosingBlock | null {
  const lines = value.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }
  const caretLine = Math.max(
    0,
    offsets.findLastIndex((offset) => offset <= pos),
  );
  let open = -1;
  for (let i = caretLine; i >= 0; i -= 1) {
    const text = (lines[i] ?? "").trim();
    if (i < caretLine && text === ":::") return null;
    if (/^:::[a-z]+$/.test(text)) {
      open = i;
      break;
    }
  }
  if (open === -1) return null;
  for (let j = Math.max(open + 1, caretLine); j < lines.length; j += 1) {
    if ((lines[j] ?? "").trim() === ":::") {
      const opener = (lines[open] ?? "").trim();
      return {
        kind: opener.slice(3),
        openerFrom: offsets[open] ?? 0,
        openerTo: (offsets[open] ?? 0) + (lines[open] ?? "").length,
        closerFrom: offsets[j] ?? 0,
        closerTo: (offsets[j] ?? 0) + (lines[j] ?? "").length,
      };
    }
  }
  return null;
}

function toggleCallout(state: TextState, kind: "note" | "warning" | "tip"): TextState {
  const { value, selStart, selEnd } = state;
  const enclosing = findEnclosingBlock(value, selStart);
  if (enclosing) {
    if (enclosing.kind !== kind) {
      // Another callout kind: relabel the opener, keep the content.
      const opener = `:::${kind}`;
      const grow = opener.length - (enclosing.openerTo - enclosing.openerFrom);
      return {
        value: value.slice(0, enclosing.openerFrom) + opener + value.slice(enclosing.openerTo),
        selStart: selStart + grow,
        selEnd: selEnd + grow,
      };
    }
    // Same kind: remove the opener and closer lines (and the newline that followed the opener).
    const inner = value.slice(
      enclosing.openerTo + 1,
      Math.max(enclosing.openerTo + 1, enclosing.closerFrom - 1),
    );
    const out = value.slice(0, enclosing.openerFrom) + inner + value.slice(enclosing.closerTo);
    const shift = enclosing.openerTo + 1 - enclosing.openerFrom;
    return {
      value: out,
      selStart: clamp(selStart - shift, enclosing.openerFrom, out.length),
      selEnd: clamp(selEnd - shift, enclosing.openerFrom, out.length),
    };
  }

  const opener = `:::${kind}`;
  if (selStart === selEnd) {
    const text = `${opener}\n\n:::`;
    const lineFrom = lineStartOf(value, selStart);
    const lineTo = lineEndOf(value, selStart);
    const blank = value.slice(lineFrom, lineTo).trim() === "";
    const at = blank ? { from: lineFrom, to: lineTo } : { from: lineTo, to: lineTo };
    const placed = replaceBlock(value, at.from, at.to, text);
    const caret = placed.start + opener.length + 1;
    return { value: placed.value, selStart: caret, selEnd: caret };
  }
  const { from, to } = lineRange(state);
  const content = value.slice(from, to);
  const text = `${opener}\n${content}\n:::`;
  const placed = replaceBlock(value, from, to, text);
  return {
    value: placed.value,
    selStart: placed.start + opener.length + 1,
    selEnd: placed.start + opener.length + 1 + content.length,
  };
}

function insertTable(state: TextState, labels: readonly [string, string]): TextState {
  const { value, selEnd } = state;
  const at = lineEndOf(value, selEnd);
  const header = `| ${labels[0]} | ${labels[1]} |`;
  const text = `${header}\n| --- | --- |\n|  |  |`;
  const placed = replaceBlock(value, at, at, text);
  // Select the first header label so typing replaces it.
  return {
    value: placed.value,
    selStart: placed.start + 2,
    selEnd: placed.start + 2 + labels[0].length,
  };
}

function insertCta(state: TextState): TextState {
  const at = lineEndOf(state.value, state.selEnd);
  const text = "{{cta:analyze}}";
  const placed = replaceBlock(state.value, at, at, text);
  const caret = placed.start + text.length;
  return { value: placed.value, selStart: caret, selEnd: caret };
}

// ---------------------------------------------------------------------------------------------
// Links, entities, image, footnote
// ---------------------------------------------------------------------------------------------

const MD_LINK = /^\[([^\]]*)\]\(([^)]*)\)$/;
const URL_ONLY = /^https?:\/\/\S+$/;

function applyLink(state: TextState, params: ToolbarParams): TextState {
  const sel = state.value.slice(state.selStart, state.selEnd);
  const existing = MD_LINK.exec(sel);
  if (existing && params.url === undefined) {
    const text = existing[1] ?? "";
    return splice(state, state.selStart, state.selEnd, text, 0, text.length);
  }
  const url = params.url ?? "";
  if (URL_ONLY.test(sel) && params.url === undefined) {
    // A pasted URL becomes the target; the caret waits in the link text.
    const text = `[](${sel})`;
    return splice(state, state.selStart, state.selEnd, text, 1, 1);
  }
  const label = sel !== "" ? sel : (params.label ?? url);
  const text = `[${label}](${url})`;
  if (url === "") {
    // No target yet: leave the caret inside the parentheses, ready to type or paste.
    const caret = label.length + 3;
    return splice(state, state.selStart, state.selEnd, text, caret, caret);
  }
  if (sel === "" && params.label === undefined) {
    return splice(state, state.selStart, state.selEnd, text, 1, 1 + label.length);
  }
  return splice(state, state.selStart, state.selEnd, text, text.length, text.length);
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function applyEntity(
  state: TextState,
  kind: "drug" | "glossary",
  slug: string | undefined,
): TextState {
  const clean = (slug ?? "").trim().toLowerCase();
  if (clean !== "" && SLUG.test(clean)) {
    const text = `{{${kind}:${clean}}}`;
    return splice(state, state.selStart, state.selEnd, text, text.length, text.length);
  }
  const text = `{{${kind}:}}`;
  const caret = text.length - 2;
  return splice(state, state.selEnd, state.selEnd, text, caret, caret);
}

function applyImage(state: TextState, params: ToolbarParams): TextState {
  if (!params.mediaId) return state;
  const alt = (params.alt ?? "").replace(/[[\]]/g, "").trim();
  const caption = (params.caption ?? "").replace(/"/g, "'").trim();
  const text = `![${alt}](media:${params.mediaId}${caption === "" ? "" : ` "${caption}"`})`;
  const at = lineEndOf(state.value, state.selEnd);
  const placed = replaceBlock(state.value, at, at, text);
  const caret = placed.start + text.length;
  return { value: placed.value, selStart: caret, selEnd: caret };
}

function applyFootnote(state: TextState): TextState {
  const { value, selStart, selEnd } = state;
  const used = [...value.matchAll(/^\[\^(\d+)\]:/gm)].map((match) => Number(match[1]));
  const n = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  const reference = `[^${String(n)}]`;
  const withRef = value.slice(0, selStart) + reference + value.slice(selEnd);
  const trimmed = withRef.replace(/\s+$/, "");
  const definition = `[^${String(n)}]: `;
  const separator = trimmed === "" ? "" : /\[\^\d+\]:[^\n]*$/.test(trimmed) ? "\n" : "\n\n";
  const out = trimmed + separator + definition;
  return { value: out, selStart: out.length, selEnd: out.length };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

const DEFAULT_TABLE_LABELS = ["Column 1", "Column 2"] as const;

export function applyToolbarAction(
  state: TextState,
  action: ToolbarAction,
  params: ToolbarParams = {},
): TextState {
  const safe: TextState = {
    value: state.value,
    selStart: clamp(Math.min(state.selStart, state.selEnd), 0, state.value.length),
    selEnd: clamp(Math.max(state.selStart, state.selEnd), 0, state.value.length),
  };
  switch (action) {
    case "h2":
    case "h3":
    case "bullet":
    case "numbered":
    case "quote":
      return toggleLinePrefix(safe, action);
    case "bold":
      return toggleInline(safe, "**");
    case "italic":
      return toggleInline(safe, "*");
    case "link":
      return applyLink(safe, params);
    case "table":
      return insertTable(safe, params.tableLabels ?? DEFAULT_TABLE_LABELS);
    case "image":
      return applyImage(safe, params);
    case "note":
    case "warning":
    case "tip":
      return toggleCallout(safe, action);
    case "drug":
    case "glossary":
      return applyEntity(safe, action, params.slug);
    case "footnote":
      return applyFootnote(safe);
    case "cta":
      return insertCta(safe);
  }
}

// ---------------------------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------------------------

export interface SlashMatch {
  /** Offset of the `/` and of the caret: the range removed when a command is chosen. */
  from: number;
  to: number;
  query: string;
}

/** `/` typed at the start of a line (and nothing but the query after it) opens the command list. */
export function matchSlashCommand(value: string, caret: number): SlashMatch | null {
  if (caret < 1 || caret > value.length) return null;
  const from = lineStartOf(value, caret);
  const typed = value.slice(from, caret);
  const match = /^\/([^\s/]{0,24})$/.exec(typed);
  return match ? { from, to: caret, query: match[1] ?? "" } : null;
}

/** English words that also select a command, beside its localized label. */
export const SLASH_ALIASES: Record<ToolbarAction, readonly string[]> = {
  h2: ["h2", "heading", "title"],
  h3: ["h3", "subheading"],
  bold: ["bold", "strong"],
  italic: ["italic", "em"],
  link: ["link", "url"],
  bullet: ["bullet", "list", "ul"],
  numbered: ["numbered", "number", "ol"],
  quote: ["quote", "blockquote"],
  table: ["table", "grid"],
  image: ["image", "img", "photo", "media"],
  note: ["note", "info"],
  warning: ["warning", "caution", "alert"],
  tip: ["tip", "hint"],
  drug: ["drug", "medicine"],
  glossary: ["glossary", "term"],
  footnote: ["footnote", "reference", "ref"],
  cta: ["cta", "analyze", "button"],
};

/** Commands whose alias or localized label contains the typed query (empty query = all). */
export function filterSlashCommands(
  query: string,
  labelOf: (action: ToolbarAction) => string,
): ToolbarAction[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...TOOLBAR_ACTIONS];
  return TOOLBAR_ACTIONS.filter(
    (action) =>
      SLASH_ALIASES[action].some((alias) => alias.includes(needle)) ||
      labelOf(action).toLowerCase().includes(needle),
  );
}

/** Removes the typed `/query` and runs the command at that spot. */
export function applySlashCommand(
  state: TextState,
  match: SlashMatch,
  action: ToolbarAction,
  params: ToolbarParams = {},
): TextState {
  const cleared: TextState = {
    value: state.value.slice(0, match.from) + state.value.slice(match.to),
    selStart: match.from,
    selEnd: match.from,
  };
  return applyToolbarAction(cleared, action, params);
}
