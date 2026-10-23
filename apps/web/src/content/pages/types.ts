/*
 * One shape for every layer-A product page (features, audiences) and trust page (SEO-GEO §4, §8,
 * §10). `components/marketing/product-page.tsx` renders it; the route files only pick the content.
 * Voice rules (AGENT.md §5.11): the product explains and never diagnoses or replaces a pharmacist
 * or doctor, uncertain lines are flagged, and no number, rating or certification is invented.
 */

export interface ProductPageSection {
  /** Anchor id; the heading's id is `<id>-title`. */
  id: string;
  heading: string;
  /** Paragraphs, each self-contained (retrieval lifts passages out of context). */
  body: string[];
  bullets?: string[];
}

export interface ProductPageFaq {
  q: string;
  a: string;
}

export interface ProductPageContent {
  meta: {
    /** Without the brand: the layout template appends it (the full title stays within 60 characters). */
    title: string;
    description: string;
  };
  hero: {
    eyebrow: string;
    h1: string;
    lead: string;
    /** Primary button; `href` is a locale-neutral path (`/register` is kept, marketing paths follow the page's locale). */
    cta: { label: string; href: string };
  };
  /** The direct answer, 40-60 words (GEO answer-first), shown right under the H1. */
  answer: string;
  sections: ProductPageSection[];
  /** 3-5 questions on product pages; empty on trust pages. */
  faq: ProductPageFaq[];
  /** Locale-neutral paths of related pages, shown as links (labels come from `ui.ts`). */
  related: string[];
  /** ISO date of the last real content change: `dateModified` and the visible "updated" date. */
  updatedAt: string;
}
