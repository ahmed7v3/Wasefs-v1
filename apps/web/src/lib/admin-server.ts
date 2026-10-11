import "server-only";

import { adminStatsSchema, type AdminStats } from "@wasfa/shared/schemas/admin";
import { cache } from "react";

import { ApiRequestError, errorReason } from "./api-error";
import { serverApi } from "./session";

import type { MeResponse } from "@wasfa/shared/schemas/user";

/*
 * Server-side half of the admin gate. The API enforces every admin rule (SECURITY.md §5); this only
 * turns its two second-factor refusals into a calm explanation instead of a broken page.
 */

/** Memoised per request: the layout's probe and the overview page share one call. */
export const getAdminStats = cache((): Promise<AdminStats> =>
  serverApi("/admin/stats", { schema: adminStatsSchema }),
);

export type AdminAccess = "ok" | "two_factor_required" | "two_factor_session";

/** Any read endpoint will do as a probe; the cheapest one the account may call, in this order. */
const PROBES = [
  ["users.read", "/admin/stats"],
  ["orgs.read", "/admin/orgs?limit=1"],
  ["roles.read", "/admin/permissions"],
  ["settings.read", "/admin/settings"],
  ["flags.read", "/admin/flags"],
  ["audit.read", "/admin/audit?limit=1"],
  ["issues.read", "/admin/issues?limit=1"],
] as const;

/**
 * Asks the API whether this session may use the admin area: an account without two-factor, or a
 * session that started before it was switched on, is refused (`two_factor_required` and
 * `two_factor_session`). Any other failure is a real error and propagates to `error.tsx`.
 */
export async function probeAdminAccess(me: MeResponse): Promise<AdminAccess> {
  if (!me.twoFactorEnabled) return "two_factor_required";
  const probe = PROBES.find(([permission]) => me.permissions.includes(permission));
  if (!probe) return "ok";
  try {
    // The overview needs the stats anyway, so the same cached call serves as the probe.
    if (probe[1] === "/admin/stats") await getAdminStats();
    else await serverApi(probe[1]);
    return "ok";
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const reason = errorReason(error);
      if (reason === "two_factor_required" || reason === "two_factor_session") return reason;
    }
    throw error;
  }
}
