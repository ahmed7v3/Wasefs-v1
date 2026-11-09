import type { QualityGateId } from "@wasfa/shared/content/constants";
import type { QualityGate } from "@wasfa/shared/schemas/content";
import type { PublishingQualityIssue } from "@wasfa/shared/schemas/publishing";

/*
 * Quality gates as an integrator reads them: a code and one actionable English sentence (an AI agent
 * acts on it; the Arabic labels live in the admin UI). `blocking` are failing gates that stop
 * publishing; everything else failing is a warning. The review gate is not something a writer can fix,
 * so it is reported as a warning ("awaiting a reviewer") rather than as a blocking item to fix.
 */

type Params = QualityGate["params"];
const str = (params: Params, key: string): string => String(params[key] ?? "");

const MESSAGES: Record<QualityGateId, (params: Params) => string> = {
  required_fields: (p) =>
    `Missing required fields: ${str(p, "missing").split(",").join(", ")}. (featured_image = featured_media_id with alt text; meta_description = seo.description.)`,
  medical_review: () =>
    "Awaiting a human reviewer's approval of this exact revision (expected for medical categories).",
  min_words: (p) =>
    `Too short: ${str(p, "words")} words, the minimum for this type is ${str(p, "min")}. Add substantive content, not filler.`,
  duplicate_content: (p) =>
    `The body is too similar to a published page (similarity ${str(p, "score")}). Write original content.`,
  title_unique: () =>
    "Another item of this type has an almost identical title. Use a distinct title.",
  description_unique: () =>
    "seo.description is identical to another page's. Write a unique description.",
  keyword_ownership: () =>
    "Another page already targets this focus keyword (cannibalisation risk).",
  headings: () =>
    "Heading structure: do not put an H1 in the body (the title is the H1) and do not skip levels (H2 then H4).",
  internal_links: (p) =>
    `Only ${str(p, "count")} internal links, at least ${str(p, "min")} recommended (link to related Wasfa pages).`,
  broken_links: (p) => `${str(p, "count")} internal link(s) point to pages that do not exist.`,
  external_sources: () =>
    "No link to a trusted source domain (WHO, NIH, FDA, ...). Add real, reachable sources.",
  image_alt: (p) =>
    `${str(p, "missing")} image(s) lack alt text. Set alt on the media (PATCH /media/{id}).`,
  image_size: (p) =>
    `The featured image is ${str(p, "width")} px wide, ${str(p, "min")} px or more is recommended.`,
  forbidden_claims: (p) =>
    `The text contains a forbidden claim (first: "${str(p, "first")}"). Remove miracle, guaranteed or cure wording.`,
  personal_dosing: (p) =>
    `${str(p, "matches")} sentence(s) tell the reader to take a specific dose. Educational text must not give personal dosing.`,
  readability: () => "Sentences or paragraphs are long: shorten them.",
};

export function describeGate(gate: QualityGate): PublishingQualityIssue {
  return {
    code: gate.id,
    message: MESSAGES[gate.id](gate.params),
    ...(Object.keys(gate.params).length > 0 ? { params: gate.params } : {}),
  };
}

export function qualityOf(gates: readonly QualityGate[]): {
  blocking: PublishingQualityIssue[];
  warnings: PublishingQualityIssue[];
} {
  const failing = gates.filter((gate) => !gate.ok && gate.level !== "info");
  return {
    blocking: failing
      .filter((gate) => gate.level === "block" && gate.id !== "medical_review")
      .map(describeGate),
    warnings: failing
      .filter((gate) => gate.level !== "block" || gate.id === "medical_review")
      .map(describeGate),
  };
}

const PREFIX_TO_TYPE = new Map<string, "article" | "guide" | "glossary">([
  ["blog", "article"],
  ["guides", "guide"],
  ["glossary", "glossary"],
]);

/** `/en/blog/my-slug` -> its type, locale and slug (the duplicate gate reports the matching page's path). */
export function parseContentPath(
  path: string,
): { type: "article" | "guide" | "glossary"; locale: "ar" | "en"; slug: string } | null {
  const match = /^(\/en)?\/(blog|guides|glossary)\/([^/?#]+)$/.exec(path);
  const type = match?.[2] === undefined ? undefined : PREFIX_TO_TYPE.get(match[2]);
  if (match?.[3] === undefined || type === undefined) return null;
  return { type, locale: match[1] === undefined ? "ar" : "en", slug: match[3] };
}
