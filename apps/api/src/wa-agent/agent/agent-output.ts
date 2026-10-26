/*
 * What the model wrote, made fit for WhatsApp: its own formatting (not Markdown), and the shape of
 * the reply (a few short messages, each under the admin's character cap). Pure functions.
 */

/** Markdown to WhatsApp style: `**x**` to `*x*`, no headings, tables, fences or markdown links. */
export function toWhatsappText(markdown: string): string {
  const lines = markdown
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => !/^\s*(```|~~~)/.test(line) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line))
    // A table separator row has nothing to show.
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, "")
        // A bullet star would read as bold.
        .replace(/^(\s*)[*•]\s+/, "$1- ")
        .replace(/^\s*\|(.*)\|\s*$/, (_all, cells: string) =>
          cells
            .split("|")
            .map((cell) => cell.trim())
            .join(" - "),
        ),
    );
  return lines
    .join("\n")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/__([^_\n]+)__/g, "*$1*")
    .replace(/`+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cuts at a code point boundary (a lone surrogate would break the message). */
function hardTrim(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

/** One over-long paragraph split at line breaks, then spaces, so no piece exceeds `max`. */
function breakLong(paragraph: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const at = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const cut = at > max / 2 ? at : max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}

/**
 * Splits on paragraph boundaries into at most `maxParts` messages of at most `maxChars` each. Short
 * paragraphs stay separate messages (like a person typing) while they fit the part budget; otherwise
 * neighbours are merged. What still does not fit is cut from the end. Empty text gives no message.
 */
export function splitReply(text: string, maxParts: number, maxChars: number): string[] {
  const clean = text.trim();
  if (clean === "" || maxParts < 1) return [];
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .flatMap((part) => breakLong(part, maxChars));

  // Too many messages: merge the neighbours whose joined text is shortest, while it fits the cap.
  const parts = [...paragraphs];
  while (parts.length > maxParts) {
    let best = -1;
    let bestLength = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < parts.length; index++) {
      const joined = (parts[index]?.length ?? 0) + 2 + (parts[index + 1]?.length ?? 0);
      if (joined <= maxChars && joined < bestLength) {
        best = index;
        bestLength = joined;
      }
    }
    if (best < 0) break;
    parts.splice(best, 2, `${parts[best] ?? ""}\n\n${parts[best + 1] ?? ""}`);
  }
  if (parts.length > maxParts) {
    // Still too many: the tail is joined into the last message and cut to the cap.
    const tail = parts.splice(maxParts - 1).join("\n\n");
    parts.push(tail);
  }
  return parts.map((part) => hardTrim(part, maxChars)).filter((part) => part !== "");
}
