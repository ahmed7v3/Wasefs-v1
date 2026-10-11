import "server-only";

import { headers } from "next/headers";

import { DEFAULT_NEXT, safeNext } from "./safe-next";

/**
 * The path (with query) of the request being rendered, as `proxy.ts` recorded it, for layouts that
 * must send a signed-out visitor to `/login?next=...`. Falls back to the dashboard.
 */
export async function getRequestPath(): Promise<string> {
  const path = (await headers()).get("x-pathname");
  return path ? safeNext(path) : DEFAULT_NEXT;
}
