import { createDb } from "./client.js";
import { backfillBrandKeys } from "./drug-brand-keys.js";

const { db, close } = createDb({ max: 1 });
try {
  const filled = await backfillBrandKeys(db);
  process.stdout.write(`Brand keys filled: ${String(filled)}\n`);
} catch (error) {
  process.stderr.write(`Backfill failed: ${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
