import { createDb } from "./client.js";
import { seedDefaults } from "./seed-data.js";

const { db, close } = createDb({ max: 1 });
try {
  const result = await seedDefaults(db);
  process.stdout.write(
    `Seed complete: ${result.settings} new site setting(s), ${result.roles} new role(s), ` +
      `${result.rolePermissions} new role permission(s).\n`,
  );
} catch (error) {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
