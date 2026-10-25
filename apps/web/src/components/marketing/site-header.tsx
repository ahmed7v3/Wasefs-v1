import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { localizedPath, type Locale } from "../../lib/locale";
import { pagePath } from "../../lib/seo";
import { SiteBrandMark } from "../site-brand-mark";

import { LanguageSwitch } from "./language-switch";

/** Which content sections have published items; an empty site shows no dead links. */
export interface ContentNav {
  blog: boolean;
  guides: boolean;
}

/**
 * Section anchors live on the home page of the visitor's language. "Features" leads to the flagship
 * feature page (it replaces the old `#features` anchor: two entries with one label would confuse).
 * Blog and guides join only when they have published content (`hasPublicContent`); the medicines
 * entry joins when that section exists.
 */
export function navItems(locale: Locale, content: ContentNav) {
  const home = localizedPath("/", locale);
  const resources = [
    ...(content.blog
      ? [{ href: localizedPath("/blog", locale), label: "content.nav.blog" as const }]
      : []),
    ...(content.guides
      ? [{ href: localizedPath("/guides", locale), label: "content.nav.guides" as const }]
      : []),
  ];
  return [
    { href: `${home}#how-it-works`, label: "marketing.nav.how" },
    {
      href: localizedPath("/features/prescription-reader", locale),
      label: "marketing.nav.features",
    },
    { href: pagePath("pricing", locale), label: "billing.nav.pricing" },
    { href: `${home}#faq`, label: "marketing.nav.faq" },
    ...resources,
  ] as const;
}

const navLink =
  "inline-flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/**
 * Header of every public page: sticky, translucent white with a blur and a thin bottom border. It
 * condenses (shadow, tighter padding) over the first 64 px of scroll in browsers with scroll-driven
 * animations (`.site-header` in globals.css); elsewhere it stays as is. No client JavaScript: the section links collapse away below `lg` (at 768 px four links, the language switch and both
 * buttons overflowed; the hero and footer carry the same links) and the sign-in link below `sm`,
 * where the hero offers it again; "create account" is always there.
 */
export function SiteHeader({
  locale = "ar",
  path = "/",
  content = { blog: false, guides: false },
}: {
  locale?: Locale;
  path?: string;
  content?: ContentNav;
}) {
  return (
    <header className="site-header sticky top-0 z-10">
      <div className="site-header-bar border-b border-border/70 bg-surface/80 backdrop-blur-md">
        <Container className="flex items-center justify-between gap-3 py-2.5">
          <SiteBrandMark locale={locale} />
          <nav
            aria-label={t("marketing.nav.label", undefined, locale)}
            className="flex items-center gap-1 sm:gap-2"
          >
            <ul className="hidden items-center gap-1 lg:flex">
              {navItems(locale, content).map((item) => (
                // The two resource entries wait for `xl`: at 1024 px six links plus both buttons overflow.
                <li
                  key={item.href}
                  className={item.label.startsWith("content.") ? "max-xl:hidden" : undefined}
                >
                  <Link href={item.href} className={navLink}>
                    {t(item.label, undefined, locale)}
                  </Link>
                </li>
              ))}
            </ul>
            {/* Below `sm` the bar has no room for it (360 px overflowed); the footer carries one. */}
            <span className="max-sm:hidden">
              <LanguageSwitch path={path} locale={locale} />
            </span>
            <Link
              href="/login"
              // `max-sm:hidden`, not `hidden sm:inline-flex`: a variant is emitted after the plain
              // utilities, so it beats the `inline-flex` that `buttonStyles` already carries.
              className={buttonStyles({
                variant: "ghost",
                className: "max-sm:hidden whitespace-nowrap",
              })}
            >
              {t("marketing.nav.signIn", undefined, locale)}
            </Link>
            {/* Tighter below `sm`: "Create account" in English plus the brand overflowed 320 px. */}
            <Link
              href="/register"
              className={buttonStyles({
                className: "whitespace-nowrap max-sm:px-3.5 max-sm:text-sm",
              })}
            >
              {t("marketing.nav.register", undefined, locale)}
            </Link>
          </nav>
        </Container>
      </div>
    </header>
  );
}
