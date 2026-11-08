import { t } from "@wasfa/shared/i18n";

import { contact } from "../content/contact";
import { contactEn } from "../content/contact.en";
import { disclaimer } from "../content/legal/disclaimer";
import { privacy } from "../content/legal/privacy";
import { terms } from "../content/legal/terms";

import { stripLocale, type Locale } from "./locale";
import { PUBLIC_PAGES, pagePath, type PublicPageKey } from "./seo";
import { breadcrumbJsonLd, type JsonLd } from "./structured-data";

/*
 * Breadcrumbs for the public pages whose own component emits none (the product, trust, content and
 * home pages bring theirs): the marketing layout adds this one so every public page has a trail.
 */

const TITLES: Partial<Record<PublicPageKey, (locale: Locale) => string>> = {
  pricing: (locale) => t("billing.pricing.title", undefined, locale),
  contact: (locale) => (locale === "en" ? contactEn.title : contact.title),
  privacy: () => privacy.title,
  terms: () => terms.title,
  disclaimer: () => disclaimer.title,
};

/** Home > page for `path` (either language), or `null` when the page brings its own trail. */
export function layoutBreadcrumb(path: string, locale: Locale, siteUrl: string): JsonLd | null {
  const neutral = stripLocale(path);
  const key = (Object.keys(TITLES) as PublicPageKey[]).find(
    (candidate) => PUBLIC_PAGES[candidate].path === neutral,
  );
  const title = key ? TITLES[key] : undefined;
  if (!key || !title) return null;
  return breadcrumbJsonLd(siteUrl, [
    { name: t("nav.home", undefined, locale), path: pagePath("home", locale) },
    { name: title(locale), path: pagePath(key, locale) },
  ]);
}
