import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { runtime } from "./runtime";

/*
 * Records an unexpected error the way the API's `ErrorReporter` does (same row shape, a 32-hex
 * fingerprint, a `WSF-` style ref), straight into `error_events` with the owner role.
 *
 * Why not a real thrown error: the API has no test-only routes, and the two real 500s this suite
 * once used (a NUL byte in POST /contact, year 0 in the audit filter) were fixed. That the API groups
 * a THROWN error by fingerprint is proven by `apps/api/test/admin.int.test.ts` through a probe route;
 * this suite proves the admin UI on such rows. The script runs from apps/api so `@wasfa/db`
 * resolves there; the web app itself never imports it.
 */
export function recordServerError(): { ref: string; fingerprint: string } {
  const fingerprint = randomBytes(16).toString("hex");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const part = () =>
    Array.from(randomBytes(4), (byte) => alphabet[byte % alphabet.length] ?? "0").join("");
  const ref = `WSF-${part()}-${part()}`;
  const script = `
    import { createDb, errorEvents } from "@wasfa/db";
    const { db, close } = createDb({ url: process.env.DATABASE_URL, max: 1 });
    await db.insert(errorEvents).values({
      ref: process.env.E2E_REF,
      fingerprint: process.env.E2E_FINGERPRINT,
      code: "INTERNAL",
      route: "/admin/audit",
      method: "GET",
      requestId: "e2e",
      message: "E2E recorded error",
      context: { errorName: "Error", appCode: null },
      stack: null,
    });
    await close();
  `;
  const apiDir = fileURLToPath(new URL("../../../api/", import.meta.url));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: apiDir,
    env: {
      ...process.env,
      DATABASE_URL: runtime().ownerDatabaseUrl,
      E2E_REF: ref,
      E2E_FINGERPRINT: fingerprint,
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`recording the error failed: ${result.stderr}`);
  }
  return { ref, fingerprint };
}
