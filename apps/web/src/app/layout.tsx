import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { connection } from "next/server";

import { isProduction, publicEnv } from "../lib/env";
import { plexArabic, plexArabicStrong } from "../lib/fonts";
import { getPublicSettings } from "../lib/public-settings";

import "../styles/globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const brand = t("brand.name");

const baseMetadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: { default: t("meta.title"), template: `%s | ${brand}` },
  description: t("meta.description"),
  applicationName: brand,
  // `alternates.canonical` is set per page: a layout-level value would canonicalise every route to it.
  openGraph: {
    type: "website",
    locale: "ar_AR",
    siteName: brand,
    title: t("meta.title"),
    description: t("meta.description"),
  },
  twitter: { card: "summary", title: t("meta.title"), description: t("meta.description") },
  // Staging and previews must never be indexed (robots.txt says the same).
  ...(isProduction ? {} : { robots: { index: false, follow: false } }),
};

/**
 * The favicon uploaded in the admin panel replaces the bundled `icon.svg`: an explicit `icons`
 * entry wins over the file convention. Without an upload (or with the API down) nothing changes.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { branding } = await getPublicSettings();
  return branding.faviconUrl === null
    ? baseMetadata
    : { ...baseMetadata, icons: { icon: branding.faviconUrl } };
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
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${plexArabicStrong.variable}`}>
      <body className="font-body">
        <a href="#main" className="skip-link">
          {t("common.skipToContent")}
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
