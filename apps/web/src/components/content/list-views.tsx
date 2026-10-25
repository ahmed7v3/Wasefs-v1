import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";
import Link from "next/link";

import { authorJsonLd, contentBreadcrumbs, listJsonLd } from "../../lib/content-seo";
import { groupGlossary, letterAnchor, totalPages } from "../../lib/content-view";
import { localeDir, type Locale } from "../../lib/locale";
import { ContentImage } from "../content-image";
import { JsonLd } from "../marketing/json-ld";

import {
  Breadcrumbs,
  CardGrid,
  CategoryChips,
  ContentEmptyState,
  Pagination,
} from "./content-parts";

import type { PublicItemCard, PublicTaxonomyPage } from "@wasfa/shared/schemas/content";

function hostOf(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
}

type Trail = { name: string; path: string }[];

function toRecords(list: readonly object[]): Record<string, unknown>[] {
  return list.map((entry) => ({ ...entry }));
}

export interface ContentListViewProps {
  locale: Locale;
  nonce: string | undefined;
  title: string;
  lead?: string | undefined;
  /** Kicker above the title: "Category" / "Tag". */
  eyebrow?: string | undefined;
  /** Raw trail (current page last); `Home` is prepended for the visible markup and the JSON-LD alike. */
  trail: Trail;
  /** Path of this list without `?page`, also the base of the pagination links. */
  path: string;
  cards: readonly PublicItemCard[];
  total: number;
  page: number;
  pageSize: number;
  chips?: {
    items: readonly { slug: string; name: string; path: string }[];
    activePath: string;
    allPath: string;
  };
  /** Sanitised HTML intro of a category or tag. */
  introHtml?: string | undefined;
}

/** Blog home, category, tag and guides hub: heading, chips, card grid, pagination, empty state. */
export function ContentListView(props: ContentListViewProps) {
  const { locale, nonce, title, lead, eyebrow, trail, path, cards, total, page, pageSize } = props;
  const pages = totalPages(total, pageSize);
  const visible = contentBreadcrumbs({ locale, trail });
  const jsonLd = toRecords(listJsonLd({ locale, name: title, path, trail }));
  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}
      <Container className="py-8 sm:py-12">
        <div lang={locale} dir={localeDir(locale)}>
          <Breadcrumbs trail={visible} locale={locale} />
          <header className="mt-6">
            {eyebrow ? (
              <p className="inline-flex rounded-full border border-border bg-surface px-3 py-0.5 text-sm font-bold text-primary">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="mt-3 font-heading text-3xl font-bold text-primary sm:text-4xl">
              {title}
            </h1>
            {lead ? <p className="mt-3 max-w-reading text-lg text-text-muted">{lead}</p> : null}
            {props.introHtml ? (
              <div
                className="content-prose mt-4"
                lang={locale}
                dangerouslySetInnerHTML={{ __html: props.introHtml }}
              />
            ) : null}
          </header>

          {props.chips ? (
            <div className="mt-6">
              <CategoryChips
                items={props.chips.items}
                activePath={props.chips.activePath}
                allPath={props.chips.allPath}
                locale={locale}
              />
            </div>
          ) : null}

          <div className="mt-8">
            {cards.length === 0 ? (
              <ContentEmptyState locale={locale} />
            ) : (
              <CardGrid cards={cards} locale={locale} />
            )}
          </div>
          <Pagination basePath={path} page={page} pages={pages} locale={locale} />
        </div>
      </Container>
    </>
  );
}

export interface GlossaryHubViewProps {
  locale: Locale;
  nonce: string | undefined;
  items: readonly { slug: string; path: string; term: string; definition: string }[];
  trail: Trail;
  path: string;
}

export function GlossaryHubView({ locale, nonce, items, trail, path }: GlossaryHubViewProps) {
  const tr = (key: MessageKey) => t(key, undefined, locale);
  const groups = groupGlossary(items);
  const latin = groups.filter((group) => group.script === "latin");
  const arabic = groups.filter((group) => group.script === "arabic");
  const jsonLd = toRecords(listJsonLd({ locale, name: tr("content.glossary.title"), path, trail }));
  const visible = contentBreadcrumbs({ locale, trail });

  const jump = (label: string, list: typeof groups) =>
    list.length === 0 ? null : (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-text-muted">{label}</span>
        <ul className="flex flex-wrap gap-1.5">
          {list.map((group) => (
            <li key={group.letter}>
              <a
                href={`#${letterAnchor(group)}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border bg-surface px-2 text-base font-bold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
              >
                {group.letter}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}
      <Container className="py-8 sm:py-12">
        <div lang={locale} dir={localeDir(locale)}>
          <Breadcrumbs trail={visible} locale={locale} />
          <header className="mt-6">
            <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
              {tr("content.glossary.title")}
            </h1>
            <p className="mt-3 max-w-reading text-lg text-text-muted">
              {tr("content.glossary.lead")}
            </p>
          </header>

          {items.length === 0 ? (
            <div className="mt-8">
              <ContentEmptyState locale={locale} />
            </div>
          ) : (
            <>
              <nav aria-label={tr("content.glossary.jump.label")} className="mt-6 space-y-2">
                {jump(tr("content.glossary.jump.latin"), latin)}
                {jump(tr("content.glossary.jump.arabic"), arabic)}
              </nav>
              <div className="mt-8 space-y-8">
                {groups.map((group) => (
                  <section
                    key={group.letter}
                    id={letterAnchor(group)}
                    aria-labelledby={`${letterAnchor(group)}-title`}
                    className="scroll-mt-24"
                  >
                    <h2
                      id={`${letterAnchor(group)}-title`}
                      className="border-b border-border pb-1 font-heading text-2xl font-semibold text-text"
                    >
                      {group.letter}
                    </h2>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                      {group.items.map((entry) => (
                        <div
                          key={entry.slug}
                          className="rounded-xl border border-border bg-surface p-4 shadow-card"
                        >
                          <dt className="font-heading text-lg font-semibold">
                            <Link
                              href={entry.path}
                              className="inline-flex min-h-8 items-center rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                            >
                              {entry.term}
                            </Link>
                          </dt>
                          <dd className="mt-1 text-base text-text-muted">{entry.definition}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </Container>
    </>
  );
}

export interface AuthorViewProps {
  locale: Locale;
  nonce: string | undefined;
  author: PublicTaxonomyPage;
  trail: Trail;
  cards: readonly PublicItemCard[];
  total: number;
  page: number;
  pageSize: number;
}

export function AuthorView({
  locale,
  nonce,
  author,
  trail,
  cards,
  total,
  page,
  pageSize,
}: AuthorViewProps) {
  const tr = (key: MessageKey) => t(key, undefined, locale);
  const person = author.person;
  const jsonLd = toRecords(authorJsonLd(author));
  const visible = contentBreadcrumbs({ locale, trail });
  return (
    <>
      {jsonLd.map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}
      <Container className="py-8 sm:py-12">
        <div lang={locale} dir={localeDir(locale)}>
          <Breadcrumbs trail={visible} locale={locale} />
          <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
            {person?.photo ? (
              <div className="size-28 shrink-0 overflow-hidden rounded-full border border-border">
                <ContentImage
                  asset={person.photo}
                  alt={person.photo.alt || author.name}
                  loading="eager"
                  sizes="112px"
                  className="size-full object-cover"
                />
              </div>
            ) : null}
            <div className="min-w-0">
              <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
                {author.name}
              </h1>
              {person && person.credentials !== "" ? (
                <p className="mt-2 text-lg text-text-muted">{person.credentials}</p>
              ) : null}
              {person && person.sameAs.length > 0 ? (
                <ul aria-label={tr("content.author.sameAs")} className="mt-3 flex flex-wrap gap-2">
                  {person.sameAs.map((href) => (
                    <li key={href}>
                      <a
                        href={href}
                        target="_blank"
                        rel="me noopener noreferrer"
                        dir="ltr"
                        className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {hostOf(href)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </header>
          {person && person.bioHtml !== "" ? (
            <div
              className="content-prose mt-6"
              lang={locale}
              dangerouslySetInnerHTML={{ __html: person.bioHtml }}
            />
          ) : null}

          <section aria-labelledby="author-articles" className="mt-10">
            <h2 id="author-articles" className="font-heading text-2xl font-semibold text-text">
              {tr("content.author.articles")}
            </h2>
            <div className="mt-4">
              {cards.length === 0 ? (
                <ContentEmptyState locale={locale} />
              ) : (
                <CardGrid cards={cards} locale={locale} />
              )}
            </div>
            <Pagination
              basePath={author.path}
              page={page}
              pages={totalPages(total, pageSize)}
              locale={locale}
            />
          </section>
        </div>
      </Container>
    </>
  );
}
