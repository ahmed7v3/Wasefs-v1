import { EARLY_ORIGIN } from "../../../../lib/early-host";

/** Bump with the content of the page, never `new Date()` per request (same rule as `PUBLIC_PAGES`). */
const PAGES = [
  { path: "/", lastModified: "2026-11-04", priority: "1.0" },
  { path: "/privacy", lastModified: "2026-11-04", priority: "0.3" },
] as const;

export function GET(): Response {
  const urls = PAGES.map(
    (page) =>
      `  <url>\n    <loc>${EARLY_ORIGIN}${page.path}</loc>\n` +
      `    <xhtml:link rel="alternate" hreflang="ar" href="${EARLY_ORIGIN}${page.path}"/>\n` +
      `    <lastmod>${page.lastModified}</lastmod>\n    <priority>${page.priority}</priority>\n  </url>`,
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
