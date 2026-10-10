import { createDb } from "./client.js";
import { seedDefaults } from "./seed-data.js";

const { db, close } = createDb({ max: 1 });
try {
  const inserted = await seedDefaults(db);
  process.stdout.write(`Seed complete: ${inserted} new site setting(s).\n`);
} catch (error) {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
