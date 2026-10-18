import { t } from "@wasfa/shared/i18n";

import type { Metadata, MetadataRoute } from "next";

/*
 * The public, indexable pages: one table feeds the sitemap, the canonical URL and the Open Graph
 * image of each page, so they cannot drift apart. `lastModified` is the date the page's content
 * last changed (bump it with the content), never `new Date()` per request.
 */

export const PUBLIC_PAGES = {
  home: {
    path: "/",
    lastModified: "2026-10-11",
    changeFrequency: "weekly",
    priority: 1,
    ogImage: "/og/home.png",
  },
  pricing: {
    path: "/pricing",
    lastModified: "2026-10-17",
    changeFrequency: "weekly",
    priority: 0.9,
    // A copy of the home card until `pnpm og:images` renders the pricing one (it is in the script).
    ogImage: "/og/pricing.png",
  },
  contact: {
    path: "/contact",
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.6,
    ogImage: "/og/contact.png",
  },
  privacy: {
    path: "/privacy",
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/privacy.png",
  },
  terms: {
    path: "/terms",
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/terms.png",
  },
  disclaimer: {
    path: "/disclaimer",
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/disclaimer.png",
  },
} as const satisfies Record<
  string,
  {
    path: string;
    lastModified: string;
    changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
    priority: number;
    ogImage: string;
  }
>;

export type PublicPageKey = keyof typeof PUBLIC_PAGES;

/** Size of every Open Graph image (`apps/web/scripts/og-images.mjs` renders them at this size). */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

export interface PageMetadataInput {
  /** The page title without the brand; omit on the home page to use the site default. */
  title?: string;
  description: string;
}

/**
 * Title, description, canonical URL, Open Graph and Twitter card for one public page. A page-level
 * `openGraph` replaces the layout's wholesale in Next.js, so the shared fields are repeated here.
 * Relative URLs resolve against `metadataBase`, so the canonical and the image are absolute.
 */
export function pageMetadata(
  key: PublicPageKey,
  { title, description }: PageMetadataInput,
): Metadata {
  const page = PUBLIC_PAGES[key];
  const brand = t("brand.name");
  const fullTitle = title ? `${title} | ${brand}` : t("meta.title");
  const images = [{ url: page.ogImage, ...OG_IMAGE_SIZE, alt: title ?? brand }];
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: page.path },
    openGraph: {
      type: "website",
      locale: "ar_AR",
      siteName: brand,
      title: fullTitle,
      description,
      url: page.path,
      images,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [page.ogImage] },
  };
}

/** The sitemap: every public page with its priority and last-change date. */
export function sitemapEntries(siteUrl: string): MetadataRoute.Sitemap {
  return Object.values(PUBLIC_PAGES).map((page) => ({
    url: new URL(page.path, siteUrl).toString(),
    lastModified: page.lastModified,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
