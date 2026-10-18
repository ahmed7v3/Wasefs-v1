import type { Redis } from "ioredis";
import type { Logger } from "pino";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;
const ALERT_RATIO = 0.8;
/**
 * Marketing (lifecycle) mail stops at this share of the daily cap, so the rest of the day's quota is
 * always left for transactional mail (GROWTH §6: lifecycle mail is deferred before anything else).
 */
const MARKETING_RATIO = 0.6;

export interface Reservation {
  key: string;
}

export type CapDecision = ({ allowed: true } & Reservation) | { allowed: false; retryAt: number };

/** `YYYYMMDD` of the UTC day, the unit the provider quota resets on. */
export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * Keeps the worker under the provider's daily quota (Brevo free plan: 300). Every send reserves a
 * slot in a Redis counter for the current UTC day. Over the cap, critical mail (verification, reset:
 * someone is waiting for it) is still sent, since a locked-out user costs more than a provider
 * warning, while everything else waits for the next day. At 80 % an alert is raised once a day.
 */
export class MailCapGuard {
  constructor(
    private readonly redis: Redis,
    private readonly cap: number,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async reserve(critical: boolean, marketing = false): Promise<CapDecision> {
    const at = this.now();
    const day = utcDay(at);
    const key = `mail:count:${day}`;
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, KEY_TTL_SECONDS);

    const limit = marketing ? Math.floor(this.cap * MARKETING_RATIO) : this.cap;
    if (used > limit && !critical) {
      await this.redis.decr(key);
      // Next UTC midnight plus up to 5 minutes, so a backlog does not all wake in the same second.
      const nextDay = (Math.floor(at / DAY_MS) + 1) * DAY_MS;
      return { allowed: false, retryAt: nextDay + Math.floor(Math.random() * 5 * 60_000) };
    }
    if (used > this.cap) {
      this.logger.warn({ used, cap: this.cap }, "Mail cap exceeded by critical mail");
    }

    if (used >= Math.ceil(this.cap * ALERT_RATIO)) {
      // `NX`: one alert per day. The admin dashboard (Phase 8) reads this key.
      const first = await this.redis.set(
        `mail:alert:${day}`,
        String(used),
        "EX",
        KEY_TTL_SECONDS,
        "NX",
      );
      if (first === "OK") {
        this.logger.warn({ used, cap: this.cap }, "Mail daily cap is at 80 percent");
      }
    }
    return { allowed: true, key };
  }

  /** Gives the slot back when the send failed, so retries do not eat the quota. */
  async release(reservation: Reservation): Promise<void> {
    await this.redis.decr(reservation.key);
  }
}
