import { articleSitemapChunk } from "../../../lib/content-sitemaps";
import { publicEnv } from "../../../lib/env";
import { SITEMAP_HEADERS, buildUrlset } from "../../../lib/sitemap-xml";

/*
 * Served as `/sitemap-articles-<n>.xml` through a rewrite in next.config.ts: a directory named
 * `sitemap-articles-[n]` cannot carry the `.xml` suffix in the App Router.
 */
// Reads the content API on every request (its fetches carry cache tags): never prerendered at build time.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ n: string }> },
): Promise<Response> {
  const { n } = await params;
  const index = /^[1-9]\d{0,2}$/.test(n) ? Number(n) : 0;
  const urls = index > 0 ? await articleSitemapChunk(index, publicEnv.NEXT_PUBLIC_SITE_URL) : null;
  if (urls === null) return new Response("Not found", { status: 404 });
  return new Response(buildUrlset(urls), { headers: SITEMAP_HEADERS });
}
