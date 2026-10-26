import type { Redis } from "ioredis";

const RESERVE_SLOT = `
local now = tonumber(ARGV[1])
local desired = tonumber(ARGV[2])
local last = tonumber(redis.call('GET', 'wa:last-sent') or '0')
local nextSlot = tonumber(redis.call('GET', KEYS[1]) or '0')
local target = math.max(now + desired, last + 3000, nextSlot)
redis.call('SET', KEYS[1], target + 3000, 'PX', 60000)
return math.max(0, target - now)
`;

/** Reserves a serialized send slot shared by replies and admin alerts. */
export async function reserveOutboundDelay(
  redis: Pick<Redis, "eval">,
  requestedDelayMs: number,
  now: number,
): Promise<number> {
  const delay = await redis.eval(
    RESERVE_SLOT,
    1,
    "wa:outbound-next",
    String(now),
    String(requestedDelayMs),
  );
  return Number(delay);
}
