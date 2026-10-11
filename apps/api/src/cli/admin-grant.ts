import { createDb } from "@wasfa/db";
import { parseEnv } from "@wasfa/shared/env";
import { emailSchema } from "@wasfa/shared/schemas/auth";
import { z } from "zod";

import { grantSuperAdmin, type GrantResult } from "./grant-super-admin.js";

/*
 * Bootstrap of the first super admin:  node dist/cli/admin-grant.js <email>
 * Run it with the owner `DATABASE_URL` (the `migrate` container in production, see DOCKER-GUIDE).
 * Exit code 0 = the account is a super admin now (or already was), 1 = nothing was changed.
 */

const OUTCOMES: Record<GrantResult["kind"], { message: string; exitCode: number }> = {
  granted: {
    message:
      "granted. The access cache lasts up to 5 minutes. Sign in and enable two-factor authentication: /admin needs it.",
    exitCode: 0,
  },
  already_granted: { message: "already super_admin", exitCode: 0 },
  not_found: { message: "no account with that email", exitCode: 1 },
  not_active: { message: "the account is not active", exitCode: 1 },
  email_not_verified: { message: "the account's email is not verified", exitCode: 1 },
  role_missing: { message: "the super_admin role is missing: run the seed first", exitCode: 1 },
};

const write = (message: string) => process.stdout.write(`${message}\n`);
const fail = (message: string) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

async function main(): Promise<void> {
  const email = emailSchema.safeParse(process.argv[2]);
  if (!email.success) {
    fail("usage: admin-grant <email>");
    return;
  }
  const env = parseEnv(z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) }));

  const handle = createDb({ url: env.DATABASE_URL, max: 1, connectTimeoutSeconds: 10 });
  try {
    const result = await grantSuperAdmin(handle.db, email.data);
    const outcome = OUTCOMES[result.kind];
    if (outcome.exitCode === 0) write(outcome.message);
    else fail(outcome.message);
  } catch (error) {
    // The error text can carry the connection string; the class name is enough to start from.
    fail(`admin-grant failed (${error instanceof Error ? error.name : "unknown error"})`);
  } finally {
    await handle.close();
  }
}

await main();
