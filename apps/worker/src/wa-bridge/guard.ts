import { createHash } from "node:crypto";

import { utcDay } from "../notifications/cap-guard.js";

import { isDirectJid } from "./inbound.js";

import type { Redis } from "ioredis";

/*
 * Anti-ban rules for the WhatsApp number (SECURITY.md section 8). Every outbound message goes
 * through `ReplyGuard.authorize`; nothing else in the bridge may call `sendMessage`. The rules:
 *
 *  - never start a conversation: only answer a message we received, in that same chat, within 24 h
 *  - at most one reply per inbound message
 *  - only the fixed short sentences (no links, no media), and only to 1:1 chats
 *  - a human-looking delay (2-6 s), at least 3 s between any two replies, 300 replies a day;
 *    above the cap the bridge stays silent (the web UI shows the result anyway)
 */

export const INBOUND_WINDOW_SECONDS = 24 * 60 * 60;
export const MIN_DELAY_MS = 2_000;
export const MAX_DELAY_MS = 6_000;
export const MIN_SPACING_MS = 3_000;
export const DAILY_REPLY_CAP = 300;
const MAX_REPLY_LENGTH = 60;
const LINK_LIKE = /https?:|www\.|\w\.(com|net|org|io|app|me|ly)\b|@\w/i;

export type DenyReason =
  "not_direct" | "text_not_allowed" | "no_recent_inbound" | "already_replied" | "daily_cap";

export type Authorization = { ok: true; delayMs: number } | { ok: false; reason: DenyReason };

/** Keys never carry a jid (it contains the phone number): a hash does. */
function jidKey(jid: string): string {
  return createHash("sha256").update(jid).digest("hex").slice(0, 24);
}

/** A reply is plain short text: no URL, no handle, nothing a spam filter would weigh. */
export function isAllowedReplyText(text: string): boolean {
  return text.length > 0 && text.length <= MAX_REPLY_LENGTH && !LINK_LIKE.test(text);
}

export class ReplyGuard {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  /** Call for every accepted inbound message: it is what makes a reply to this chat legitimate. */
  async noteInbound(jid: string, messageId: string): Promise<void> {
    const chat = jidKey(jid);
    await this.redis
      .multi()
      .set(`wa:in:${chat}`, String(this.now()), "EX", INBOUND_WINDOW_SECONDS)
      .set(`wa:in:${chat}:${messageId}`, "1", "EX", INBOUND_WINDOW_SECONDS)
      .exec();
  }

  /**
   * May we answer `inboundId` in `jid` with `text`? On success the message is marked as answered
   * and the caller must wait `delayMs`, send, then call `recordSent`.
   */
  async authorize(request: {
    jid: string;
    inboundId: string;
    text: string;
  }): Promise<Authorization> {
    const { jid, inboundId, text } = request;
    if (!isDirectJid(jid)) return { ok: false, reason: "not_direct" };
    if (!isAllowedReplyText(text)) return { ok: false, reason: "text_not_allowed" };

    const chat = jidKey(jid);
    const [chatSeen, messageSeen] = await Promise.all([
      this.redis.exists(`wa:in:${chat}`),
      this.redis.exists(`wa:in:${chat}:${inboundId}`),
    ]);
    if (chatSeen === 0 || messageSeen === 0) return { ok: false, reason: "no_recent_inbound" };

    const sentToday = Number((await this.redis.get(`wa:sent:${utcDay(this.now())}`)) ?? 0);
    if (sentToday >= DAILY_REPLY_CAP) return { ok: false, reason: "daily_cap" };

    const first = await this.redis.set(
      `wa:replied:${chat}:${inboundId}`,
      "1",
      "EX",
      INBOUND_WINDOW_SECONDS,
      "NX",
    );
    if (first !== "OK") return { ok: false, reason: "already_replied" };

    const jitter = MIN_DELAY_MS + Math.floor(this.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
    const lastSent = Number((await this.redis.get("wa:last-sent")) ?? 0);
    const untilSpaced = lastSent + MIN_SPACING_MS - this.now();
    return { ok: true, delayMs: Math.max(jitter, untilSpaced) };
  }

  /** Counts a reply that was really sent: feeds the spacing rule and the daily cap. */
  async recordSent(): Promise<void> {
    const day = utcDay(this.now());
    await this.redis
      .multi()
      .set("wa:last-sent", String(this.now()), "EX", 3_600)
      .incr(`wa:sent:${day}`)
      .expire(`wa:sent:${day}`, 2 * 24 * 60 * 60)
      .exec();
  }
}
