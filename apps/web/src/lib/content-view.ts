import { CONTENT_SLUG_MAX, CONTENT_SLUG_PATTERN } from "@wasfa/shared/content/constants";

import { localizedPath, type Locale } from "./locale";

import type { PublicItem } from "@wasfa/shared/schemas/content";

/*
 * Pure helpers of the public content pages (no request access, no fetching), so the templates and the
 * routes stay thin and the rules (slug guard, glossary grouping, pagination, share links) are unit-tested.
 */

export type ContentSection = "blog" | "guides" | "glossary";

/** Base path of a section in `locale`: `("blog", "en")` -> `/en/blog`. */
export function sectionPath(section: ContentSection, locale: Locale): string {
  return localizedPath(`/${section}`, locale);
}

/** Longest `[...slug]` path (segments) the catch-all resolves; deeper paths never reach the API. */
export const PAGE_SLUG_MAX_SEGMENTS = 3;

/** Whether `segments` can be the slug of a `page` item: 1-3 segments, each a valid slug. */
export function isPageSlugSegments(segments: readonly string[]): boolean {
  return (
    segments.length >= 1 &&
    segments.length <= PAGE_SLUG_MAX_SEGMENTS &&
    segments.every(
      (segment) => segment.length <= CONTENT_SLUG_MAX && CONTENT_SLUG_PATTERN.test(segment),
    )
  );
}

/** `?page=` as a positive integer (invalid, missing or absurd values mean the first page). */
export function parsePageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || !/^\d{1,4}$/.test(raw)) return 1;
  const page = Number(raw);
  return page >= 1 && page <= 1000 ? page : 1;
}

/** Page 1 is the clean URL (self-canonical), the others carry `?page=n`. */
export function pageHref(basePath: string, page: number): string {
  return page <= 1 ? basePath : `${basePath}?page=${String(page)}`;
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** UTC, Gregorian, Western digits (DESIGN-SYSTEM §4.6). */
export function formatContentDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    numberingSystem: "latn",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** `YYYY-MM-DD` of an instant: the `datetime` attribute shown to readers and the same value in JSON-LD. */
export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

export interface ShareLink {
  id: "whatsapp" | "facebook" | "x" | "telegram";
  href: string;
}

/** Plain share links (no third-party scripts, CONTENT-PLATFORM §7). */
export function shareLinks(url: string, title: string): ShareLink[] {
  const u = encodeURIComponent(url);
  const text = encodeURIComponent(`${title} ${url}`);
  return [
    { id: "whatsapp", href: `https://wa.me/?text=${text}` },
    { id: "facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    {
      id: "x",
      href: `https://twitter.com/intent/tweet?url=${u}&text=${encodeURIComponent(title)}`,
    },
    { id: "telegram", href: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(title)}` },
  ];
}

// ---------------------------------------------------------------------------------------------
// Glossary grouping
// ---------------------------------------------------------------------------------------------

export type LetterScript = "latin" | "arabic" | "other";

export interface GlossaryGroup<T> {
  letter: string;
  script: LetterScript;
  items: T[];
}

const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_LETTER = /^[ء-يٱٮ-ۓ]$/u;

/** First letter of a term: Latin upper-cased, Arabic with marks removed and أ إ آ ٱ folded to ا. */
export function glossaryLetter(term: string): { letter: string; script: LetterScript } {
  const cleaned = term.normalize("NFC").replace(ARABIC_MARKS, "").trimStart();
  for (const char of cleaned) {
    if (/^[A-Za-z]$/.test(char)) return { letter: char.toUpperCase(), script: "latin" };
    const folded = char.replace(/[أإآٱ]/, "ا");
    if (ARABIC_LETTER.test(folded)) return { letter: folded, script: "arabic" };
    // Skip leading digits, quotes and punctuation: the term "(BID)" belongs under B.
    if (/^[\p{L}]$/u.test(char)) return { letter: "#", script: "other" };
  }
  return { letter: "#", script: "other" };
}

const ARABIC_ORDER = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";

/** Groups by first letter: Latin A-Z, then Arabic in alphabet order, then everything else. */
export function groupGlossary<T extends { term: string }>(items: readonly T[]): GlossaryGroup<T>[] {
  const groups = new Map<string, GlossaryGroup<T>>();
  for (const item of items) {
    const { letter, script } = glossaryLetter(item.term);
    const group = groups.get(letter) ?? { letter, script, items: [] };
    group.items.push(item);
    groups.set(letter, group);
  }
  const rank = (group: GlossaryGroup<T>): number => {
    if (group.script === "latin") return 0;
    if (group.script === "arabic") return 1;
    return 2;
  };
  const arabicIndex = (letter: string): number => {
    const index = ARABIC_ORDER.indexOf(letter);
    return index === -1 ? ARABIC_ORDER.length : index;
  };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.toSorted((a, b) => a.term.localeCompare(b.term, "und")),
    }))
    .toSorted((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.script === "arabic") return arabicIndex(a.letter) - arabicIndex(b.letter);
      return a.letter.localeCompare(b.letter);
    });
}

/** Anchor id of a letter group (ASCII, so it works in both scripts). */
export function letterAnchor(group: { letter: string; script: LetterScript }): string {
  if (group.script === "latin") return `letter-${group.letter.toLowerCase()}`;
  if (group.script === "arabic") return `letter-ar-${String(group.letter.codePointAt(0))}`;
  return "letter-other";
}

// ---------------------------------------------------------------------------------------------
// Item trail
// ---------------------------------------------------------------------------------------------

/** Section of a content type (`page` items have none). */
export function sectionOfType(type: PublicItem["type"]): ContentSection | null {
  if (type === "article") return "blog";
  if (type === "guide") return "guides";
  if (type === "glossary") return "glossary";
  return null;
}
