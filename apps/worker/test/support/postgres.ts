import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { API_DB_ROLE, createDb, runMigrations, setApiRolePassword } from "@wasfa/db";

const API_DB_PASSWORD = "api-role-test-password";

export interface TestPostgres {
  /** Owner role: runs migrations and seeds test rows. */
  ownerUrl: string;
  /** The restricted role the worker really runs as in production (no UPDATE/DELETE on audit_logs). */
  apiUrl: string;
  stop: () => Promise<void>;
}

/** A migrated Postgres 18 (same major as production) with the restricted `wasfa_api` role ready to log in. */
export async function startPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const ownerUrl = container.getConnectionUri();
  const { db, close } = createDb({ url: ownerUrl, max: 1 });
  try {
    await runMigrations(db);
    await setApiRolePassword(db, API_DB_PASSWORD);
  } finally {
    await close();
  }
  const api = new URL(ownerUrl);
  api.username = API_DB_ROLE;
  api.password = API_DB_PASSWORD;
  return {
    ownerUrl,
    apiUrl: api.toString(),
    stop: async () => {
      await container.stop();
    },
  };
}
