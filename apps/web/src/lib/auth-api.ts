import { PROVIDER_IDS, PROVIDER_STATUSES } from "@wasfa/shared/auth-settings";
import { z } from "zod";

import { publicEnv } from "./env";

/*
 * Response shapes of the auth endpoints the screens depend on. Only what the UI reads is declared;
 * the API's other fields (a trimmed user summary) are ignored. A mismatch throws `INTERNAL` in the
 * api client, so drift between api and web shows up loudly.
 */

/** `GET /auth/providers`: which social buttons to draw and in which state. */
export const providersResponseSchema = z.array(
  z.object({ id: z.enum(PROVIDER_IDS), status: z.enum(PROVIDER_STATUSES) }),
);
export type ProviderStates = z.output<typeof providersResponseSchema>;

/** `POST /auth/sign-in/email|phone-number`: `twoFactorRedirect: true` means "now send the code". */
export const signInResponseSchema = z.object({
  twoFactorRedirect: z.boolean().optional(),
});

/** `POST /auth/sign-in/social`: the provider's consent page, which the browser must now visit. */
export const socialSignInResponseSchema = z.object({
  url: z.string().refine((value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  }, "must be an http(s) URL"),
});

/** Where the API sends people back to after a link in an email (resolved against the site origin). */
export const VERIFIED_CALLBACK = "/login?verified=1";
export const RESET_PATH = "/reset-password";

/** Absolute URL on this site for a same-origin path (`NEXT_PUBLIC_SITE_URL` may or may not end in `/`). */
export function siteUrl(path: string): string {
  return new URL(path, publicEnv.NEXT_PUBLIC_SITE_URL).toString();
}

/** Where the address of a fresh registration waits for the "check your inbox" page (never in the URL). */
export const PENDING_EMAIL_KEY = "wasfa.pendingEmail";
