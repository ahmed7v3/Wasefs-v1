import { orgContextIdSchema } from "@wasfa/shared/schemas/org";

import {
  clearBrowserCookie,
  parseCookie,
  readBrowserCookie,
  writeBrowserCookie,
} from "./browser-cookies";

/*
 * The workspace a signed-in person acts in: their personal account (no cookie) or one organization
 * they are an active member of (`wasfa_ctx=<orgId>`). The cookie is only a preference: the API
 * checks membership on every request that carries an `orgId`, so a forged value gets a 404 and
 * nothing else. Server code reads it with `workspaceFromCookieHeader`, the browser with
 * `getWorkspaceOrgId`; both go through the same validation.
 */

export const WORKSPACE_COOKIE = "wasfa_ctx";
export const WORKSPACE_COOKIE_DAYS = 180;

/** An org id from a raw cookie value, or `null` when it is absent or not a UUID. */
export function parseWorkspace(value: string | null | undefined): string | null {
  const parsed = orgContextIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Server side: the choice in a request's `Cookie` header (or a `cookies().get(...)` value). */
export function workspaceFromCookieHeader(header: string | null | undefined): string | null {
  return parseWorkspace(parseCookie(header, WORKSPACE_COOKIE));
}

export function getWorkspaceOrgId(): string | null {
  return parseWorkspace(readBrowserCookie(WORKSPACE_COOKIE));
}

/** `null` returns to the personal account. */
export function setWorkspaceOrgId(orgId: string | null): void {
  if (orgId === null) clearBrowserCookie(WORKSPACE_COOKIE);
  else writeBrowserCookie(WORKSPACE_COOKIE, orgId, WORKSPACE_COOKIE_DAYS);
}

/** A request body with the selected organization added, when there is one. */
export function withWorkspace<T extends object>(body: T): T & { orgId?: string } {
  const orgId = getWorkspaceOrgId();
  return orgId === null ? body : { ...body, orgId };
}

/** `/me/credits` for the selected organization (or the personal account). */
export function creditsPath(orgId: string | null): string {
  return orgId === null ? "/me/credits" : `/me/credits?orgId=${encodeURIComponent(orgId)}`;
}
