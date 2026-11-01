/*
 * Markdown-ish model text to WhatsApp formatting (docs/WA-AGENT-RUNTIME.md §11, §18.6). Pure and
 * idempotent: WhatsApp renders `*bold*`, `_italic_`, `~strike~`, `mono`, "• " bullets and numbered lists, but
 * shows Markdown headings, `**bold**` and tables raw, so those are rewritten. Fenced code is left untouched.
 * One `pass` applies every rule once; `toWhatsApp` repeats it to a fixpoint so odd inputs (`***x***`) still
 * satisfy toWhatsApp(toWhatsApp(x)) === toWhatsApp(x). Every rewrite shrinks the text or removes a marker, so the
 * loop ends fast; the cap is only a guard.
 */

const MAX_PASSES = 20;

/** A line that opens or closes a fenced code block. */
const FENCE_LINE = /^\s*```/;
const FENCE_WITH_LANG_ONLY = /^\s*```[\w+#.-]*\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/;
const BULLET = /^(\s*)[-*+]\s+(\S.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(\S.*)$/;
/** `| --- | :-: |` (the caller also requires a pipe, so a lone `---` rule is not a table). */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function countFences(line: string): number {
  return line.split("```").length - 1;
}

function isFenceToggle(line: string): boolean {
  return FENCE_LINE.test(line) && countFences(line) % 2 === 1;
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

function isTableSeparator(line: string): boolean {
  return line.includes("|") && TABLE_SEPARATOR.test(line);
}

function plain(segment: string): string {
  return segment
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "*$1*")
    .replace(/__(?=\S)([^_\n]+?)__/g, "*$1*")
    .replace(/~~(?=\S)([^~\n]+?)~~/g, "~$1~");
}

/** Inline rules on a line, leaving `inline code` spans exactly as written. */
function inline(line: string): string {
  return line
    .split(/(`[^`\n]*`)/)
    .map((segment, index) => (index % 2 === 1 ? segment : plain(segment)))
    .join("");
}

function tableRowToBullet(row: string): string {
  const cells = row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
  return cells.length === 0 ? "" : `• ${cells.join(" — ")}`;
}

function lineRules(line: string): string {
  const heading = HEADING.exec(line);
  if (heading) {
    // Stars inside a bold heading would nest badly, so they go; the whole line is the bold span.
    const content = inline(heading[1] ?? "")
      .replace(/\*/g, "")
      .trim();
    return content === "" ? "" : `*${content}*`;
  }
  const bullet = BULLET.exec(line);
  if (bullet) return inline(`${bullet[1] ?? ""}• ${bullet[2] ?? ""}`);
  const numbered = NUMBERED.exec(line);
  if (numbered) return inline(`${numbered[1] ?? ""}${numbered[2] ?? ""}. ${numbered[3] ?? ""}`);
  return inline(line);
}

function pass(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;
  // Runs of blank lines collapse to one outside code; `lastBlank` is the previous emitted line.
  let lastBlank = false;
  const push = (line: string, code: boolean): void => {
    const value = code ? line : line.trimEnd();
    if (!code && value === "") {
      if (lastBlank) return;
      lastBlank = true;
    } else {
      lastBlank = false;
    }
    out.push(value);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (inCode) {
      if (isFenceToggle(line)) {
        inCode = false;
        push("```", true);
      } else {
        push(line, true);
      }
      continue;
    }
    if (isFenceToggle(line)) {
      inCode = true;
      push(FENCE_WITH_LANG_ONLY.test(line) ? "```" : line.trimEnd(), true);
      continue;
    }
    const next = lines[i + 1];
    if (isTableRow(line) && next !== undefined && isTableSeparator(next)) {
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j] ?? "") && !FENCE_LINE.test(lines[j] ?? "")) {
        push(tableRowToBullet(lines[j] ?? ""), false);
        j += 1;
      }
      i = j - 1;
      continue;
    }
    push(lineRules(line), false);
  }
  return out.join("\n").trim();
}

/** Rewrite Markdown-style model text into what WhatsApp renders. Idempotent. */
export function toWhatsApp(text: string): string {
  let current = text;
  for (let i = 0; i < MAX_PASSES; i += 1) {
    const next = pass(current);
    if (next === current) return next;
    current = next;
  }
  return current;
}
