import { describe, expect, it, vi } from "vitest";

import { authorPage, item } from "./support/content-fixtures";

const env = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ENV = "production";
  process.env.NEXT_PUBLIC_MEDIA_ORIGIN = "https://media.test/bucket";
  return true;
});
vi.mock("server-only", () => ({}));

const {
  articleJsonLd,
  authorJsonLd,
  contentBreadcrumbs,
  contentMetadata,
  glossaryJsonLd,
  listJsonLd,
} = await import("../src/lib/content-seo");

describe("content-seo", () => {
  it("is loaded in production mode", () => {
    expect(env).toBe(true);
  });

  it("contentMetadata: canonical, hreflang pair, closest-to-1200 og image, rss link", () => {
    const meta = contentMetadata({
      path: "/blog/x",
      locale: "ar",
      title: "T",
      description: "D",
      robots: "index",
      alternates: { ar: "/blog/x", en: "/en/blog/x" },
      ogImage: item().image,
      kind: "article",
      publishedTime: "2026-10-01T08:00:00.000Z",
      authors: ["Dr. Sara"],
      feedHref: "/blog/feed.xml",
    });
    expect(meta.alternates).toEqual({
      canonical: "https://wasfa.online/blog/x",
      languages: {
        ar: "https://wasfa.online/blog/x",
        en: "https://wasfa.online/en/blog/x",
        "x-default": "https://wasfa.online/blog/x",
      },
      types: { "application/rss+xml": "https://wasfa.online/blog/feed.xml" },
    });
    expect(meta.openGraph).toMatchObject({
      type: "article",
      locale: "ar_AR",
      alternateLocale: ["en_US"],
      images: [{ url: "https://media.test/bucket/media/abc/1280.webp", width: 1280, height: 640 }],
    });
    expect(meta.robots).toMatchObject({ index: true, follow: true });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("contentMetadata: single language has no hreflang; canonical override; noindex; default og", () => {
    const meta = contentMetadata({
      path: "/blog/x",
      locale: "ar",
      title: "T",
      description: "D",
      robots: "noindex",
      canonical: "https://other.example/a",
      alternates: { ar: "/blog/x", en: null },
      kind: "website",
    });
    expect(meta.alternates).toEqual({ canonical: "https://other.example/a" });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.openGraph).toMatchObject({ images: [{ url: "https://wasfa.online/og/home.png" }] });
    const site = contentMetadata({
      path: "/blog/x",
      locale: "en",
      title: "T",
      description: "D",
      robots: "index",
      canonical: "/blog/y",
      alternates: { ar: null, en: "/en/blog/x" },
      kind: "website",
    });
    expect(site.alternates?.canonical).toBe("https://wasfa.online/blog/y");
  });

  it("contentBreadcrumbs prepends the localized home", () => {
    expect(
      contentBreadcrumbs({ locale: "en", trail: [{ name: "Blog", path: "/en/blog" }] }),
    ).toEqual([
      { name: "Home", path: "/en" },
      { name: "Blog", path: "/en/blog" },
    ]);
  });

  it("articleJsonLd without reviewer has no MedicalWebPage", () => {
    expect(articleJsonLd(item())).toMatchInlineSnapshot(`
      [
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          "author": {
            "@type": "Person",
            "name": "Dr. Sara",
            "url": "https://wasfa.online/authors/sara",
          },
          "dateModified": "2026-10-05T08:00:00.000Z",
          "datePublished": "2026-10-01T08:00:00.000Z",
          "description": "A short guide.",
          "headline": "Reading <a> prescription & more",
          "image": [
            {
              "@type": "ImageObject",
              "height": 320,
              "url": "https://media.test/bucket/media/abc/640.webp",
              "width": 640,
            },
            {
              "@type": "ImageObject",
              "height": 640,
              "url": "https://media.test/bucket/media/abc/1280.webp",
              "width": 1280,
            },
            {
              "@type": "ImageObject",
              "height": 800,
              "url": "https://media.test/bucket/media/abc/1600.jpg",
              "width": 1600,
            },
          ],
          "inLanguage": "ar",
          "mainEntityOfPage": "https://wasfa.online/blog/reading-a-prescription",
          "publisher": {
            "@type": "Organization",
            "logo": {
              "@type": "ImageObject",
              "url": "https://wasfa.online/logo.png",
            },
            "name": "وصفة AI",
          },
          "wordCount": 812,
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/",
              "name": "الرئيسية",
              "position": 1,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/blog",
              "name": "المدونة",
              "position": 2,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/blog/c/basics",
              "name": "Basics",
              "position": 3,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/blog/reading-a-prescription",
              "name": "Reading <a> prescription & more",
              "position": 4,
            },
          ],
        },
      ]
    `);
  });

  it("articleJsonLd with reviewer adds MedicalWebPage; guides use Article", () => {
    const out = articleJsonLd(
      item({
        type: "guide",
        path: "/guides/x",
        reviewer: {
          slug: "omar",
          name: "Dr. Omar",
          credentials: "MD",
          path: "/authors/omar",
          photo: null,
          reviewedAt: "2026-10-02T08:00:00.000Z",
          licence: null,
        },
      }),
    );
    expect(out.map((entry) => entry["@type"])).toEqual([
      "Article",
      "MedicalWebPage",
      "BreadcrumbList",
    ]);
    expect(out).toMatchInlineSnapshot(`
      [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          "author": {
            "@type": "Person",
            "name": "Dr. Sara",
            "url": "https://wasfa.online/authors/sara",
          },
          "dateModified": "2026-10-05T08:00:00.000Z",
          "datePublished": "2026-10-01T08:00:00.000Z",
          "description": "A short guide.",
          "headline": "Reading <a> prescription & more",
          "image": [
            {
              "@type": "ImageObject",
              "height": 320,
              "url": "https://media.test/bucket/media/abc/640.webp",
              "width": 640,
            },
            {
              "@type": "ImageObject",
              "height": 640,
              "url": "https://media.test/bucket/media/abc/1280.webp",
              "width": 1280,
            },
            {
              "@type": "ImageObject",
              "height": 800,
              "url": "https://media.test/bucket/media/abc/1600.jpg",
              "width": 1600,
            },
          ],
          "inLanguage": "ar",
          "mainEntityOfPage": "https://wasfa.online/guides/x",
          "publisher": {
            "@type": "Organization",
            "logo": {
              "@type": "ImageObject",
              "url": "https://wasfa.online/logo.png",
            },
            "name": "وصفة AI",
          },
          "wordCount": 812,
        },
        {
          "@context": "https://schema.org",
          "@type": "MedicalWebPage",
          "description": "A short guide.",
          "inLanguage": "ar",
          "lastReviewed": "2026-10-02T08:00:00.000Z",
          "name": "Reading <a> prescription & more",
          "reviewedBy": {
            "@type": "Person",
            "name": "Dr. Omar",
            "url": "https://wasfa.online/authors/omar",
          },
          "url": "https://wasfa.online/guides/x",
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/",
              "name": "الرئيسية",
              "position": 1,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/guides",
              "name": "الأدلة",
              "position": 2,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/blog/c/basics",
              "name": "Basics",
              "position": 3,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/guides/x",
              "name": "Reading <a> prescription & more",
              "position": 4,
            },
          ],
        },
      ]
    `);
  });

  it("glossaryJsonLd", () => {
    expect(
      glossaryJsonLd(
        item({ type: "glossary", path: "/glossary/bid", title: "BID", definition: "Twice daily" }),
      ),
    ).toMatchInlineSnapshot(`
      [
        {
          "@context": "https://schema.org",
          "@type": "DefinedTerm",
          "description": "Twice daily",
          "inDefinedTermSet": {
            "@type": "DefinedTermSet",
            "name": "المصطلحات",
            "url": "https://wasfa.online/glossary",
          },
          "name": "BID",
          "url": "https://wasfa.online/glossary/bid",
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/",
              "name": "الرئيسية",
              "position": 1,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/glossary",
              "name": "المصطلحات",
              "position": 2,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/glossary/bid",
              "name": "BID",
              "position": 3,
            },
          ],
        },
      ]
    `);
  });

  it("authorJsonLd", () => {
    expect(authorJsonLd(authorPage())).toMatchInlineSnapshot(`
      [
        {
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "jobTitle": "PharmD",
            "name": "Dr. Sara",
            "sameAs": [
              "https://example.org/sara",
            ],
          },
          "url": "https://wasfa.online/authors/sara",
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/",
              "name": "الرئيسية",
              "position": 1,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/authors/sara",
              "name": "Dr. Sara",
              "position": 2,
            },
          ],
        },
      ]
    `);
  });

  it("listJsonLd", () => {
    expect(
      listJsonLd({
        locale: "en",
        name: "Basics",
        path: "/en/blog/c/basics",
        trail: [{ name: "Blog", path: "/en/blog" }],
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "inLanguage": "en",
          "name": "Basics",
          "url": "https://wasfa.online/en/blog/c/basics",
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/en",
              "name": "Home",
              "position": 1,
            },
            {
              "@type": "ListItem",
              "item": "https://wasfa.online/en/blog",
              "name": "Blog",
              "position": 2,
            },
          ],
        },
      ]
    `);
  });
});
