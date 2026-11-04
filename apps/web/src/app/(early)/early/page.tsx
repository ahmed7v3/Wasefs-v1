import { ARAB_COUNTRIES, EARLY_VARIANTS, arabCountry } from "@wasfa/shared/schemas/early-access";
import { headers } from "next/headers";

import { EarlyHero } from "../../../components/early/EarlyHero";
import { EarlyJoinProvider } from "../../../components/early/EarlyJoinProvider";
import {
  AppsSoon,
  Faq,
  FeatureBento,
  FinalCta,
  FoundingPerks,
  HowItWorks,
  WhatsAppSection,
} from "../../../components/early/EarlySections";
import { JsonLd } from "../../../components/marketing/json-ld";
import { early } from "../../../content/early";
import { EARLY_ORIGIN } from "../../../lib/early-host";
import { getEarlyJoined, formatCount } from "../../../lib/early-stats";
import { isProduction, publicEnv } from "../../../lib/env";
import { getPublicSettings } from "../../../lib/public-settings";
import {
  faqJsonLd,
  organizationJsonLd,
  type JsonLd as JsonLdData,
} from "../../../lib/structured-data";

import type { EarlyVariant } from "@wasfa/shared/schemas/early-access";
import type { Metadata } from "next";

/*
 * Country detection (kept simple on purpose): the root layout already renders every page per
 * request (CSP nonce), so reading `CF-IPCountry` here costs nothing and gives the right flag in the
 * first HTML, with no extra request and no cookie. Crawlers see the same page: the country only
 * decides the order of the picker (docs/EARLY-ACCESS-PLAN.md D5).
 */

export function generateMetadata(): Metadata {
  const { meta } = early;
  const url = `${EARLY_ORIGIN}/`;
  return {
    metadataBase: new URL(EARLY_ORIGIN),
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: url, languages: { ar: url, "x-default": url } },
    // Staging and previews must never be indexed (the root layout says the same).
    robots: isProduction
      ? { index: true, follow: true, "max-image-preview": "large" }
      : { index: false, follow: false },
    openGraph: {
      type: "website",
      url,
      siteName: early.brand,
      locale: "ar_AR",
      title: meta.title,
      description: meta.description,
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [{ url: `${EARLY_ORIGIN}/early/opengraph-image`, alt: meta.ogAlt }],
    },
  };
}

function toVariant(raw: string | null): EarlyVariant {
  return (EARLY_VARIANTS as readonly string[]).includes(raw ?? "") ? (raw as EarlyVariant) : "a";
}

function websiteJsonLd(): JsonLdData {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: early.brand,
    url: `${EARLY_ORIGIN}/`,
    inLanguage: "ar",
  };
}

function softwareJsonLd(): JsonLdData {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: early.brand,
    alternateName: "Wasfa AI",
    url: `${EARLY_ORIGIN}/`,
    description: early.meta.description,
    applicationCategory: "HealthApplication",
    operatingSystem: "Web, WhatsApp, Android, iOS",
    inLanguage: "ar",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/PreOrder",
      url: `${EARLY_ORIGIN}/`,
    },
    areaServed: ARAB_COUNTRIES.map((country) => ({ "@type": "Country", name: country.nameAr })),
  };
}

export default async function EarlyPage() {
  const [requestHeaders, joined, settings] = await Promise.all([
    headers(),
    getEarlyJoined(),
    getPublicSettings(),
  ]);
  const variant = toVariant(requestHeaders.get("x-early-variant"));
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // `CF-IPCountry` is "XX"/"T1" for unknown/Tor; anything that is not an Arab state is ignored.
  const detectedCountry = arabCountry(requestHeaders.get("cf-ipcountry"))?.iso ?? null;
  const counter = joined === null ? null : formatCount(joined);

  return (
    <>
      <JsonLd data={organizationJsonLd(settings, publicEnv.NEXT_PUBLIC_SITE_URL)} nonce={nonce} />
      <JsonLd data={websiteJsonLd()} nonce={nonce} />
      <JsonLd data={softwareJsonLd()} nonce={nonce} />
      <JsonLd data={faqJsonLd(early.faq.items)} nonce={nonce} />
      <EarlyJoinProvider variant={variant}>
        <EarlyHero variant={variant} detectedCountry={detectedCountry} nonce={nonce} />
        <FeatureBento />
        <WhatsAppSection />
        <HowItWorks />
        <FoundingPerks />
        <AppsSoon />
        <Faq />
        <FinalCta detectedCountry={detectedCountry} nonce={nonce} counter={counter} />
      </EarlyJoinProvider>
    </>
  );
}
