import "server-only";

import { joinLandingSchema, type JoinLanding } from "@wasfa/shared/schemas/org";

import { serverEnv } from "./server-env";

const TIMEOUT_MS = 4_000;

/**
 * What the public join page shows for a slug: the organization and the member benefit. Public and
 * cookie-less on purpose; the API answers the same `{ valid: false }` for a link that never existed
 * and one that is disabled, expired or used up. `null` = the API could not answer at all.
 */
export async function getJoinLanding(slug: string): Promise<JoinLanding | null> {
  try {
    const response = await fetch(`${serverEnv.API_INTERNAL_URL}/join/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = joinLandingSchema.safeParse(await response.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
