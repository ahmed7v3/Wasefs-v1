import { getPublicSettings } from "../../lib/public-settings";

/** The IndexNow ownership proof (not a secret by protocol); 404 while the feature is off. */
export async function GET(): Promise<Response> {
  const { indexNow } = (await getPublicSettings()).seo;
  if (!indexNow.enabled || indexNow.key === null) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(indexNow.key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
