import { countWords, slugify } from "@wasfa/shared/content";

import {
  containsNormalized,
  countEntityLinks,
  extractHeadings,
  extractImages,
  extractLinks,
  firstWords,
  readabilityFacts,
} from "./markdown-facts";
import {
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
  codePointLength,
} from "./snippet";

import type { ContentType } from "@wasfa/shared/content/constants";
import type { QualityGate } from "@wasfa/shared/schemas/content";

/*
 * The per-page SEO checklist (SEO-GEO §7.1, CONTENT-PLATFORM §8.3) as pure functions of the
 * Markdown and the metadata. Each item is `pass` or `improve` with the numbers its message needs;
 * there is deliberately NO combined score (a number to chase invites keyword stuffing). Items that do
 * not apply (a keyword check without a keyword, internal links on a glossary entry) are left out.
 */

export const CHECKLIST_IDS = [
  "focus_keyword",
  "keyword_title",
  "keyword_intro",
  "keyword_h2",
  "keyword_slug",
  "keyword_description",
  "meta_title",
  "meta_description",
  "headings",
  "internal_links",
  "image_alts",
  "length",
  "duplicate",
  "unique_meta",
  "readability",
] as const;
export type ChecklistId = (typeof CHECKLIST_IDS)[number];

export interface ChecklistItem {
  id: ChecklistId;
  status: "pass" | "improve";
  params: Record<string, string | number>;
}

export interface ChecklistInput {
  type: ContentType;
  title: string;
  bodyMd: string;
  slug: string;
  seo: { title: string; description: string; focusKeyword: string };
  /** `true` when a featured image is set but has no alt text in this locale; null = no featured image. */
  featuredAltMissing: boolean | null;
  /** The gates of the last server evaluation (similarity and uniqueness need the whole database). */
  gates: readonly QualityGate[];
  minWords: Record<"article" | "guide" | "glossary", number>;
}

export const DEFAULT_MIN_WORDS = { article: 600, guide: 1_200, glossary: 80 } as const;

const KEYWORD_INTRO_WORDS = 100;
const MIN_INTERNAL_LINKS = 2;
const MAX_AVG_SENTENCE_WORDS = 28;
const MAX_PARAGRAPH_WORDS = 150;

const item = (
  id: ChecklistId,
  ok: boolean,
  params: Record<string, string | number> = {},
): ChecklistItem => ({ id, status: ok ? "pass" : "improve", params });

function slugCoversKeyword(slug: string, keyword: string): boolean {
  const wanted = slugify(keyword);
  if (wanted === "") return false;
  const have = new Set(slug.split("-"));
  return wanted.split("-").every((word) => have.has(word));
}

export function seoChecklist(input: ChecklistInput): ChecklistItem[] {
  const { type, bodyMd, seo } = input;
  const keyword = seo.focusKeyword.trim();
  const effectiveTitle = seo.title.trim() || input.title.trim();
  const headings = extractHeadings(bodyMd);
  const words = countWords(bodyMd);
  const items: ChecklistItem[] = [];
  const isProse = type !== "page";

  if (isProse) {
    items.push(item("focus_keyword", keyword !== ""));
    if (keyword !== "") {
      items.push(item("keyword_title", containsNormalized(effectiveTitle, keyword)));
      items.push(
        item(
          "keyword_intro",
          containsNormalized(firstWords(bodyMd, KEYWORD_INTRO_WORDS), keyword),
          { words: KEYWORD_INTRO_WORDS },
        ),
      );
      items.push(
        item(
          "keyword_h2",
          headings.some((h) => h.level === 2 && containsNormalized(h.text, keyword)),
        ),
      );
      if (slugify(keyword) !== "") {
        items.push(item("keyword_slug", slugCoversKeyword(input.slug, keyword)));
      }
      items.push(item("keyword_description", containsNormalized(seo.description, keyword)));
    }
  }

  const titleLength = codePointLength(effectiveTitle);
  items.push(
    item("meta_title", titleLength > 0 && titleLength <= SEO_TITLE_MAX, {
      length: titleLength,
      max: SEO_TITLE_MAX,
    }),
  );
  const descriptionLength = codePointLength(seo.description.trim());
  items.push(
    item(
      "meta_description",
      descriptionLength >= SEO_DESCRIPTION_MIN && descriptionLength <= SEO_DESCRIPTION_MAX,
      { length: descriptionLength, min: SEO_DESCRIPTION_MIN, max: SEO_DESCRIPTION_MAX },
    ),
  );

  if (isProse) {
    let previous = 1;
    let skipped = 0;
    for (const heading of headings) {
      if (heading.level > previous + 1) skipped += 1;
      previous = heading.level;
    }
    const h1 = headings.filter((h) => h.level === 1).length;
    const h2 = headings.filter((h) => h.level === 2).length;
    const needsH2 = words >= 300 && h2 === 0;
    items.push(
      item("headings", h1 === 0 && skipped === 0 && !needsH2, {
        h1InBody: h1,
        skipped,
        h2,
      }),
    );
  }

  if (type === "article") {
    const hrefs = new Set(
      extractLinks(bodyMd)
        .filter((link) => link.internal)
        .map((link) => link.href),
    );
    const count = hrefs.size + countEntityLinks(bodyMd);
    items.push(
      item("internal_links", count >= MIN_INTERNAL_LINKS, { count, min: MIN_INTERNAL_LINKS }),
    );
  }

  const images = extractImages(bodyMd);
  const missingAlt =
    images.filter((image) => image.alt === "").length + (input.featuredAltMissing === true ? 1 : 0);
  if (images.length > 0 || input.featuredAltMissing !== null) {
    items.push(item("image_alts", missingAlt === 0, { missing: missingAlt }));
  }

  if (type === "article" || type === "guide" || type === "glossary") {
    const min = input.minWords[type];
    items.push(item("length", words >= min, { words, min }));
  }

  const duplicate = input.gates.find((gate) => gate.id === "duplicate_content");
  if (duplicate) {
    items.push(
      item("duplicate", duplicate.ok, {
        score: Number(duplicate.params["score"] ?? 0),
        ...(typeof duplicate.params["matchPath"] === "string"
          ? { matchPath: duplicate.params["matchPath"] }
          : {}),
      }),
    );
  }
  const titleUnique = input.gates.find((gate) => gate.id === "title_unique");
  const descriptionUnique = input.gates.find((gate) => gate.id === "description_unique");
  if (titleUnique || descriptionUnique) {
    items.push(
      item("unique_meta", (titleUnique?.ok ?? true) && (descriptionUnique?.ok ?? true), {
        title: titleUnique?.ok === false ? 1 : 0,
        description: descriptionUnique?.ok === false ? 1 : 0,
      }),
    );
  }

  if (type === "article" || type === "guide") {
    const facts = readabilityFacts(bodyMd);
    items.push(
      item(
        "readability",
        facts.avgSentenceWords <= MAX_AVG_SENTENCE_WORDS &&
          facts.longestParagraphWords <= MAX_PARAGRAPH_WORDS,
        {
          avgSentenceWords: facts.avgSentenceWords,
          longestParagraphWords: facts.longestParagraphWords,
        },
      ),
    );
  }

  return items;
}
