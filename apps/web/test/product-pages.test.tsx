// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { t } from "@wasfa/shared/i18n";
import { describe, expect, it, vi } from "vitest";

import {
  ProductPageView,
  pageLink,
  productPageJsonLd,
  productPageMetadata,
} from "../src/components/marketing/product-page";
import {
  PRODUCT_PAGE_CONTENT,
  TRUST_PAGE_KEYS,
  productPageContent,
  type ProductPageKey,
} from "../src/content/pages";
import { productPageUi } from "../src/content/pages/ui";
import { LOCALES, type Locale } from "../src/lib/locale";
import { PUBLIC_PAGES, pagePath } from "../src/lib/seo";
import { pageSitemapUrls } from "../src/lib/sitemap-xml";

import type { ProductPageContent } from "../src/content/pages/types";

// `server-only` (pulled in by the request nonce helper) throws outside a server build.
vi.mock("server-only", () => ({}));

const SITE = "https://wasfa.online";
const KEYS = Object.keys(PRODUCT_PAGE_CONTENT) as ProductPageKey[];
const CASES = KEYS.flatMap((key) => LOCALES.map((locale) => [key, locale] as const));

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

function pageWords(content: ProductPageContent): number {
  return [
    content.hero.h1,
    content.hero.lead,
    content.answer,
    ...content.sections.flatMap((s) => [s.heading, ...s.body, ...(s.bullets ?? [])]),
    ...content.faq.flatMap((f) => [f.q, f.a]),
  ].reduce((sum, part) => sum + words(part), 0);
}

describe("product page registry", () => {
  it("has the twelve pages, each with a PUBLIC_PAGES entry and an English counterpart under /en", () => {
    expect(KEYS).toHaveLength(12);
    for (const key of KEYS) {
      const page = PUBLIC_PAGES[key];
      expect(page.pathEn).toBe(`/en${page.path}`);
    }
  });
});

describe.each(CASES)("content of %s (%s)", (key, locale) => {
  const content = productPageContent(key, locale);
  const trust = TRUST_PAGE_KEYS.includes(key);
  const brand = t("brand.name", undefined, locale);

  it("keeps the full title within 60 characters and the description within 155", () => {
    expect(content.meta.title.length).toBeGreaterThan(0);
    expect(`${content.meta.title} | ${brand}`.length).toBeLessThanOrEqual(60);
    expect(content.meta.description.length).toBeGreaterThanOrEqual(110);
    expect(content.meta.description.length).toBeLessThanOrEqual(155);
  });

  it("opens with a 40-60 word direct answer", () => {
    expect(words(content.answer)).toBeGreaterThanOrEqual(40);
    expect(words(content.answer)).toBeLessThanOrEqual(60);
  });

  it("has the length of its kind", () => {
    const total = pageWords(content);
    if (trust) {
      expect(total).toBeGreaterThanOrEqual(250);
      expect(total).toBeLessThanOrEqual(600);
    } else {
      expect(total).toBeGreaterThanOrEqual(500);
      expect(total).toBeLessThanOrEqual(900);
    }
  });

  it("has unique section ids, filled headings and paragraphs, and an h1", () => {
    expect(content.hero.h1.length).toBeGreaterThan(0);
    const ids = content.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("faq");
    for (const section of content.sections) {
      expect(section.heading.length).toBeGreaterThan(0);
      expect(section.body.length).toBeGreaterThan(0);
    }
  });

  it("has 3-5 FAQ entries on product pages and none on trust pages", () => {
    if (trust) {
      expect(content.faq).toHaveLength(0);
    } else {
      expect(content.faq.length).toBeGreaterThanOrEqual(3);
      expect(content.faq.length).toBeLessThanOrEqual(5);
    }
  });

  it("matches the sitemap date and links only to known pages with a label", () => {
    expect(content.updatedAt).toBe(PUBLIC_PAGES[key].lastModified);
    const ui = productPageUi(locale);
    for (const path of content.related) {
      expect(Object.values(PUBLIC_PAGES).some((page) => page.path === path)).toBe(true);
      expect(ui.links[path]).toBeTruthy();
    }
  });
});

describe("internal linking", () => {
  it("links every feature page to an audience page and /pricing, and every audience page to two features", () => {
    for (const key of KEYS) {
      const { related } = productPageContent(key, "ar");
      if (key.startsWith("feature")) {
        expect(related).toContain("/pricing");
        expect(related.some((path) => path.startsWith("/for/"))).toBe(true);
      }
      if (key.startsWith("for")) {
        expect(
          related.filter((path) => path.startsWith("/features/")).length,
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("gives every page a /register or /contact call to action", () => {
    for (const key of KEYS) {
      for (const locale of LOCALES) {
        expect(["/register", "/contact"]).toContain(productPageContent(key, locale).hero.cta.href);
      }
    }
  });

  it("keeps app routes unlocalized and falls back to the Arabic page when there is no English one", () => {
    expect(pageLink("/for/patients", "en")).toEqual({
      href: "/en/for/patients",
      arabicOnly: false,
    });
    expect(pageLink("/contact", "en")).toEqual({ href: "/en/contact", arabicOnly: false });
    expect(pageLink("/pricing", "en")).toEqual({ href: "/en/pricing", arabicOnly: false });
    expect(pageLink("/disclaimer", "en")).toEqual({ href: "/disclaimer", arabicOnly: true });
    expect(pageLink("/register", "en")).toEqual({ href: "/register", arabicOnly: false });
    expect(pageLink("/for/patients", "ar").href).toBe("/for/patients");
  });
});

describe("trust pages", () => {
  it("carry the draft marker at the top of both content files", () => {
    const dir = join(__dirname, "../src/content/pages");
    for (const file of ["about", "editorial-policy", "medical-review", "sources"]) {
      for (const suffix of ["", ".en"]) {
        const source = readFileSync(join(dir, `${file}${suffix}.ts`), "utf8");
        expect(source.startsWith("// DRAFT — needs owner approval (phase4 WP2 step 8).")).toBe(
          true,
        );
      }
    }
  });

  it("name no reviewer: the medical review page says none is appointed", () => {
    expect(productPageContent("medicalReview", "ar").sections[0]?.body.join(" ")).toContain(
      "لم نُعيّن",
    );
    expect(productPageContent("medicalReview", "en").sections[0]?.body.join(" ")).toContain(
      "not yet appointed",
    );
  });
});

describe.each(CASES)("metadata of %s (%s)", (key, locale) => {
  const page = PUBLIC_PAGES[key];
  const meta = productPageMetadata(key, locale);

  it("sets the canonical of its own language and the OG image", () => {
    expect(meta.alternates?.canonical).toBe(pagePath(key, locale));
    expect(meta.openGraph).toMatchObject({
      locale: locale === "ar" ? "ar_AR" : "en_US",
      url: pagePath(key, locale),
      images: [{ url: page.ogImage }],
    });
  });

  it("lists ar, en and x-default (Arabic) in hreflang, reciprocally from both versions", () => {
    const expected = { ar: page.path, en: page.pathEn, "x-default": page.path };
    expect(meta.alternates?.languages).toEqual(expected);
    const other: Locale = locale === "ar" ? "en" : "ar";
    expect(productPageMetadata(key, other).alternates?.languages).toEqual(expected);
  });
});

describe.each(CASES)("JSON-LD of %s (%s)", (key, locale) => {
  const data = productPageJsonLd(key, locale, SITE);
  const types = data.map((entry) => entry["@type"]);

  it("is a BreadcrumbList, a WebPage (AboutPage on /about) and a FAQPage only with questions", () => {
    const content = productPageContent(key, locale);
    expect(types).toEqual([
      "BreadcrumbList",
      key === "about" ? "AboutPage" : "WebPage",
      ...(content.faq.length > 0 ? ["FAQPage"] : []),
    ]);
  });

  it("never claims a medical review or repeats the home page entities", () => {
    for (const type of ["MedicalWebPage", "Organization", "SoftwareApplication", "WebSite"]) {
      expect(types).not.toContain(type);
    }
  });

  it("points at the page's absolute URL, language and modified date", () => {
    const page = data[1];
    expect(page).toMatchObject({
      url: new URL(pagePath(key, locale), SITE).toString(),
      inLanguage: locale,
      dateModified: productPageContent(key, locale).updatedAt,
    });
    expect(TRUST_PAGE_KEYS.includes(key)).toBe(!("about" in (page ?? {})));
  });
});

describe("sitemap", () => {
  it("lists all 24 page URLs, each with the full hreflang set", () => {
    const entries = pageSitemapUrls(SITE);
    for (const key of KEYS) {
      const page = PUBLIC_PAGES[key];
      for (const path of [page.path, page.pathEn]) {
        const entry = entries.find((candidate) => new URL(candidate.url).pathname === path);
        expect(entry, path).toBeDefined();
        expect(entry?.alternates).toEqual({
          ar: `${SITE}${page.path}`,
          en: `${SITE}${page.pathEn}`,
          "x-default": `${SITE}${page.path}`,
        });
      }
    }
  });
});

describe.each(CASES)("ProductPageView %s (%s)", (key, locale) => {
  const content = productPageContent(key, locale);
  const view = <ProductPageView pageKey={key} locale={locale} nonce="test-nonce" siteUrl={SITE} />;

  it("renders exactly one h1 and h2 sections below it, never a skipped level", () => {
    const { container } = render(view);
    const h1 = container.querySelectorAll("h1");
    expect(h1).toHaveLength(1);
    expect(h1[0]?.textContent).toBe(content.hero.h1);
    expect(container.querySelectorAll("h3,h4,h5,h6")).toHaveLength(0);
    for (const section of content.sections) {
      expect(container.querySelector(`#${section.id}-title`)?.tagName).toBe("H2");
    }
  });

  it("serializes each JSON-LD block with the request nonce", () => {
    const { container } = render(view);
    const scripts = [...container.querySelectorAll('script[type="application/ld+json"]')];
    expect(scripts).toHaveLength(productPageJsonLd(key, locale, SITE).length);
    for (const script of scripts) {
      expect(script.getAttribute("nonce")).toBe("test-nonce");
      expect(() => JSON.parse(script.textContent ?? "")).not.toThrow();
    }
  });

  it("links related pages in the page's language and shows the update date", () => {
    const { container } = render(view);
    const hrefs = [...container.querySelectorAll("nav[aria-labelledby=related-title] a")].map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(content.related.map((path) => pageLink(path, locale).href));
    expect(container.querySelector(`time[datetime="${content.updatedAt}"]`)).not.toBeNull();
  });
});

describe("prescription reader accuracy section", () => {
  it.each(LOCALES)("answers the accuracy question under #accuracy (%s)", (locale) => {
    const { container } = render(
      <ProductPageView
        pageKey="featurePrescriptionReader"
        locale={locale}
        nonce={undefined}
        siteUrl={SITE}
      />,
    );
    const heading = container.querySelector("#accuracy-title");
    expect(heading?.textContent).toBe(
      locale === "ar"
        ? "هل الذكاء الاصطناعي يقرأ الروشتة بدقة؟"
        : "Can AI read prescriptions accurately?",
    );
    expect(container.querySelector("section#accuracy")).not.toBeNull();
  });
});
