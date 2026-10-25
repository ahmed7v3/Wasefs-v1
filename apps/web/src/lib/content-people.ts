import type { Person, PersonInput } from "@wasfa/shared/schemas/content";

/*
 * Helpers of the people screen: the plain-text excerpt the public profile card shows, the request body
 * of a person (for toggles that change one field), and the https-only check of the sameAs list editor.
 */

/** Markdown reduced to plain text and cut at `max` characters on a word boundary, ending with «…». */
export function plainExcerpt(markdown: string, max = 180): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The `PersonInput` of an existing person with some fields changed (the API takes the whole input). */
export function personBody(person: Person, changes: Partial<PersonInput> = {}): PersonInput {
  return {
    slug: person.slug,
    nameAr: person.nameAr,
    nameEn: person.nameEn,
    role: person.role,
    credentialsAr: person.credentialsAr,
    credentialsEn: person.credentialsEn,
    licenceNumber: person.licenceNumber,
    showLicence: person.showLicence,
    bioMdAr: person.bioMdAr,
    bioMdEn: person.bioMdEn,
    photoMediaId: person.photoMediaId,
    sameAs: person.sameAs,
    userId: person.userId,
    active: person.active,
    ...changes,
  };
}

/** True for an absolute https URL (the only scheme a sameAs link may use). */
export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}
