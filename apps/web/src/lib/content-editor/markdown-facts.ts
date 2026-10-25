import { plainForMatching } from "@wasfa/shared/content";

/*
 * Facts read from the Markdown source while the editor types (outline, SEO checklist, sources list).
 * They mirror the shapes the server renderer reads (`#` headings, `[t](u)` links, `![alt](media:id)`
 * images) but are deliberately forgiving: the server render is the authority, this only feeds live hints.
 */

export interface MdHeading {
  level: number;
  text: string;
  /** Zero-based line number. */
  line: number;
  /** Offset of the first character of the heading line. */
  offset: number;
}

export interface MdLink {
  text: string;
  href: string;
  internal: boolean;
}

export interface MdImage {
  alt: string;
  src: string;
  caption: string;
  /** The library asset id when the source is `media:<id>`. */
  mediaId: string | null;
}

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** Inline markdown reduced to the words a reader sees (emphasis, code, links, directives). */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ATX headings (`## x`), skipping fenced code. */
export function extractHeadings(markdown: string): MdHeading[] {
  const headings: MdHeading[] = [];
  let inFence = false;
  let offset = 0;
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence) {
      const match = HEADING.exec(line);
      if (match) {
        headings.push({
          level: (match[1] ?? "#").length,
          text: stripInline(match[2] ?? ""),
          line: index,
          offset,
        });
      }
    }
    offset += line.length + 1;
  }
  return headings;
}

const LINK = /(?<!!)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** Links in the body; `internal` = a site path (`/blog/x`) rather than a URL or an anchor. */
export function extractLinks(markdown: string): MdLink[] {
  const links: MdLink[] = [];
  for (const match of markdown.matchAll(LINK)) {
    const href = match[2] ?? "";
    links.push({
      text: match[1] ?? "",
      href,
      internal: href.startsWith("/") && !href.startsWith("//"),
    });
  }
  return links;
}

/** `{{drug:slug}}` and `{{glossary:slug}}` render as internal links on the server. */
export function countEntityLinks(markdown: string): number {
  return markdown.match(/\{\{(?:drug|glossary):[a-z0-9-]+\}\}/g)?.length ?? 0;
}

const IMAGE = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"([^"]*)")?\s*\)/g;

export function extractImages(markdown: string): MdImage[] {
  const images: MdImage[] = [];
  for (const match of markdown.matchAll(IMAGE)) {
    const src = match[2] ?? "";
    images.push({
      alt: (match[1] ?? "").trim(),
      src,
      caption: match[3] ?? "",
      mediaId: src.startsWith("media:") ? src.slice("media:".length) : null,
    });
  }
  return images;
}

/** The first `count` words of the body as the matcher sees them (normalised Arabic, lower case). */
export function firstWords(markdown: string, count: number): string {
  const body = markdown
    .replace(/^:::.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}[ \t]+/gm, "");
  return plainForMatching(body).split(" ").filter(Boolean).slice(0, count).join(" ");
}

/** Whether `needle` occurs in `haystack` after both are normalised the way the quality gates do it. */
export function containsNormalized(haystack: string, needle: string): boolean {
  const target = plainForMatching(needle);
  return target !== "" && plainForMatching(haystack).includes(target);
}

/** Sentence and paragraph sizes of the prose (same thresholds as the server `readability` gate). */
export function readabilityFacts(markdown: string): {
  avgSentenceWords: number;
  longestParagraphWords: number;
} {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "" && !/^(?:#|[-*+>|]|\d+[.)]|:::|\{\{|!\[)/.test(chunk));
  let longest = 0;
  let sentences = 0;
  let words = 0;
  for (const paragraph of paragraphs) {
    const count = stripInline(paragraph).split(" ").filter(Boolean).length;
    longest = Math.max(longest, count);
    for (const sentence of paragraph.split(/[.!?؟۔]+(?:\s|$)/)) {
      const n = stripInline(sentence).split(" ").filter(Boolean).length;
      if (n > 0) {
        sentences += 1;
        words += n;
      }
    }
  }
  return {
    avgSentenceWords: sentences === 0 ? 0 : Math.round((words / sentences) * 10) / 10,
    longestParagraphWords: longest,
  };
}

/**
 * What the suggested-links lookup searches for: the selected words when there are some, else the
 * nearest heading above the caret, else the title. Short noise (under 3 characters) is ignored.
 */
export function linkQueryAt(
  markdown: string,
  selStart: number,
  selEnd: number,
  title: string,
): string {
  const selected = markdown.slice(selStart, selEnd).replace(/\s+/g, " ").trim();
  if (selected.length >= 3 && selected.length <= 100) return stripInline(selected);
  const heading = extractHeadings(markdown)
    .filter((candidate) => candidate.offset <= selStart)
    .at(-1);
  const query = heading?.text ?? title;
  return stripInline(query).slice(0, 100);
}
