import { newId } from "@wasfa/shared/ids";

import type { Redis } from "ioredis";

/*
 * The conversation lock of the v2 turn engine (docs/WA-AGENT-RUNTIME.md §4.4, §17.4). Redis is the mutex
 * (one worker at a time per conversation, a crashed holder frees it by expiry); Postgres is the fence
 * authority (`wa_conversations.turn_fence`, bumped in `TurnRepo.bumpFence`) because the writes that end a
 * turn are in Postgres and the check must be atomic with them.
 */

export const LOCK_TTL_MS = 60_000;
export const LOCK_HEARTBEAT_MS = 15_000;

export const lockKey = (conversationId: string) => `wa:agent:lock:${conversationId}`;

// Both scripts act only while the key still holds our token: it may have expired and been taken over.
const EXTEND = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

/** A write that would end or commit a turn was refused: another holder took the conversation's fence. */
export class StaleFenceError extends Error {
  constructor(readonly conversationId: string) {
    super("stale fence: the conversation lock was taken over");
    this.name = "StaleFenceError";
  }
}

export interface LockHandle {
  /** Aborts when the lock could not be renewed: stop work early, the next holder takes over. */
  readonly signal: AbortSignal;
  /** Stops the heartbeat and deletes the key if it is still ours. Safe to call twice. */
  release: () => Promise<void>;
}

export class ConversationLock {
  constructor(
    private readonly redis: Redis,
    private readonly timing: { ttlMs: number; heartbeatMs: number } = {
      ttlMs: LOCK_TTL_MS,
      heartbeatMs: LOCK_HEARTBEAT_MS,
    },
  ) {}

  /** The lock, or null when another worker holds it. */
  async acquire(conversationId: string): Promise<LockHandle | null> {
    const key = lockKey(conversationId);
    const token = newId();
    const { ttlMs, heartbeatMs } = this.timing;
    const got = await this.redis.set(key, token, "PX", ttlMs, "NX");
    if (got !== "OK") return null;

    const controller = new AbortController();
    let lastRenewed = Date.now();
    let released = false;
    const beat = setInterval(() => {
      void (async () => {
        try {
          const extended = await this.redis.eval(EXTEND, 1, key, token, String(ttlMs));
          if (Number(extended) === 1) {
            lastRenewed = Date.now();
            return;
          }
          controller.abort(new Error("lock lost"));
        } catch {
          // A Redis blip is not a lost lock; it is once the key could have expired.
          if (Date.now() - lastRenewed >= ttlMs - heartbeatMs) {
            controller.abort(new Error("lock not renewed"));
          }
        }
      })();
    }, heartbeatMs);
    // A held lock must not keep the process alive.
    beat.unref();

    return {
      signal: controller.signal,
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(beat);
        await this.redis.eval(RELEASE, 1, key, token);
      },
    };
  }
}
