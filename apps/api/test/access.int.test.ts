import { Controller, Delete, Get, Inject, Module, Param, Post } from "@nestjs/common";
import { auditLogs, createDb, seedDefaults, sessions, users } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PERMISSION_KEYS } from "@wasfa/shared/permissions";
import { and, desc, eq, sql } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuditCtx, Audited, type AuditScope } from "../src/audit/audited.decorator.js";
import { TURNSTILE_VERIFY_URL } from "../src/auth/turnstile.js";
import { createApp } from "../src/bootstrap.js";
import { Public } from "../src/common/auth.guard.js";
import { CurrentUser, type AuthenticatedUser } from "../src/common/current-user.js";
import { DB, type DbHandle } from "../src/common/database.js";
import { RequireFreshAuth } from "../src/common/fresh-auth.js";
import { RequirePermission } from "../src/common/permissions.guard.js";
import { scopedRepo, type ScopedRepo } from "../src/common/scoped-repo.js";
import { RbacService } from "../src/rbac/rbac.service.js";

import { AuthHarness, PASSWORD, WEB, pwnedHandlers, testApiEnv } from "./support/auth-harness.js";
import { startInfra, type TestInfra } from "./support/infra.js";
import { wrongOwnerIsHidden } from "./support/wrong-owner.js";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

// ---------------------------------------------------------------------------------------------
// One throwaway route per guard.
// ---------------------------------------------------------------------------------------------
@Public()
@Controller("__acl")
class PublicProbe {
  @Get("public")
  open() {
    return { open: true };
  }
}

@Controller("__acl")
class AclProbe {
  private readonly ownedSessions: ScopedRepo<typeof sessions>;

  constructor(@Inject(DB) handle: DbHandle) {
    this.ownedSessions = scopedRepo(handle.db, {
      table: sessions,
      scope: sessions.userId,
      id: sessions.id,
    });
  }

  @Get("private")
  whoami(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      roles: user.roles,
      permissions: user.permissions,
      orgIds: user.orgIds,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
    };
  }

  @Get("needs-users-read")
  @RequirePermission("users.read")
  read() {
    return { ok: true };
  }

  @Get("needs-two")
  @RequirePermission("users.read", "audit.read")
  both() {
    return { ok: true };
  }

  @Get("fresh")
  @RequireFreshAuth(5)
  fresh() {
    return { ok: true };
  }

  @Post("write")
  write() {
    return { written: true };
  }

  /** The wrong-owner pattern Task 1.7 endpoints copy: the owner filter is part of the repository call. */
  @Delete("sessions/:id")
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.ownedSessions.require(user.id, id);
    await this.ownedSessions.remove(user.id, id);
    return { removed: true };
  }
}

@Controller("admin/__acl")
class AdminProbe {
  @Get("ping")
  @RequirePermission("users.read")
  ping() {
    return { admin: true };
  }

  @Get("unprotected")
  unprotected() {
    return { admin: true };
  }

  @Post("things/:id")
  @RequirePermission("users.suspend")
  @Audited({
    action: "thing.update",
    targetType: "thing",
    fields: ["status", "note", "password", "token", "email"],
  })
  update(@Param("id") id: string, @AuditCtx() audit: AuditScope) {
    audit.before = { status: "active", password: "hunter2" };
    audit.after = {
      status: "suspended",
      note: "contact ali@example.com or +201012345678",
      token: "tok_123",
      email: "ali@example.com",
      ignoredByAllowlist: "x",
    };
    return { id };
  }

  @Post("fails")
  @RequirePermission("users.suspend")
  @Audited({ action: "thing.fail", targetType: "thing" })
  fails() {
    throw new AppError(ErrorCode.VALIDATION_FAILED);
  }
}

@Module({ controllers: [PublicProbe, AclProbe, AdminProbe] })
class AclTestModule {}

// ---------------------------------------------------------------------------------------------
const network = setupServer(
  ...pwnedHandlers(),
  http.post(TURNSTILE_VERIFY_URL, () => HttpResponse.json({ success: true })),
);

let infra: TestInfra;
let app: NestFastifyApplication;
let owner: ReturnType<typeof createDb>;
let rbac: RbacService;
const harness = new AuthHarness(
  () => app,
  () => owner.db,
);

beforeAll(async () => {
  infra = await startInfra();
  network.listen({ onUnhandledRequest: "error" });
  owner = createDb({ url: infra.databaseUrl, max: 2 });
  await seedDefaults(owner.db);
  app = await createApp(testApiEnv(infra, { TURNSTILE_SECRET_KEY: "test-secret" }), {
    extraImports: [harness.mailerModule(), AclTestModule],
    authMailer: false,
  });
  rbac = app.get(RbacService);
}, 180_000);

afterAll(async () => {
  network.close();
  await app?.close();
  await owner?.close();
  await infra?.stop();
});

const get = (path: string, jar: Map<string, string>) => harness.call("GET", path, { jar });

/** An admin with the given role, two-factor on, holding a session that went through the TOTP challenge. */
async function adminWithTwoFactor(role: string) {
  const user = await harness.signedInUser();
  await harness.grantRole(user.userId, role);
  const { secret } = await harness.enableTwoFactor(user);
  return { ...user, secret };
}

describe("deny by default", () => {
  it("lets public routes through and answers anonymous callers with 401", async () => {
    expect((await get("/__acl/public", new Map())).statusCode).toBe(200);
    expect((await get("/health/live", new Map())).statusCode).toBe(200);

    const anonymous = await get("/__acl/private", new Map());
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect((await get("/phone/verify/status", new Map())).statusCode).toBe(401);
  });

  it("builds the caller from the database", async () => {
    const user = await harness.signedInUser();
    const res = await get("/__acl/private", user.jar);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: user.userId,
      roles: [],
      permissions: [],
      orgIds: [],
      twoFactorEnabled: false,
      emailVerified: true,
      phoneVerified: false,
    });
  });

  it("ends the sessions of a suspended user on their next request", async () => {
    const user = await harness.signedInUser();
    expect((await get("/__acl/private", user.jar)).statusCode).toBe(200);
    await owner.db
      .update(users)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(users.id, user.userId));
    expect((await get("/__acl/private", user.jar)).statusCode).toBe(401);
    expect(await owner.db.select().from(sessions).where(eq(sessions.userId, user.userId))).toEqual(
      [],
    );
  });
});

describe("permissions", () => {
  it("answers 403 when the permission is missing and 200 when a role grants it", async () => {
    const user = await harness.signedInUser();
    const denied = await get("/__acl/needs-users-read", user.jar);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "FORBIDDEN" });

    await harness.grantRole(user.userId, "support");
    await rbac.bustUser(user.userId);
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(200);
    // `support` holds users.read and issues.read but not audit.read: all listed permissions are required.
    expect((await get("/__acl/needs-two", user.jar)).statusCode).toBe(403);
  });

  it("gives super_admin every permission in the catalog", async () => {
    const user = await harness.signedInUser();
    await harness.grantRole(user.userId, "super_admin");
    await rbac.bustUser(user.userId);
    const profile = (await get("/__acl/private", user.jar)).json<{
      permissions: string[];
      roles: string[];
    }>();
    expect(profile.roles).toEqual(["super_admin"]);
    expect([...profile.permissions].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect((await get("/__acl/needs-two", user.jar)).statusCode).toBe(200);
  });

  it("caches permissions for a while and forgets them when told to", async () => {
    const user = await harness.signedInUser();
    await harness.grantRole(user.userId, "support");
    await rbac.bustUser(user.userId);
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(200);

    // Role removed in the database: the cached profile still answers until it is busted.
    await owner.db.execute(sql`delete from user_roles where user_id = ${user.userId}`);
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(200);
    await rbac.bustUser(user.userId);
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(403);

    // A whole role's holders, and everyone at once.
    await harness.grantRole(user.userId, "support");
    await rbac.bustAll();
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(200);
    await owner.db.execute(sql`delete from user_roles where user_id = ${user.userId}`);
    await rbac.bustRole("support");
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(200);
    await rbac.bustAll();
    expect((await get("/__acl/needs-users-read", user.jar)).statusCode).toBe(403);
  });
});

describe("admin routes", () => {
  it("refuse an admin who has not switched on two-factor", async () => {
    const user = await harness.signedInUser();
    await harness.grantRole(user.userId, "support");
    await rbac.bustUser(user.userId);
    const res = await get("/admin/__acl/ping", user.jar);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      code: "FORBIDDEN",
      details: { reason: "two_factor_required" },
    });
  });

  it("refuse a session that predates two-factor, and accept one that went through it", async () => {
    const user = await harness.signedInUser();
    await harness.grantRole(user.userId, "support");
    // Second session, opened before 2FA exists.
    const early = new Map<string, string>();
    await harness.call("POST", "/auth/sign-in/email", {
      body: { email: user.email, password: PASSWORD },
      jar: early,
    });
    const { secret } = await harness.enableTwoFactor(user);

    const stale = await get("/admin/__acl/ping", early);
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ details: { reason: "two_factor_session" } });

    // The session that confirmed the first code is verified, and so is a fresh TOTP sign-in.
    expect((await get("/admin/__acl/ping", user.jar)).statusCode).toBe(200);
    const again = await harness.signInWithTotp(user.email, secret);
    expect((await get("/admin/__acl/ping", again)).statusCode).toBe(200);
  });

  it("refuse an admin route that forgot @RequirePermission", async () => {
    const admin = await adminWithTwoFactor("admin");
    const res = await get("/admin/__acl/unprotected", admin.jar);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ details: { reason: "admin_route_unprotected" } });
  });

  it("refuse an ordinary user even with two-factor on", async () => {
    const user = await harness.signedInUser();
    await harness.enableTwoFactor(user);
    expect((await get("/admin/__acl/ping", user.jar)).statusCode).toBe(403);
  });

  it("do not accept a password-only sign-in as a second factor", async () => {
    const admin = await adminWithTwoFactor("support");
    const jar = new Map<string, string>();
    const res = await harness.call("POST", "/auth/sign-in/email", {
      body: { email: admin.email, password: PASSWORD },
      jar,
    });
    expect(res.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await get("/admin/__acl/ping", jar)).statusCode).toBe(401);
  });
});

describe("fresh authentication", () => {
  it("asks for a re-login when the last proof is older than the window, and accepts the password", async () => {
    const user = await harness.signedInUser();
    expect((await get("/__acl/fresh", user.jar)).statusCode).toBe(200);

    await owner.db
      .update(sessions)
      .set({ reauthAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(sessions.userId, user.userId));
    const stale = await get("/__acl/fresh", user.jar);
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({
      code: "AUTH_REQUIRED",
      details: { reason: "reauth", maxAgeMinutes: 5 },
    });

    const wrong = await harness.call("POST", "/auth/reauth", {
      body: { password: "not the password" },
      jar: user.jar,
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ details: { reason: "invalid_credentials" } });
    expect((await get("/__acl/fresh", user.jar)).statusCode).toBe(401);

    const ok = await harness.call("POST", "/auth/reauth", {
      body: { password: PASSWORD },
      jar: user.jar,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toHaveProperty("reauthAt");
    expect((await get("/__acl/fresh", user.jar)).statusCode).toBe(200);
  });

  it("needs a session, limits attempts, and has nothing to offer a password-less account", async () => {
    expect(
      (await harness.call("POST", "/auth/reauth", { body: { password: PASSWORD } })).statusCode,
    ).toBe(401);

    const user = await harness.signedInUser();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await harness.call("POST", "/auth/reauth", {
            body: { password: "wrong password" },
            jar: user.jar,
          })
        ).statusCode,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);

    const social = await harness.signedInUser();
    await owner.db.execute(sql`delete from accounts where user_id = ${social.userId}`);
    const res = await harness.call("POST", "/auth/reauth", {
      body: { password: PASSWORD },
      jar: social.jar,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ details: { reason: "invalid_credentials" } });
  });
});

describe("origin check", () => {
  it("refuses a state-changing request with the session cookie from a foreign origin", async () => {
    const user = await harness.signedInUser();
    const foreign = await harness.call("POST", "/__acl/write", {
      jar: user.jar,
      origin: "https://evil.example",
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ details: { reason: "origin_not_allowed" } });

    const none = await harness.call("POST", "/__acl/write", { jar: user.jar, origin: null });
    expect(none.statusCode).toBe(403);
    const nullOrigin = await harness.call("POST", "/__acl/write", {
      jar: user.jar,
      origin: "null",
    });
    expect(nullOrigin.statusCode).toBe(403);
  });

  it("accepts our own origin, a Referer from it, and any GET", async () => {
    const user = await harness.signedInUser();
    expect((await harness.call("POST", "/__acl/write", { jar: user.jar })).statusCode).toBe(201);
    const viaReferer = await harness.call("POST", "/__acl/write", {
      jar: user.jar,
      origin: null,
      headers: { referer: `${WEB}/some/page?x=1` },
    });
    expect(viaReferer.statusCode).toBe(201);
    const foreignReferer = await harness.call("POST", "/__acl/write", {
      jar: user.jar,
      origin: null,
      headers: { referer: "https://evil.example/page" },
    });
    expect(foreignReferer.statusCode).toBe(403);
    expect(
      (
        await harness.call("GET", "/__acl/private", {
          jar: user.jar,
          origin: "https://evil.example",
        })
      ).statusCode,
    ).toBe(200);
  });

  it("does not apply to requests that carry no session cookie", async () => {
    const res = await harness.call("POST", "/__acl/write", { origin: "https://evil.example" });
    // Not blocked by the origin check; it is the missing session that answers.
    expect(res.statusCode).toBe(401);
  });
});

describe("audit trail", () => {
  it("records an audited admin write with actor, target, redacted before/after, IP and agent", async () => {
    const admin = await adminWithTwoFactor("admin");
    const res = await harness.call("POST", "/admin/__acl/things/thing-42", {
      jar: admin.jar,
      ip: "10.20.30.40",
      headers: { "user-agent": "vitest-agent/1.0" },
    });
    expect(res.statusCode).toBe(201);

    const [row] = await owner.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, "thing-42"))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(row).toMatchObject({
      actorId: admin.userId,
      action: "thing.update",
      targetType: "thing",
      targetId: "thing-42",
      ip: "10.20.30.40",
      userAgent: "vitest-agent/1.0",
    });
    // Secrets and contact details never reach the trail; keys outside the allowlist are dropped.
    expect(row?.before).toEqual({ status: "active", password: "[REDACTED]" });
    expect(row?.after).toEqual({
      status: "suspended",
      note: "contact [EMAIL] or [PHONE]",
      token: "[REDACTED]",
      email: "[REDACTED]",
    });
    const stored = JSON.stringify([row?.before, row?.after]);
    for (const secret of ["hunter2", "tok_123", "ali@example.com", "201012345678"]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("writes nothing when the admin action failed", async () => {
    const admin = await adminWithTwoFactor("admin");
    const res = await harness.call("POST", "/admin/__acl/fails", { jar: admin.jar });
    expect(res.statusCode).toBe(400);
    const rows = await owner.db.select().from(auditLogs).where(eq(auditLogs.action, "thing.fail"));
    expect(rows).toEqual([]);
  });

  it("cannot be rewritten by the API's own database role", async () => {
    const { db } = app.get<DbHandle>(DB);
    await expect(db.execute(sql`update audit_logs set action = 'tampered'`)).rejects.toMatchObject({
      cause: { code: "42501" },
    });
    await expect(db.execute(sql`delete from audit_logs`)).rejects.toMatchObject({
      cause: { code: "42501" },
    });
    const [current] = await db.execute<{ current_user: string }>(sql`select current_user`);
    expect(current?.current_user).toBe("wasfa_api");
  });
});

describe("security events", () => {
  const auditRows = (userId: string, action: string) =>
    owner.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.actorId, userId), eq(auditLogs.action, action)));

  it("audits a password change and two-factor changes, without any credential in the row", async () => {
    const user = await harness.signedInUser();

    const wrong = await harness.call("POST", "/auth/change-password", {
      jar: user.jar,
      body: { currentPassword: "not my password", newPassword: "another long passphrase" },
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    expect(await auditRows(user.userId, "auth.password_change")).toEqual([]);

    const changed = await harness.call("POST", "/auth/change-password", {
      jar: user.jar,
      body: { currentPassword: PASSWORD, newPassword: "another long passphrase" },
    });
    expect(changed.statusCode).toBe(200);
    const [row] = await auditRows(user.userId, "auth.password_change");
    expect(row).toMatchObject({
      targetType: "user",
      targetId: user.userId,
      before: null,
      after: null,
    });
    expect(JSON.stringify(row)).not.toContain("passphrase");

    await harness.enableTwoFactor(user, "another long passphrase");
    expect(await auditRows(user.userId, "auth.two_factor_enable")).toHaveLength(1);
  });
});

describe("wrong-owner pattern", () => {
  it("hides another user's row as NOT_FOUND and leaves it untouched", async () => {
    const alice = await harness.signedInUser();
    const bob = await harness.signedInUser();
    const [aliceSession] = await owner.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, alice.userId));
    if (!aliceSession) throw new Error("no session");

    await wrongOwnerIsHidden({
      owner: () => harness.call("DELETE", `/__acl/sessions/${aliceSession.id}`, { jar: alice.jar }),
      intruder: () =>
        harness.call("DELETE", `/__acl/sessions/${aliceSession.id}`, { jar: bob.jar }),
      stillThere: async () =>
        (
          await owner.db
            .select({ id: sessions.id })
            .from(sessions)
            .where(and(eq(sessions.id, aliceSession.id)))
        ).length > 0,
    });
  });
});
