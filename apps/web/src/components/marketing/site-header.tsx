import { t } from "@wasfa/shared/i18n";
import { Container, buttonStyles } from "@wasfa/ui";
import Link from "next/link";

import { localizedPath, type Locale } from "../../lib/locale";
import { pagePath } from "../../lib/seo";
import { SiteBrandMark } from "../site-brand-mark";

import { LanguageSwitch } from "./language-switch";

/** Section anchors live on the home page of the visitor's language. */
function navItems(locale: Locale) {
  const home = localizedPath("/", locale);
  return [
    { href: `${home}#how-it-works`, label: "marketing.nav.how" },
    { href: `${home}#features`, label: "marketing.nav.features" },
    { href: pagePath("pricing", locale), label: "billing.nav.pricing" },
    { href: `${home}#faq`, label: "marketing.nav.faq" },
  ] as const;
}

const navLink =
  "inline-flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/**
 * Header of every public page: sticky, translucent white with a blur and a thin bottom border. No
 * client JavaScript: the section links collapse away below `md` (a phone scrolls the page instead)
 * and the sign-in link below `sm`, where the hero offers it again; "create account" is always there.
 */
export function SiteHeader({ locale = "ar", path = "/" }: { locale?: Locale; path?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border/70 bg-surface/80 backdrop-blur-md">
      <Container className="flex items-center justify-between gap-3 py-2.5">
        <SiteBrandMark locale={locale} />
        <nav
          aria-label={t("marketing.nav.label", undefined, locale)}
          className="flex items-center gap-1 sm:gap-2"
        >
          <ul className="hidden items-center gap-1 md:flex">
            {navItems(locale).map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={navLink}>
                  {t(item.label, undefined, locale)}
                </Link>
              </li>
            ))}
          </ul>
          <LanguageSwitch path={path} locale={locale} />
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
          <Link href="/register" className={buttonStyles({ className: "whitespace-nowrap" })}>
            {t("marketing.nav.register", undefined, locale)}
          </Link>
        </nav>
      </Container>
    </header>
  );
}
