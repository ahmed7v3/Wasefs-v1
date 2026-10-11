import { createDb } from "./client.js";
import { seedDefaults } from "./seed-data.js";

const { db, close } = createDb({ max: 1 });
try {
  const result = await seedDefaults(db);
  process.stdout.write(
    `Seed complete: ${result.settings} new site setting(s), ${result.roles} new role(s), ` +
      `${result.rolePermissions} new role permission(s), ${result.plans} new plan(s), ` +
      `${result.aiProviders} new AI provider(s), ${result.aiModels} new AI model(s), ` +
      `${result.aiTaskRoutes} new AI route(s).\n`,
  );
} catch (error) {
  process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
