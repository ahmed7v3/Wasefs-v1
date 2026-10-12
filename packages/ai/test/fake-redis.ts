import type { RedisLike } from "../src/redis-like.js";

/** Just enough Redis for the breaker and the spend guard, with a clock tests can move. */
export class FakeRedis implements RedisLike {
  private readonly values = new Map<string, { value: string; expiresAt: number | null }>();
  now = 1_000_000;

  advance(seconds: number): void {
    this.now += seconds * 1_000;
  }

  ttlSeconds(key: string): number | null {
    const entry = this.live(key);
    return entry?.expiresAt == null ? null : Math.round((entry.expiresAt - this.now) / 1_000);
  }

  private live(key: string) {
    const entry = this.values.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }

  incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  incrby(key: string, increment: number): Promise<number> {
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + increment;
    this.values.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return Promise.resolve(next);
  }

  expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(0);
    entry.expiresAt = this.now + seconds * 1_000;
    return Promise.resolve(1);
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
  set(key: string, value: string, ex: "EX", seconds: number, nx: "NX"): Promise<"OK" | null>;
  set(key: string, value: string, _ex: "EX", seconds: number, nx?: "NX"): Promise<"OK" | null> {
    if (nx !== undefined && this.live(key)) return Promise.resolve(null);
    this.values.set(key, { value, expiresAt: this.now + seconds * 1_000 });
    return Promise.resolve("OK");
  }
}
