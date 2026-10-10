import "server-only";

import { t } from "@wasfa/shared/i18n";
import { meResponseSchema, type MeResponse } from "@wasfa/shared/schemas/user";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { toRequestError } from "./api-client";
import { ApiRequestError } from "./api-error";
import { publicEnv } from "./env";
import { loginPath } from "./route-guard";
import { serverEnv } from "./server-env";

import type { ApiOptions } from "./api-client";
import type { z } from "zod";

/*
 * Server-side calls to the API as the signed-in user. They forward the incoming cookie, and ALWAYS
 * send `Origin`: server-to-server `fetch` has none, and the API's origin guard (SECURITY.md §11)
 * refuses a state-changing request that carries a session cookie without a trusted one.
 */

async function forwardedHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": "ar",
    Origin: publicEnv.NEXT_PUBLIC_SITE_URL,
  };
  const cookie = incoming.get("cookie");
  if (cookie) forwarded["Cookie"] = cookie;
  // The API rate-limits per client IP; without this every page view would count against the web server's address.
  const clientIp = incoming.get("x-forwarded-for");
  if (clientIp) forwarded["X-Forwarded-For"] = clientIp;
  return forwarded;
}

async function send(path: string, options: ApiOptions): Promise<Response> {
  const requestHeaders = await forwardedHeaders();
  if (options.body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (options.turnstileToken) requestHeaders["x-turnstile-token"] = options.turnstileToken;
  try {
    return await fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
      method: options.method ?? "GET",
      headers: requestHeaders,
      cache: "no-store",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE", t("error.UPSTREAM_UNAVAILABLE"));
  }
}

/** Server-side API call as the current user, for mutations done in server actions or route handlers. */
export async function serverApi<S extends z.ZodType>(
  path: string,
  options: ApiOptions & { schema: S },
): Promise<z.output<S>>;
export async function serverApi(path: string, options?: ApiOptions): Promise<void>;
export async function serverApi(
  path: string,
  options: ApiOptions & { schema?: z.ZodType | undefined } = {},
): Promise<unknown> {
  const response = await send(path, options);
  if (!response.ok) throw await toRequestError(response);
  if (response.status === 204 || !options.schema) return undefined;
  const parsed = options.schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiRequestError("INTERNAL", t("error.INTERNAL"), undefined, response.status);
  }
  return parsed.data;
}

/**
 * Who is signed in, or `null`. Memoised per request (`cache`), so a layout and its pages share
 * one call. A 401 is an answer, not an error; anything else unexpected throws.
 */
export const getMe = cache(async (): Promise<MeResponse | null> => {
  const incoming = await headers();
  // No cookie, no session: skip the round trip for anonymous visitors.
  if (!incoming.get("cookie")) return null;
  const response = await send("/me", {});
  if (response.status === 401) return null;
  if (!response.ok) throw await toRequestError(response);
  const parsed = meResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiRequestError("INTERNAL", t("error.INTERNAL"), undefined, response.status);
  }
  return parsed.data;
});

/** The signed-in user, or a redirect to the login page that comes back to `nextPath`. */
export async function requireMe(nextPath: string): Promise<MeResponse> {
  const me = await getMe();
  if (!me) redirect(loginPath(nextPath));
  return me;
}

/** Like `requireMe`, and sends people who have not finished onboarding there first. */
export async function requireOnboarded(nextPath: string): Promise<MeResponse> {
  const me = await requireMe(nextPath);
  if (!me.onboarding.done) redirect("/onboarding");
  return me;
}
