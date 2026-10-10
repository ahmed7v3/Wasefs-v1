import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createDb, runMigrations } from "@wasfa/db";

export interface TestInfra {
  databaseUrl: string;
  redisUrl: string;
  /** Stops Postgres to simulate an outage; `undefined` when running against external services. */
  stopPostgres: (() => Promise<void>) | undefined;
  stop: () => Promise<void>;
}

/**
 * Testcontainers by default (Postgres 18 + Redis 8, same majors as production).
 * Set `TEST_DATABASE_URL` + `TEST_REDIS_URL` to run against already-running services instead
 * (e.g. a machine without Docker). Use a throwaway database: migrations run against it.
 */
export async function startInfra(): Promise<TestInfra> {
  const externalDb = process.env.TEST_DATABASE_URL;
  const externalRedis = process.env.TEST_REDIS_URL;
  let infra: TestInfra;

  if (externalDb && externalRedis) {
    infra = {
      databaseUrl: externalDb,
      redisUrl: externalRedis,
      stopPostgres: undefined,
      stop: async () => undefined,
    };
  } else {
    const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] =
      await Promise.all([
        new PostgreSqlContainer("postgres:18-alpine").start(),
        new RedisContainer("redis:8-alpine").start(),
      ]);
    let postgresRunning = true;
    infra = {
      databaseUrl: postgres.getConnectionUri(),
      redisUrl: redis.getConnectionUrl(),
      stopPostgres: async () => {
        postgresRunning = false;
        await postgres.stop();
      },
      stop: async () => {
        await Promise.all([postgresRunning ? postgres.stop() : undefined, redis.stop()]);
      },
    };
  }

  const { db, close } = createDb({ url: infra.databaseUrl, max: 1 });
  try {
    await runMigrations(db);
  } finally {
    await close();
  }
  return infra;
}
