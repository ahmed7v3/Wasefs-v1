import { adImpressionsSchema } from "@wasfa/shared/ads";

import { forwardAdImpressions } from "../../../../lib/ads-server";

/*
 * Same-origin target of the ad beacon (docs/ADS.md §5): a batch of signed slot tokens, nothing else.
 * The body may arrive as `text/plain` (`sendBeacon` avoids a CORS preflight), so it is parsed from
 * text. No cookie is read, no visitor id exists, and the answer is always an empty 204.
 */

export async function POST(request: Request): Promise<Response> {
  const parsed = adImpressionsSchema.safeParse(
    await request
      .text()
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => undefined),
  );
  if (parsed.success) {
    await forwardAdImpressions(parsed.data.tokens, {
      cfConnectingIp: request.headers.get("cf-connecting-ip"),
      forwardedFor: request.headers.get("x-forwarded-for"),
    });
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
