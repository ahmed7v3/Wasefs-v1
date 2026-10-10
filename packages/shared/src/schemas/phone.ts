import { z } from "zod";

import { t } from "../i18n/index.js";
import { E164_PATTERN } from "../identity.js";

/*
 * Phone verification by inbound WhatsApp ("reverse OTP"). The user sends a short code FROM their
 * number to ours; the proof is the sender, not the code. These are the shapes shared by the api
 * (challenges, endpoints) and the wa-bridge in the worker (what it pushes and what it may answer).
 */

export const PHONE_CODE_LENGTH = 6;
/** A challenge lives this long; the code is single-use. */
export const PHONE_VERIFY_TTL_SECONDS = 10 * 60;

/** Redis stream the bridge appends inbound codes to (`MAXLEN ~ 10000`) and the api consumes. */
export const WA_INBOUND_STREAM = "wa:inbound";
export const WA_INBOUND_MAXLEN = 10_000;
/** Redis stream the api appends outcomes to; the bridge turns each into at most one short reply. */
export const WA_REPLY_STREAM = "wa:replies";
/** `{ at, state }` written by the bridge every 30 s; absent or old means the bridge is down. */
export const WA_HEARTBEAT_KEY = "wa:heartbeat";
export const WA_HEARTBEAT_INTERVAL_MS = 30_000;
export const WA_HEARTBEAT_STALE_AFTER_MS = 90_000;

export const WA_CONNECTION_STATES = [
  "connecting",
  "connected",
  "disconnected",
  "logged_out",
] as const;
export type WaConnectionState = (typeof WA_CONNECTION_STATES)[number];

export const waHeartbeatSchema = z.object({
  at: z.number().int().positive(),
  state: z.enum(WA_CONNECTION_STATES),
});
export type WaHeartbeat = z.output<typeof waHeartbeatSchema>;

export type WaStatus = WaConnectionState | "down";

/** What the bridge is doing, judged from its last heartbeat. A silent bridge is `down`. */
export function waStatus(stored: string | null, now: number = Date.now()): WaStatus {
  if (stored === null) return "down";
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return "down";
  }
  const beat = waHeartbeatSchema.safeParse(value);
  if (!beat.success) return "down";
  const age = now - beat.data.at;
  return age >= -30_000 && age <= WA_HEARTBEAT_STALE_AFTER_MS ? beat.data.state : "down";
}

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits to ASCII, so a code typed on an Arabic keyboard still parses. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(
      code >= EXTENDED_ARABIC_INDIC_ZERO
        ? code - EXTENDED_ARABIC_INDIC_ZERO
        : code - ARABIC_INDIC_ZERO,
    );
  });
}

const CODE_IN_TEXT = /(?<!\d)(\d{6})(?!\d)/;

/** The first stand-alone 6-digit number in a message, or null. Longer digit runs (phone numbers) never match. */
export function parseVerificationCode(text: string): string | null {
  return CODE_IN_TEXT.exec(normalizeDigits(text))?.[1] ?? null;
}

/** The text the `wa.me` link pre-fills, in the user's language. */
export function verificationMessage(code: string, locale: "ar" | "en" = "ar"): string {
  return t("phone.verify.waMessage", { code }, locale);
}

export const replyOutcomeSchema = z.enum(["verified", "invalid"]);
export type ReplyOutcome = z.output<typeof replyOutcomeSchema>;

/** The only two sentences the bridge may ever send. The api picks one by name; it cannot supply text. */
export function replyText(outcome: ReplyOutcome): string {
  return t(outcome === "verified" ? "phone.reply.verified" : "phone.reply.invalid");
}

export const startPhoneVerificationSchema = z.object({
  phoneNumber: z.string().trim().regex(E164_PATTERN),
});

/** One entry of `wa:inbound`. */
export const inboundMessageSchema = z.object({
  /** WhatsApp message id: lets the bridge answer exactly this message, once. */
  id: z.string().min(1).max(128),
  /** Sender as E.164, resolved by the bridge (never taken from message text). */
  phone: z.string().regex(E164_PATTERN),
  code: z.string().regex(/^\d{6}$/),
  /** Epoch milliseconds the message was sent. */
  receivedAt: z.number().int().positive(),
  /** Conversation to answer in; opaque to the api, which echoes it back in `wa:replies`. */
  jid: z.string().min(1).max(128),
});
export type InboundMessage = z.output<typeof inboundMessageSchema>;

/** One entry of `wa:replies`. */
export const replyRequestSchema = z.object({
  inboundId: z.string().min(1).max(128),
  jid: z.string().min(1).max(128),
  outcome: replyOutcomeSchema,
});
export type ReplyRequest = z.output<typeof replyRequestSchema>;

export const PHONE_VERIFY_STATUSES = ["none", "pending", "verified", "failed"] as const;
export type PhoneVerifyStatus = (typeof PHONE_VERIFY_STATUSES)[number];
