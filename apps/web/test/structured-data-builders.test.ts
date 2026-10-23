import { describe, expect, it } from "vitest";

import {
  aboutPage,
  article,
  breadcrumbList,
  definedTerm,
  drug,
  medicalWebPage,
  profilePage,
  webPage,
} from "../src/lib/structured-data";

describe("content-platform JSON-LD builders", () => {
  it("breadcrumbList", () => {
    expect(
      breadcrumbList([
        { name: "Home", url: "https://wasfa.online/" },
        { name: "Blog", url: "https://wasfa.online/blog" },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
          {
            "@type": "ListItem",
            "item": "https://wasfa.online/",
            "name": "Home",
            "position": 1,
          },
          {
            "@type": "ListItem",
            "item": "https://wasfa.online/blog",
            "name": "Blog",
            "position": 2,
          },
        ],
      }
    `);
  });

  it("article", () => {
    expect(
      article({
        headline: "H",
        url: "https://wasfa.online/blog/h",
        images: ["https://wasfa.online/i.png"],
        author: { name: "Dr A", url: "https://wasfa.online/authors/a" },
        datePublished: "2026-10-01",
        dateModified: "2026-10-05",
        inLanguage: "ar",
        publisher: { name: "Wasfa AI", logoUrl: "https://wasfa.online/logo.png" },
      }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "Article",
        "author": {
          "@type": "Person",
          "name": "Dr A",
          "url": "https://wasfa.online/authors/a",
        },
        "dateModified": "2026-10-05",
        "datePublished": "2026-10-01",
        "headline": "H",
        "image": [
          "https://wasfa.online/i.png",
        ],
        "inLanguage": "ar",
        "mainEntityOfPage": "https://wasfa.online/blog/h",
        "publisher": {
          "@type": "Organization",
          "logo": {
            "@type": "ImageObject",
            "url": "https://wasfa.online/logo.png",
          },
          "name": "Wasfa AI",
        },
      }
    `);
  });

  it("medicalWebPage omits absent fields", () => {
    expect(
      medicalWebPage({ name: "Statins", url: "https://wasfa.online/s", inLanguage: "en" }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "inLanguage": "en",
        "name": "Statins",
        "url": "https://wasfa.online/s",
      }
    `);
    expect(
      medicalWebPage({
        name: "Statins",
        url: "https://wasfa.online/s",
        inLanguage: "en",
        reviewedBy: { name: "Dr B" },
        lastReviewed: "2026-10-01",
        about: "Statins",
        citations: ["https://example.org/src"],
      }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "MedicalWebPage",
        "about": {
          "@type": "Thing",
          "name": "Statins",
        },
        "citation": [
          "https://example.org/src",
        ],
        "inLanguage": "en",
        "lastReviewed": "2026-10-01",
        "name": "Statins",
        "reviewedBy": {
          "@type": "Person",
          "name": "Dr B",
        },
        "url": "https://wasfa.online/s",
      }
    `);
  });

  it("drug", () => {
    expect(
      drug({
        name: "Panadol",
        nonProprietaryName: "paracetamol",
        activeIngredient: "paracetamol",
        drugClass: "Analgesic",
        prescriptionStatus: "OTC",
        dosageForm: "tablet",
        manufacturer: "GSK",
      }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "Drug",
        "activeIngredient": "paracetamol",
        "dosageForm": "tablet",
        "drugClass": {
          "@type": "DrugClass",
          "name": "Analgesic",
        },
        "manufacturer": {
          "@type": "Organization",
          "name": "GSK",
        },
        "name": "Panadol",
        "nonProprietaryName": "paracetamol",
        "prescriptionStatus": "https://schema.org/OTC",
      }
    `);
  });

  it("profilePage", () => {
    expect(
      profilePage({
        url: "https://wasfa.online/authors/a",
        name: "Dr A",
        jobTitle: "Pharmacist",
        credentials: ["BPharm"],
        sameAs: ["https://linkedin.com/in/a"],
        knowsAbout: ["Pharmacology"],
      }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "mainEntity": {
          "@type": "Person",
          "hasCredential": [
            {
              "@type": "EducationalOccupationalCredential",
              "name": "BPharm",
            },
          ],
          "jobTitle": "Pharmacist",
          "knowsAbout": [
            "Pharmacology",
          ],
          "name": "Dr A",
          "sameAs": [
            "https://linkedin.com/in/a",
          ],
        },
        "url": "https://wasfa.online/authors/a",
      }
    `);
  });

  it("definedTerm", () => {
    expect(
      definedTerm({
        term: "Dose",
        definition: "The amount of medicine taken at one time.",
        url: "https://wasfa.online/glossary/dose",
        termSet: { name: "Glossary", url: "https://wasfa.online/glossary" },
      }),
    ).toMatchInlineSnapshot(`
      {
        "@context": "https://schema.org",
        "@type": "DefinedTerm",
        "description": "The amount of medicine taken at one time.",
        "inDefinedTermSet": {
          "@type": "DefinedTermSet",
          "name": "Glossary",
          "url": "https://wasfa.online/glossary",
        },
        "name": "Dose",
        "url": "https://wasfa.online/glossary/dose",
      }
    `);
  });
  it("webPage and aboutPage describe the page without any review claim", () => {
    const input = {
      name: "Prescription reader",
      url: "https://wasfa.online/en/features/prescription-reader",
      description: "Reads prescriptions.",
      inLanguage: "en",
      dateModified: "2026-10-20",
      siteUrl: "https://wasfa.online",
      about: "AI prescription reader",
    } as const;
    expect(webPage(input)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: input.name,
      url: input.url,
      description: input.description,
      inLanguage: "en",
      dateModified: "2026-10-20",
      isPartOf: { "@type": "WebSite", url: "https://wasfa.online" },
      about: { "@type": "Thing", name: "AI prescription reader" },
    });
    const withoutAbout = {
      name: input.name,
      url: input.url,
      description: input.description,
      inLanguage: input.inLanguage,
      dateModified: input.dateModified,
      siteUrl: input.siteUrl,
    };
    expect(aboutPage(withoutAbout)).toMatchObject({ "@type": "AboutPage" });
    expect(aboutPage(withoutAbout)).not.toHaveProperty("about");
    expect(aboutPage(withoutAbout)).not.toHaveProperty("reviewedBy");
  });
});
