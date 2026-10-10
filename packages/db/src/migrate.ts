import { createDb } from "./client.js";
import { runMigrations, setApiRolePassword } from "./migrations.js";

const { db, close } = createDb({ max: 1 });
try {
  await runMigrations(db);
  process.stdout.write("Migrations applied.\n");
  const apiPassword = process.env.API_DB_PASSWORD;
  if (apiPassword !== undefined && apiPassword !== "") {
    await setApiRolePassword(db, apiPassword);
    process.stdout.write("API database role password set.\n");
  }
} catch (error) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
