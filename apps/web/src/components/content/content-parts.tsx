import { t, type MessageKey } from "@wasfa/shared/i18n";
import { cn } from "@wasfa/ui";
import Link from "next/link";

import { pageHref, shareLinks } from "../../lib/content-view";
import { localizedPath, type Locale } from "../../lib/locale";
import { ContentImage } from "../content-image";

import { CopyLinkButton } from "./copy-link-button";

import type { PublicItemCard, TocEntry } from "@wasfa/shared/schemas/content";

/*
 * Small server components shared by every public content template (article, lists, glossary, author):
 * breadcrumbs, card grid, chips, pagination, share links, TOC, empty state.
 */

const tr = (key: MessageKey, locale: Locale, params?: Record<string, string | number>) =>
  t(key, params, locale);

const focusLink =
  "focus-visible:outline-none focus-visible:shadow-focus rounded-sm underline-offset-4 hover:underline";

export function Breadcrumbs({
  trail,
  locale,
}: {
  trail: readonly { name: string; path: string }[];
  locale: Locale;
}) {
  return (
    <nav aria-label={tr("content.breadcrumb.label", locale)} className="text-sm text-text-muted">
      <ol className="flex flex-wrap items-center gap-x-2">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-x-2">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {last ? (
                <span aria-current="page">{crumb.name}</span>
              ) : (
                <Link
                  href={crumb.path}
                  className={cn("inline-flex min-h-6 items-center", focusLink)}
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A visible date whose `datetime` is the day, the same value the JSON-LD carries. */
export function TimeStamp({ iso, label, locale }: { iso: string; label: string; locale: Locale }) {
  const text = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    numberingSystem: "latn",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
  return (
    <span>
      {label} <time dateTime={iso.slice(0, 10)}>{text}</time>
    </span>
  );
}

const CARD_SIZES = "(min-width: 1024px) 360px, (min-width: 640px) 45vw, 100vw";

export function ContentCard({ card, locale }: { card: PublicItemCard; locale: Locale }) {
  const summary =
    card.type === "glossary" && card.definition !== "" ? card.definition : card.excerpt;
  return (
    <li className="flex">
      <article
        lang={card.locale}
        dir={card.locale === "ar" ? "rtl" : "ltr"}
        className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card"
      >
        {card.image ? (
          <Link
            href={card.path}
            tabIndex={-1}
            aria-hidden="true"
            className="block aspect-video overflow-hidden"
          >
            <ContentImage
              asset={card.image}
              alt=""
              sizes={CARD_SIZES}
              className="size-full object-cover"
            />
          </Link>
        ) : null}
        <div className="flex flex-1 flex-col gap-2 p-5">
          {card.category ? (
            <p className="text-sm font-bold text-primary">{card.category.name}</p>
          ) : null}
          <h3 className="font-heading text-xl font-semibold text-text">
            <Link href={card.path} className={cn("block py-1", focusLink)}>
              {card.title}
            </Link>
          </h3>
          {summary !== "" ? <p className="text-base text-text-muted">{summary}</p> : null}
          {card.readingMinutes > 0 ? (
            <p className="mt-auto pt-2 text-sm text-text-muted">
              {tr("content.card.readMinutes", locale, { n: card.readingMinutes })}
            </p>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/** 1 column at 360 px, 2 from `sm`, 3 from `lg`. */
export function CardGrid({ cards, locale }: { cards: readonly PublicItemCard[]; locale: Locale }) {
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <ContentCard key={card.id} card={card} locale={locale} />
      ))}
    </ul>
  );
}

export function CategoryChips({
  items,
  activePath,
  allPath,
  locale,
}: {
  items: readonly { slug: string; name: string; path: string }[];
  activePath: string;
  allPath: string;
  locale: Locale;
}) {
  if (items.length === 0) return null;
  const chip = (path: string, label: string) => {
    const active = path === activePath;
    return (
      <li key={path}>
        <Link
          href={path}
          {...(active ? { "aria-current": "page" as const } : {})}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full border px-4 text-base font-semibold focus-visible:outline-none focus-visible:shadow-focus",
            active
              ? "border-primary bg-primary text-on-primary"
              : "border-border bg-surface text-text hover:bg-primary-soft hover:text-primary",
          )}
        >
          {label}
        </Link>
      </li>
    );
  };
  return (
    <nav aria-label={tr("content.categories.label", locale)}>
      <ul className="flex flex-wrap gap-2">
        {chip(allPath, tr("content.all", locale))}
        {items.map((item) => chip(item.path, item.name))}
      </ul>
    </nav>
  );
}

export function Pagination({
  basePath,
  page,
  pages,
  locale,
}: {
  basePath: string;
  page: number;
  pages: number;
  locale: Locale;
}) {
  if (pages <= 1) return null;
  const numbers = Array.from({ length: pages }, (_, index) => index + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= 1,
  );
  const base =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-3 text-base font-semibold focus-visible:outline-none focus-visible:shadow-focus";
  return (
    <nav aria-label={tr("content.pagination.label", locale)} className="mt-10">
      <ul className="flex flex-wrap items-center justify-center gap-2">
        {page > 1 ? (
          <li>
            <Link
              href={pageHref(basePath, page - 1)}
              className={cn(base, "border-border bg-surface hover:bg-primary-soft")}
            >
              {tr("content.pagination.prev", locale)}
            </Link>
          </li>
        ) : null}
        {numbers.map((n, index) => (
          <li key={n} className="flex items-center gap-2">
            {index > 0 && n - (numbers[index - 1] ?? n) > 1 ? (
              <span aria-hidden="true">…</span>
            ) : null}
            <Link
              href={pageHref(basePath, n)}
              aria-label={tr("content.pagination.page", locale, { n })}
              {...(n === page ? { "aria-current": "page" as const } : {})}
              className={cn(
                base,
                n === page
                  ? "border-primary bg-primary text-on-primary"
                  : "border-border bg-surface hover:bg-primary-soft",
              )}
            >
              {n}
            </Link>
          </li>
        ))}
        {page < pages ? (
          <li>
            <Link
              href={pageHref(basePath, page + 1)}
              className={cn(base, "border-border bg-surface hover:bg-primary-soft")}
            >
              {tr("content.pagination.next", locale)}
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/** Friendly empty state; a hub with nothing published renders this, never a 404. */
export function ContentEmptyState({ locale }: { locale: Locale }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-8 text-center">
      <p className="font-heading text-xl font-semibold text-text">
        {tr("content.empty.title", locale)}
      </p>
      <p className="mt-2 text-base text-text-muted">{tr("content.empty.hint", locale)}</p>
      <Link
        href={localizedPath("/", locale)}
        className={cn(
          "mt-4 inline-flex min-h-11 items-center font-semibold text-primary",
          focusLink,
        )}
      >
        {tr("content.empty.home", locale)}
      </Link>
    </div>
  );
}

export function ShareLinks({ url, title, locale }: { url: string; title: string; locale: Locale }) {
  return (
    <section aria-labelledby="share-title" className="mt-10">
      <h2 id="share-title" className="font-heading text-lg font-semibold text-text">
        {tr("content.share.title", locale)}
      </h2>
      <ul className="mt-2 flex flex-wrap items-center gap-2">
        {shareLinks(url, title).map((link) => (
          <li key={link.id}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-base font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus"
            >
              {tr(`content.share.${link.id}`, locale)}
            </a>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <CopyLinkButton
            url={url}
            label={tr("content.share.copy", locale)}
            copiedLabel={tr("content.share.copied", locale)}
          />
        </li>
      </ul>
    </section>
  );
}

function TocList({ toc }: { toc: readonly TocEntry[] }) {
  return (
    <ol className="space-y-1 text-base">
      {toc.map((entry) => (
        <li key={entry.id} className={entry.level > 2 ? "ps-4" : undefined}>
          <a
            href={`#${entry.id}`}
            className="inline-flex min-h-8 items-center rounded-sm text-text underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Collapsed native `<details>` below `lg`, sticky sidebar from `lg`: two renderings, one hidden by CSS. */
export function Toc({ toc, locale }: { toc: readonly TocEntry[]; locale: Locale }) {
  if (toc.length === 0) return null;
  const label = tr("content.toc.title", locale);
  return (
    <>
      <nav aria-label={label} className="lg:hidden">
        <details className="rounded-xl border border-border bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center rounded-xl px-4 font-bold text-text focus-visible:outline-none focus-visible:shadow-focus">
            {label}
          </summary>
          <div className="px-4 pb-4">
            <TocList toc={toc} />
          </div>
        </details>
      </nav>
      <nav
        aria-label={label}
        className="sticky top-24 hidden max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-xl border border-border bg-surface p-4 lg:block"
      >
        <p className="mb-2 font-bold text-text">{label}</p>
        <TocList toc={toc} />
      </nav>
    </>
  );
}
