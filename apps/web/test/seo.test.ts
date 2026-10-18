import { describe, expect, it } from "vitest";

import sitemap from "../src/app/sitemap";
import { PUBLIC_PAGES, pageMetadata, sitemapEntries } from "../src/lib/seo";

describe("sitemap", () => {
  it("lists the landing, pricing, privacy, terms, disclaimer and contact pages with absolute URLs", () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).toEqual(["/", "/pricing", "/contact", "/privacy", "/terms", "/disclaimer"]);
    for (const entry of sitemap()) expect(entry.url).toMatch(/^https?:\/\//);
  });

  it("gives the landing page the top priority and every page a fixed lastModified date", () => {
    const entries = sitemapEntries("https://wasfa.online");
    expect(entries[0]).toMatchObject({ url: "https://wasfa.online/", priority: 1 });
    for (const entry of entries) {
      expect(entry.priority).toBeLessThanOrEqual(1);
      // A constant ISO date from the table, not a per-request `new Date()`.
      expect(entry.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("pageMetadata", () => {
  it("sets the canonical path, Open Graph with ar_AR and the page image, and a large Twitter card", () => {
    const meta = pageMetadata("privacy", { title: "سياسة الخصوصية", description: "وصف" });
    expect(meta.alternates?.canonical).toBe("/privacy");
    expect(meta.title).toBe("سياسة الخصوصية");
    expect(meta.openGraph).toMatchObject({
      locale: "ar_AR",
      url: "/privacy",
      description: "وصف",
      images: [{ url: "/og/privacy.png", width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("leaves the title to the site default on the home page", () => {
    const meta = pageMetadata("home", { description: "وصف" });
    expect(meta).not.toHaveProperty("title");
    expect(meta.alternates?.canonical).toBe("/");
  });

  it("points every public page at its own image", () => {
    const images = Object.values(PUBLIC_PAGES).map((page) => page.ogImage);
    expect(new Set(images).size).toBe(images.length);
  });
});
