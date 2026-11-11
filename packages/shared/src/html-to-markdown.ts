import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

/** Bounded, non-fetching HTML import sanitizer. It emits Markdown only, never HTML. */
const MAX_BYTES = 200 * 1024;
const MAX_OUTPUT_BYTES = 200 * 1024;
const MAX_NODES = 30_000;
const MAX_DEPTH = 100;
const DROP_SUBTREES = new Set([
  "script", "style", "iframe", "object", "embed", "svg", "math", "template", "noscript",
  "form", "video", "audio", "source", "track", "canvas", "input", "button", "select", "textarea",
]);
const INLINE_MARKS: Record<string, string> = {
  strong: "**", b: "**", em: "*", i: "*", del: "~~", s: "~~", strike: "~~",
};
const VOID = new Set(["br", "hr", "img"]);
type Node = DefaultTreeAdapterTypes.ChildNode;
type Element = DefaultTreeAdapterTypes.Element;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
function escapeText(value: string): string {
  return value.replace(/([\\`*_{}\x5b\x5d<>#+.!|~-])/g, "\\$1");
}
function attribute(element: Element, name: "href" | "alt"): string | undefined {
  return element.attrs.find((item) => item.name === name && item.namespace === undefined)?.value;
}
function safeLink(value: string): boolean {
  const href = value.trim();
  if (!href || href.split("").some((character) => character <= " " || character === "\\") || href.startsWith("//")) return false;
  if (/^(?:javascript|data|vbscript|file):/i.test(href)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return /^https?:\/\//i.test(href);
  return true;
}
function codeFence(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  return "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
}
function plainText(node: Node, depth: number, count: { value: number }): string {
  if (++count.value > MAX_NODES || depth > MAX_DEPTH) throw new RangeError("HTML import is too complex");
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return "";
  if ("tagName" in node && DROP_SUBTREES.has((node as Element).tagName.toLowerCase())) return "";
  const children = "childNodes" in node ? node.childNodes : [];
  return children.map((child) => plainText(child, depth + 1, count)).join("");
}

export function htmlToMarkdown(input: string): string {
  if (byteLength(input) > MAX_BYTES) throw new RangeError("HTML import exceeds 200 KB");
  const fragment = parseFragment(input);
  let nodeCount = 0;

  const render = (node: Node, depth = 0, listDepth = 0): string => {
    if (++nodeCount > MAX_NODES) throw new RangeError("HTML import is too complex");
    if (depth > MAX_DEPTH) throw new RangeError("HTML import is too deeply nested");
    if (node.nodeName === "#text") return escapeText((node as DefaultTreeAdapterTypes.TextNode).value);
    if (node.nodeName === "#comment" || node.nodeName === "#documentType") return "";
    if (!("tagName" in node)) {
      const children = "childNodes" in node ? (node as unknown as { childNodes: Node[] }).childNodes : [];
      return children.map((child) => render(child, depth + 1, listDepth)).join("");
    }
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (DROP_SUBTREES.has(tag)) return "";
    const children = (): string => element.childNodes.map((child) => render(child, depth + 1, listDepth)).join("");
    if (tag === "img") {
      const alt = attribute(element, "alt");
      return alt ? escapeText(alt) : "";
    }
    if (tag === "br") return "  \n";
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "a") {
      const content = children();
      const href = attribute(element, "href");
      if (href === undefined || !safeLink(href) || !content.trim()) return content;
      const destination = href.trim().replace(/[()[\]<>\\\s]/g, (character) => encodeURIComponent(character));
      return `[${content}](${destination})`;
    }
    if (tag === "pre") {
      const raw = element.childNodes.map((child) => plainText(child, depth + 1, { value: 0 })).join("").replace(/^\n|\n$/g, "");
      const fence = codeFence(raw);
      return `\n\n${fence}\n${raw.replace(/\r\n?/g, "\n")}\n${fence}\n\n`;
    }
    if (tag === "code") return `\`${children()}\``;
    if (tag in INLINE_MARKS) {
      const mark = INLINE_MARKS[tag];
      return `${mark}${children()}${mark}`;
    }
    if (/^h[1-6]$/.test(tag)) {
      const level = Math.min(6, Number(tag.slice(1)) + 1);
      return `\n\n${"#".repeat(level)} ${children().trim()}\n\n`;
    }
    if (tag === "ul" || tag === "ol") {
      const content = element.childNodes.map((child) => render(child, depth + 1, listDepth + 1)).join("");
      return `\n${content}\n`;
    }
    if (tag === "li") {
      const parentIsOrdered = element.parentNode && "tagName" in element.parentNode && (element.parentNode as Element).tagName === "ol";
      const marker = parentIsOrdered ? "1. " : "- ";
      const nested = children().trim().replace(/\n{2,}/g, "\n");
      return `${"  ".repeat(Math.max(0, listDepth - 1))}${marker}${nested}\n`;
    }
    if (tag === "blockquote") {
      const content = children().trim();
      return `\n\n${content.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "table") {
      const rows: Element[] = [];
      const pending: { node: Node; level: number }[] = element.childNodes.map((node) => ({ node, level: depth + 1 }));
      let scanned = 0;
      while (pending.length > 0) {
        const entry = pending.pop();
        if (entry === undefined) break;
        if (++scanned > MAX_NODES || entry.level > MAX_DEPTH) throw new RangeError("HTML import is too complex");
        if ("tagName" in entry.node && (entry.node as Element).tagName === "tr") rows.push(entry.node as Element);
        else if ("childNodes" in entry.node && !("tagName" in entry.node && DROP_SUBTREES.has((entry.node as Element).tagName.toLowerCase()))) {
          for (const child of (entry.node as DefaultTreeAdapterTypes.ParentNode).childNodes) pending.push({ node: child, level: entry.level + 1 });
        }
      }
      rows.reverse();
      const renderedRows = rows.map((row) => {
        const cells = row.childNodes.filter((child): child is Element => "tagName" in child && ["td", "th"].includes((child as Element).tagName));
        return `| ${cells.map((cell) => cell.childNodes.map((child) => render(child, depth + 1, listDepth)).join("").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
      });
      const firstRow = renderedRows[0];
      if (firstRow !== undefined) {
        renderedRows.splice(1, 0, `| ${firstRow.slice(2, -2).split("|").map(() => "---").join(" | ")} |`);
      }
      return `\n\n${renderedRows.join("\n")}\n\n`;
    }
    if (["p", "div", "section", "article", "main", "header", "footer", "address", "figure", "figcaption"].includes(tag)) return `\n\n${children().trim()}\n\n`;
    if (VOID.has(tag)) return "";
    return children();
  };

  const markdown = fragment.childNodes.map((node) => render(node)).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (byteLength(markdown) > MAX_OUTPUT_BYTES) throw new RangeError("Converted Markdown exceeds 200 KB");
  return `${markdown}\n`;
}
