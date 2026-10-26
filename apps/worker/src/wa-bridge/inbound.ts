import { E164_PATTERN } from "@wasfa/shared/identity";
import { parseVerificationCode, type InboundMessage } from "@wasfa/shared/schemas/phone";

/** Messages older than this are history replayed after a reconnect, not a user waiting for a result. */
export const MAX_INBOUND_AGE_MS = 15 * 60_000;

type MaybeLong = number | { toNumber: () => number } | null | undefined;

/** The slice of a Baileys `WAMessage` the bridge reads. A structural type keeps this file testable without Baileys. */
export interface RawMessage {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean | null;
  };
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    ephemeralMessage?: { message?: RawMessage["message"] } | null;
    // Media and other content the agent reads (docs/WA-AGENT.md); the verification path ignores them.
    imageMessage?: {
      caption?: string | null;
      mimetype?: string | null;
      fileLength?: MaybeLong;
    } | null;
    documentMessage?: {
      caption?: string | null;
      mimetype?: string | null;
      fileLength?: MaybeLong;
    } | null;
    audioMessage?: {
      mimetype?: string | null;
      seconds?: number | null;
      fileLength?: MaybeLong;
    } | null;
    videoMessage?: object | null;
    stickerMessage?: object | null;
    locationMessage?: object | null;
    liveLocationMessage?: object | null;
    contactMessage?: object | null;
    contactsArrayMessage?: object | null;
  } | null;
  /** The sender's WhatsApp profile name. */
  pushName?: string | null;
  /** Seconds since the epoch; Baileys may hand over a `Long`. */
  messageTimestamp?: number | { toNumber: () => number } | null;
}

export interface LidResolver {
  /** LID jid to the phone-number jid, or null when WhatsApp has not told us. */
  getPNForLID: (lid: string) => Promise<string | null>;
}

export type IgnoreReason =
  "from_me" | "not_direct" | "not_text" | "no_code" | "unresolved_sender" | "stale" | "no_id";

export type Extracted = { ok: true; message: InboundMessage } | { ok: false; reason: IgnoreReason };
export type AlertOptInCommand = { action: "optin" | "optout"; jid: string; digits: string };

const PN_SERVER = "s.whatsapp.net";
const LID_SERVER = "lid";

/** `201012345678:12@s.whatsapp.net` to `{ user: "201012345678", server: "s.whatsapp.net" }`; device and agent suffixes are dropped. */
export function splitJid(jid: string): { user: string; server: string } | null {
  const at = jid.lastIndexOf("@");
  if (at <= 0) return null;
  const user = jid.slice(0, at).split(/[:_]/)[0] ?? "";
  const server = jid.slice(at + 1);
  return user === "" ? null : { user, server };
}

/** A 1:1 chat. Groups, statuses, broadcasts, newsletters and calls all have other servers. */
export function isDirectJid(jid: string | null | undefined): jid is string {
  if (!jid) return false;
  const parts = splitJid(jid);
  return parts !== null && (parts.server === PN_SERVER || parts.server === LID_SERVER);
}

function phoneFromPnJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const parts = splitJid(jid);
  if (parts?.server !== PN_SERVER || !/^\d{6,15}$/.test(parts.user)) return null;
  const phone = `+${parts.user}`;
  return E164_PATTERN.test(phone) ? phone : null;
}

function textOf(message: RawMessage["message"]): string | null {
  if (!message) return null;
  const direct = message.conversation ?? message.extendedTextMessage?.text;
  if (typeof direct === "string") return direct;
  // Disappearing-message chats wrap the content one level down.
  return message.ephemeralMessage ? textOf(message.ephemeralMessage.message) : null;
}

function secondsOf(value: RawMessage["messageTimestamp"]): number | null {
  if (value === null || value === undefined) return null;
  const seconds = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** The text and the sender's phone of a fresh 1:1 message, for the bridge's keyword commands. */
async function commandOf(
  raw: RawMessage,
  resolver: LidResolver,
  now: number,
): Promise<{ text: string; digits: string } | null> {
  if (raw.key.fromMe || !isDirectJid(raw.key.remoteJid) || !raw.key.id) return null;
  const original = textOf(raw.message);
  if (original === null) return null;
  const seconds = secondsOf(raw.messageTimestamp);
  if (seconds !== null && now - seconds * 1000 > MAX_INBOUND_AGE_MS) return null;
  let phone = phoneFromPnJid(raw.key.remoteJid) ?? phoneFromPnJid(raw.key.remoteJidAlt);
  if (phone === null && splitJid(raw.key.remoteJid)?.server === LID_SERVER) {
    try {
      phone = phoneFromPnJid(await resolver.getPNForLID(raw.key.remoteJid));
    } catch {
      phone = null;
    }
  }
  if (!phone) return null;
  return { text: original.trim(), digits: phone.slice(1) };
}

export async function extractAlertOptInCommand(
  raw: RawMessage,
  resolver: LidResolver,
  now = Date.now(),
): Promise<AlertOptInCommand | null> {
  const text = textOf(raw.message)?.trim() ?? "";
  const action =
    text.toLocaleUpperCase() === "ALERTS ON" || text === "تنبيهات"
      ? "optin"
      : text.toLocaleUpperCase() === "ALERTS OFF" || text === "إيقاف التنبيهات"
        ? "optout"
        : null;
  if (!action) return null;
  const command = await commandOf(raw, resolver, now);
  if (!command) return null;
  return { action, digits: command.digits, jid: `${command.digits}@s.whatsapp.net` };
}

export type CustomerPrefCommand = { action: "stop" | "start"; jid: string; digits: string };

const STOP_WORDS = new Set(["STOP", "إيقاف", "ايقاف", "الغاء", "إلغاء"]);
const START_WORDS = new Set(["START", "تشغيل"]);

/**
 * A customer's STOP / START for WhatsApp notifications: the whole message is the keyword (any
 * case), so a sentence that merely contains it is not a command.
 */
export async function extractCustomerPrefCommand(
  raw: RawMessage,
  resolver: LidResolver,
  now = Date.now(),
): Promise<CustomerPrefCommand | null> {
  const text = (textOf(raw.message)?.trim() ?? "").toLocaleUpperCase();
  const action = STOP_WORDS.has(text) ? "stop" : START_WORDS.has(text) ? "start" : null;
  if (!action) return null;
  const command = await commandOf(raw, resolver, now);
  if (!command) return null;
  return { action, digits: command.digits, jid: `${command.digits}@s.whatsapp.net` };
}

/**
 * Turns a raw WhatsApp message into a verification claim, or says why not. Accepts only 1:1 text
 * messages from other people that contain a 6-digit code; the sender's phone number comes from the
 * jid (or its LID mapping), never from the message text.
 */
export async function extractInbound(
  raw: RawMessage,
  resolver: LidResolver,
  now: number = Date.now(),
): Promise<Extracted> {
  const { key } = raw;
  if (key.fromMe) return { ok: false, reason: "from_me" };
  if (!isDirectJid(key.remoteJid)) return { ok: false, reason: "not_direct" };
  if (!key.id) return { ok: false, reason: "no_id" };

  const text = textOf(raw.message);
  if (text === null) return { ok: false, reason: "not_text" };
  const code = parseVerificationCode(text);
  if (code === null) return { ok: false, reason: "no_code" };

  const seconds = secondsOf(raw.messageTimestamp);
  const receivedAt = seconds === null ? now : seconds * 1000;
  if (now - receivedAt > MAX_INBOUND_AGE_MS) return { ok: false, reason: "stale" };

  let phone = phoneFromPnJid(key.remoteJid) ?? phoneFromPnJid(key.remoteJidAlt);
  if (phone === null && splitJid(key.remoteJid)?.server === LID_SERVER) {
    try {
      phone = phoneFromPnJid(await resolver.getPNForLID(key.remoteJid));
    } catch {
      phone = null;
    }
  }
  if (phone === null) return { ok: false, reason: "unresolved_sender" };

  return {
    ok: true,
    message: { id: key.id, phone, code, receivedAt, jid: key.remoteJid },
  };
}

/** When the message was sent (epoch ms), or `fallback` when WhatsApp gave no timestamp. */
export function sentAtMs(raw: RawMessage, fallback: number): number {
  const seconds = secondsOf(raw.messageTimestamp);
  return seconds === null ? fallback : seconds * 1000;
}

/**
 * The phone number of the other side of a 1:1 chat (E.164), from the chat jid, its alternate form
 * or the LID mapping; null when WhatsApp has not told us. Used for the agent, which keeps a chat
 * it cannot resolve instead of dropping it (a guest).
 */
export async function chatPhone(raw: RawMessage, resolver: LidResolver): Promise<string | null> {
  let phone = phoneFromPnJid(raw.key.remoteJid) ?? phoneFromPnJid(raw.key.remoteJidAlt);
  if (phone === null && raw.key.remoteJid && splitJid(raw.key.remoteJid)?.server === LID_SERVER) {
    try {
      phone = phoneFromPnJid(await resolver.getPNForLID(raw.key.remoteJid));
    } catch {
      phone = null;
    }
  }
  return phone;
}

/** The agent's key for a chat: the phone-number jid when known, else the LID jid as given. */
export function agentChatJid(phone: string | null, remoteJid: string): string {
  return phone === null ? remoteJid : `${phone.slice(1)}@s.whatsapp.net`;
}
