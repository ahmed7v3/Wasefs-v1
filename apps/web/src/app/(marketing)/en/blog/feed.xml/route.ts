import { feedResponse } from "../../../../../lib/content-feed-response";

// Reads the content API on every request (its fetches carry cache tags): never prerendered at build time.
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return feedResponse("en");
}
