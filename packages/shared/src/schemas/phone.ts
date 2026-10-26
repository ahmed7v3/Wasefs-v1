import { z } from "zod";

import { t } from "../i18n/public.js";
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
/** WhatsApp AI agent streams (docs/WA-AGENT.md): bridge to api, api to bridge, bridge to api (delivery result). */
export const WA_AGENT_IN_STREAM = "wa:agent:in";
export const WA_AGENT_OUT_STREAM = "wa:agent:out";
export const WA_AGENT_SENT_STREAM = "wa:agent:sent";
export const WA_AGENT_STREAM_MAXLEN = 10_000;
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

export const replyOutcomeSchema = z.enum([
  "verified",
  "invalid",
  "alerts_on",
  "alerts_off",
  "messages_off",
  "messages_on",
]);
export type ReplyOutcome = z.output<typeof replyOutcomeSchema>;

/** The only two sentences the bridge may ever send. The api picks one by name; it cannot supply text. */
export function replyText(outcome: ReplyOutcome): string {
  if (outcome === "alerts_on") return t("phone.reply.alertsOn");
  if (outcome === "alerts_off") return t("phone.reply.alertsOff");
  if (outcome === "messages_off") return t("phone.reply.messagesOff");
  if (outcome === "messages_on") return t("phone.reply.messagesOn");
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

// ---------------------------------------------------------------------------------------------
// Control channel: the admin (api) tells the long-running bridge to link or unlink the number.
// ---------------------------------------------------------------------------------------------

/**
 * Redis list the api `LPUSH`es commands onto (`LTRIM`med and given a short expiry, so a command
 * issued while the bridge was down cannot fire minutes later) and the bridge `BRPOP`s (FIFO).
 */
export const WA_COMMANDS_KEY = "wa:commands";
export const WA_COMMANDS_MAXLEN = 20;
export const WA_COMMANDS_TTL_SECONDS = 5 * 60;
/** The bridge's answer to the last command, read by `GET /admin/whatsapp`. Expires with the pairing code. */
export const WA_PAIRING_KEY = "wa:pairing";
/** A pairing code is valid for about this long; the key and the bridge's pairing window match it. */
export const WA_PAIRING_TTL_SECONDS = 180;

const commandId = z.string().min(1).max(64);
/** Digits with country code, no `+`: what WhatsApp's pairing endpoint takes. */
export const waNumberDigitsSchema = z.string().regex(/^[1-9]\d{7,14}$/);

export const waCommandSchema = z.discriminatedUnion("cmd", [
  z.object({ id: commandId, cmd: z.literal("link"), number: waNumberDigitsSchema }),
  z.object({ id: commandId, cmd: z.literal("unlink") }),
]);
export type WaCommand = z.output<typeof waCommandSchema>;

export const WA_PAIRING_STATES = [
  "requested",
  "code",
  "linked",
  "already_linked",
  "unlinked",
  "error",
] as const;
export type WaPairingState = (typeof WA_PAIRING_STATES)[number];

/** Machine reasons the bridge puts on `state: "error"` (fixed strings: never an upstream error message). */
export const WA_PAIRING_ERRORS = [
  "pairing_request_failed",
  "connection_closed",
  "timeout",
  "unlink_failed",
] as const;
export type WaPairingError = (typeof WA_PAIRING_ERRORS)[number];

/** Pairing codes are 8 characters from A-Z and 0-9. A short-lived secret: only ever in `wa:pairing`. */
export const waPairingCodeSchema = z.string().regex(/^[A-Z0-9]{8}$/);

/** The value of `wa:pairing`. `expiresAt` is epoch milliseconds, present with `state: "code"`. */
export const waPairingSchema = z.object({
  id: commandId,
  cmd: z.enum(["link", "unlink"]),
  state: z.enum(WA_PAIRING_STATES),
  code: waPairingCodeSchema.optional(),
  /** Masked: only the last four digits. */
  number: z.string().max(32).optional(),
  expiresAt: z.number().int().positive().optional(),
  reason: z.enum(WA_PAIRING_ERRORS).optional(),
});
export type WaPairing = z.output<typeof waPairingSchema>;

/** `••••1234`: enough for the admin to recognise the number, nothing more. */
export function maskWaNumber(digits: string): string {
  return `••••${digits.slice(-4)}`;
}

export const PHONE_VERIFY_STATUSES = ["none", "pending", "verified", "failed"] as const;
export type PhoneVerifyStatus = (typeof PHONE_VERIFY_STATUSES)[number];
