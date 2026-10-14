import { createDb } from "@wasfa/db";
import { decodeEncryptionKey, keyId } from "@wasfa/shared/crypto";
import { parseEnv } from "@wasfa/shared/env";
import { z } from "zod";

import { rotateEncryptionKey } from "./rotate-key.js";

/*
 * ENCRYPTION_KEY rotation:
 *   ENCRYPTION_KEY_OLD=<old base64> ENCRYPTION_KEY=<new base64> \
 *     node dist/cli/rotate-encryption-key.js [--dry-run]
 * Run it with the owner DATABASE_URL (the `migrate` container). It re-seals provider API keys and
 * the WhatsApp session under the new key in one transaction; a value that opens with neither key
 * aborts everything. Afterwards put the new key in `.env.prod` and redeploy (AI-COST-RUNBOOK).
 */
const write = (message: string) => process.stdout.write(`${message}\n`);
const fail = (message: string) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

async function main(): Promise<void> {
  const env = parseEnv(
    z.object({
      DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
      ENCRYPTION_KEY: z.string().min(1),
      ENCRYPTION_KEY_OLD: z.string().min(1),
    }),
  );
  let oldKey: Buffer;
  let newKey: Buffer;
  try {
    oldKey = decodeEncryptionKey(env.ENCRYPTION_KEY_OLD);
    newKey = decodeEncryptionKey(env.ENCRYPTION_KEY);
  } catch {
    fail("both keys must be base64 of exactly 32 bytes");
    return;
  }
  if (keyId(oldKey) === keyId(newKey)) {
    fail("the old and new keys are the same");
    return;
  }
  const dryRun = process.argv.includes("--dry-run");
  const handle = createDb({ url: env.DATABASE_URL, max: 1, connectTimeoutSeconds: 10 });
  try {
    const result = await rotateEncryptionKey(handle.db, oldKey, newKey, { dryRun });
    write(
      `${dryRun ? "dry run (nothing changed): " : ""}re-sealed ${result.providers} provider key(s) ` +
        `and ${result.waSessions} WhatsApp session row(s); ${result.alreadyCurrent} already used ` +
        `the new key (id ${keyId(newKey)}).`,
    );
  } catch (error) {
    // Never print the error text: it could carry a connection string.
    fail(
      `rotation failed, nothing was changed (${error instanceof Error ? error.name : "unknown error"})`,
    );
  } finally {
    await handle.close();
  }
}

await main();
