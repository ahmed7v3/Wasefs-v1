import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { createDb } from "../src/client.js";
import { runMigrations } from "../src/migrations.js";

export interface TestDb {
  handle: ReturnType<typeof createDb>;
  /** Connection URL of the owner role (the one migrations run as). */
  url: string;
  stop: () => Promise<void>;
}

/**
 * A migrated, empty PostgreSQL 18. Testcontainers by default; set TEST_DATABASE_URL to use a running
 * (throwaway!) database instead.
 */
export async function startTestDb(): Promise<TestDb> {
  let container: StartedPostgreSqlContainer | undefined;
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("postgres:18-alpine").start();
    url = container.getConnectionUri();
  }
  const handle = createDb({ url, max: 2 });
  await runMigrations(handle.db);
  return {
    handle,
    url,
    stop: async () => {
      await handle.close();
      await container?.stop();
    },
  };
}

/** Name of the constraint a failed query violated (drizzle wraps the driver error in `cause`). */
export function violatedConstraint(error: unknown): string | undefined {
  const candidate = (error as { cause?: unknown } | null)?.cause ?? error;
  const name = (candidate as { constraint_name?: unknown } | null)?.constraint_name;
  return typeof name === "string" ? name : undefined;
}
