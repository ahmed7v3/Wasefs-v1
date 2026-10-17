import { utcDay } from "../notifications/cap-guard.js";

import { reserveOutboundDelay } from "./outbound-spacing.js";

import type { Redis } from "ioredis";

export type AlertDenyReason = "disabled" | "not_opted_in" | "cap_reached" | "unsafe_text";
export type AlertAuthorization =
  { ok: true; delayMs: number } | { ok: false; reason: AlertDenyReason };

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|app)\b/i;

export class AlertGuard {
  constructor(
    private readonly redis: Redis,
    private readonly enabled: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  async authorize(jid: string, text: string, requestedCap: number): Promise<AlertAuthorization> {
    if (!this.enabled) return { ok: false, reason: "disabled" };
    if (text.length < 1 || text.length > 300 || URL_PATTERN.test(text))
      return { ok: false, reason: "unsafe_text" };
    if ((await this.redis.sismember("wa:alert_optin_jids", jid)) !== 1)
      return { ok: false, reason: "not_opted_in" };
    const cap = Math.min(20, Math.max(1, Math.trunc(requestedCap)));
    const day = utcDay(this.now());
    const key = `wa:alert-sent:${day}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 172_800);
    if (count > cap) {
      await this.redis.decr(key);
      return { ok: false, reason: "cap_reached" };
    }
    const delayMs = await reserveOutboundDelay(this.redis, 0, this.now());
    return { ok: true, delayMs };
  }

  async recordSent(): Promise<void> {
    const multi = this.redis.multi();
    multi.set("wa:last-sent", String(this.now()));
    await multi.exec();
  }

  async releaseReservation(): Promise<void> {
    await this.redis.decr(`wa:alert-sent:${utcDay(this.now())}`);
  }
}
