import "server-only";

import { cookies } from "next/headers";

import { WORKSPACE_COOKIE, parseWorkspace } from "./workspace";

import type { MeResponse } from "@wasfa/shared/schemas/user";

/**
 * The organization the request acts for: the `wasfa_ctx` cookie, but only while the caller is still
 * an active member (`me.organizations`). A stale choice reads as the personal account, and the
 * shell's `WorkspaceSync` removes the cookie in the browser.
 */
export async function requestedWorkspace(
  me: Pick<MeResponse, "organizations">,
): Promise<string | null> {
  const orgId = parseWorkspace((await cookies()).get(WORKSPACE_COOKIE)?.value);
  return orgId !== null && me.organizations.some((org) => org.id === orgId) ? orgId : null;
}
