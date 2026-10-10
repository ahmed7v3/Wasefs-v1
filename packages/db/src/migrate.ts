import { createDb } from "./client.js";
import { runMigrations } from "./migrations.js";

const { db, close } = createDb({ max: 1 });
try {
  await runMigrations(db);
  process.stdout.write("Migrations applied.\n");
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
