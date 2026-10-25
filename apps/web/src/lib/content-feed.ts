import "server-only";

import { t } from "@wasfa/shared/i18n";

import { mediaUrl } from "./content-api";
import { localizedPath, type Locale } from "./locale";
import { escapeXml } from "./sitemap-xml";

import type { PublicItemCard } from "@wasfa/shared/schemas/content";

/*
 * RSS 2.0 for the blog (SEO-GEO §5.4): `/blog/feed.xml` and `/en/blog/feed.xml`, the latest 50 articles
 * with the excerpt as summary and the featured image. Pure string builder; every dynamic value is
 * XML-escaped, so a title with `&` or `<` cannot break the document.
 */

export const FEED_MAX_ITEMS = 50;
export const FEED_PATH = { ar: "/blog/feed.xml", en: "/en/blog/feed.xml" } as const;

const MIME = { avif: "image/avif", webp: "image/webp", jpeg: "image/jpeg" } as const;
const BLOG_NAME: Record<Locale, string> = { ar: "المدونة", en: "Blog" };

function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

function imageParts(card: PublicItemCard): string {
  const variants = card.image?.variants.filter((variant) => variant.format !== "avif") ?? [];
  if (variants.length === 0) return "";
  const sorted = [...variants].sort((a, b) => a.width - b.width);
  // Largest variant up to 1280 px for the enclosure, the first one >= 480 px as the thumbnail.
  const big = [...sorted].reverse().find((variant) => variant.width <= 1280) ?? sorted[0];
  const thumb = sorted.find((variant) => variant.width >= 480) ?? sorted[0];
  const parts: string[] = [];
  if (big && mediaUrl(big.key)) {
    parts.push(
      `<enclosure url="${escapeXml(mediaUrl(big.key))}" length="${String(big.bytes)}" type="${MIME[big.format]}"/>`,
    );
  }
  if (thumb && mediaUrl(thumb.key)) {
    parts.push(
      `<media:thumbnail url="${escapeXml(mediaUrl(thumb.key))}" width="${String(thumb.width)}"/>`,
    );
  }
  return parts.join("");
}

export function buildRss(args: {
  locale: Locale;
  items: readonly PublicItemCard[];
  siteUrl: string;
}): string {
  const { locale, siteUrl } = args;
  const abs = (path: string): string => new URL(path, siteUrl).toString();
  const items = args.items.slice(0, FEED_MAX_ITEMS);
  const brand = t("brand.name", undefined, locale);
  const newest = items.reduce(
    (latest, card) => (card.contentUpdatedAt > latest ? card.contentUpdatedAt : latest),
    "",
  );
  const body = items.map((card) =>
    [
      "<item>",
      `<title>${escapeXml(card.title)}</title>`,
      `<link>${escapeXml(abs(card.path))}</link>`,
      `<guid isPermaLink="true">${escapeXml(abs(card.path))}</guid>`,
      `<pubDate>${rfc822(card.publishedAt)}</pubDate>`,
      ...(card.author ? [`<dc:creator>${escapeXml(card.author.name)}</dc:creator>`] : []),
      ...(card.category ? [`<category>${escapeXml(card.category.name)}</category>`] : []),
      `<description>${escapeXml(card.excerpt)}</description>`,
      `<content:encoded><![CDATA[<p>${escapeXml(card.excerpt)}</p>]]></content:encoded>`,
      imageParts(card),
      "</item>",
    ].join(""),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">',
    "<channel>",
    `<title>${escapeXml(`${brand} - ${BLOG_NAME[locale]}`)}</title>`,
    `<link>${escapeXml(abs(localizedPath("/blog", locale)))}</link>`,
    `<description>${escapeXml(t("meta.description", undefined, locale))}</description>`,
    `<language>${locale}</language>`,
    ...(newest ? [`<lastBuildDate>${rfc822(newest)}</lastBuildDate>`] : []),
    `<atom:link href="${escapeXml(abs(FEED_PATH[locale]))}" rel="self" type="application/rss+xml"/>`,
    ...body,
    "</channel>",
    "</rss>",
  ].join("");
}

export const FEED_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=900",
} as const;
