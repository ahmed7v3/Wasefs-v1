import { t, type MessageKey } from "@wasfa/shared/i18n";
import { notFound, permanentRedirect } from "next/navigation";

import {
  getGlossaryIndex,
  getPreview,
  getTaxonomyList,
  getTaxonomyPage,
  hasPublicContent,
  listContent,
  resolveContent,
} from "../../lib/content-api";
import { contentMetadata } from "../../lib/content-seo";
import {
  isPageSlugSegments,
  pageHref,
  parsePageParam,
  sectionPath,
  type ContentSection,
} from "../../lib/content-view";
import { publicEnv } from "../../lib/env";
import { type Locale } from "../../lib/locale";
import { getNonce } from "../../lib/nonce";

import { ArticleView } from "./article-view";
import { AuthorView, ContentListView, GlossaryHubView } from "./list-views";

import type { ContentType } from "@wasfa/shared/content/constants";
import type { PublicItem, PublicTaxonomyPage } from "@wasfa/shared/schemas/content";
import type { Metadata } from "next";

/*
 * Server-side glue of the public content routes: fetch (lib/content-api), decide (render / 301 / 404)
 * and hand the data to the presentational views. Route files only call these, so the AR and EN twins
 * cannot drift. Failures of the API throw (500), never a 404: see content-api.ts.
 */

export const PAGE_SIZE = 12;

export type SearchParams = Record<string, string | string[] | undefined>;

const tr = (key: MessageKey, locale: Locale, params?: Record<string, string | number>) =>
  t(key, params, locale);

const other = (locale: Locale): Locale => (locale === "ar" ? "en" : "ar");

/** hreflang pair of a hub: the twin is listed only when the other language has published content there. */
async function hubAlternates(
  section: ContentSection,
  locale: Locale,
): Promise<{ ar: string | null; en: string | null }> {
  const has = (await hasPublicContent(other(locale)))[section];
  const self = sectionPath(section, locale);
  const twin = has ? sectionPath(section, other(locale)) : null;
  return locale === "ar" ? { ar: self, en: twin } : { ar: twin, en: self };
}

function pageTitle(title: string, page: number, locale: Locale): string {
  return page > 1 ? `${title} — ${tr("content.list.page", locale, { n: page })}` : title;
}

// ---------------------------------------------------------------------------------------------
// Items (article, guide, glossary entry, page)
// ---------------------------------------------------------------------------------------------

/** resolve -> item | 301 | 404. The proxy answers real 301/410 first; this is the backstop. */
export async function loadItem(
  type: ContentType,
  locale: Locale,
  slug: string,
): Promise<PublicItem> {
  const result = await resolveContent(type, locale, slug);
  if (result.kind === "redirect") permanentRedirect(result.to);
  if (result.kind !== "item") notFound();
  // An `en` item renders under `/en` only (and the reverse): never the same text under two languages.
  if (result.item.locale !== locale) notFound();
  return result.item;
}

export function itemMetadataFor(item: PublicItem): Metadata {
  const { seo } = item;
  return contentMetadata({
    path: item.path,
    locale: item.locale,
    title: seo.title || item.title,
    description: seo.description || item.excerpt || item.definition,
    robots: seo.robots,
    ...(seo.canonical ? { canonical: seo.canonical } : {}),
    alternates: item.alternates,
    ogImage: seo.ogImage ?? item.image,
    ...(seo.ogTitle ? { ogTitle: seo.ogTitle } : {}),
    ...(seo.ogDescription ? { ogDescription: seo.ogDescription } : {}),
    kind: item.type === "article" || item.type === "guide" ? "article" : "website",
    publishedTime: item.firstPublishedAt,
    modifiedTime: item.contentUpdatedAt,
    ...(item.author ? { authors: [item.author.name] } : {}),
  });
}

export async function itemMetadata(
  type: ContentType,
  locale: Locale,
  slug: string,
): Promise<Metadata> {
  return itemMetadataFor(await loadItem(type, locale, slug));
}

export async function ItemPage({
  type,
  locale,
  slug,
}: {
  type: ContentType;
  locale: Locale;
  slug: string;
}) {
  const [item, nonce] = await Promise.all([loadItem(type, locale, slug), getNonce()]);
  return <ArticleView item={item} nonce={nonce} siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL} />;
}

// ---------------------------------------------------------------------------------------------
// Preview (root route, no twin)
// ---------------------------------------------------------------------------------------------

export function previewMetadata(): Metadata {
  return {
    title: tr("content.preview.banner", "ar"),
    robots: { index: false, follow: false, nocache: true },
  };
}

export async function PreviewPage({ token }: { token: string }) {
  const [preview, nonce] = await Promise.all([getPreview(token), getNonce()]);
  if (preview === null) notFound();
  return (
    <ArticleView
      item={preview.item}
      nonce={nonce}
      siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL}
      preview
    />
  );
}

// ---------------------------------------------------------------------------------------------
// `page` items under the catch-all
// ---------------------------------------------------------------------------------------------

/** Static routes win over the catch-all; anything that cannot be a page slug never reaches the API. */
export function pageSlugFromSegments(segments: readonly string[]): string {
  if (!isPageSlugSegments(segments)) notFound();
  return segments.join("/");
}

// ---------------------------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------------------------

async function loadList(
  query: Parameters<typeof listContent>[0],
  requestedPage: number,
): Promise<Awaited<ReturnType<typeof listContent>>> {
  const list = await listContent(query);
  // A page past the end is a 404; an empty first page is the friendly empty state.
  if (requestedPage > 1 && list.items.length === 0) notFound();
  return list;
}

export async function hubMetadata(
  section: ContentSection,
  locale: Locale,
  searchParams: SearchParams,
): Promise<Metadata> {
  const page = parsePageParam(searchParams["page"]);
  const title = tr(`content.${section}.metaTitle`, locale);
  const description = tr(`content.${section}.metaDescription`, locale);
  return contentMetadata({
    path: pageHref(sectionPath(section, locale), page),
    locale,
    title: pageTitle(title, page, locale),
    description,
    robots: "index",
    alternates: await hubAlternates(section, locale),
    kind: "website",
  });
}

export async function BlogHomePage({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: SearchParams;
}) {
  const page = parsePageParam(searchParams["page"]);
  const path = sectionPath("blog", locale);
  const [list, categories, nonce] = await Promise.all([
    loadList({ type: "article", locale, page, pageSize: PAGE_SIZE }, page),
    getTaxonomyList("category", locale),
    getNonce(),
  ]);
  const title = tr("content.blog.title", locale);
  return (
    <ContentListView
      locale={locale}
      nonce={nonce}
      title={title}
      lead={tr("content.blog.lead", locale)}
      trail={[{ name: tr("content.nav.blog", locale), path }]}
      path={path}
      cards={list.items}
      total={list.total}
      page={page}
      pageSize={list.pageSize}
      chips={{ items: categories.items, activePath: path, allPath: path }}
    />
  );
}

export async function GuidesHubPage({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: SearchParams;
}) {
  const page = parsePageParam(searchParams["page"]);
  const path = sectionPath("guides", locale);
  const [list, nonce] = await Promise.all([
    loadList({ type: "guide", locale, page, pageSize: PAGE_SIZE }, page),
    getNonce(),
  ]);
  return (
    <ContentListView
      locale={locale}
      nonce={nonce}
      title={tr("content.guides.title", locale)}
      lead={tr("content.guides.lead", locale)}
      trail={[{ name: tr("content.nav.guides", locale), path }]}
      path={path}
      cards={list.items}
      total={list.total}
      page={page}
      pageSize={list.pageSize}
    />
  );
}

export async function glossaryHubMetadata(locale: Locale): Promise<Metadata> {
  return contentMetadata({
    path: sectionPath("glossary", locale),
    locale,
    title: tr("content.glossary.metaTitle", locale),
    description: tr("content.glossary.metaDescription", locale),
    robots: "index",
    alternates: await hubAlternates("glossary", locale),
    kind: "website",
  });
}

export async function GlossaryHubPage({ locale }: { locale: Locale }) {
  const path = sectionPath("glossary", locale);
  const [index, nonce] = await Promise.all([getGlossaryIndex(locale), getNonce()]);
  return (
    <GlossaryHubView
      locale={locale}
      nonce={nonce}
      items={index.items}
      trail={[{ name: tr("content.nav.glossary", locale), path }]}
      path={path}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Category, tag, author
// ---------------------------------------------------------------------------------------------

async function loadTaxonomy(
  kind: "category" | "tag" | "author",
  locale: Locale,
  slug: string,
): Promise<PublicTaxonomyPage> {
  const page = await getTaxonomyPage(kind, locale, slug);
  if (page === null) notFound();
  return page;
}

export async function taxonomyMetadata(
  kind: "category" | "tag" | "author",
  locale: Locale,
  slug: string,
  searchParams: SearchParams,
): Promise<Metadata> {
  const taxon = await loadTaxonomy(kind, locale, slug);
  const page = parsePageParam(searchParams["page"]);
  const fallbackTitle =
    kind === "author" ? `${taxon.name} — ${tr("content.author.metaSuffix", locale)}` : taxon.name;
  return contentMetadata({
    path: pageHref(taxon.path, page),
    locale,
    title: pageTitle(taxon.seoTitle || fallbackTitle, page, locale),
    description: taxon.seoDescription || taxon.name,
    // Tag pages without enough posts or an intro render but stay out of the index.
    robots: taxon.indexable ? "index" : "noindex",
    alternates: taxon.alternates,
    kind: kind === "author" ? "profile" : "website",
  });
}

export async function TaxonomyListPage({
  kind,
  locale,
  slug,
  searchParams,
}: {
  kind: "category" | "tag";
  locale: Locale;
  slug: string;
  searchParams: SearchParams;
}) {
  const page = parsePageParam(searchParams["page"]);
  const taxon = await loadTaxonomy(kind, locale, slug);
  const base = sectionPath("blog", locale);
  const [list, categories, nonce] = await Promise.all([
    loadList(
      {
        type: "article",
        locale,
        page,
        pageSize: PAGE_SIZE,
        ...(kind === "category" ? { categorySlug: slug } : { tagSlug: slug }),
      },
      page,
    ),
    kind === "category" ? getTaxonomyList("category", locale) : Promise.resolve(null),
    getNonce(),
  ]);
  return (
    <ContentListView
      locale={locale}
      nonce={nonce}
      title={taxon.name}
      eyebrow={tr(kind === "category" ? "content.category.label" : "content.tag.label", locale)}
      trail={[
        { name: tr("content.nav.blog", locale), path: base },
        { name: taxon.name, path: taxon.path },
      ]}
      path={taxon.path}
      cards={list.items}
      total={list.total}
      page={page}
      pageSize={list.pageSize}
      introHtml={taxon.introHtml}
      {...(categories
        ? { chips: { items: categories.items, activePath: taxon.path, allPath: base } }
        : {})}
    />
  );
}

export async function AuthorPage({
  locale,
  slug,
  searchParams,
}: {
  locale: Locale;
  slug: string;
  searchParams: SearchParams;
}) {
  const page = parsePageParam(searchParams["page"]);
  const author = await loadTaxonomy("author", locale, slug);
  const [list, nonce] = await Promise.all([
    loadList({ type: "article", locale, page, pageSize: PAGE_SIZE, authorSlug: slug }, page),
    getNonce(),
  ]);
  return (
    <AuthorView
      locale={locale}
      nonce={nonce}
      author={author}
      trail={[{ name: author.name, path: author.path }]}
      cards={list.items}
      total={list.total}
      page={page}
      pageSize={list.pageSize}
    />
  );
}
