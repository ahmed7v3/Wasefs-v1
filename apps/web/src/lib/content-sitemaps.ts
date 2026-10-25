import "server-only";

import { getSitemapPage, mediaUrl, type SitemapKind } from "./content-api";
import { alternates, type Locale } from "./locale";
import { MAX_URLS_PER_SITEMAP, type SitemapUrl } from "./sitemap-xml";

import type { publicSitemapResponseSchema } from "@wasfa/shared/schemas/content";
import type { z } from "zod";

/*
 * Content sitemaps (SEO-GEO §5.4): every file merges both locales, carries the reciprocal hreflang
 * set where a twin exists, and `lastmod` is the API real content change time. Built from the cached
 * `getSitemapPage` reads, so a publish refreshes them by tag.
 */

type ApiUrl = z.output<typeof publicSitemapResponseSchema>["urls"][number];

/** Hard stop on pages per kind and locale (20 x 10,000 URLs is far beyond any plan). */
export const MAX_SITEMAP_PAGES = 20;

export const CONTENT_SITEMAP_FILES = {
  guides: { file: "sitemap-guides.xml", kinds: ["guide"] },
  glossary: { file: "sitemap-glossary.xml", kinds: ["glossary"] },
  authors: { file: "sitemap-authors.xml", kinds: ["author"] },
  taxonomy: { file: "sitemap-taxonomy.xml", kinds: ["category", "tag"] },
} as const satisfies Record<string, { file: string; kinds: readonly SitemapKind[] }>;

export type ContentSitemapKey = keyof typeof CONTENT_SITEMAP_FILES;

export const articleSitemapFile = (n: number): string => `sitemap-articles-${String(n)}.xml`;

export function toSitemapUrl(entry: ApiUrl, siteUrl: string): SitemapUrl {
  const abs = (path: string): string => new URL(path, siteUrl).toString();
  // The API sends an absolute URL or a media key; a key needs the media origin.
  const imageUrl = entry.image
    ? /^https?:\/\//.test(entry.image.url)
      ? entry.image.url
      : mediaUrl(entry.image.url)
    : "";
  const pair = entry.alternates.ar && entry.alternates.en ? entry.alternates : null;
  const hreflang = pair ? alternates(pair.ar ?? "", pair.en) : null;
  return {
    url: abs(entry.path),
    lastModified: entry.lastmod,
    ...(hreflang
      ? {
          alternates: {
            ar: abs(hreflang.ar),
            en: abs(hreflang.en),
            "x-default": abs(hreflang["x-default"]),
          },
        }
      : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
  };
}

async function allPages(kind: SitemapKind, locale: Locale): Promise<ApiUrl[]> {
  const urls: ApiUrl[] = [];
  for (let page = 1; page <= MAX_SITEMAP_PAGES; page += 1) {
    const response = await getSitemapPage(kind, locale, page);
    urls.push(...response.urls);
    if (!response.hasMore) break;
  }
  return urls;
}

/** Every URL of `kinds` in both locales, de-duplicated by path and ordered by path (stable chunks). */
export async function collectContentUrls(
  kinds: readonly SitemapKind[],
  siteUrl: string,
): Promise<SitemapUrl[]> {
  const batches = await Promise.all(
    kinds.flatMap((kind) => (["ar", "en"] as const).map((locale) => allPages(kind, locale))),
  );
  const byPath = new Map<string, ApiUrl>();
  for (const entry of batches.flat()) byPath.set(entry.path, entry);
  return [...byPath.values()]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => toSitemapUrl(entry, siteUrl));
}

export function newestLastModified(urls: readonly SitemapUrl[]): string {
  return urls.reduce(
    (latest, entry) => (entry.lastModified > latest ? entry.lastModified : latest),
    "",
  );
}

/** The children to add to `/sitemap.xml`: articles chunked by the per-file cap, others only when non-empty. */
export async function contentIndexChildren(
  siteUrl: string,
): Promise<{ file: string; lastModified: string }[]> {
  const [articles, ...others] = await Promise.all([
    collectContentUrls(["article"], siteUrl),
    ...Object.values(CONTENT_SITEMAP_FILES).map((entry) =>
      collectContentUrls(entry.kinds, siteUrl),
    ),
  ]);
  const children: { file: string; lastModified: string }[] = [];
  for (
    let start = 0, n = 1;
    start < (articles?.length ?? 0);
    start += MAX_URLS_PER_SITEMAP, n += 1
  ) {
    children.push({
      file: articleSitemapFile(n),
      lastModified: newestLastModified((articles ?? []).slice(start, start + MAX_URLS_PER_SITEMAP)),
    });
  }
  Object.values(CONTENT_SITEMAP_FILES).forEach((entry, index) => {
    const urls = others[index] ?? [];
    if (urls.length > 0)
      children.push({ file: entry.file, lastModified: newestLastModified(urls) });
  });
  return children;
}

/** File `n` (1-based) of the article sitemap; `null` past the end (a 404), an empty set only for n = 1. */
export async function articleSitemapChunk(
  n: number,
  siteUrl: string,
): Promise<SitemapUrl[] | null> {
  const all = await collectContentUrls(["article"], siteUrl);
  const start = (n - 1) * MAX_URLS_PER_SITEMAP;
  if (n > 1 && start >= all.length) return null;
  return all.slice(start, start + MAX_URLS_PER_SITEMAP);
}

export async function contentSitemapUrls(
  key: ContentSitemapKey,
  siteUrl: string,
): Promise<SitemapUrl[]> {
  // Truncated rather than failing the file: a 500 would hide every URL in it from crawlers.
  return (await collectContentUrls(CONTENT_SITEMAP_FILES[key].kinds, siteUrl)).slice(
    0,
    MAX_URLS_PER_SITEMAP,
  );
}
