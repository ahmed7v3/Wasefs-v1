import { t } from "@wasfa/shared/i18n";
import { headers } from "next/headers";
import { connection } from "next/server";

import { isProduction, publicEnv } from "../lib/env";
import { plexArabic, plexArabicStrong } from "../lib/fonts";
import { localeDir, localeFromPath, ogLocale, type Locale } from "../lib/locale";
import { getPublicSettings } from "../lib/public-settings";

import "../styles/globals.css";

import type { PublicSettings } from "@wasfa/shared/settings";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/** The language of the request, from the path `proxy.ts` forwards (Arabic when absent). */
async function requestLocale(): Promise<Locale> {
  return localeFromPath((await headers()).get("x-pathname") ?? "/");
}

/** Next's `verification` field from the admin's tokens; unset tokens are left out entirely. */
function verificationMetadata({ google, bing, yandex }: PublicSettings["seo"]["verification"]) {
  const other: Record<string, string> = {
    ...(bing ? { "msvalidate.01": bing } : {}),
    ...(yandex ? { "yandex-verification": yandex } : {}),
  };
  return {
    ...(google ? { google } : {}),
    ...(Object.keys(other).length > 0 ? { other } : {}),
  };
}

function baseMetadata(locale: Locale, seo: PublicSettings["seo"]): Metadata {
  const brand = t("brand.name", undefined, locale);
  const title = t("meta.title", undefined, locale);
  // The admin's description is written for the Arabic site; English keeps its own default.
  const description =
    locale === "ar" && seo.defaultDescription !== null
      ? seo.defaultDescription
      : t("meta.description", undefined, locale);
  const verification = verificationMetadata(seo.verification);
  return {
    metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
    // `%s` in the admin's template is Next's own placeholder, so it can be passed through as is.
    // Like the description, the admin's template carries the Arabic brand: English keeps its own.
    title: {
      default: title,
      template: (locale === "ar" ? seo.titleTemplate : null) ?? `%s | ${brand}`,
    },
    description,
    applicationName: brand,
    // `alternates.canonical` is set per page: a layout-level value would canonicalise every route to it.
    openGraph: {
      type: "website",
      locale: ogLocale(locale),
      siteName: brand,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(Object.keys(verification).length > 0 ? { verification } : {}),
    // Staging and previews must never be indexed (robots.txt says the same).
    ...(isProduction ? {} : { robots: { index: false, follow: false } }),
  };
}

/**
 * The favicon uploaded in the admin panel replaces the bundled `icon.svg`: an explicit `icons`
 * entry wins over the file convention. Without an upload (or with the API down) nothing changes.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [{ branding, seo }, locale] = await Promise.all([getPublicSettings(), requestLocale()]);
  const base = baseMetadata(locale, seo);
  return branding.faviconUrl === null ? base : { ...base, icons: { icon: branding.faviconUrl } };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F6F6F4",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The CSP nonce is generated per request in proxy.ts, so pages must render per request.
  await connection();
  const locale = await requestLocale();
  return (
    <html
      lang={locale}
      dir={localeDir(locale)}
      className={`${plexArabic.variable} ${plexArabicStrong.variable}`}
    >
      <body className="font-body">
        <a href="#main" className="skip-link">
          {t("common.skipToContent", undefined, locale)}
        </a>
        {children}
      </body>
    </html>
  );
}
