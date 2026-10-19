import { t } from "@wasfa/shared/i18n";
import Link from "next/link";

import { stripLocale, type Locale } from "../../lib/locale";
import { PUBLIC_PAGES } from "../../lib/seo";

export interface LanguageSwitchTarget {
  locale: Locale;
  href: string;
}

/**
 * Where the switch leads from `path` (in `locale`): the same page in the other language, or `null`
 * when the page exists in one language only (legal pages, unknown routes): a switch to a 404 or to
 * a different page would be worse than no switch.
 */
export function languageSwitchTarget(path: string, locale: Locale): LanguageSwitchTarget | null {
  const neutral = stripLocale(path);
  const page = Object.values(PUBLIC_PAGES).find((candidate) => candidate.path === neutral);
  if (!page || page.pathEn === null) return null;
  return locale === "ar" ? { locale: "en", href: page.pathEn } : { locale: "ar", href: page.path };
}

const linkClass =
  "inline-flex min-h-11 items-center rounded-full px-3 text-base font-semibold text-text transition-colors duration-150 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:shadow-focus";

/** Link to the counterpart of the current page in the other language; renders nothing without one. */
export function LanguageSwitch({ path, locale }: { path: string; locale: Locale }) {
  const target = languageSwitchTarget(path, locale);
  if (target === null) return null;
  const key = target.locale === "en" ? "marketing.langSwitch.en" : "marketing.langSwitch.ar";
  return (
    <Link href={target.href} hrefLang={target.locale} lang={target.locale} className={linkClass}>
      {t(key, undefined, target.locale)}
    </Link>
  );
}
