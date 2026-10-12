/**
 * The few Redis commands the breaker and the spend guard use, declared here so this package never
 * depends on a Redis client: `ioredis` satisfies it as is, tests pass a fake.
 */
export interface RedisLike {
  incr(key: string): Promise<number>;
  incrby(key: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
  /** `SET key value EX seconds NX`: `"OK"` when it was set, `null` when the key already existed. */
  set(key: string, value: string, ex: "EX", seconds: number, nx: "NX"): Promise<"OK" | null>;
}

export type BreakerRedis = Pick<RedisLike, "incr" | "expire" | "set" | "get" | "del">;
export type SpendRedis = Pick<RedisLike, "incrby" | "expire" | "set" | "get">;
