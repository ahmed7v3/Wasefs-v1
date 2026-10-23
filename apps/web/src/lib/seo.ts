import { t } from "@wasfa/shared/i18n";

import { isProduction } from "./env";
import { alternates, ogLocale, type Locale } from "./locale";

import type { Metadata, MetadataRoute } from "next";

/*
 * The public, indexable pages: one table feeds the sitemap, the canonical URL and the Open Graph
 * image of each page, so they cannot drift apart. `lastModified` is the date the page's content
 * last changed (bump it with the content), never `new Date()` per request.
 */

export const PUBLIC_PAGES = {
  home: {
    path: "/",
    /** The English counterpart, or `null` while the page is Arabic only (no hreflang then). */
    pathEn: "/en",
    lastModified: "2026-10-11",
    changeFrequency: "weekly",
    priority: 1,
    ogImage: "/og/home.png",
  },
  pricing: {
    path: "/pricing",
    pathEn: "/en/pricing",
    lastModified: "2026-10-17",
    changeFrequency: "weekly",
    priority: 0.9,
    // A copy of the home card until `pnpm og:images` renders the pricing one (it is in the script).
    ogImage: "/og/pricing.png",
  },
  contact: {
    path: "/contact",
    pathEn: "/en/contact",
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.6,
    ogImage: "/og/contact.png",
  },
  privacy: {
    path: "/privacy",
    pathEn: null,
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/privacy.png",
  },
  terms: {
    path: "/terms",
    pathEn: null,
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/terms.png",
  },
  disclaimer: {
    path: "/disclaimer",
    pathEn: null,
    lastModified: "2026-10-11",
    changeFrequency: "yearly",
    priority: 0.4,
    ogImage: "/og/disclaimer.png",
  },
} as const satisfies Record<
  string,
  {
    path: string;
    pathEn: string | null;
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
 * Production pages are indexable with full-size previews (SEO-GEO §5.2). Outside production the
 * root layout's `noindex` stays in force: a page-level `robots` would replace it.
 */
export const INDEXABLE_ROBOTS = {
  index: true,
  follow: true,
  googleBot: { "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
} as const satisfies NonNullable<Metadata["robots"]>;

/**
 * Title, description, canonical URL, hreflang, Open Graph and Twitter card for one public page in
 * `locale`. A page-level `openGraph` replaces the layout's wholesale in Next.js, so the shared
 * fields are repeated here. Relative URLs resolve against `metadataBase`, so the canonical and the
 * image are absolute. Pages with no counterpart in the other language carry no hreflang.
 */
export function pageMetadata(
  key: PublicPageKey,
  { title, description }: PageMetadataInput,
  locale: Locale = "ar",
): Metadata {
  const page = PUBLIC_PAGES[key];
  const brand = t("brand.name", undefined, locale);
  const fullTitle = title ? `${title} | ${brand}` : t("meta.title", undefined, locale);
  const path = pagePath(key, locale);
  const languages = alternates(page.path, page.pathEn);
  const images = [{ url: page.ogImage, ...OG_IMAGE_SIZE, alt: title ?? brand }];
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path, ...(languages ? { languages } : {}) },
    openGraph: {
      type: "website",
      locale: ogLocale(locale),
      ...(languages ? { alternateLocale: [ogLocale(locale === "ar" ? "en" : "ar")] } : {}),
      siteName: brand,
      title: fullTitle,
      description,
      url: path,
      images,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description, images: [page.ogImage] },
    ...(isProduction ? { robots: INDEXABLE_ROBOTS } : {}),
  };
}

/** The path of a public page in `locale`; the Arabic path while the page has no English version. */
export function pagePath(key: PublicPageKey, locale: Locale): string {
  const page = PUBLIC_PAGES[key];
  return locale === "en" && page.pathEn !== null ? page.pathEn : page.path;
}
