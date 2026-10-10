import { RedisContainer } from "@testcontainers/redis";

export interface TestRedis {
  url: string;
  stop: () => Promise<void>;
}

/**
 * Redis 8 via Testcontainers (same major as production). Set `TEST_REDIS_URL` to use an
 * already-running instance instead; use a throwaway one, tests create their own queues in it.
 */
export async function startRedis(): Promise<TestRedis> {
  const external = process.env.TEST_REDIS_URL;
  if (external) return { url: external, stop: async () => undefined };
  const container = await new RedisContainer("redis:8-alpine").start();
  return {
    url: container.getConnectionUrl(),
    stop: async () => {
      await container.stop();
    },
  };
}
