import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Signing for the web cache-revalidation call (API/worker -> web `/api/revalidate`, CONTENT-PLATFORM
 * §11.5). HMAC-SHA256 over "<timestamp>.<body>" proves the caller knows `REVALIDATE_SECRET`; the
 * timestamp bounds a captured request's lifetime and `ReplayCache` makes each signature single-use
 * inside that window. Node-only (node:crypto): import from `@wasfa/shared/content/revalidate`.
 */

export const REVALIDATE_HEADER = "x-revalidate-signature";
const PREFIX = "sha256=";

function mac(secret: string, timestamp: number, body: string): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
}

/** `sha256=<hex>` for the header; `timestamp` is Unix seconds and must also be inside the body. */
export function signRevalidation(secret: string, timestamp: number, body: string): string {
  return `${PREFIX}${mac(secret, timestamp, body).toString("hex")}`;
}

export type RevalidationCheck =
  { ok: true } | { ok: false; reason: "malformed" | "stale" | "bad_signature" };

export function verifyRevalidation(input: {
  secret: string;
  /** The header value, `sha256=<hex>`. */
  signature: string;
  timestamp: number;
  body: string;
  /** Unix seconds now (injected so tests need no fake timers). */
  now: number;
  windowSeconds: number;
}): RevalidationCheck {
  const { secret, signature, timestamp, body, now, windowSeconds } = input;
  if (!Number.isFinite(timestamp) || !signature.startsWith(PREFIX))
    return { ok: false, reason: "malformed" };
  // Absolute difference: a timestamp from the future is as suspect as an old one.
  if (Math.abs(now - timestamp) > windowSeconds) return { ok: false, reason: "stale" };
  const hex = signature.slice(PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) return { ok: false, reason: "malformed" };
  const given = Buffer.from(hex, "hex");
  const expected = mac(secret, timestamp, body);
  return given.length === expected.length && timingSafeEqual(given, expected)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/**
 * Remembers signatures until they leave the window so a captured request cannot be replayed. In
 * memory per process: a restart or a second web instance forgets, which the timestamp window bounds.
 */
export class ReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 10_000) {}

  /** `true` when the signature is new (and now remembered); `false` for a replay. `nowMs` / `ttlMs` in milliseconds. */
  remember(signature: string, nowMs: number, ttlMs: number): boolean {
    for (const [key, expiry] of this.seen) {
      if (expiry <= nowMs) this.seen.delete(key);
    }
    if (this.seen.has(signature)) return false;
    // A flood of valid signatures cannot grow memory without bound: drop the oldest.
    while (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    this.seen.set(signature, nowMs + ttlMs);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
