import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { auditLogs, createDb, roles, seedDefaults, userRoles, users } from "@wasfa/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantSuperAdmin } from "../src/cli/grant-super-admin.js";

import { startInfra, type TestInfra } from "./support/infra.js";

import type { NewUser } from "@wasfa/db";

const run = promisify(execFile);
const API_DIR = fileURLToPath(new URL("..", import.meta.url));

let infra: TestInfra;
let owner: ReturnType<typeof createDb>;

beforeAll(async () => {
  infra = await startInfra();
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
}, 180_000);

afterAll(async () => {
  await owner?.close();
  await infra?.stop();
});

const email = () => `root-${randomBytes(4).toString("hex")}@example.com`;

async function insertUser(values: Partial<NewUser> = {}): Promise<{ id: string; email: string }> {
  const address = values.email ?? email();
  const [row] = await owner.db
    .insert(users)
    .values({ name: "Root", emailVerified: true, ...values, email: address })
    .returning({ id: users.id });
  if (!row) throw new Error("insert failed");
  return { id: row.id, email: address };
}

const rolesOf = async (userId: string) =>
  (await owner.db.select().from(userRoles).where(eq(userRoles.userId, userId))).map(
    (row) => row.roleKey,
  );

const grantAudit = (userId: string) =>
  owner.db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "role.grant"), eq(auditLogs.targetId, userId)));

/** The parent environment (SWC needs the user profile folders) with only the given DATABASE_URL. */
function childEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  delete inherited.DATABASE_URL;
  return { ...inherited, ...env };
}

/** The real entry point, started the way an operator would start it. */
async function cli(args: string[], env: Record<string, string | undefined>) {
  try {
    const { stdout, stderr } = await run(
      process.execPath,
      ["--import", "@swc-node/register/esm-register", "src/cli/admin-grant.ts", ...args],
      { cwd: API_DIR, env: childEnv(env) },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

describe("grantSuperAdmin", () => {
  it("grants once, audits as the system, and is idempotent", async () => {
    const user = await insertUser();
    const first = await grantSuperAdmin(owner.db, user.email);
    expect(first).toEqual({ kind: "granted", userId: user.id });
    expect(await rolesOf(user.id)).toEqual(["super_admin"]);

    const audit = await grantAudit(user.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: null,
      action: "role.grant",
      targetType: "user",
      after: { roleKey: "super_admin", via: "cli" },
    });
    expect(JSON.stringify(audit[0])).not.toContain(user.email);

    expect(await grantSuperAdmin(owner.db, user.email)).toEqual({
      kind: "already_granted",
      userId: user.id,
    });
    expect(await grantAudit(user.id)).toHaveLength(1);
    expect(await rolesOf(user.id)).toEqual(["super_admin"]);
  });

  it("matches the address case-insensitively", async () => {
    const user = await insertUser({ email: `Mixed-${randomBytes(3).toString("hex")}@Example.com` });
    const result = await grantSuperAdmin(owner.db, user.email.toLowerCase());
    expect(result.kind).toBe("granted");
  });

  it("refuses unknown, unverified, suspended and deleted accounts and changes nothing", async () => {
    expect(await grantSuperAdmin(owner.db, email())).toEqual({ kind: "not_found" });

    const unverified = await insertUser({ emailVerified: false });
    expect((await grantSuperAdmin(owner.db, unverified.email)).kind).toBe("email_not_verified");

    const suspended = await insertUser({ status: "suspended", suspendedReason: "test" });
    expect((await grantSuperAdmin(owner.db, suspended.email)).kind).toBe("not_active");

    const deleted = await insertUser({ status: "deleted", deletedAt: new Date() });
    expect((await grantSuperAdmin(owner.db, deleted.email)).kind).toBe("not_active");

    for (const user of [unverified, suspended, deleted]) {
      expect(await rolesOf(user.id)).toEqual([]);
      expect(await grantAudit(user.id)).toEqual([]);
    }
  });
});

describe("pnpm admin:grant (the real command)", () => {
  it("grants, reports it, and reports 'already' the second time", async () => {
    const user = await insertUser();
    const env = { DATABASE_URL: infra.databaseUrl };

    const first = await cli([user.email], env);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain("granted");
    expect(first.stdout).toContain("5 minutes");
    expect(first.stdout).toContain("two-factor");
    expect(first.stdout + first.stderr).not.toContain(user.email);
    expect(await rolesOf(user.id)).toEqual(["super_admin"]);

    const second = await cli([user.email], env);
    expect(second.code, second.stderr).toBe(0);
    expect(second.stdout).toContain("already super_admin");
    expect(await grantAudit(user.id)).toHaveLength(1);
  }, 60_000);

  it("exits 1 for an unknown or unverified account, a missing argument and a bad environment", async () => {
    const env = { DATABASE_URL: infra.databaseUrl };
    const unverified = await insertUser({ emailVerified: false });

    const unknown = await cli([email()], env);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("no account");

    const notVerified = await cli([unverified.email], env);
    expect(notVerified.code).toBe(1);
    expect(notVerified.stderr).toContain("not verified");
    expect(await rolesOf(unverified.id)).toEqual([]);

    const noArg = await cli([], env);
    expect(noArg.code).toBe(1);
    expect(noArg.stderr).toContain("usage");
    expect((await cli(["not-an-email"], env)).code).toBe(1);

    const noEnv = await cli([unverified.email], {});
    expect(noEnv.code).toBe(1);
    expect(noEnv.stderr).toContain("DATABASE_URL");
  }, 60_000);
});

describe("without the super_admin role", () => {
  // Last: it removes a seeded role from the database.
  it("tells the operator to seed instead of failing on a foreign key", async () => {
    const user = await insertUser();
    await owner.db.delete(userRoles).where(eq(userRoles.roleKey, "super_admin"));
    await owner.db.delete(roles).where(eq(roles.key, "super_admin"));
    expect(await grantSuperAdmin(owner.db, user.email)).toEqual({ kind: "role_missing" });
  });
});
