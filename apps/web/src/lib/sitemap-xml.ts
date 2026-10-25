import { alternates } from "./locale";
import { PUBLIC_PAGES } from "./seo";

/*
 * Sitemap index + child sitemaps (SEO-GEO §5.4). `generateSitemaps()` in Next 16 serves children at
 * `/sitemap/<id>.xml` and no index at `/sitemap.xml`, so the XML is built here and served by route
 * handlers. Pure string builders; every dynamic value is XML-escaped.
 */

/** Protocol allows 50,000; we cap lower so regeneration stays fast. */
export const MAX_URLS_PER_SITEMAP = 10_000;

export interface SitemapUrl {
  url: string;
  /** ISO date or datetime of the real content change. */
  lastModified: string;
  changeFrequency?: string;
  priority?: number;
  /** hreflang → absolute URL; listed on every version of the page. */
  alternates?: Record<string, string>;
  /** Absolute URL of the featured image (`<image:image>`), articles only. */
  image?: string;
}

export interface SitemapChild {
  /** File name served at the site root, e.g. `sitemap-pages.xml`. */
  file: string;
  urls: (siteUrl: string) => SitemapUrl[];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

export function buildUrlset(urls: readonly SitemapUrl[]): string {
  if (urls.length > MAX_URLS_PER_SITEMAP) {
    throw new Error(`A sitemap holds at most ${MAX_URLS_PER_SITEMAP} URLs`);
  }
  const body = urls.map((entry) => {
    const links = Object.entries(entry.alternates ?? {}).map(
      ([lang, href]) =>
        `<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(href)}"/>`,
    );
    return [
      "<url>",
      `<loc>${escapeXml(entry.url)}</loc>`,
      `<lastmod>${escapeXml(entry.lastModified)}</lastmod>`,
      ...(entry.changeFrequency
        ? [`<changefreq>${escapeXml(entry.changeFrequency)}</changefreq>`]
        : []),
      ...(entry.priority === undefined
        ? []
        : [`<priority>${entry.priority.toFixed(1)}</priority>`]),
      ...links,
      ...(entry.image
        ? [`<image:image><image:loc>${escapeXml(entry.image)}</image:loc></image:image>`]
        : []),
      "</url>",
    ].join("");
  });
  return `${XML_HEADER}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body.join("")}</urlset>`;
}

export function buildSitemapIndex(
  children: readonly { loc: string; lastModified: string }[],
): string {
  const body = children.map(
    (child) =>
      `<sitemap><loc>${escapeXml(child.loc)}</loc><lastmod>${escapeXml(child.lastModified)}</lastmod></sitemap>`,
  );
  return `${XML_HEADER}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body.join("")}</sitemapindex>`;
}

/** Both language versions of every public page, each carrying the full hreflang set. */
export function pageSitemapUrls(siteUrl: string): SitemapUrl[] {
  const abs = (path: string): string => new URL(path, siteUrl).toString();
  return Object.values(PUBLIC_PAGES).flatMap((page) => {
    const alts = alternates(page.path, page.pathEn);
    const hreflang = alts
      ? { ar: abs(alts.ar), en: abs(alts.en), "x-default": abs(alts["x-default"]) }
      : undefined;
    const base = {
      lastModified: page.lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
      ...(hreflang ? { alternates: hreflang } : {}),
    };
    return [
      { url: abs(page.path), ...base },
      ...(page.pathEn ? [{ url: abs(page.pathEn), ...base }] : []),
    ];
  });
}

/** Static children; the content-platform children are built from the API in `content-sitemaps.ts`. */
export const SITEMAP_CHILDREN: readonly SitemapChild[] = [
  { file: "sitemap-pages.xml", urls: pageSitemapUrls },
];

/** `extra` are the content children, which need the API and so are resolved by the route (`content-sitemaps.ts`). */
export function sitemapIndexFor(
  siteUrl: string,
  extra: readonly { file: string; lastModified: string }[] = [],
): string {
  return buildSitemapIndex([
    ...SITEMAP_CHILDREN.map((child) => ({
      loc: new URL(`/${child.file}`, siteUrl).toString(),
      lastModified: child
        .urls(siteUrl)
        .reduce((latest, entry) => (entry.lastModified > latest ? entry.lastModified : latest), ""),
    })),
    ...extra.map((child) => ({
      loc: new URL(`/${child.file}`, siteUrl).toString(),
      lastModified: child.lastModified,
    })),
  ]);
}

export const SITEMAP_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
} as const;
