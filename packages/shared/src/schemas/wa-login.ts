import { z } from "zod";

import { E164_PATTERN } from "../identity.js";

import { normalizeDigits } from "./phone.js";

/*
 * "Continue with WhatsApp" (docs/WA-SIGNUP.md): the shapes shared by the api (challenges, endpoints,
 * the stream consumer) and the wa-bridge (what it pushes). The proof of the phone is the sender of
 * the message, exactly as for verification codes; the token only names the browser's challenge.
 */

/** Bridge to api: login claims and the logout command. */
export const WA_LOGIN_STREAM = "wa:login:in";
export const WA_LOGIN_STREAM_MAXLEN = 5_000;
/** A challenge lives this long and is consumed once. */
export const WA_LOGIN_TTL_SECONDS = 5 * 60;
/** The httpOnly cookie that binds a challenge to the browser that asked. */
export const WA_LOGIN_COOKIE = "wasfa_wa_login";
export const WA_LOGIN_COOKIE_PATH = "/auth/whatsapp";
/** Sessions born from a WhatsApp sign-in carry this `login_method`. */
export const WA_LOGIN_METHOD = "whatsapp";
/** "Undo" reaches back this far. */
export const WA_LOGOUT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Crockford base32 (no I, L, O, U): 8 characters shown as `XXXX-XXXX`, sent as `WASFA-XXXX-XXXX`. */
export const WA_LOGIN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const WA_LOGIN_TOKEN_PATTERN = /WASFA-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})/i;

export const waLoginTokenSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/);

/** The token (8 characters, upper case) inside a message, or null. Arabic digits are normalized first. */
export function parseLoginToken(text: string): string | null {
  const match = WA_LOGIN_TOKEN_PATTERN.exec(normalizeDigits(text));
  return match ? `${match[1] ?? ""}${match[2] ?? ""}`.toUpperCase() : null;
}

/** `ABCD1234` to `WASFA-ABCD-1234`: what the pre-filled message carries. */
export function formatLoginToken(token: string): string {
  return `WASFA-${token.slice(0, 4)}-${token.slice(4)}`;
}

/** `ABCD1234` to `ABCD-1234`: what the page shows. */
export function displayLoginToken(token: string): string {
  return `${token.slice(0, 4)}-${token.slice(4)}`;
}

const entryBase = {
  /** WhatsApp message id: lets the api answer exactly this message, once. */
  id: z.string().min(1).max(128),
  /** Sender as E.164, resolved by the bridge (never taken from message text). */
  phone: z.string().regex(E164_PATTERN),
  /** Conversation to answer in; opaque to the api, echoed back in `wa:replies`. */
  jid: z.string().min(1).max(128),
  receivedAt: z.number().int().positive(),
};

/** One entry of `wa:login:in`. */
export const waLoginEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("login"),
    ...entryBase,
    token: waLoginTokenSchema,
    /** Clipped to 60 characters with control characters stripped by the bridge. */
    pushName: z.string().max(60).optional(),
  }),
  z.object({ kind: z.literal("logout"), ...entryBase }),
]);
export type WaLoginEntry = z.output<typeof waLoginEntrySchema>;

/** `POST /auth/whatsapp/start` takes no input: the challenge is bound to the browser by a cookie. */
export const waLoginStartRequestSchema = z.object({});

/** The response of `POST /auth/whatsapp/start`. */
export const waLoginStartResponseSchema = z.object({
  /** `XXXX-XXXX`, for display. */
  token: z.string(),
  waLink: z.string(),
  /** ISO timestamp. */
  expiresAt: z.string(),
});
export type WaLoginStartResponse = z.output<typeof waLoginStartResponseSchema>;

export const WA_LOGIN_REFUSAL_REASONS = ["two_factor", "privileged", "inactive"] as const;
export type WaLoginRefusalReason = (typeof WA_LOGIN_REFUSAL_REASONS)[number];
/** What the page can be told: the account refusals, plus "new accounts are closed right now". */
export const WA_LOGIN_STATUS_REASONS = [...WA_LOGIN_REFUSAL_REASONS, "signup_closed"] as const;
export type WaLoginStatusReason = (typeof WA_LOGIN_STATUS_REASONS)[number];

/** `GET /auth/whatsapp/status`. */
export const waLoginStatusResponseSchema = z.object({
  status: z.enum(["pending", "signed_in", "refused", "expired"]),
  isNew: z.boolean().optional(),
  reason: z.enum(WA_LOGIN_STATUS_REASONS).optional(),
});
export type WaLoginStatusResponse = z.output<typeof waLoginStatusResponseSchema>;

/** `POST /auth/whatsapp/magic`: the one-time token from the agent's link (base64url, 32 bytes). */
export const waMagicRequestSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

/** `GET /auth/whatsapp/availability`: whether the web draws the button. */
export const waLoginAvailabilityResponseSchema = z.object({ available: z.boolean() });

/** Control characters and bidi overrides: never part of a display name. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** `pushName` for the stream: control characters stripped, clipped to 60 characters. */
export function cleanPushName(value: string | null | undefined): string | undefined {
  const cleaned = (value ?? "").replace(UNSAFE_NAME_CHARS, "").trim();
  const clipped = Array.from(cleaned).slice(0, 60).join("").trim();
  return clipped === "" ? undefined : clipped;
}
