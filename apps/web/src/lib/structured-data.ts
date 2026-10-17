import { fromMinor } from "@wasfa/shared/money";

import type { PublicSettings } from "@wasfa/shared/settings";

/*
 * schema.org JSON-LD builders (SEO / GEO). Pure functions: the landing page serialises their output
 * into `<script type="application/ld+json">`. Everything dynamic comes from the public settings, so
 * a channel the admin has not set simply does not appear.
 */

export type JsonLd = Record<string, unknown>;

export interface FaqEntry {
  question: string;
  answer: string;
}

/** Path of the raster logo (Google ignores SVG logos); rendered by `scripts/og-images.mjs`. */
export const LOGO_PATH = "/logo.png";

function absolute(path: string, siteUrl: string): string {
  return new URL(path, siteUrl).toString();
}

/** Non-null social profile URLs, in the registry's order. */
export function socialProfiles(socials: PublicSettings["socials"]): string[] {
  return Object.values(socials).filter((url): url is string => url !== null);
}

export function organizationJsonLd(settings: PublicSettings, siteUrl: string): JsonLd {
  const { branding, contact, socials } = settings;
  const sameAs = socialProfiles(socials);
  const contactPoint =
    contact.email || contact.phone
      ? {
          "@type": "ContactPoint",
          contactType: "customer support",
          availableLanguage: ["Arabic"],
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.phone ? { telephone: contact.phone } : {}),
        }
      : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: branding.nameAr,
    alternateName: branding.nameEn,
    url: siteUrl,
    logo: branding.logoUrl ?? absolute(LOGO_PATH, siteUrl),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    ...(contactPoint ? { contactPoint } : {}),
  };
}

export function webSiteJsonLd(settings: PublicSettings, siteUrl: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.branding.nameAr,
    alternateName: settings.branding.nameEn,
    url: siteUrl,
    inLanguage: "ar",
  };
}

/** Free web application. `HealthApplication` is the schema.org category for health apps. */
export function softwareApplicationJsonLd(
  settings: PublicSettings,
  siteUrl: string,
  description: string,
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: settings.branding.nameAr,
    alternateName: settings.branding.nameEn,
    url: siteUrl,
    description,
    applicationCategory: "HealthApplication",
    operatingSystem: "Web",
    inLanguage: "ar",
    offers: { "@type": "Offer", price: "0", priceCurrency: "EGP" },
  };
}

export function faqJsonLd(entries: readonly FaqEntry[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}

/**
 * JSON for a `<script>` element. `<` is escaped so no text can close the tag or open a comment,
 * and U+2028/U+2029 (line terminators that older parsers choke on) are escaped too.
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, String.raw`\u003c`)
    .replaceAll(String.fromCharCode(0x2028), String.raw`\u2028`)
    .replaceAll(String.fromCharCode(0x2029), String.raw`\u2029`);
}

export interface ProductOffer {
  /** Plan and period, e.g. "بلس - شهر واحد". */
  name: string;
  amountMinor: number;
  currency: string;
}

/**
 * The paid plans as one schema.org `Product` with an `Offer` per plan price, straight from the
 * catalog the page shows (no number is typed twice). Prices are exact decimal strings.
 */
export function productJsonLd(
  settings: PublicSettings,
  siteUrl: string,
  input: { name: string; description: string; offers: readonly ProductOffer[] },
): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    description: input.description,
    brand: { "@type": "Brand", name: settings.branding.nameAr },
    offers: input.offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: fromMinor(offer.amountMinor, offer.currency),
      priceCurrency: offer.currency,
      availability: "https://schema.org/InStock",
      url: absolute("/pricing", siteUrl),
    })),
  };
}
