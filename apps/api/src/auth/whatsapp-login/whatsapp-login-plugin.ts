import {
  WA_LOGIN_COOKIE,
  WA_LOGIN_COOKIE_PATH,
  WA_LOGIN_TTL_SECONDS,
  waMagicRequestSchema,
} from "@wasfa/shared/schemas/wa-login";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { AuthCode } from "../auth-errors.js";

import { WaLoginUnavailableError, type WhatsAppLoginService } from "./whatsapp-login.service.js";

import type { MagicLinkService } from "./magic-link.service.js";
import type { BetterAuthPlugin, GenericEndpointContext } from "better-auth";

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: WA_LOGIN_COOKIE_PATH,
} as const;

/**
 * "Continue with WhatsApp" (docs/WA-SIGNUP.md section 2). Two endpoints, reachable as
 * `/auth/whatsapp/start` and `/auth/whatsapp/status` once `AUTH_ROUTES` lists them:
 *
 * - `start` creates the challenge and binds it to this browser with an httpOnly nonce cookie (only
 *   its SHA-256 is stored).
 * - `status` is where the session is minted, and only for the browser holding that cookie: the
 *   inbound WhatsApp message never creates a session by itself. The session goes through Better
 *   Auth's own `createSession`, so the `session.create` hook (suspended users, admin session cap)
 *   applies, and it is tagged `login_method = 'whatsapp'` so the chat's "logout" can undo it.
 */
export function whatsappLoginPlugin(
  service: WhatsAppLoginService,
  magic: MagicLinkService,
): BetterAuthPlugin {
  const invalid = () =>
    APIError.from("UNAUTHORIZED", {
      code: AuthCode.INVALID_CREDENTIALS,
      message: "Invalid credentials",
    });

  /** A session through Better Auth (so its hooks apply), tagged for the chat's undo, with its cookie. */
  async function mintSession(ctx: GenericEndpointContext, userId: string): Promise<void> {
    const session = await ctx.context.internalAdapter.createSession(userId);
    try {
      await service.tagSession(session.id);
    } catch (error) {
      // An untagged session could not be undone from the chat: do not hand it out.
      await service.discardSession(session.id).catch(() => undefined);
      throw error;
    }
    const user = await ctx.context.internalAdapter.findUserById(userId);
    if (!user) {
      await service.discardSession(session.id).catch(() => undefined);
      throw invalid();
    }
    await setSessionCookie(ctx, { session, user });
  }

  return {
    id: "wasfa-whatsapp-login",
    endpoints: {
      whatsappStart: createAuthEndpoint("/whatsapp/start", { method: "POST" }, async (ctx) => {
        let started;
        try {
          started = await service.start(ctx.headers?.get("user-agent"));
        } catch (error) {
          if (error instanceof WaLoginUnavailableError) {
            throw APIError.from(error.reason === "disabled" ? "FORBIDDEN" : "BAD_REQUEST", {
              code:
                error.reason === "disabled"
                  ? AuthCode.WHATSAPP_LOGIN_DISABLED
                  : AuthCode.WHATSAPP_LOGIN_UNAVAILABLE,
              message: "WhatsApp sign-in is unavailable",
            });
          }
          throw error;
        }
        ctx.setCookie(WA_LOGIN_COOKIE, started.nonce, {
          ...cookieOptions,
          maxAge: WA_LOGIN_TTL_SECONDS,
        });
        return ctx.json(started.response);
      }),

      whatsappStatus: createAuthEndpoint(
        "/whatsapp/status",
        { method: "GET", query: z.object({ token: z.string().max(64).optional() }) },
        async (ctx) => {
          const nonce = ctx.getCookie(WA_LOGIN_COOKIE) ?? undefined;
          const result = await service.poll(ctx.query.token, nonce);

          if (result.status === "refused") {
            ctx.setCookie(WA_LOGIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
            return ctx.json({ status: "refused" as const, reason: result.reason });
          }
          if (result.status !== "approved") return ctx.json({ status: result.status });

          // The result was consumed by the poll above: from here on there is exactly one session.
          await mintSession(ctx, result.userId);
          ctx.setCookie(WA_LOGIN_COOKIE, "", { ...cookieOptions, maxAge: 0 });
          return ctx.json({ status: "signed_in" as const, isNew: result.isNew });
        },
      ),

      // The agent's one-time link: same session, same tag, bearer token instead of the cookie.
      whatsappMagic: createAuthEndpoint(
        "/whatsapp/magic",
        { method: "POST", body: waMagicRequestSchema },
        async (ctx) => {
          const redeemed = await magic.redeem(ctx.body.token);
          // Expired, unknown, used and refused all look the same.
          if (redeemed === null) throw invalid();
          await mintSession(ctx, redeemed.userId);
          return ctx.json({ status: "signed_in" as const, isNew: redeemed.isNew });
        },
      ),
    },
  };
}
