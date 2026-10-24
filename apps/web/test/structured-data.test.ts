import { settingDefault, type PublicSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { landing } from "../src/content/landing";
import {
  LOGO_PATH,
  faqJsonLd,
  organizationJsonLd,
  serializeJsonLd,
  socialProfiles,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from "../src/lib/structured-data";

const SITE = "https://wasfa.online";

const defaults: PublicSettings = {
  branding: settingDefault("branding"),
  contact: settingDefault("contact"),
  socials: settingDefault("socials"),
  locale: settingDefault("locale"),
  currency: settingDefault("currency"),
  access: settingDefault("access"),
  free_tier: settingDefault("free_tier"),
  rx: settingDefault("rx"),
  seo: settingDefault("seo"),
  landing: settingDefault("landing"),
};

describe("faqJsonLd", () => {
  const data = faqJsonLd(landing.faq.items);

  it("is a FAQPage with one Question per FAQ entry of the landing content, in order", () => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("FAQPage");
    const entities = data["mainEntity"] as {
      "@type": string;
      name: string;
      acceptedAnswer: { "@type": string; text: string };
    }[];
    expect(entities).toHaveLength(landing.faq.items.length);
    entities.forEach((entity, index) => {
      expect(entity["@type"]).toBe("Question");
      expect(entity.name).toBe(landing.faq.items[index]?.question);
      expect(entity.acceptedAnswer).toEqual({
        "@type": "Answer",
        text: landing.faq.items[index]?.answer,
      });
    });
  });

  it("has between 6 and 8 questions, each with a non-empty answer", () => {
    expect(landing.faq.items.length).toBeGreaterThanOrEqual(6);
    expect(landing.faq.items.length).toBeLessThanOrEqual(8);
    for (const item of landing.faq.items) {
      expect(item.question.trim()).not.toBe("");
      expect(item.answer.trim()).not.toBe("");
    }
  });
});

describe("organizationJsonLd", () => {
  it("lists only the social profiles that are set, and no contact point without a channel", () => {
    const settings: PublicSettings = {
      ...defaults,
      socials: {
        ...defaults.socials,
        facebook: "https://facebook.com/wasfa",
        youtube: "https://youtube.com/@wasfa",
      },
    };
    const data = organizationJsonLd(settings, SITE);
    expect(data["@type"]).toBe("Organization");
    expect(data["name"]).toBe(defaults.branding.nameAr);
    expect(data["url"]).toBe(SITE);
    expect(data["sameAs"]).toEqual(["https://facebook.com/wasfa", "https://youtube.com/@wasfa"]);
    expect(data).not.toHaveProperty("contactPoint");
  });

  it("omits sameAs entirely when there is no social profile", () => {
    expect(organizationJsonLd(defaults, SITE)).not.toHaveProperty("sameAs");
    expect(socialProfiles(defaults.socials)).toEqual([]);
  });

  it("builds the contact point from the contact settings that are set", () => {
    const settings: PublicSettings = {
      ...defaults,
      contact: { ...defaults.contact, email: "help@wasfa.online", phone: "+201012345678" },
    };
    expect(organizationJsonLd(settings, SITE)["contactPoint"]).toEqual({
      "@type": "ContactPoint",
      contactType: "customer support",
      availableLanguage: ["Arabic"],
      email: "help@wasfa.online",
      telephone: "+201012345678",
    });
    const emailOnly: PublicSettings = {
      ...defaults,
      contact: { ...defaults.contact, email: "help@wasfa.online" },
    };
    expect(organizationJsonLd(emailOnly, SITE)["contactPoint"]).not.toHaveProperty("telephone");
  });

  it("uses the configured logo, else the committed raster logo on the site", () => {
    expect(organizationJsonLd(defaults, SITE)["logo"]).toBe(`${SITE}${LOGO_PATH}`);
    const settings: PublicSettings = {
      ...defaults,
      branding: { ...defaults.branding, logoUrl: "https://cdn.example.com/logo.png" },
    };
    expect(organizationJsonLd(settings, SITE)["logo"]).toBe("https://cdn.example.com/logo.png");
  });
});

describe("webSiteJsonLd and softwareApplicationJsonLd", () => {
  it("describe the site and a free web health application", () => {
    expect(webSiteJsonLd(defaults, SITE)).toMatchObject({
      "@type": "WebSite",
      url: SITE,
      inLanguage: "ar",
    });
    const app = softwareApplicationJsonLd(defaults, SITE, "وصف");
    expect(app).toMatchObject({
      "@type": "SoftwareApplication",
      applicationCategory: "HealthApplication",
      operatingSystem: "Web",
      description: "وصف",
      offers: { "@type": "Offer", price: "0", priceCurrency: "EGP" },
    });
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so no value can close the script tag", () => {
    const text = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(text).toContain("\\u003c/script>");
    // Still the same data after parsing.
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("escapes the JavaScript line separators", () => {
    const separators = `${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}`;
    const text = serializeJsonLd({ name: `a${separators}b` });
    expect(text).not.toContain(String.fromCharCode(0x2028));
    expect(text).not.toContain(String.fromCharCode(0x2029));
    expect(JSON.parse(text)).toEqual({ name: `a${separators}b` });
  });
});
