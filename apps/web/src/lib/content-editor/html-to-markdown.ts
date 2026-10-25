import { stripBidiControls } from "@wasfa/shared/content";

/*
 * Pasted HTML (Google Docs, Word, web pages) -> clean Markdown in the dialect of CONTENT-PLATFORM §7.
 * Pure given a DOM `DOMParser`; the parsed document is inert (scripts never run, nothing is fetched),
 * and the walk only ever READS elements, so hostile markup can at worst produce odd text. Images are
 * dropped (remote sources are never linked; uploads go through the media library), and so is every
 * attribute except a vetted `href`.
 */

/** Pasted HTML larger than this is ignored (the caller falls back to the plain-text paste). */
export const MAX_PASTE_HTML_CHARS = 400_000;

const SKIP = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "head",
  "meta",
  "link",
  "svg",
  "canvas",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "img",
  "picture",
  "video",
  "audio",
  "title",
  "base",
]);

const BLOCK = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "address",
  "fieldset",
  "details",
  "summary",
  "dl",
  "dt",
  "dd",
  "center",
]);

interface Chunk {
  text: string;
  /** List items stay one line apart; everything else is separated by a blank line. */
  tight: boolean;
}

function isHidden(el: Element): boolean {
  if (el.hasAttribute("hidden")) return true;
  const style = (el.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
  return style.includes("display:none") || style.includes("visibility:hidden");
}

function styleOf(el: Element): string {
  return (el.getAttribute("style") ?? "").toLowerCase().replace(/\s+/g, "");
}

/** Bold either by tag or by the inline style Google Docs and Word use on spans. */
function isBold(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const style = styleOf(el);
  const weight = /font-weight:(\w+)/.exec(style)?.[1];
  const heavy =
    weight === "bold" || weight === "bolder" || (weight !== undefined && Number(weight) >= 600);
  if (tag === "b" || tag === "strong") {
    // Google Docs wraps the whole clipboard in <b style="font-weight:normal">.
    return !(weight === "normal" || (weight !== undefined && Number(weight) < 600));
  }
  return heavy;
}

function isItalic(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const style = styleOf(el);
  if (tag === "i" || tag === "em") return !style.includes("font-style:normal");
  return style.includes("font-style:italic");
}

function wrapMarker(text: string, marker: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const inner = match?.[2] ?? "";
  if (inner === "") return text;
  return `${match?.[1] ?? ""}${marker}${inner}${marker}${match?.[3] ?? ""}`;
}

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]<])/g, "\\$1");
}

/** Google wraps outbound links in a redirect (`google.com/url?q=<real>`); unwrap it. */
function cleanHref(raw: string): string | null {
  const href = raw.trim();
  if (href === "") return null;
  let candidate = href;
  try {
    const url = new URL(href, "https://invalid.example");
    if (
      /(^|\.)google\.com$/.test(url.hostname) &&
      url.pathname === "/url" &&
      url.searchParams.get("q")
    ) {
      candidate = url.searchParams.get("q") ?? href;
    }
  } catch {
    return null;
  }
  if (candidate.startsWith("#") || (candidate.startsWith("/") && !candidate.startsWith("//"))) {
    return candidate.replace(/\s/g, "%20").replace(/\)/g, "%29");
  }
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\)/g, "%29");
  } catch {
    return null;
  }
}

interface InlineOptions {
  /** Headings and table cells: no emphasis markers, no hard breaks. */
  plain?: boolean;
  /** List items: nested lists are rendered separately. */
  skipLists?: boolean;
  inPre?: boolean;
}

function inlineChildren(parent: Node, options: InlineOptions): string {
  let out = "";
  for (const child of Array.from(parent.childNodes)) out += inlineNode(child, options);
  return out;
}

function inlineNode(node: Node, options: InlineOptions): string {
  if (node.nodeType === 3) {
    const raw = node.textContent ?? "";
    if (options.inPre) return raw;
    return escapeText(raw.replace(/\s+/g, " "));
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  // Office namespaced tags (`o:p`) carry no text of their own.
  if (SKIP.has(tag) || isHidden(el) || tag.includes(":")) return "";
  if (options.skipLists && (tag === "ul" || tag === "ol")) return "";

  if (tag === "br") return options.plain ? " " : "  \n";
  if (tag === "code" && !options.inPre) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return text === "" ? "" : `\`${text.replace(/`/g, "'")}\``;
  }
  if (tag === "a") {
    const text = inlineChildren(el, options).trim();
    const href = cleanHref(el.getAttribute("href") ?? "");
    if (text === "") return "";
    return href === null ? text : `[${text}](${href})`;
  }

  let inner = inlineChildren(el, options);
  if (BLOCK.has(tag) || tag === "p") inner = `${inner.trim()} `;
  if (options.plain) return inner;
  // Docs wraps bold inside italic spans etc.; apply the markers once per element, innermost first.
  if (isBold(el)) inner = wrapMarker(inner, "**");
  if (isItalic(el)) inner = wrapMarker(inner, "*");
  return inner;
}

function tidyInline(text: string): string {
  return text
    .replace(/[ \t]+\n/g, (match) => (match.startsWith("  ") ? "  \n" : "\n"))
    .replace(/ {3,}\n/g, "  \n")
    .replace(/(?<![ ]) {2,}(?!\n)/g, " ")
    .trim();
}

function cellText(cell: Element): string {
  return tidyInline(inlineChildren(cell, { plain: true }))
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|");
}

function tableMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr"))
    // A nested table's rows belong to the nested table.
    .filter((row) => row.closest("table") === table)
    .map((row) =>
      Array.from(row.children)
        .filter(
          (cell) => cell.tagName.toLowerCase() === "td" || cell.tagName.toLowerCase() === "th",
        )
        .map(cellText),
    )
    .filter((cells) => cells.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((cells) => cells.length));
  const line = (cells: string[]): string =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  return [
    line(head ?? []),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map(line),
  ].join("\n");
}

function markerWidth(marker: string): number {
  return marker.length + 1;
}

function listMarkdown(list: Element, depth: number, indent: string): string[] {
  const ordered = list.tagName.toLowerCase() === "ol";
  let number = ordered ? Number(list.getAttribute("start")) || 1 : 0;
  const lines: string[] = [];
  let lastIndent = indent + "  ";
  for (const child of Array.from(list.children)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") {
      // Google Docs puts a nested list beside the item instead of inside it.
      lines.push(...listMarkdown(child, depth + 1, lastIndent));
      continue;
    }
    if (tag !== "li" || isHidden(child)) continue;
    const marker = ordered ? `${String(number)}.` : "-";
    number += 1;
    const text = tidyInline(inlineChildren(child, { skipLists: true })).replace(/\n+/g, " ");
    lines.push(`${indent}${marker} ${text}`.trimEnd());
    lastIndent = indent + " ".repeat(markerWidth(marker));
    for (const nested of Array.from(child.children)) {
      const nestedTag = nested.tagName.toLowerCase();
      if (nestedTag === "ul" || nestedTag === "ol") {
        lines.push(...listMarkdown(nested, depth + 1, lastIndent));
      }
    }
  }
  return lines;
}

/** Word's fake lists: `<p class=MsoListParagraph style="mso-list:l0 level2 lfo1">` with a bullet span. */
function msoListInfo(el: Element): { level: number; ordered: boolean } | null {
  const style = el.getAttribute("style") ?? "";
  const className = el.getAttribute("class") ?? "";
  if (!/mso-list/i.test(style) && !/MsoListParagraph/i.test(className)) return null;
  const level = Number(/level(\d+)/i.exec(style)?.[1] ?? 1);
  const marker = (
    Array.from(el.querySelectorAll("span")).find((span) =>
      /mso-list:\s*Ignore/i.test(span.getAttribute("style") ?? ""),
    )?.textContent ?? ""
  ).trim();
  return { level: Math.max(1, level), ordered: /^[0-9a-z٠-٩]+[.)]$/i.test(marker) };
}

function msoItemText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const span of Array.from(clone.querySelectorAll("span"))) {
    if (/mso-list:\s*Ignore/i.test(span.getAttribute("style") ?? "")) span.remove();
  }
  return tidyInline(inlineChildren(clone, {})).replace(/\n+/g, " ");
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((child) => {
    const tag = child.tagName.toLowerCase();
    return (
      BLOCK.has(tag) ||
      /^h[1-6]$/.test(tag) ||
      ["ul", "ol", "table", "blockquote", "pre", "hr"].includes(tag) ||
      (tag !== "a" && hasBlockChild(child))
    );
  });
}

function blocksOf(parent: Node, out: Chunk[]): void {
  let run = "";
  const flush = (): void => {
    const text = tidyInline(run);
    if (text !== "") out.push({ text, tight: false });
    run = "";
  };

  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3) {
      run += inlineNode(child, {});
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || isHidden(el) || tag.startsWith("o:")) continue;

    if (/^h[1-6]$/.test(tag)) {
      flush();
      const text = tidyInline(inlineChildren(el, { plain: true })).replace(/\s+/g, " ");
      if (text !== "") {
        const level = Number(tag.slice(1));
        out.push({ text: `${level <= 2 ? "##" : "###"} ${text}`, tight: false });
      }
    } else if (tag === "ul" || tag === "ol") {
      flush();
      const lines = listMarkdown(el, 0, "");
      if (lines.length > 0) out.push({ text: lines.join("\n"), tight: false });
    } else if (tag === "blockquote") {
      flush();
      const inner: Chunk[] = [];
      blocksOf(el, inner);
      const text = joinChunks(inner)
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
      if (text !== "") out.push({ text, tight: false });
    } else if (tag === "table") {
      flush();
      const text = tableMarkdown(el);
      if (text !== "") out.push({ text, tight: false });
    } else if (tag === "hr") {
      flush();
      out.push({ text: "---", tight: false });
    } else if (tag === "pre") {
      flush();
      const code = (el.textContent ?? "").replace(/\n+$/, "");
      if (code.trim() !== "")
        out.push({ text: `\`\`\`\n${code.replace(/```/g, "'''")}\n\`\`\``, tight: false });
    } else if (tag === "p" && msoListInfo(el)) {
      flush();
      const info = msoListInfo(el);
      const text = msoItemText(el);
      if (info && text !== "") {
        const indent = "  ".repeat(info.level - 1);
        const marker = info.ordered ? "1." : "-";
        const previous = out[out.length - 1];
        const chunk = `${indent}${marker} ${text}`;
        // Consecutive list paragraphs join into one list.
        if (previous?.tight) previous.text += `\n${chunk}`;
        else out.push({ text: chunk, tight: true });
      }
    } else if (BLOCK.has(tag)) {
      flush();
      if (hasBlockChild(el)) blocksOf(el, out);
      else {
        const text = tidyInline(inlineNode(el, {}));
        if (text !== "") out.push({ text, tight: false });
      }
    } else if (hasBlockChild(el)) {
      // An inline wrapper around blocks (Google Docs wraps its whole clipboard in a <b>).
      flush();
      blocksOf(el, out);
    } else {
      // Inline element (span, b, i, a...) in a block context: part of the running paragraph.
      run += inlineNode(el, {});
    }
  }
  flush();
}

function joinChunks(chunks: Chunk[]): string {
  let out = "";
  chunks.forEach((chunk, index) => {
    if (index > 0) out += "\n\n";
    out += chunk.text;
  });
  return out;
}

/**
 * Converts pasted HTML to Markdown. Returns "" for empty input, for input over `MAX_PASTE_HTML_CHARS`,
 * and when no DOM parser exists (the paste handler then keeps the browser's plain-text paste).
 */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === "" || html.length > MAX_PASTE_HTML_CHARS) return "";
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const chunks: Chunk[] = [];
  blocksOf(doc.body, chunks);
  const markdown = joinChunks(chunks)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripBidiControls(markdown).text;
}
