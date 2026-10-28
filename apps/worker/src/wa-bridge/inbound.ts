import { E164_PATTERN } from "@wasfa/shared/identity";
import { parseVerificationCode, type InboundMessage } from "@wasfa/shared/schemas/phone";
import { cleanPushName, parseLoginToken, type WaLoginEntry } from "@wasfa/shared/schemas/wa-login";

/** Messages older than this are history replayed after a reconnect, not a user waiting for a result. */
export const MAX_INBOUND_AGE_MS = 15 * 60_000;

type MaybeLong = number | { toNumber: () => number } | null | undefined;

/** A wrapper Baileys' `normalizeMessageContent` looks through: the real content is one level down. */
interface Wrapper {
  message?: RawContent | null;
}

/**
 * The wrapper fields of `normalizeMessageContent` (Baileys Utils/messages.js) plus
 * `deviceSentMessage` (which Baileys unwraps while decrypting). Business and ad-origin senders use
 * view-once, edited and document-with-caption wrappers that a plain-text reader never sees.
 */
export const WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "documentWithCaptionMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "editedMessage",
  "associatedChildMessage",
  "groupStatusMessage",
  "groupStatusMessageV2",
  "deviceSentMessage",
] as const;

export interface RawContent {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  ephemeralMessage?: Wrapper | null;
  viewOnceMessage?: Wrapper | null;
  documentWithCaptionMessage?: Wrapper | null;
  viewOnceMessageV2?: Wrapper | null;
  viewOnceMessageV2Extension?: Wrapper | null;
  editedMessage?: Wrapper | null;
  associatedChildMessage?: Wrapper | null;
  groupStatusMessage?: Wrapper | null;
  groupStatusMessageV2?: Wrapper | null;
  deviceSentMessage?: Wrapper | null;
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
}

/** The slice of a Baileys `WAMessage` the bridge reads. A structural type keeps this file testable without Baileys. */
export interface RawMessage {
  key: {
    id?: string | null;
    remoteJid?: string | null;
    /** The other form of the sender: the phone-number jid of a LID chat, or the LID of a phone chat. */
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
    fromMe?: boolean | null;
  };
  message?: RawContent | null;
  /** Set when decryption failed (CIPHERTEXT); `message` is then empty. */
  messageStubType?: number | string | null;
  messageStubParameters?: (string | null)[] | null;
  /** The business name WhatsApp verified; present for business senders only. */
  verifiedBizName?: string | null;
  /** The sender's WhatsApp profile name. */
  pushName?: string | null;
  /** Seconds since the epoch; Baileys may hand over a `Long`. */
  messageTimestamp?: number | { toNumber: () => number } | null;
}

export interface LidResolver {
  /** LID jid to the phone-number jid, or null when WhatsApp has not told us. */
  getPNForLID: (lid: string) => Promise<string | null>;
  /** Remembers a `lid -> phone-number jid` pair that WhatsApp handed over with a message. */
  learn?: (lid: string, pn: string) => Promise<void>;
  /**
   * The phone-number jid of the number that claimed `code` whose LID WhatsApp says is `lid`, or
   * null. The pairing comes from WhatsApp (phone to LID lookup), never from the message.
   */
  resolveClaimed?: (lid: string, code: string) => Promise<string | null>;
}

export type IgnoreReason =
  "from_me" | "not_direct" | "not_text" | "no_code" | "unresolved_sender" | "stale" | "no_id";

export type Extracted = { ok: true; message: InboundMessage } | { ok: false; reason: IgnoreReason };
export type AlertOptInCommand = { action: "optin" | "optout"; jid: string; digits: string };

const PN_SERVER = "s.whatsapp.net";
const LID_SERVER = "lid";
// Business-platform ("hosted") accounts: the same user part on another server.
const HOSTED_PN_SERVER = "hosted";
const HOSTED_LID_SERVER = "hosted.lid";

export type Addressing = "pn" | "lid" | "unknown";

/** `201012345678:12@s.whatsapp.net` to `{ user: "201012345678", server: "s.whatsapp.net" }`; device and agent suffixes are dropped. */
export function splitJid(jid: string): { user: string; server: string } | null {
  const at = jid.lastIndexOf("@");
  if (at <= 0) return null;
  const user = jid.slice(0, at).split(/[:_]/)[0] ?? "";
  const server = jid.slice(at + 1);
  return user === "" ? null : { user, server };
}

/** How a jid addresses a person: by phone number, by LID, or not a person at all. */
export function addressingOf(jid: string | null | undefined): Addressing {
  const server = jid ? splitJid(jid)?.server : undefined;
  if (server === PN_SERVER || server === HOSTED_PN_SERVER) return "pn";
  if (server === LID_SERVER || server === HOSTED_LID_SERVER) return "lid";
  return "unknown";
}

/** A 1:1 chat. Groups, statuses, broadcasts, newsletters and calls all have other servers. */
export function isDirectJid(jid: string | null | undefined): jid is string {
  return !!jid && addressingOf(jid) !== "unknown";
}

function phoneFromPnJid(jid: string | null | undefined): string | null {
  if (!jid || addressingOf(jid) !== "pn") return null;
  const user = splitJid(jid)?.user ?? "";
  if (!/^\d{6,15}$/.test(user)) return null;
  const phone = `+${user}`;
  return E164_PATTERN.test(phone) ? phone : null;
}

/**
 * The content under any chain of wrappers (what Baileys' `normalizeMessageContent` returns; it also
 * stops after 5 levels). Pure, so structural fixtures can exercise it.
 */
export function unwrapContent(message: RawContent | null | undefined): RawContent | null {
  let content = message ?? null;
  for (let depth = 0; content && depth < 5; depth += 1) {
    const current: RawContent = content;
    const wrapper = WRAPPER_KEYS.map((key) => current[key]).find((item) => item?.message);
    if (!wrapper?.message) break;
    content = wrapper.message;
  }
  return content;
}

function textOf(message: RawContent | null | undefined): string | null {
  const content = unwrapContent(message);
  if (!content) return null;
  const direct = content.conversation ?? content.extendedTextMessage?.text;
  return typeof direct === "string" ? direct : null;
}

function secondsOf(value: RawMessage["messageTimestamp"]): number | null {
  if (value === null || value === undefined) return null;
  const seconds = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * The sender's phone (E.164); never taken from message text. In order: the chat jid when it is a
 * phone-number jid; the alternate forms Baileys puts on the key (`remoteJidAlt` is the phone jid of
 * a LID chat, `participantAlt` the same for group-style keys); then the LID mapping (WhatsApp's own
 * store, backed by our Redis cache). Baileys has no on-demand LID to phone lookup (usync only goes
 * phone to LID), so a LID it was never told about stays unresolved.
 */
export async function resolveSenderPhone(
  raw: RawMessage,
  resolver: LidResolver,
): Promise<string | null> {
  const { remoteJid, remoteJidAlt, participantAlt } = raw.key;
  const direct = phoneFromPnJid(remoteJid);
  if (direct !== null) return direct;
  const lid = remoteJid && addressingOf(remoteJid) === "lid" ? remoteJid : null;
  for (const alt of [remoteJidAlt, participantAlt]) {
    const phone = phoneFromPnJid(alt);
    if (phone === null || !alt) continue;
    if (lid) await resolver.learn?.(lid, alt).catch(() => undefined);
    return phone;
  }
  if (!lid) return null;
  try {
    return phoneFromPnJid(await resolver.getPNForLID(lid));
  } catch {
    return null;
  }
}

/**
 * A LID sender WhatsApp did not pair with a number (common for WhatsApp Business): the number that
 * claimed this code, if WhatsApp says that number's LID is the sender's.
 */
async function claimedPhone(
  remoteJid: string,
  code: string,
  resolver: LidResolver,
): Promise<string | null> {
  if (addressingOf(remoteJid) !== "lid" || !resolver.resolveClaimed) return null;
  try {
    return phoneFromPnJid(await resolver.resolveClaimed(remoteJid, code));
  } catch {
    return null;
  }
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
  const phone = await resolveSenderPhone(raw, resolver);
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

/** Where to answer: the chat jid as given, except hosted jids, which are answered on the phone-number jid. */
function replyJidOf(remoteJid: string, phone: string): string {
  const server = splitJid(remoteJid)?.server;
  return server === HOSTED_PN_SERVER || server === HOSTED_LID_SERVER
    ? `${phone.slice(1)}@${PN_SERVER}`
    : remoteJid;
}

const LOGOUT_WORDS = new Set(["خروج", "LOGOUT"]);

export type LoginCommand =
  | { ok: true; entry: WaLoginEntry }
  | { ok: false; reason: "unresolved_sender"; id: string; jid: string };

/**
 * "Continue with WhatsApp" (docs/WA-SIGNUP.md): a fresh 1:1 text that carries a `WASFA-XXXX-XXXX`
 * token is a sign-in claim; the whole message `خروج` / `LOGOUT` (any case) is the undo. The sender's
 * phone comes from the jid or its LID mapping, never from the text. Null when the message is
 * neither (or too old to be a user waiting).
 */
export async function extractLoginCommand(
  raw: RawMessage,
  resolver: LidResolver,
  now: number = Date.now(),
): Promise<LoginCommand | null> {
  const { key } = raw;
  if (key.fromMe || !isDirectJid(key.remoteJid) || !key.id) return null;
  const text = textOf(raw.message);
  if (text === null) return null;
  const trimmed = text.trim();
  const logout = LOGOUT_WORDS.has(trimmed.toLocaleUpperCase());
  const token = logout ? null : parseLoginToken(trimmed);
  if (!logout && token === null) return null;

  const seconds = secondsOf(raw.messageTimestamp);
  const receivedAt = seconds === null ? now : seconds * 1000;
  if (now - receivedAt > MAX_INBOUND_AGE_MS) return null;

  const phone = await resolveSenderPhone(raw, resolver);
  if (phone === null)
    return { ok: false, reason: "unresolved_sender", id: key.id, jid: key.remoteJid };

  const base = { id: key.id, phone, jid: replyJidOf(key.remoteJid, phone), receivedAt };
  if (token === null) return { ok: true, entry: { kind: "logout", ...base } };
  const pushName = cleanPushName(raw.pushName);
  return {
    ok: true,
    entry: { kind: "login", ...base, token, ...(pushName ? { pushName } : {}) },
  };
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

  const phone =
    (await resolveSenderPhone(raw, resolver)) ??
    (await claimedPhone(key.remoteJid, code, resolver));
  if (phone === null) {
    return { ok: false, reason: "unresolved_sender" };
  }

  return {
    ok: true,
    message: { id: key.id, phone, code, receivedAt, jid: replyJidOf(key.remoteJid, phone) },
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
export function chatPhone(raw: RawMessage, resolver: LidResolver): Promise<string | null> {
  return resolveSenderPhone(raw, resolver);
}

/** The agent's key for a chat: the phone-number jid when known, else the LID jid as given. */
export function agentChatJid(phone: string | null, remoteJid: string): string {
  return phone === null ? remoteJid : `${phone.slice(1)}@s.whatsapp.net`;
}
