import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { API_DB_ROLE, createDb, runMigrations, setApiRolePassword } from "@wasfa/db";

const API_DB_PASSWORD = "api-role-test-password";

export interface TestInfra {
  /** Owner role: runs migrations and seeds. */
  databaseUrl: string;
  /** The restricted role the API really runs as in production (no UPDATE/DELETE on audit_logs). */
  apiDatabaseUrl: string;
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
      apiDatabaseUrl: externalDb,
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
      apiDatabaseUrl: postgres.getConnectionUri(),
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
    await setApiRolePassword(db, API_DB_PASSWORD);
  } finally {
    await close();
  }
  const apiUrl = new URL(infra.databaseUrl);
  apiUrl.username = API_DB_ROLE;
  apiUrl.password = API_DB_PASSWORD;
  infra.apiDatabaseUrl = apiUrl.toString();
  return infra;
}
