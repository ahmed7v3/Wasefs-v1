import {
  WA_CUSTOMER_LIST,
  WA_CUSTOMER_MAX_AGE_MS,
  WA_CUSTOMER_MAX_TEXT,
  WA_CUSTOMER_OPTOUT_SET,
  waCustomerMessageSchema,
  waCustomerDay,
  waCustomerResultKey,
  waCustomerSentKey,
} from "@wasfa/shared/customer-messages";

import { readSetting } from "../settings.js";

import { reserveOutboundDelay } from "./outbound-spacing.js";

import type { ReplySocket } from "./replies.js";
import type { Database } from "@wasfa/db";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * Customer notifications are the one place the bridge writes first (owner decision, 2026-10-17).
 * The worker already chose who may get them; this guard is the last line before WhatsApp: the
 * owner's switch (read here, so it also stops what is already queued), STOP, freshness, text and
 * link rules, a hard daily cap, one decision per message, and the shared spacing with replies.
 */

export type CustomerDenyReason =
  | "disabled"
  | "stale"
  | "opted_out"
  | "unsafe_text"
  | "cap_reached"
  | "already_decided"
  | "not_connected";

export type CustomerAuthorization =
  { ok: true; delayMs: number } | { ok: false; reason: CustomerDenyReason };

const SETTINGS_TTL_MS = 30_000;
const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 6_000;
/** Anything that looks like a link or a handle; only links to our own site are allowed. */
const URL_LIKE =
  /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|app|me|ly|online)\b\S*/gi;

export class CustomerGuard {
  private settingsAt = 0;
  private settings: { enabled: boolean; dailyCap: number } = { enabled: false, dailyCap: 0 };

  constructor(
    private readonly redis: Redis,
    private readonly db: Database,
    /** The web origin whose links may appear in a message (`WEB_ORIGIN`); null = no links at all. */
    private readonly linkOrigin: string | null,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
  ) {}

  private async current(): Promise<{ enabled: boolean; dailyCap: number }> {
    if (this.now() - this.settingsAt > SETTINGS_TTL_MS) {
      const { customerMessages } = await readSetting(this.db, "whatsapp");
      this.settings = { enabled: customerMessages.enabled, dailyCap: customerMessages.dailyCap };
      this.settingsAt = this.now();
    }
    return this.settings;
  }

  /** True when every link in `text` points at our own site. */
  linksAllowed(text: string): boolean {
    const links = text.match(URL_LIKE) ?? [];
    if (links.length === 0) return true;
    if (!this.linkOrigin) return false;
    const host = new URL(this.linkOrigin).host;
    return links.every((link) => {
      try {
        return new URL(link).host === host;
      } catch {
        return false;
      }
    });
  }

  async authorize(message: {
    id: string;
    jid: string;
    text: string;
    createdAt: number;
  }): Promise<CustomerAuthorization> {
    const resultKey = waCustomerResultKey(message.id);
    const deny = async (reason: CustomerDenyReason): Promise<CustomerAuthorization> => {
      // Recorded only if nobody decided yet: the worker's check reads it and mails instead.
      await this.redis.set(resultKey, `denied:${reason}`, "EX", 86_400, "NX");
      return { ok: false, reason };
    };

    const settings = await this.current();
    if (!settings.enabled) return deny("disabled");
    if (this.now() - message.createdAt > WA_CUSTOMER_MAX_AGE_MS) return deny("stale");
    if (message.text.length > WA_CUSTOMER_MAX_TEXT || !this.linksAllowed(message.text)) {
      return deny("unsafe_text");
    }
    if ((await this.redis.sismember(WA_CUSTOMER_OPTOUT_SET, message.jid)) === 1) {
      return deny("opted_out");
    }

    const counter = waCustomerSentKey(waCustomerDay(this.now()));
    const sent = await this.redis.incr(counter);
    if (sent === 1) await this.redis.expire(counter, 172_800);
    if (sent > settings.dailyCap) {
      await this.redis.decr(counter);
      return deny("cap_reached");
    }
    // One decision per message: a duplicate entry, or a check that already gave up, stops here.
    const claimed = await this.redis.set(resultKey, "sending", "EX", 86_400, "NX");
    if (claimed !== "OK") {
      await this.redis.decr(counter);
      return { ok: false, reason: "already_decided" };
    }
    const jitter = MIN_DELAY_MS + Math.floor(this.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
    return { ok: true, delayMs: await reserveOutboundDelay(this.redis, jitter, this.now()) };
  }

  async recordSent(id: string): Promise<void> {
    await this.redis
      .multi()
      .set("wa:last-sent", String(this.now()), "EX", 3_600)
      .set(waCustomerResultKey(id), "sent", "EX", 86_400)
      .exec();
  }

  async recordFailed(id: string): Promise<void> {
    await this.redis
      .multi()
      .decr(waCustomerSentKey(waCustomerDay(this.now())))
      .set(waCustomerResultKey(id), "failed", "EX", 86_400)
      .exec();
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type CustomerSendResult = "sent" | "invalid" | "failed" | CustomerDenyReason;

/** Sends one `wa:customer` entry, or records why not. */
export async function processCustomerMessage(
  raw: string,
  deps: { guard: CustomerGuard; socket: ReplySocket; logger: Logger; sleep?: typeof pause },
): Promise<CustomerSendResult> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  const parsed = waCustomerMessageSchema.safeParse(value);
  if (!parsed.success) return "invalid";
  const message = parsed.data;
  if (!deps.socket.isConnected()) {
    // Not claimed: the worker's check finds no "sent" and mails the customer.
    return "not_connected";
  }
  const authorization = await deps.guard.authorize(message);
  if (!authorization.ok) {
    deps.logger.info(
      { reason: authorization.reason, kind: message.kind },
      "Customer WhatsApp withheld",
    );
    return authorization.reason;
  }
  await (deps.sleep ?? pause)(authorization.delayMs);
  try {
    await deps.socket.sendText(message.jid, message.text);
  } catch {
    await deps.guard.recordFailed(message.id);
    deps.logger.warn({ kind: message.kind }, "Customer WhatsApp send failed");
    return "failed";
  }
  await deps.guard.recordSent(message.id);
  deps.logger.info({ kind: message.kind, length: message.text.length }, "Customer WhatsApp sent");
  return "sent";
}

/** Pops `wa:customer` until `signal` aborts; `redis` must be a connection of its own. */
export async function runCustomerLoop(input: {
  redis: Redis;
  guard: CustomerGuard;
  socket: ReplySocket;
  logger: Logger;
  signal: AbortSignal;
}): Promise<void> {
  while (!input.signal.aborted) {
    const item = await input.redis.brpop(WA_CUSTOMER_LIST, 5);
    if (!item) continue;
    await processCustomerMessage(item[1], input);
  }
}
