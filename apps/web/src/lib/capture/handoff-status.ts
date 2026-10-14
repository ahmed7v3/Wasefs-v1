import "server-only";

import {
  HANDOFF_TOKEN_PATTERN,
  handoffStatusResponseSchema,
  type HandoffStatusResponse,
} from "@wasfa/shared/schemas/handoff";

import { serverEnv } from "../server-env";

/**
 * Asks the API whether a phone link still works and how many pages it can take. `null` for a link
 * that is unknown, expired or malformed (all look the same on purpose). No cookie is sent: the
 * token is the only credential here. Any other failure throws and ends in the error page.
 */
export async function getHandoffStatus(token: string): Promise<HandoffStatusResponse | null> {
  if (!HANDOFF_TOKEN_PATTERN.test(token)) return null;
  const response = await fetch(`${serverEnv.API_INTERNAL_URL}/handoff/${token}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`handoff status failed with ${String(response.status)}`);
  const parsed = handoffStatusResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("handoff status had an unexpected shape");
  return parsed.data;
}
