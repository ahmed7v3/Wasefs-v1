import { earlyLinkResponseSchema } from "@wasfa/shared/schemas/early-access";

import { serverEnv } from "../../../../../lib/server-env";

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOOKUP_TIMEOUT_MS = 2_000;

function redirect(location: string): Response {
  // A relative Location keeps whatever host the visitor used (subdomain, dev host, preview).
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/**
 * Short campaign link `early.wasfa.online/c/<slug>` (EARLY-ACCESS-PLAN D10): looks the link up on the
 * API and sends the visitor to `/` with the campaign and its UTMs, which the page stores as first
 * touch. Unknown or unreachable: plain `/` (a dead short link must never show an error page).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  if (!SLUG.test(slug)) return redirect("/");
  try {
    const response = await fetch(
      `${serverEnv.API_INTERNAL_URL}/public/early-access/link/${encodeURIComponent(slug)}`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    if (!response.ok) return redirect("/");
    const link = earlyLinkResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!link.success) return redirect("/");
    const query = new URLSearchParams({ c: link.data.slug });
    for (const [key, value] of Object.entries(link.data.utm)) {
      if (value) query.set(key.startsWith("utm_") ? key : `utm_${key}`, value);
    }
    return redirect(`/?${query.toString()}`);
  } catch {
    return redirect("/");
  }
}
