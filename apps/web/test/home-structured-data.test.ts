import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import {
  PRODUCT_PAGE_CONTENT,
  productPageContent,
  type ProductPageKey,
} from "../src/content/pages";
import { buildLlmsTxt, planFacts } from "../src/lib/llms-txt";
import { layoutBreadcrumb } from "../src/lib/page-breadcrumb";
import {
  breadcrumbJsonLd,
  homeStructuredData,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../src/lib/structured-data";

import type { CatalogResponse } from "@wasfa/shared/schemas/billing";

const SITE = "https://wasfa.online";

const settings: PublicSettings = {
  branding: settingDefault("branding"),
  contact: settingDefault("contact"),
  socials: settingDefault("socials"),
  locale: settingDefault("locale"),
  currency: settingDefault("currency"),
  access: settingDefault("access"),
  free_tier: { monthlyAnalyses: 5 },
  rx: settingDefault("rx"),
  seo: settingDefault("seo"),
  landing: settingDefault("landing"),
};

const plans = [
  { name: "Plus - 1 month", amountMinor: 19900, currency: "EGP" },
  { name: "Plus - 12 months", amountMinor: 190000, currency: "EGP" },
];
const faqs = [
  { question: "Q1?", answer: "A1" },
  { question: "Q2?", answer: "A2" },
];

describe("homeStructuredData", () => {
  const data = homeStructuredData({ settings, siteUrl: SITE, description: "desc", faqs, plans });

  it("returns Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList in order", () => {
    expect(data.map((item) => item["@type"])).toEqual([
      "Organization",
      "WebSite",
      "SoftwareApplication",
      "FAQPage",
      "BreadcrumbList",
    ]);
    for (const item of data) expect(item["@context"]).toBe("https://schema.org");
  });

  it("WebSite has no SearchAction while no public search page exists", () => {
    expect(data[1]).not.toHaveProperty("potentialAction");
  });

  it("WebSite gets a SearchAction only when a real search path is given", () => {
    expect(
      webSiteJsonLd(settings, "https://wasfa.online", "/search?q={search_term_string}"),
    ).toMatchObject({
      potentialAction: {
        "@type": "SearchAction",
        target: "https://wasfa.online/search?q={search_term_string}",
      },
    });
  });

  it("SoftwareApplication offers come from the plans with exact decimal prices", () => {
    expect(data[2]).toMatchObject({
      applicationCategory: "HealthApplication",
      offers: [
        { "@type": "Offer", name: "Plus - 1 month", price: "199.00", priceCurrency: "EGP" },
        { "@type": "Offer", name: "Plus - 12 months", price: "1900.00", priceCurrency: "EGP" },
      ],
    });
  });

  it("FAQPage holds exactly the given questions and answers", () => {
    expect(data[3]).toMatchObject({
      mainEntity: [
        { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1" } },
        { "@type": "Question", name: "Q2?", acceptedAnswer: { "@type": "Answer", text: "A2" } },
      ],
    });
  });

  it("BreadcrumbList items have position, name and an absolute item URL", () => {
    expect(data[4]).toMatchObject({
      itemListElement: [{ "@type": "ListItem", position: 1, item: `${SITE}/` }],
    });
  });
});

describe("softwareApplicationJsonLd without plans", () => {
  it("falls back to a free offer", () => {
    expect(softwareApplicationJsonLd(settings, SITE, "d")["offers"]).toEqual({
      "@type": "Offer",
      price: "0",
      priceCurrency: "EGP",
    });
  });
});

describe("webSiteJsonLd", () => {
  it("keeps name, url and language", () => {
    expect(webSiteJsonLd(settings, SITE)).toMatchObject({ "@type": "WebSite", url: SITE });
  });
});

describe("breadcrumbJsonLd and layoutBreadcrumb", () => {
  it("resolves paths against the site URL", () => {
    expect(breadcrumbJsonLd(SITE, [{ name: "A", path: "/pricing" }])).toMatchObject({
      itemListElement: [{ position: 1, name: "A", item: `${SITE}/pricing` }],
    });
  });

  it.each([
    ["/pricing", "ar", `${SITE}/pricing`],
    ["/en/pricing", "en", `${SITE}/en/pricing`],
    ["/contact", "ar", `${SITE}/contact`],
    ["/privacy", "ar", `${SITE}/privacy`],
    ["/terms", "ar", `${SITE}/terms`],
    ["/disclaimer", "ar", `${SITE}/disclaimer`],
  ] as const)("%s gets Home > page", (path, locale, url) => {
    const crumb = layoutBreadcrumb(path, locale, SITE);
    expect(crumb).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { position: 1, item: locale === "en" ? `${SITE}/en` : `${SITE}/` },
        { position: 2, item: url },
      ],
    });
  });

  it("leaves pages that bring their own trail alone", () => {
    expect(layoutBreadcrumb("/about", "ar", SITE)).toBeNull();
    expect(layoutBreadcrumb("/blog/x", "ar", SITE)).toBeNull();
    expect(layoutBreadcrumb("/", "ar", SITE)).toBeNull();
  });
});

describe("product page metadata", () => {
  const keys = Object.keys(PRODUCT_PAGE_CONTENT) as ProductPageKey[];
  it.each(["ar", "en"] as const)("%s: every title and description is unique", (locale) => {
    const metas = keys.map((key) => productPageContent(key, locale).meta);
    const titles = metas.map((meta) => meta.title);
    const descriptions = metas.map((meta) => meta.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});

describe("llms.txt plan facts", () => {
  const catalog = {
    currency: "EGP",
    plans: [
      {
        names: { ar: "بلس", en: "Plus" },
        monthlyCredits: 40,
        prices: [{ months: 1, display: { headlineMinor: 19900 } }],
      },
    ],
  } as unknown as CatalogResponse;

  it("reads the free allowance from the settings and plans from the catalog", () => {
    const text = buildLlmsTxt(settings, SITE, catalog);
    expect(text).toContain("## Plans");
    expect(text).toContain("Free plan: 5 prescription analyses per month");
    expect(text).toContain("Plus: 40 credits per month, 199.00 EGP per month.");
  });

  it("states only the free allowance when the catalog is unavailable", () => {
    expect(planFacts(settings, null)).toHaveLength(1);
  });
});
