import { getCatalog } from "../../lib/billing-server";
import { publicEnv } from "../../lib/env";
import { buildLlmsTxt } from "../../lib/llms-txt";
import { getPublicSettings } from "../../lib/public-settings";

export async function GET(): Promise<Response> {
  const [settings, catalog] = await Promise.all([getPublicSettings(), getCatalog(undefined)]);
  if (!settings.seo.llmsTxt.enabled) return new Response("Not found", { status: 404 });
  return new Response(buildLlmsTxt(settings, publicEnv.NEXT_PUBLIC_SITE_URL, catalog), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
