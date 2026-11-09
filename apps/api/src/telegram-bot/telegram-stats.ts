import type { Redis } from "ioredis";

type StatKind = "analyses" | "messages";

const TTL_SECONDS = 3 * 86_400;

const keyOf = (kind: StatKind, now: Date) => `tg:stat:${kind}:${now.toISOString().slice(0, 10)}`;

/** Daily counters for the admin card; counts only, no content. Best effort: never breaks a reply. */
export async function bumpStat(redis: Redis, kind: StatKind, now = new Date()): Promise<void> {
  const key = keyOf(kind, now);
  try {
    await redis.multi().incr(key).expire(key, TTL_SECONDS).exec();
  } catch {
    // A counter is not worth failing an answer for.
  }
}

export async function readStat(redis: Redis, kind: StatKind, now = new Date()): Promise<number> {
  try {
    return Number((await redis.get(keyOf(kind, now))) ?? 0);
  } catch {
    return 0;
  }
}
