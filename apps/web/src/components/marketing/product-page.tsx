import { Container, buttonStyles } from "@wasfa/ui";
import { ArrowRight, ChevronDown } from "lucide-react";
import Link from "next/link";

import { TRUST_PAGE_KEYS, productPageContent, type ProductPageKey } from "../../content/pages";
import { productPageUi } from "../../content/pages/ui";
import { publicEnv } from "../../lib/env";
import { localizedPath, type Locale } from "../../lib/locale";
import { getNonce } from "../../lib/nonce";
import { PUBLIC_PAGES, pageMetadata, pagePath } from "../../lib/seo";
import {
  aboutPage,
  breadcrumbList,
  faqJsonLd,
  webPage,
  type JsonLd as JsonLdData,
} from "../../lib/structured-data";
import { Notice } from "../notice";

import { FinalCta } from "./final-cta";
import { JsonLd } from "./json-ld";
import { SectionHeading } from "./section-heading";

import type { Metadata } from "next";

/** UTC, Gregorian, Western digits (DESIGN-SYSTEM §4.6); the date is a content constant, not a timestamp. */
function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    numberingSystem: "latn",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * Where a locale-neutral path leads in `locale`: the English page when one exists, otherwise the
 * Arabic one (flagged, so the link carries `hreflang="ar"`). `/register` and other app routes are
 * not localized.
 */
export function pageLink(path: string, locale: Locale): { href: string; arabicOnly: boolean } {
  const page = Object.values(PUBLIC_PAGES).find((entry) => entry.path === path);
  if (!page) return { href: path, arabicOnly: false };
  if (locale === "ar") return { href: page.path, arabicOnly: false };
  return page.pathEn === null
    ? { href: page.path, arabicOnly: true }
    : { href: localizedPath(page.path, locale), arabicOnly: false };
}

export function productPageMetadata(key: ProductPageKey, locale: Locale): Metadata {
  const { meta } = productPageContent(key, locale);
  return pageMetadata(key, { title: meta.title, description: meta.description }, locale);
}

/** BreadcrumbList + WebPage (AboutPage on `/about`) + FAQPage when the page has questions (SEO-GEO §8). */
export function productPageJsonLd(
  key: ProductPageKey,
  locale: Locale,
  siteUrl: string,
): JsonLdData[] {
  const content = productPageContent(key, locale);
  const ui = productPageUi(locale);
  const abs = (path: string): string => new URL(path, siteUrl).toString();
  const url = abs(pagePath(key, locale));
  const trust = TRUST_PAGE_KEYS.includes(key);
  const pageInput = {
    name: content.meta.title,
    url,
    description: content.meta.description,
    inLanguage: locale,
    dateModified: content.updatedAt,
    siteUrl,
    ...(trust ? {} : { about: content.hero.eyebrow }),
  };
  return [
    breadcrumbList([
      { name: ui.breadcrumbHome, url: abs(pagePath("home", locale)) },
      { name: content.hero.eyebrow, url },
    ]),
    key === "about" ? aboutPage(pageInput) : webPage(pageInput),
    ...(content.faq.length > 0
      ? [faqJsonLd(content.faq.map((item) => ({ question: item.q, answer: item.a })))]
      : []),
  ];
}

const linkClass =
  "inline-flex min-h-11 items-center rounded-sm text-base font-semibold text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus";

export interface ProductPageViewProps {
  pageKey: ProductPageKey;
  locale: Locale;
  nonce: string | undefined;
  siteUrl: string;
}

/** The presentational part (no request access), so tests can render it with a fixed nonce. */
export function ProductPageView({ pageKey, locale, nonce, siteUrl }: ProductPageViewProps) {
  const content = productPageContent(pageKey, locale);
  const ui = productPageUi(locale);
  const trust = TRUST_PAGE_KEYS.includes(pageKey);
  const cta = pageLink(content.hero.cta.href, locale);
  const home = localizedPath("/", locale);

  return (
    <>
      {productPageJsonLd(pageKey, locale, siteUrl).map((data, index) => (
        <JsonLd key={index} data={data} nonce={nonce} />
      ))}

      <Container width="reading" className="py-10 sm:py-14">
        <article>
          <nav aria-label={ui.breadcrumbLabel} className="text-sm text-text-muted">
            <ol className="flex flex-wrap items-center gap-x-2">
              <li>
                <Link href={home} className="underline-offset-4 hover:underline">
                  {ui.breadcrumbHome}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{content.hero.eyebrow}</li>
            </ol>
          </nav>

          <header className="mt-6">
            <p className="inline-flex rounded-full border border-border bg-surface px-3 py-0.5 text-sm font-bold text-primary">
              {content.hero.eyebrow}
            </p>
            <h1 className="mt-4 font-heading text-3xl font-bold text-primary sm:text-4xl">
              {content.hero.h1}
            </h1>
            <p className="mt-3 text-lg text-text-muted">{content.hero.lead}</p>
            <p className="mt-5 rounded-xl border border-border bg-surface p-5 text-lg text-text shadow-card">
              {content.answer}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link
                href={cta.href}
                {...(cta.arabicOnly ? { hrefLang: "ar" } : {})}
                className={buttonStyles({ size: "lg", className: "shadow-raised" })}
              >
                {content.hero.cta.label}
                <ArrowRight aria-hidden="true" className="size-5 rtl:-scale-x-100" />
              </Link>
              <p className="text-sm text-text-muted">
                {ui.updated}:{" "}
                <time dateTime={content.updatedAt}>{formatDate(content.updatedAt, locale)}</time>
              </p>
            </div>
          </header>

          {content.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="mt-10 scroll-mt-4"
            >
              <h2
                id={`${section.id}-title`}
                className="font-heading text-2xl font-semibold text-text"
              >
                {section.heading}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-base">
                  {paragraph}
                </p>
              ))}
              {section.bullets ? (
                <ul className="mt-3 list-disc space-y-1.5 ps-6 text-base marker:text-primary">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          {content.faq.length > 0 ? (
            <section id="faq" aria-labelledby="faq-title" className="mt-12 scroll-mt-4">
              <SectionHeading id="faq-title" title={ui.faqTitle} lead={ui.faqLead} />
              <div className="mt-6 flex flex-col gap-3">
                {content.faq.map((item) => (
                  <details
                    key={item.q}
                    className="group rounded-2xl border border-border bg-surface shadow-card open:shadow-raised"
                  >
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-2xl px-5 py-3 text-lg font-bold text-text focus-visible:outline-none focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
                      {item.q}
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                        <ChevronDown
                          aria-hidden="true"
                          className="size-5 transition-transform duration-200 ease-standard group-open:rotate-180"
                        />
                      </span>
                    </summary>
                    <p className="px-5 pb-5 text-base text-text-muted">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}

          <nav aria-labelledby="related-title" className="mt-12">
            <h2 id="related-title" className="font-heading text-2xl font-semibold text-text">
              {ui.relatedTitle}
            </h2>
            <ul className="mt-2 flex flex-col">
              {content.related.map((path) => {
                const link = pageLink(path, locale);
                return (
                  <li key={path}>
                    <Link
                      href={link.href}
                      {...(link.arabicOnly ? { hrefLang: "ar" } : {})}
                      className={linkClass}
                    >
                      {ui.links[path] ?? path}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <Notice tone="info" className="mt-10">
            {ui.safetyNote}{" "}
            <Link href={pageLink("/disclaimer", locale).href} hrefLang="ar" className={linkClass}>
              {ui.disclaimerLink}
            </Link>
          </Notice>
        </article>
      </Container>

      {trust ? null : <FinalCta locale={locale} />}
    </>
  );
}

export async function ProductPage({
  pageKey,
  locale,
}: {
  pageKey: ProductPageKey;
  locale: Locale;
}) {
  const nonce = await getNonce();
  return (
    <ProductPageView
      pageKey={pageKey}
      locale={locale}
      nonce={nonce}
      siteUrl={publicEnv.NEXT_PUBLIC_SITE_URL}
    />
  );
}
