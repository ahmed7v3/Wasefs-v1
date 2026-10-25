import { t } from "@wasfa/shared/i18n";

import { mediaUrl } from "./content-api";
import { isProduction, publicEnv } from "./env";
import { alternates, localizedPath, ogLocale, type Locale } from "./locale";
import { INDEXABLE_ROBOTS, OG_IMAGE_SIZE } from "./seo";
import {
  LOGO_PATH,
  article,
  breadcrumbList,
  collectionPage,
  definedTerm,
  medicalWebPage,
  profilePage,
  type JsonLd,
} from "./structured-data";

import type { PublicImage, PublicItem, PublicTaxonomyPage } from "@wasfa/shared/schemas/content";
import type { Metadata } from "next";

/*
 * Metadata and JSON-LD for the content templates (SEO-GEO §5.5, §8). Metadata mirrors `pageMetadata`
 * (production-only robots, hreflang from the shared `alternates()` helper); the JSON-LD builders only
 * describe what the page shows and reuse the primitives in `structured-data.ts`.
 */

/** Section names for breadcrumbs; structured data is not UI copy but must match the visible trail. */
const SECTION_NAMES: Record<"blog" | "guides" | "glossary" | "authors", Record<Locale, string>> = {
  blog: { ar: "المدونة", en: "Blog" },
  guides: { ar: "الأدلة", en: "Guides" },
  glossary: { ar: "المصطلحات", en: "Glossary" },
  authors: { ar: "الكتّاب", en: "Authors" },
};

const abs = (path: string): string => new URL(path, publicEnv.NEXT_PUBLIC_SITE_URL).toString();

function imageHeight(image: PublicImage, width: number): number {
  return Math.round((width * image.height) / Math.max(image.width, 1));
}

/** The raster variant closest to the 1200 px Open Graph width (avif is skipped: social crawlers do not decode it). */
function ogImageFor(image: PublicImage | null | undefined) {
  if (!image) return null;
  const usable = image.variants.filter((variant) => variant.format !== "avif");
  const pool = usable.length > 0 ? usable : image.variants;
  const best = pool.reduce<(typeof pool)[number] | null>(
    (current, variant) =>
      current === null || Math.abs(variant.width - 1200) < Math.abs(current.width - 1200)
        ? variant
        : current,
    null,
  );
  if (!best) return null;
  const url = mediaUrl(best.key);
  if (!url) return null;
  return { url, width: best.width, height: imageHeight(image, best.width), alt: image.alt };
}

export interface ContentMetadataArgs {
  path: string;
  locale: Locale;
  title: string;
  description: string;
  robots: "index" | "noindex";
  canonical?: string | null;
  alternates: { ar: string | null; en: string | null };
  ogImage?: PublicImage | null;
  ogTitle?: string;
  ogDescription?: string;
  kind: "article" | "website" | "profile";
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  feedHref?: string;
}

export function contentMetadata(args: ContentMetadataArgs): Metadata {
  const brand = t("brand.name", undefined, args.locale);
  const canonical = args.canonical ? abs(args.canonical) : abs(args.path);
  const hreflang =
    args.alternates.ar && args.alternates.en
      ? alternates(args.alternates.ar, args.alternates.en)
      : null;
  const languages = hreflang
    ? { ar: abs(hreflang.ar), en: abs(hreflang.en), "x-default": abs(hreflang["x-default"]) }
    : undefined;
  const ogTitle = args.ogTitle || args.title;
  const ogDescription = args.ogDescription || args.description;
  const image = ogImageFor(args.ogImage);
  const images = image
    ? [image]
    : [{ url: abs("/og/home.png"), ...OG_IMAGE_SIZE, alt: args.title }];
  return {
    title: args.title,
    description: args.description,
    alternates: {
      canonical,
      ...(languages ? { languages } : {}),
      ...(args.feedHref ? { types: { "application/rss+xml": abs(args.feedHref) } } : {}),
    },
    openGraph: {
      type: args.kind,
      locale: ogLocale(args.locale),
      ...(hreflang ? { alternateLocale: [ogLocale(args.locale === "ar" ? "en" : "ar")] } : {}),
      siteName: brand,
      title: ogTitle,
      description: ogDescription,
      url: canonical,
      images,
      ...(args.kind === "article"
        ? {
            ...(args.publishedTime ? { publishedTime: args.publishedTime } : {}),
            ...(args.modifiedTime ? { modifiedTime: args.modifiedTime } : {}),
            ...(args.authors?.length ? { authors: args.authors } : {}),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: ogTitle,
      description: ogDescription,
      images: images.map((entry) => entry.url),
    },
    // Outside production the root layout noindex must stay in force (a page-level value replaces it).
    ...(isProduction
      ? { robots: args.robots === "index" ? INDEXABLE_ROBOTS : { index: false, follow: true } }
      : {}),
  };
}

export function contentBreadcrumbs(args: {
  locale: Locale;
  trail: { name: string; path: string }[];
}): { name: string; path: string }[] {
  return [
    { name: t("nav.home", undefined, args.locale), path: localizedPath("/", args.locale) },
    ...args.trail,
  ];
}

function crumbs(trail: readonly { name: string; path: string }[]): JsonLd {
  return breadcrumbList(trail.map((entry) => ({ name: entry.name, url: abs(entry.path) })));
}

function section(locale: Locale, key: keyof typeof SECTION_NAMES, prefix: string) {
  return { name: SECTION_NAMES[key][locale], path: localizedPath(prefix, locale) };
}

export function articleJsonLd(item: PublicItem): JsonLd[] {
  const { locale } = item;
  const url = abs(item.path);
  const image = item.image;
  const images = image
    ? image.variants
        // Google structured-data images must be a format its crawler decodes everywhere: no avif.
        .filter((variant) => variant.format !== "avif")
        .map((variant) => ({
          url: mediaUrl(variant.key),
          width: variant.width,
          height: imageHeight(image, variant.width),
        }))
        .filter((entry) => entry.url !== "")
    : [];
  const isGuide = item.type === "guide";
  const trail = contentBreadcrumbs({
    locale,
    trail: [
      isGuide ? section(locale, "guides", "/guides") : section(locale, "blog", "/blog"),
      ...(item.category ? [{ name: item.category.name, path: item.category.path }] : []),
      { name: item.title, path: item.path },
    ],
  });
  const description = item.seo.description || item.excerpt;
  return [
    article({
      type: item.type === "article" ? "BlogPosting" : "Article",
      headline: item.title,
      description,
      url,
      images,
      wordCount: item.wordCount,
      author: item.author
        ? { name: item.author.name, url: abs(item.author.path) }
        : { name: t("brand.name", undefined, locale) },
      datePublished: item.firstPublishedAt,
      dateModified: item.contentUpdatedAt,
      inLanguage: locale,
      publisher: { name: t("brand.name", undefined, locale), logoUrl: abs(LOGO_PATH) },
    }),
    ...(item.reviewer
      ? [
          medicalWebPage({
            name: item.title,
            url,
            description,
            inLanguage: locale,
            reviewedBy: { name: item.reviewer.name, url: abs(item.reviewer.path) },
            lastReviewed: item.reviewer.reviewedAt,
          }),
        ]
      : []),
    crumbs(trail),
  ];
}

export function glossaryJsonLd(item: PublicItem): JsonLd[] {
  const { locale } = item;
  const root = section(locale, "glossary", "/glossary");
  return [
    definedTerm({
      term: item.title,
      definition: item.definition || item.excerpt,
      url: abs(item.path),
      termSet: { name: root.name, url: abs(root.path) },
    }),
    crumbs(contentBreadcrumbs({ locale, trail: [root, { name: item.title, path: item.path }] })),
  ];
}

export function authorJsonLd(page: PublicTaxonomyPage): JsonLd[] {
  const locale: Locale = page.path === "/en" || page.path.startsWith("/en/") ? "en" : "ar";
  return [
    profilePage({
      url: abs(page.path),
      name: page.name,
      ...(page.person?.credentials ? { jobTitle: page.person.credentials } : {}),
      ...(page.person?.sameAs.length ? { sameAs: page.person.sameAs } : {}),
    }),
    crumbs(
      contentBreadcrumbs({
        locale,
        // No "Authors" crumb: there is no /authors index page, and the visible trail is Home › name.
        trail: [{ name: page.name, path: page.path }],
      }),
    ),
  ];
}

export function listJsonLd(args: {
  locale: Locale;
  name: string;
  path: string;
  trail: { name: string; path: string }[];
}): JsonLd[] {
  return [
    collectionPage({ name: args.name, url: abs(args.path), inLanguage: args.locale }),
    crumbs(contentBreadcrumbs({ locale: args.locale, trail: args.trail })),
  ];
}
