import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import Link from "next/link";

import { contentBreadcrumbs, articleJsonLd, glossaryJsonLd } from "../../lib/content-seo";
import { sectionOfType, sectionPath } from "../../lib/content-view";
import { localeDir, localizedPath, type Locale } from "../../lib/locale";
import { ContentImage } from "../content-image";
import { JsonLd } from "../marketing/json-ld";

import { Breadcrumbs, CardGrid, ShareLinks, TimeStamp, Toc } from "./content-parts";

import type { PublicItem } from "@wasfa/shared/schemas/content";

const SECTION_TITLE: Record<"blog" | "guides" | "glossary", MessageKey> = {
  blog: "content.nav.blog",
  guides: "content.nav.guides",
  glossary: "content.nav.glossary",
};

/** The visible trail, built once and used for both the markup and (inside the builders) the JSON-LD. */
export function itemTrail(item: PublicItem, locale: Locale): { name: string; path: string }[] {
  const section = sectionOfType(item.type);
  const trail: { name: string; path: string }[] = [];
  if (section !== null) {
    trail.push({
      name: t(SECTION_TITLE[section], undefined, locale),
      path: sectionPath(section, locale),
    });
    if (item.type !== "glossary" && item.category) {
      trail.push({ name: item.category.name, path: item.category.path });
    }
  }
  trail.push({ name: item.title, path: item.path });
  return contentBreadcrumbs({ locale, trail });
}

function toRecords(list: readonly object[]): Record<string, unknown>[] {
  return list.map((entry) => ({ ...entry }));
}

export interface ArticleViewProps {
  item: PublicItem;
  nonce: string | undefined;
  /** Absolute origin, for the share links. */
  siteUrl: string;
  /** Preview: the unpublished banner; the JSON-LD is left out (nothing here is indexable). */
  preview?: boolean;
}

/**
 * One template for article, guide, glossary entry and `page` items. The chrome speaks the content's own
 * language (an `en` item under `/en`, or a preview at the root), so `<article lang dir>` is explicit.
 */
export function ArticleView({ item, nonce, siteUrl, preview = false }: ArticleViewProps) {
  const locale: Locale = item.locale;
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, params, locale);
  const trail = itemTrail(item, locale);
  const url = new URL(item.path, siteUrl).toString();
  const showToc = (item.type === "guide" || item.flags.showToc) && item.toc.length > 0;
  const jsonLd = preview
    ? []
    : toRecords(item.type === "glossary" ? glossaryJsonLd(item) : articleJsonLd(item));
  const reviewer = item.reviewer;

  return (
    <>
      {preview ? (
        <div
          role="status"
          className="sticky top-0 z-20 border-b border-warning bg-warning-soft px-4 py-2 text-center text-base font-bold text-text"
        >
          {t("content.preview.banner", undefined, locale)}
        </div>
      ) : null}
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}
      <Container className="py-8 sm:py-12">
        <article lang={locale} dir={localeDir(locale)}>
          <Breadcrumbs trail={trail} locale={locale} />

          <div className={showToc ? "mt-6 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]" : "mt-6"}>
            {showToc ? (
              <aside className="lg:order-first">
                <Toc toc={item.toc} locale={locale} />
              </aside>
            ) : null}

            <div className="min-w-0">
              <header>
                {item.category && item.type === "article" ? (
                  <p className="inline-flex rounded-full border border-border bg-surface px-3 py-0.5 text-sm font-bold text-primary">
                    {item.category.name}
                  </p>
                ) : null}
                <h1 className="mt-3 font-heading text-3xl font-bold text-primary sm:text-4xl">
                  {item.title}
                </h1>
                {item.type === "glossary" && item.definition !== "" ? (
                  <p className="mt-4 rounded-xl border border-border bg-surface p-5 text-lg text-text shadow-card">
                    <strong>{tr("content.definition")}: </strong>
                    {item.definition}
                  </p>
                ) : item.excerpt !== "" ? (
                  <p className="mt-3 text-lg text-text-muted">{item.excerpt}</p>
                ) : null}

                {item.flags.sponsored ? (
                  <p className="mt-3 inline-flex rounded-full border border-warning bg-warning-soft px-3 py-0.5 text-sm font-bold text-text">
                    {tr("content.sponsored")}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-col gap-1 text-sm text-text-muted">
                  {item.author ? (
                    <p>
                      {tr("content.by")}{" "}
                      <Link
                        href={item.author.path}
                        rel="author"
                        className="font-semibold text-text underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {item.author.name}
                      </Link>
                      {item.author.credentials !== "" ? <> — {item.author.credentials}</> : null}
                    </p>
                  ) : null}
                  {reviewer ? (
                    <p>
                      {tr("content.reviewed.by")}{" "}
                      <Link
                        href={reviewer.path}
                        className="font-semibold text-text underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {reviewer.name}
                      </Link>
                      {reviewer.credentials !== "" ? <> — {reviewer.credentials}</> : null}
                      {reviewer.licence ? (
                        <> ({tr("content.reviewed.licence", { number: reviewer.licence })})</>
                      ) : null}{" "}
                      {tr("content.reviewed.on")}{" "}
                      <time dateTime={reviewer.reviewedAt.slice(0, 10)}>
                        {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
                          numberingSystem: "latn",
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(reviewer.reviewedAt))}
                      </time>
                    </p>
                  ) : null}
                  <p className="flex flex-wrap gap-x-4">
                    <TimeStamp
                      iso={item.firstPublishedAt}
                      label={tr("content.published")}
                      locale={locale}
                    />
                    <TimeStamp
                      iso={item.contentUpdatedAt}
                      label={tr("content.updated")}
                      locale={locale}
                    />
                    {item.readingMinutes > 0 ? (
                      <span>{tr("content.card.readMinutes", { n: item.readingMinutes })}</span>
                    ) : null}
                  </p>
                </div>
              </header>

              {item.image ? (
                <figure className="mt-6">
                  <ContentImage
                    asset={item.image}
                    alt={item.image.alt}
                    loading="eager"
                    sizes="(min-width: 1024px) 720px, 100vw"
                    className="h-auto w-full rounded-xl"
                  />
                  {item.image.caption || item.image.credit ? (
                    <figcaption className="mt-2 text-sm text-text-muted">
                      {[item.image.caption, item.image.credit].filter(Boolean).join(" — ")}
                    </figcaption>
                  ) : null}
                </figure>
              ) : null}

              <div
                className="content-prose mt-8"
                lang={locale}
                dir={localeDir(locale)}
                dangerouslySetInnerHTML={{ __html: item.bodyHtml }}
              />

              {item.flags.aiAssisted ? (
                <p className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">
                  {tr("content.aiNote")}
                </p>
              ) : null}

              {item.corrections.length > 0 ? (
                <section aria-labelledby="corrections-title" className="mt-8">
                  <h2
                    id="corrections-title"
                    className="font-heading text-lg font-semibold text-text"
                  >
                    {tr("content.corrections.title")}
                  </h2>
                  <ul className="mt-2 space-y-2 text-base">
                    {item.corrections.map((correction) => (
                      <li key={`${correction.at}-${correction.summary}`}>
                        <TimeStamp iso={correction.at} label="" locale={locale} />:{" "}
                        {correction.summary}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {item.tags.length > 0 ? (
                <ul className="mt-6 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <li key={tag.slug}>
                      <Link
                        href={tag.path}
                        className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {tag.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="mt-6 text-sm text-text-muted">
                {tr("content.medicalNote")}{" "}
                <Link
                  href={localizedPath("/disclaimer", locale)}
                  hrefLang="ar"
                  className="font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {tr("content.medicalNote.link")}
                </Link>
              </p>

              {preview ? null : <ShareLinks url={url} title={item.title} locale={locale} />}
            </div>
          </div>

          {item.flags.showRelated && item.related.length > 0 ? (
            <section aria-labelledby="related-title" className="mt-12">
              <h2 id="related-title" className="font-heading text-2xl font-semibold text-text">
                {tr("content.related.title")}
              </h2>
              <div className="mt-4">
                <CardGrid cards={item.related} locale={locale} />
              </div>
            </section>
          ) : null}
        </article>
      </Container>
    </>
  );
}
