import "server-only";

import { earlyStatsResponseSchema } from "@wasfa/shared/schemas/early-access";

import { serverEnv } from "./server-env";

/** The page must render without the API: a slow or failing stats call just hides the counter. */
const STATS_TIMEOUT_MS = 1_500;

/** People who joined so far, or null when below the public threshold or the API is unreachable. */
export async function getEarlyJoined(): Promise<number | null> {
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/public/early-access/stats`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = earlyStatsResponseSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data.joined : null;
  } catch {
    return null;
  }
}

/** Western digits with a thousands separator, matching the site's default number style. */
export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}
