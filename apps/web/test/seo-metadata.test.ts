import { describe, expect, it } from "vitest";

import { LanguageSwitch, languageSwitchTarget } from "../src/components/marketing/language-switch";
import { localizedPath } from "../src/lib/locale";
import { PUBLIC_PAGES, pageMetadata, pagePath, type PublicPageKey } from "../src/lib/seo";

const KEYS = Object.keys(PUBLIC_PAGES) as PublicPageKey[];
const BILINGUAL = KEYS.filter((key) => PUBLIC_PAGES[key].pathEn !== null);
const ARABIC_ONLY = KEYS.filter((key) => PUBLIC_PAGES[key].pathEn === null);

function languages(key: PublicPageKey, locale: "ar" | "en") {
  const meta = pageMetadata(key, { title: "T", description: "D" }, locale);
  return meta.alternates?.languages as Record<string, string> | undefined;
}

describe("pageMetadata locale", () => {
  it("defaults to Arabic: canonical is the Arabic path", () => {
    const meta = pageMetadata("contact", { title: "T", description: "D" });
    expect(meta.alternates?.canonical).toBe("/contact");
    expect(meta.openGraph).toMatchObject({ locale: "ar_AR", alternateLocale: ["en_US"] });
  });

  it("English: canonical is the /en path, og locale en_US with ar_AR alternate", () => {
    const meta = pageMetadata("contact", { title: "Contact us", description: "D" }, "en");
    expect(meta.alternates?.canonical).toBe("/en/contact");
    expect(meta.openGraph).toMatchObject({
      locale: "en_US",
      alternateLocale: ["ar_AR"],
      url: "/en/contact",
      siteName: "Wasfa AI",
      title: "Contact us | Wasfa AI",
    });
  });

  it("English home without a title uses the English default title", () => {
    const meta = pageMetadata("home", { description: "D" }, "en");
    expect(meta).not.toHaveProperty("title");
    expect(meta.alternates?.canonical).toBe("/en");
    expect(meta.openGraph).toMatchObject({ title: expect.stringContaining("Wasfa AI") });
  });

  it("does not override the layout's non-production noindex", () => {
    expect(pageMetadata("home", { description: "D" })).not.toHaveProperty("robots");
  });

  it.each(BILINGUAL)("%s: hreflang is reciprocal in both languages", (key) => {
    const page = PUBLIC_PAGES[key];
    const expected = { ar: page.path, en: page.pathEn, "x-default": page.path };
    expect(languages(key, "ar")).toEqual(expected);
    expect(languages(key, "en")).toEqual(expected);
    // Each version's canonical is one of the alternates it declares.
    const ar = pageMetadata(key, { title: "T", description: "D" }, "ar");
    const en = pageMetadata(key, { title: "T", description: "D" }, "en");
    expect(ar.alternates?.canonical).toBe(expected.ar);
    expect(en.alternates?.canonical).toBe(expected.en);
  });

  it.each(ARABIC_ONLY)("%s: no hreflang, no alternate locale, Arabic canonical", (key) => {
    const meta = pageMetadata(key, { title: "T", description: "D" }, "ar");
    expect(meta.alternates).not.toHaveProperty("languages");
    expect(meta.openGraph).not.toHaveProperty("alternateLocale");
    expect(pagePath(key, "en")).toBe(PUBLIC_PAGES[key].path);
  });

  it("covers the legal pages as Arabic only", () => {
    expect(ARABIC_ONLY).toEqual(expect.arrayContaining(["privacy", "terms", "disclaimer"]));
  });

  it("pathEn always equals the localized form of the Arabic path", () => {
    for (const key of BILINGUAL) {
      expect(PUBLIC_PAGES[key].pathEn).toBe(localizedPath(PUBLIC_PAGES[key].path, "en"));
    }
  });
});

describe("language switch", () => {
  it("links to the English counterpart from an Arabic page that has one", () => {
    expect(languageSwitchTarget("/", "ar")).toEqual({ locale: "en", href: "/en" });
    expect(languageSwitchTarget("/contact?x=1", "ar")).toEqual({
      locale: "en",
      href: "/en/contact",
    });
  });

  it("links back to Arabic from the English page", () => {
    expect(languageSwitchTarget("/en", "en")).toEqual({ locale: "ar", href: "/" });
    expect(languageSwitchTarget("/en/contact", "en")).toEqual({ locale: "ar", href: "/contact" });
  });

  it("is absent where the page has no counterpart", () => {
    expect(languageSwitchTarget("/privacy", "ar")).toBeNull();
    expect(languageSwitchTarget("/en/privacy", "en")).toBeNull();
    expect(languageSwitchTarget("/unsubscribe", "ar")).toBeNull();
    expect(LanguageSwitch({ path: "/terms", locale: "ar" })).toBeNull();
  });
});
