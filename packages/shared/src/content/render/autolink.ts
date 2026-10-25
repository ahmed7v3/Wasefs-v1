import { normalizeArabic } from "../../normalize.js";
import { countWords } from "../text.js";

import { text, type MNode } from "./mnode.js";

import type { AutoLinkTarget, RenderedEntity } from "./types.js";

/*
 * Automatic internal linking (SEO-GEO §7.2): the first mention of a drug or glossary term links to
 * its page, with a ceiling per target and a minimum gap in words between any two links so a
 * paragraph never turns blue. Operates on the mdast tree, so it can only touch running text: never a
 * heading, an existing link, code, a footnote definition or a callout title.
 */

/** Arabic spellings that writers mix freely; each letter matches all of its variants. */
const LETTER_VARIANTS: Readonly<Record<string, string>> = {
  ا: "[اأإآٱ]",
  ي: "[يىئ]",
  ه: "[هة]",
  و: "[وؤ]",
};
const OPTIONAL_MARKS = "[\\p{Mn}ـ]*";
const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{M}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{M}\\p{N}])";
/** One-letter prefix + definite article ("بال", "وال", "لل" is not handled): «الباراسيتامول», «بالباراسيتامول». */
const ARABIC_PREFIX = "(?:[وفبلك]?ال)?";

const escapeLiteral = (char: string): string => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regex that finds `term` in running text with Unicode word boundaries and Arabic letter-variant tolerance. */
export function termRegExp(term: string): RegExp | null {
  const normalized = normalizeArabic(term).toLowerCase();
  if (normalized === "") return null;
  const body = [...normalized]
    .map((char) => {
      if (/\s/u.test(char)) return "\\s+";
      return (LETTER_VARIANTS[char] ?? escapeLiteral(char)) + OPTIONAL_MARKS;
    })
    .join("");
  const startsArabic = /^[\u0600-ۿ]/.test(normalized) && !normalized.startsWith("ال");
  return new RegExp(
    `${BOUNDARY_BEFORE}${startsArabic ? ARABIC_PREFIX : ""}${body}${BOUNDARY_AFTER}`,
    "giu",
  );
}

interface Candidate {
  target: AutoLinkTarget;
  term: string;
  /** Compiled on first use: building a Unicode-aware pattern costs ~2 ms, so thousands of targets must not all be compiled per render. */
  regex?: RegExp | null;
  length: number;
  /** First word of the term in canonical spelling; a text node without it cannot match, so its regex is skipped. */
  key: string | null;
}

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const ARTICLE = /^(?:[وفبلك]?ال)/;

/** Canonical spellings of every word in `value`, plus each word without a leading definite article. */
function wordKeys(value: string): Set<string> {
  const keys = new Set<string>();
  for (const word of normalizeArabic(value).toLowerCase().match(WORD) ?? []) {
    keys.add(word);
    const bare = word.replace(ARTICLE, "");
    if (bare !== word && bare !== "") keys.add(bare);
  }
  return keys;
}

/** Identity of a target for counting: the explicit `{{drug:x}}` links use the same key. */
export const entityKey = (kind: string, slug: string): string => `${kind}:${slug}`;

/** Marks text that must never be auto-linked (`{{nolink:term}}`). */
export const noLinkNodes = new WeakSet<MNode>();
/** Explicit entity links already in the tree, keyed for counting. */
export const explicitEntityLinks = new WeakMap<
  MNode,
  { kind: "drug" | "glossary"; slug: string }
>();

const SKIP_TYPES = new Set([
  "heading",
  "link",
  "linkReference",
  "code",
  "inlineCode",
  "footnoteDefinition",
  "definition",
  "image",
  "imageReference",
  "html",
]);

export interface AutoLinkOptions {
  targets: readonly AutoLinkTarget[];
  maxPerTarget: number;
  minWordsBetween: number;
}

export function autoLink(root: MNode, options: AutoLinkOptions): RenderedEntity[] {
  const candidates: Candidate[] = [];
  for (const target of options.targets) {
    for (const term of target.terms) {
      if (normalizeArabic(term) === "") continue;
      const key = normalizeArabic(term).toLowerCase().match(WORD)?.[0] ?? null;
      candidates.push({ target, term, length: term.length, key });
    }
  }
  if (candidates.length === 0 || options.maxPerTarget < 1) return [];
  // Longer terms first so «باراسيتامول فوار» wins over «باراسيتامول» when both start at the same place.
  candidates.sort((a, b) => b.length - a.length);

  const counts = new Map<string, number>();
  // An explicit link anywhere in the body satisfies that target: auto-linking an earlier mention would duplicate it.
  const markExplicit = (node: MNode): void => {
    const explicit = explicitEntityLinks.get(node);
    if (explicit !== undefined)
      counts.set(entityKey(explicit.kind, explicit.slug), options.maxPerTarget);
    node.children?.forEach(markExplicit);
  };
  markExplicit(root);

  const entities: RenderedEntity[] = [];
  let wordsSoFar = 0;
  let lastLinkAt: number | null = null;

  const linkText = (node: MNode): MNode[] => {
    const value = node.value ?? "";
    const out: MNode[] = [];
    let cursor = 0;
    const keys = wordKeys(value);
    const relevant = candidates.filter(
      (candidate) => candidate.key === null || keys.has(candidate.key),
    );
    if (relevant.length === 0) return [node];
    for (;;) {
      let best: { candidate: Candidate; index: number; end: number } | null = null;
      for (const candidate of relevant) {
        candidate.regex ??= termRegExp(candidate.term);
        const regex = candidate.regex;
        if (regex === null) continue;
        const key = entityKey(candidate.target.kind, candidate.target.slug);
        if ((counts.get(key) ?? 0) >= options.maxPerTarget) continue;
        regex.lastIndex = cursor;
        for (let match = regex.exec(value); match !== null; match = regex.exec(value)) {
          const at = wordsSoFar + countWords(value.slice(0, match.index));
          const gapOk = lastLinkAt === null || at - lastLinkAt >= options.minWordsBetween;
          if (match[0] === "") {
            regex.lastIndex += 1;
            continue;
          }
          if (!gapOk) continue;
          const index = match.index;
          const end = index + match[0].length;
          if (best === null || index < best.index || (index === best.index && end > best.end)) {
            best = { candidate, index, end };
          }
          break;
        }
      }
      if (best === null) break;
      const { target } = best.candidate;
      if (best.index > cursor) out.push(text(value.slice(cursor, best.index)));
      const entity =
        target.kind === "content" ? {} : { className: ["entity-link"], dataEntity: target.kind };
      out.push({
        type: "link",
        url: target.path,
        title: target.title,
        children: [text(value.slice(best.index, best.end))],
        data: { hProperties: entity },
      });
      const key = entityKey(target.kind, target.slug);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (target.kind !== "content")
        entities.push({ kind: target.kind, slug: target.slug, source: "auto" });
      lastLinkAt = wordsSoFar + countWords(value.slice(0, best.end));
      cursor = best.end;
    }
    if (out.length === 0) return [node];
    if (cursor < value.length) out.push(text(value.slice(cursor)));
    return out;
  };

  const walk = (node: MNode, skipped: boolean): void => {
    if (node.children === undefined) return;
    const next: MNode[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        const value = child.value ?? "";
        if (skipped || noLinkNodes.has(child)) next.push(child);
        else next.push(...linkText(child));
        wordsSoFar += countWords(value);
        continue;
      }
      if (child.type === "inlineCode" || child.type === "code") {
        next.push(child);
        continue;
      }
      const skipChild =
        skipped || SKIP_TYPES.has(child.type) || child.data?.["directiveLabel"] === true;
      walk(child, skipChild);
      if (explicitEntityLinks.has(child)) lastLinkAt = wordsSoFar;
      next.push(child);
    }
    node.children = next;
  };
  walk(root, false);
  return entities;
}
