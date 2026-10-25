import { contentPath } from "@wasfa/shared/content";

import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";

/*
 * An APPROXIMATE preview of the JSON-LD the public page will emit (SEO-GEO §8), built from what the
 * editor already knows. The real graph is produced server-side from the published revision; this only
 * lets the editor see which fields are missing (no description, no author). Read-only, never submitted.
 */

export interface StructuredDataInput {
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  title: string;
  excerpt: string;
  definition: string;
  seoTitle: string;
  seoDescription: string;
  /** ISO instants; null while not published. */
  publishedAt: string | null;
  updatedAt: string | null;
  author: { name: string; slug: string } | null;
  reviewer: { name: string; slug: string } | null;
  /** The live page path when known (a renamed slug keeps the live path until republished). */
  publicPath: string | null;
  featuredMediaId: string | null;
  origin: string;
}

const HEADLINE_MAX = 110;

const cut = (text: string, max: number): string => {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, max).join("");
};

export function buildStructuredData(input: StructuredDataInput): Record<string, unknown> {
  const origin = input.origin.replace(/\/+$/, "");
  const path =
    input.publicPath ?? (input.slug ? contentPath(input.type, input.locale, input.slug) : "/");
  const url = `${origin}${path}`;
  const description = input.seoDescription || input.excerpt || input.definition;
  const person = (who: { name: string; slug: string }) => ({
    "@type": "Person",
    name: who.name,
    url: `${origin}${input.locale === "en" ? "/en" : ""}/authors/${who.slug}`,
  });

  if (input.type === "glossary") {
    return {
      "@context": "https://schema.org",
      "@type": "DefinedTerm",
      name: input.title,
      description: input.definition || description,
      inLanguage: input.locale,
      url,
    };
  }
  if (input.type === "page") {
    return {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: input.seoTitle || input.title,
      description,
      inLanguage: input.locale,
      url,
    };
  }
  return {
    "@context": "https://schema.org",
    "@type": input.type === "article" ? "BlogPosting" : "Article",
    headline: cut(input.seoTitle || input.title, HEADLINE_MAX),
    description,
    inLanguage: input.locale,
    mainEntityOfPage: url,
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    ...(input.updatedAt ? { dateModified: input.updatedAt } : {}),
    ...(input.author ? { author: person(input.author) } : {}),
    ...(input.reviewer ? { reviewedBy: person(input.reviewer) } : {}),
    ...(input.featuredMediaId ? { image: ["<featured image URL>"] } : {}),
    publisher: { "@type": "Organization", name: "Wasfa", url: origin },
  };
}
