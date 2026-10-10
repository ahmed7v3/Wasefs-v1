import { t } from "@wasfa/shared/i18n";
import { connection } from "next/server";

import { isProduction, publicEnv } from "../lib/env";
import { alexandria, plexArabic, plexArabicStrong } from "../lib/fonts";

import "../styles/globals.css";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

const brand = t("brand.name");

export const metadata: Metadata = {
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F7FB",
  colorScheme: "light",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The CSP nonce is generated per request in proxy.ts, so pages must render per request.
  await connection();
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${alexandria.variable} ${plexArabic.variable} ${plexArabicStrong.variable}`}
    >
      <body className="font-body">
        <a href="#main" className="skip-link">
          {t("common.skipToContent")}
        </a>
        {children}
      </body>
    </html>
  );
}
