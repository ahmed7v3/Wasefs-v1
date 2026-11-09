/** A chat may send this many messages per window; the rest get one friendly note, then silence. */
export const CHAT_RATE_MAX = 30;
export const CHAT_RATE_WINDOW_SECONDS = 600;

export type RateVerdict = "ok" | "warn" | "drop";

interface CounterStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/**
 * Fixed-window counter per chat. `warn` is returned once (the first message over the limit) so the
 * person is told, and `drop` after that so a flood is not answered message by message.
 */
export async function chatRateVerdict(
  redis: CounterStore,
  chatId: number,
  now: number,
): Promise<RateVerdict> {
  const bucket = Math.floor(now / (CHAT_RATE_WINDOW_SECONDS * 1_000));
  const key = `tg:rl:${String(chatId)}:${String(bucket)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, CHAT_RATE_WINDOW_SECONDS);
  if (count <= CHAT_RATE_MAX) return "ok";
  return count === CHAT_RATE_MAX + 1 ? "warn" : "drop";
}
