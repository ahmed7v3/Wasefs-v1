import { normalizeArabic } from "../normalize.js";

import {
  QUALITY_GATE_IDS,
  type ContentType,
  type GateLevel,
  type QualityGateId,
} from "./constants.js";
import { countWords } from "./text.js";

import type { ContentMeta, ContentPayload, QualityGate } from "../schemas/content.js";
import type { SettingValue } from "../settings.js";

/*
 * Quality gates (CONTENT-PLATFORM §6.2) as one pure function. Computed on every save so the editor
 * can show them live, and re-evaluated on schedule/publish where the `block` ones stop the action.
 * Database-wide facts (similarity, duplicate title, broken links, keyword owner) are gathered by the
 * API and passed in as `context`, which keeps this module testable without a database.
 */

export type QualitySettings = Pick<
  SettingValue<"content">,
  "minWords" | "duplicate" | "forbiddenPhrases" | "featuredMinWidth" | "dofollowDomains"
>;

export interface RenderFacts {
  headings: readonly { level: number; text: string }[];
  links: readonly { href: string; internal: boolean }[];
  images: readonly { alt: string; decorative: boolean }[];
  wordCount: number;
  /** Codes of the renderer's warnings; `h1_in_body` and `heading_skip` feed the headings gate. */
  warningCodes?: readonly string[] | undefined;
}

export interface QualityContext {
  /** Highest shingle similarity against published items of the same locale. */
  similarity: { score: number; matchPath: string | null } | null;
  titleDuplicate: boolean;
  descriptionDuplicate: boolean;
  /** Path of another URL that owns the focus keyword; `null` until the keyword map exists. */
  keywordOwnerPath: string | null;
  brokenInternalLinks: number;
  review: { required: boolean; approvedMatchesCurrent: boolean };
}

export interface QualityInput {
  type: ContentType;
  payload: Pick<ContentPayload, "title" | "excerpt" | "definition" | "bodyMd">;
  meta: Pick<ContentMeta, "slug" | "categoryId" | "primaryAuthorId" | "seo" | "flags">;
  /** The featured image when one is set; `hasAlt` is about the alt text in the content's locale. */
  featuredImage: { hasAlt: boolean; width: number } | null;
  render: RenderFacts;
  settings: QualitySettings;
  context: QualityContext;
}

const MIN_INTERNAL_LINKS = 2;
const MAX_AVERAGE_SENTENCE_WORDS = 28;
const MAX_PARAGRAPH_WORDS = 150;

/** Markdown and directive punctuation replaced by spaces, then the canonical Arabic spelling, lower-cased. */
export function plainForMatching(markdown: string): string {
  return normalizeArabic(markdown.replace(/[*_`~>#[\]()|!{}:]+/g, " ")).toLowerCase();
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Phrases that appear in `text` (both sides already normalised). Latin edges need a word boundary; Arabic prefixes attach to words, so they do not. */
export function findForbiddenPhrases(text: string, phrases: readonly string[]): string[] {
  const found: string[] = [];
  for (const phrase of phrases) {
    const needle = plainForMatching(phrase);
    if (needle === "") continue;
    const left = /^[a-z0-9]/.test(needle) ? "(?<![a-z0-9])" : "";
    const right = /[a-z0-9]$/.test(needle) ? "(?![a-z0-9])" : "";
    if (new RegExp(`${left}${escapeRegExp(needle)}${right}`).test(text)) found.push(phrase);
  }
  return found;
}

const ARABIC_DOSING =
  /(?:خذ|خذي|تناول|تناولي|استخدم|استخدمي)\s+(?:[\p{L}\p{M}]+\s+){0,3}?(?:\d+(?:[.,]\d+)?\s*(?:مجم|ملجم|ملغ|ملغم|حبه|حبات|حبوب|قرص|اقراص|مل)|حبتين|قرصين)(?![\p{L}])/gu;
const ENGLISH_DOSING =
  /\btake\s+(?:\w+\s+){0,2}?\d+(?:\.\d+)?\s*(?:mg|mcg|ml|tablets?|pills?|capsules?)\b/g;

/** How many sentences tell the reader to take a specific amount of a medicine. */
export function countPersonalDosing(text: string): number {
  return (text.match(ARABIC_DOSING)?.length ?? 0) + (text.match(ENGLISH_DOSING)?.length ?? 0);
}

function hostOf(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** `host` equals a listed domain or is a subdomain of one. */
export function hostInDomains(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => {
    const d = domain.toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
}

function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Paragraph and sentence sizes of the prose in a markdown body (headings, lists, tables and quotes skipped). */
function readabilityFacts(bodyMd: string): {
  avgSentenceWords: number;
  longestParagraphWords: number;
} {
  const paragraphs = bodyMd
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== "" && !/^(?:#|[-*+>|]|\d+[.)]|:::|\{\{|!\[)/.test(chunk));
  let longest = 0;
  let sentences = 0;
  let words = 0;
  for (const paragraph of paragraphs) {
    const count = countWords(paragraph);
    longest = Math.max(longest, count);
    for (const sentence of paragraph.split(/[.!?؟۔]+(?:\s|$)/)) {
      const n = countWords(sentence);
      if (n > 0) {
        sentences += 1;
        words += n;
      }
    }
  }
  return {
    avgSentenceWords: sentences === 0 ? 0 : round(words / sentences, 1),
    longestParagraphWords: longest,
  };
}

type Builder = (
  input: QualityInput,
) => { level: GateLevel; ok: boolean; params?: QualityGate["params"] } | null;

const isProse = (type: ContentType): boolean => type !== "page";

const BUILDERS: Record<QualityGateId, Builder> = {
  required_fields: ({ type, payload, meta, featuredImage }) => {
    const missing: string[] = [];
    if (payload.title.trim() === "") missing.push("title");
    if (meta.slug.trim() === "") missing.push("slug");
    if ((type === "article" || type === "guide") && payload.excerpt.trim() === "")
      missing.push("excerpt");
    if (type === "glossary" && payload.definition.trim() === "") missing.push("definition");
    if ((type === "article" || type === "guide") && meta.categoryId === null)
      missing.push("category");
    if (isProse(type) && meta.primaryAuthorId === null) missing.push("author");
    if (
      (type === "article" || type === "guide") &&
      (featuredImage === null || !featuredImage.hasAlt)
    ) {
      missing.push("featured_image");
    }
    if (meta.seo.description.trim() === "") missing.push("meta_description");
    return {
      level: "block",
      ok: missing.length === 0,
      params: { count: missing.length, missing: missing.join(",") },
    };
  },

  medical_review: ({ context }) =>
    context.review.required
      ? { level: "block", ok: context.review.approvedMatchesCurrent, params: {} }
      : null,

  min_words: ({ type, render, settings }) => {
    if (type === "page") return null;
    const min = settings.minWords[type];
    return {
      level: "block",
      ok: render.wordCount >= min,
      params: { words: render.wordCount, min },
    };
  },

  duplicate_content: ({ type, context, settings }) => {
    if (!isProse(type)) return null;
    const similarity = context.similarity;
    const score = similarity === null ? 0 : round(similarity.score);
    const params: QualityGate["params"] =
      similarity?.matchPath != null ? { score, matchPath: similarity.matchPath } : { score };
    if (score >= settings.duplicate.blockAt) return { level: "block", ok: false, params };
    if (score >= settings.duplicate.warnAt) return { level: "warn", ok: false, params };
    return { level: "block", ok: true, params };
  },

  title_unique: ({ context }) => ({ level: "block", ok: !context.titleDuplicate }),

  description_unique: ({ context }) => ({ level: "block", ok: !context.descriptionDuplicate }),

  keyword_ownership: ({ type, meta, context }) => {
    if (!isProse(type) || meta.seo.focusKeyword.trim() === "") return null;
    return context.keywordOwnerPath === null
      ? { level: "warn", ok: true, params: {} }
      : { level: "warn", ok: false, params: { ownerPath: context.keywordOwnerPath } };
  },

  headings: ({ type, render }) => {
    if (!isProse(type)) return null;
    const codes = render.warningCodes ?? [];
    let skipped = 0;
    let previous = 1;
    for (const heading of render.headings) {
      if (heading.level > previous + 1) skipped += 1;
      previous = heading.level;
    }
    const h1 = codes.includes("h1_in_body") ? 1 : 0;
    const skips = Math.max(skipped, codes.includes("heading_skip") ? 1 : 0);
    return { level: "warn", ok: h1 === 0 && skips === 0, params: { h1InBody: h1, skipped: skips } };
  },

  internal_links: ({ type, render }) => {
    if (type !== "article") return null;
    const count = new Set(render.links.filter((link) => link.internal).map((link) => link.href))
      .size;
    return {
      level: "warn",
      ok: count >= MIN_INTERNAL_LINKS,
      params: { count, min: MIN_INTERNAL_LINKS },
    };
  },

  broken_links: ({ context }) => ({
    level: "warn",
    ok: context.brokenInternalLinks === 0,
    params: { count: context.brokenInternalLinks },
  }),

  external_sources: ({ type, render, settings }) => {
    if (type !== "article" && type !== "guide") return null;
    const external = render.links.filter((link) => !link.internal && hostOf(link.href) !== null);
    const trusted = external.filter((link) => {
      const host = hostOf(link.href);
      return host !== null && hostInDomains(host, settings.dofollowDomains);
    });
    return {
      level: "warn",
      ok: trusted.length > 0,
      params: { trusted: trusted.length, external: external.length },
    };
  },

  image_alt: ({ featuredImage, render }) => {
    const bodyImages = render.images.filter((image) => !image.decorative);
    if (featuredImage === null && bodyImages.length === 0) return null;
    const missing =
      bodyImages.filter((image) => image.alt.trim() === "").length +
      (featuredImage !== null && !featuredImage.hasAlt ? 1 : 0);
    return { level: "block", ok: missing === 0, params: { missing } };
  },

  image_size: ({ featuredImage, settings }) =>
    featuredImage === null
      ? null
      : {
          level: "warn",
          ok: featuredImage.width >= settings.featuredMinWidth,
          params: { width: featuredImage.width, min: settings.featuredMinWidth },
        },

  forbidden_claims: ({ payload, settings }) => {
    const text = plainForMatching(
      [payload.title, payload.excerpt, payload.definition, payload.bodyMd].join("\n\n"),
    );
    const found = findForbiddenPhrases(text, settings.forbiddenPhrases);
    return {
      level: "block",
      ok: found.length === 0,
      params: { count: found.length, first: found[0] ?? "" },
    };
  },

  personal_dosing: ({ type, payload }) => {
    if (!isProse(type)) return null;
    const matches = countPersonalDosing(plainForMatching(payload.bodyMd));
    return { level: "warn", ok: matches === 0, params: { matches } };
  },

  readability: ({ type, payload }) => {
    if (type !== "article" && type !== "guide") return null;
    const facts = readabilityFacts(payload.bodyMd);
    return {
      level: "info",
      ok:
        facts.avgSentenceWords <= MAX_AVERAGE_SENTENCE_WORDS &&
        facts.longestParagraphWords <= MAX_PARAGRAPH_WORDS,
      params: {
        avgSentenceWords: facts.avgSentenceWords,
        longestParagraphWords: facts.longestParagraphWords,
      },
    };
  },
};

/** One entry per applicable gate, in `QUALITY_GATE_IDS` order. */
export function evaluateGates(input: QualityInput): QualityGate[] {
  const gates: QualityGate[] = [];
  for (const id of QUALITY_GATE_IDS) {
    const result = BUILDERS[id](input);
    if (result !== null)
      gates.push({ id, level: result.level, ok: result.ok, params: result.params ?? {} });
  }
  return gates;
}

/** A failing `block` gate stops schedule/publish. */
export function hasBlockingIssues(gates: readonly QualityGate[]): boolean {
  return gates.some((gate) => gate.level === "block" && !gate.ok);
}

/** Counts shown in the admin list. */
export function gateIssueCounts(gates: readonly QualityGate[]): { block: number; warn: number } {
  return {
    block: gates.filter((gate) => gate.level === "block" && !gate.ok).length,
    warn: gates.filter((gate) => gate.level === "warn" && !gate.ok).length,
  };
}
