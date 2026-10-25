import { expect, test } from "./support/fixtures";

// Content-platform plumbing (WP3). Written but not run on the machine that authored it (no Docker).
// The e2e stack runs the web app WITHOUT REVALIDATE_SECRET, so the endpoint must behave as absent.

test("the revalidate endpoint answers 404 when no secret is configured", async ({
  request,
  urls,
}) => {
  const response = await request.post(`${urls.web}/api/revalidate`, {
    data: { tags: ["content:path-state"], timestamp: Math.floor(Date.now() / 1000) },
  });
  expect(response.status()).toBe(404);
});

test("the sitemap index lists the static and content children", async ({ request, urls }) => {
  const response = await request.get(`${urls.web}/sitemap.xml`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/xml");
  const xml = await response.text();
  expect(xml).toContain("<sitemapindex");
  expect(xml).toContain("/sitemap-pages.xml</loc>");
  // Content children appear only when the set is non-empty; every listed child must be fetchable.
  for (const [, loc] of xml.matchAll(/<loc>([^<]+sitemap-[^<]+\.xml)<\/loc>/g)) {
    const child = await request.get(loc ?? "");
    expect(child.status(), loc).toBe(200);
    expect(await child.text()).toContain("<urlset");
  }
});

test("an unknown article sitemap number is a 404", async ({ request, urls }) => {
  expect((await request.get(`${urls.web}/sitemap-articles-999.xml`)).status()).toBe(404);
});
