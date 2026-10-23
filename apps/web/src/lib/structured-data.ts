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

// ---------------------------------------------------------------------------------------------
// Content-platform builders (SEO-GEO §8). Inputs carry absolute URLs; optional fields that are
// absent are omitted so the output only describes what the page shows.
// ---------------------------------------------------------------------------------------------

const SCHEMA_CONTEXT = "https://schema.org";

function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([, value]) => value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0),
    ),
  ) as Partial<T>;
}

export interface BreadcrumbItem {
  name: string;
  /** Absolute URL. */
  url: string;
}

export function breadcrumbList(items: readonly BreadcrumbItem[]): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface PersonRef {
  name: string;
  url?: string;
}

function person(ref: PersonRef): JsonLd {
  return { "@type": "Person", name: ref.name, ...defined({ url: ref.url }) };
}

export interface ArticleInput {
  headline: string;
  description?: string;
  url: string;
  /** Absolute image URLs (Google recommends three ratios). */
  images?: readonly string[];
  author: PersonRef;
  datePublished: string;
  dateModified: string;
  inLanguage: "ar" | "en";
  publisher: { name: string; logoUrl: string };
}

export function article(input: ArticleInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: input.headline,
    ...defined({ description: input.description, image: input.images }),
    mainEntityOfPage: input.url,
    author: person(input.author),
    datePublished: input.datePublished,
    dateModified: input.dateModified,
    inLanguage: input.inLanguage,
    publisher: {
      "@type": "Organization",
      name: input.publisher.name,
      logo: { "@type": "ImageObject", url: input.publisher.logoUrl },
    },
  };
}

export interface MedicalWebPageInput {
  name: string;
  url: string;
  description?: string;
  inLanguage: "ar" | "en";
  reviewedBy?: PersonRef;
  lastReviewed?: string;
  /** What the page is about, e.g. a condition or drug name. */
  about?: string;
  /** Source URLs. */
  citations?: readonly string[];
}

export function medicalWebPage(input: MedicalWebPageInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "MedicalWebPage",
    name: input.name,
    url: input.url,
    inLanguage: input.inLanguage,
    ...defined({
      description: input.description,
      reviewedBy: input.reviewedBy ? person(input.reviewedBy) : undefined,
      lastReviewed: input.lastReviewed,
      about: input.about ? { "@type": "Thing", name: input.about } : undefined,
      citation: input.citations,
    }),
  };
}

export interface DrugInput {
  name: string;
  /** International nonproprietary name. */
  nonProprietaryName?: string;
  activeIngredient?: string;
  drugClass?: string;
  prescriptionStatus?: "PrescriptionOnly" | "OTC";
  dosageForm?: string;
  manufacturer?: string;
  url?: string;
}

export function drug(input: DrugInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Drug",
    name: input.name,
    ...defined({
      url: input.url,
      nonProprietaryName: input.nonProprietaryName,
      activeIngredient: input.activeIngredient,
      drugClass: input.drugClass ? { "@type": "DrugClass", name: input.drugClass } : undefined,
      prescriptionStatus: input.prescriptionStatus
        ? `https://schema.org/${input.prescriptionStatus === "OTC" ? "OTC" : "PrescriptionOnly"}`
        : undefined,
      dosageForm: input.dosageForm,
      manufacturer: input.manufacturer
        ? { "@type": "Organization", name: input.manufacturer }
        : undefined,
    }),
  };
}

export interface ProfilePageInput {
  url: string;
  name: string;
  jobTitle?: string;
  credentials?: readonly string[];
  sameAs?: readonly string[];
  knowsAbout?: readonly string[];
}

export function profilePage(input: ProfilePageInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ProfilePage",
    url: input.url,
    mainEntity: {
      "@type": "Person",
      name: input.name,
      ...defined({
        jobTitle: input.jobTitle,
        hasCredential: input.credentials?.map((credential) => ({
          "@type": "EducationalOccupationalCredential",
          name: credential,
        })),
        sameAs: input.sameAs,
        knowsAbout: input.knowsAbout,
      }),
    },
  };
}

export interface DefinedTermInput {
  term: string;
  definition: string;
  url: string;
  /** The glossary the term belongs to. */
  termSet: { name: string; url: string };
}

export function definedTerm(input: DefinedTermInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "DefinedTerm",
    name: input.term,
    description: input.definition,
    url: input.url,
    inDefinedTermSet: { "@type": "DefinedTermSet", name: input.termSet.name, url: input.termSet.url },
  };
}

export interface WebPageInput {
  name: string;
  url: string;
  description: string;
  inLanguage: "ar" | "en";
  /** ISO date of the last real content change. */
  dateModified: string;
  /** Absolute URL of the site, so the page points back at the `WebSite` described on the home page. */
  siteUrl: string;
  /** What the page is about (a feature or an audience); omitted on trust pages. */
  about?: string;
}

function webPageOfType(type: "WebPage" | "AboutPage", input: WebPageInput): JsonLd {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": type,
    name: input.name,
    url: input.url,
    description: input.description,
    inLanguage: input.inLanguage,
    dateModified: input.dateModified,
    isPartOf: { "@type": "WebSite", url: input.siteUrl },
    ...defined({ about: input.about ? { "@type": "Thing", name: input.about } : undefined }),
  };
}

/** A plain page. Medical pages use `medicalWebPage` (reviewer and date); this one claims no review. */
export function webPage(input: WebPageInput): JsonLd {
  return webPageOfType("WebPage", input);
}

export function aboutPage(input: WebPageInput): JsonLd {
  return webPageOfType("AboutPage", input);
}
