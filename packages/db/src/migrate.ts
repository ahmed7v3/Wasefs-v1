import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const { db, close } = createDb({ max: 1 });
try {
  await migrate(db, { migrationsFolder });
  process.stdout.write("Migrations applied.\n");
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
