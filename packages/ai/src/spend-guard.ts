import { aiPausedError } from "./refusals.js";

import type { SpendRedis } from "./redis-like.js";

/*
 * Global daily provider spend (USD micros) in Redis, per UTC day. The estimate is added when a call
 * starts and corrected when it ends, so concurrent calls see each other's in-flight spend.
 */

const SPEND_TTL_SECONDS = 3 * 24 * 60 * 60;
const ALERTED_TTL_SECONDS = 2 * 24 * 60 * 60;

export interface SpendLimits {
  /** 0 pauses all AI work (the cap is already reached). */
  dailyCapUsdMicros: number;
  /** Percent of the cap at which the alert fires, once per day. */
  alertPercent: number;
}

export interface SpendAlert {
  day: string;
  spendUsdMicros: number;
  capUsdMicros: number;
  alertPercent: number;
}

export interface SpendGuard {
  /** Throws `UPSTREAM_UNAVAILABLE` (`ai_paused`) when today's spend has reached the cap. */
  check(capMicros: number): Promise<void>;
  /** Adds the estimated cost of a call about to start; returns the UTC day it was booked on. */
  add(estimateMicros: number): Promise<string>;
  /** Moves today's figure by `actual - estimate`; `day` is the one `add` returned (a call can cross midnight). */
  correct(deltaMicros: number, day?: string): Promise<void>;
}

export interface SpendGuardOptions {
  limits: () => Promise<SpendLimits>;
  /** Called at most once per UTC day, when spend first reaches the alert threshold. */
  onAlert: (alert: SpendAlert) => void | Promise<void>;
  now?: () => Date;
}

export const spendKey = (day: string) => `ai:spend:${day}`;
export const spendAlertedKey = (day: string) => `ai:spend:alerted:${day}`;
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

export function createSpendGuard(redis: SpendRedis, options: SpendGuardOptions): SpendGuard {
  const now = options.now ?? (() => new Date());

  async function alertIfCrossed(day: string, spend: number): Promise<void> {
    const { dailyCapUsdMicros: cap, alertPercent } = await options.limits();
    if (cap <= 0 || spend * 100 < cap * alertPercent) return;
    // NX makes the claim atomic across processes: exactly one caller sees "OK" per day.
    const claimed = await redis.set(spendAlertedKey(day), "1", "EX", ALERTED_TTL_SECONDS, "NX");
    if (claimed !== "OK") return;
    try {
      await options.onAlert({
        day,
        spendUsdMicros: spend,
        capUsdMicros: cap,
        alertPercent,
      });
    } catch {
      // A failing alert channel must not fail the AI call that happened to cross the threshold.
    }
  }

  async function bump(day: string, delta: number): Promise<void> {
    const key = spendKey(day);
    const spend = await redis.incrby(key, delta);
    await redis.expire(key, SPEND_TTL_SECONDS);
    if (delta > 0) await alertIfCrossed(day, spend);
  }

  return {
    async check(capMicros) {
      const raw = await redis.get(spendKey(utcDay(now())));
      if (Number(raw ?? 0) >= capMicros) throw aiPausedError();
    },
    async add(estimateMicros) {
      const day = utcDay(now());
      await bump(day, estimateMicros);
      return day;
    },
    async correct(deltaMicros, day = utcDay(now())) {
      if (deltaMicros !== 0) await bump(day, deltaMicros);
    },
  };
}
