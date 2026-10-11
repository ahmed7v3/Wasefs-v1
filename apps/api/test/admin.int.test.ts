import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { Controller, Get, Module } from "@nestjs/common";
import {
  auditLogs,
  errorEvents,
  organizationInvites,
  sessions,
  users,
  type NewErrorEvent,
} from "@wasfa/db";
import { emailSendPayloadSchema } from "@wasfa/shared/email";
import { type Permission } from "@wasfa/shared/permissions";
import {
  adminFlagListResponseSchema,
  adminFlagSchema,
  adminOrgDetailSchema,
  adminOrgListResponseSchema,
  adminSettingSchema,
  adminSettingsResponseSchema,
  adminStatsSchema,
  adminSuspendResponseSchema,
  adminUserDetailSchema,
  adminUserListResponseSchema,
  auditListResponseSchema,
  issueDetailSchema,
  issueListResponseSchema,
  issueSchema,
} from "@wasfa/shared/schemas/admin";
import { SETTING_KEYS } from "@wasfa/shared/settings";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantSuperAdmin } from "../src/cli/grant-super-admin.js";
import { Public } from "../src/common/auth.guard.js";

import {
  AdminTestContext,
  MISSING_FINGERPRINT,
  MISSING_ID,
  type Admin,
  type Person,
} from "./support/admin-context.js";
import { PASSWORD, type Jar } from "./support/auth-harness.js";
import { auditRows, expectRateLimited, insertOrg } from "./support/identity-fixtures.js";

import type { LightMyRequestResponse } from "fastify";

// Throwaway routes that fail on purpose, to create real `error_events` rows through the real filter.
@Public()
@Controller("__probe")
class ProbeController {
  @Get("boom")
  boom(): never {
    throw new Error("probe failure");
  }

  @Get("other")
  other(): never {
    throw new TypeError("another probe failure");
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start([ProbeModule]);
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, who: { jar: Jar }, body?: Record<string, unknown>) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

const tag = () => randomBytes(4).toString("hex");

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({
    code,
    ...(reason ? { details: { reason } } : {}),
  });
}

// ---------------------------------------------------------------------------------------------
// Every admin route: authentication, permission, second factor, fresh authentication, rate limit.
// ---------------------------------------------------------------------------------------------
interface AdminRoute {
  name: string;
  method: Method;
  url: string;
  needs: Permission;
  /** Reads 120/min, writes 30/min. */
  max: 120 | 30;
  /** `@RequireFreshAuth(10)` */
  fresh?: true;
  body?: Record<string, unknown>;
}

const REASON = { reason: "Because the test says so" };
const ROUTES: AdminRoute[] = [
  { name: "stats", method: "GET", url: "/admin/stats", needs: "users.read", max: 120 },
  { name: "users list", method: "GET", url: "/admin/users", needs: "users.read", max: 120 },
  {
    name: "user detail",
    method: "GET",
    url: `/admin/users/${MISSING_ID}`,
    needs: "users.read",
    max: 120,
  },
  {
    name: "suspend",
    method: "POST",
    url: `/admin/users/${MISSING_ID}/suspend`,
    needs: "users.suspend",
    max: 30,
    fresh: true,
    body: REASON,
  },
  {
    name: "unsuspend",
    method: "POST",
    url: `/admin/users/${MISSING_ID}/unsuspend`,
    needs: "users.suspend",
    max: 30,
    fresh: true,
    body: REASON,
  },
  {
    name: "grant role",
    method: "PUT",
    url: `/admin/users/${MISSING_ID}/roles/support`,
    needs: "users.roles.write",
    max: 30,
    fresh: true,
    body: REASON,
  },
  {
    name: "revoke role",
    method: "DELETE",
    url: `/admin/users/${MISSING_ID}/roles/support`,
    needs: "users.roles.write",
    max: 30,
    fresh: true,
    body: REASON,
  },
  { name: "orgs list", method: "GET", url: "/admin/orgs", needs: "orgs.read", max: 120 },
  {
    name: "org detail",
    method: "GET",
    url: `/admin/orgs/${MISSING_ID}`,
    needs: "orgs.read",
    max: 120,
  },
  { name: "roles list", method: "GET", url: "/admin/roles", needs: "roles.read", max: 120 },
  {
    name: "permissions",
    method: "GET",
    url: "/admin/permissions",
    needs: "roles.read",
    max: 120,
  },
  {
    name: "role create",
    method: "POST",
    url: "/admin/roles",
    needs: "roles.write",
    max: 30,
    fresh: true,
    body: { key: "matrix_role", nameAr: "x", nameEn: "x", permissions: [] },
  },
  {
    name: "role update",
    method: "PATCH",
    url: "/admin/roles/matrix_role",
    needs: "roles.write",
    max: 30,
    fresh: true,
    body: { nameEn: "y" },
  },
  {
    name: "role delete",
    method: "DELETE",
    url: "/admin/roles/matrix_role",
    needs: "roles.write",
    max: 30,
    fresh: true,
  },
  {
    name: "settings list",
    method: "GET",
    url: "/admin/settings",
    needs: "settings.read",
    max: 120,
  },
  {
    name: "setting put",
    method: "PUT",
    url: "/admin/settings/free_tier",
    needs: "settings.write",
    max: 30,
    fresh: true,
    body: { value: { monthlyAnalyses: 3 } },
  },
  { name: "flags list", method: "GET", url: "/admin/flags", needs: "flags.read", max: 120 },
  {
    name: "flag put",
    method: "PUT",
    url: "/admin/flags/matrix_flag",
    needs: "flags.write",
    max: 30,
    body: { enabled: false, rules: {} },
  },
  {
    name: "flag delete",
    method: "DELETE",
    url: "/admin/flags/matrix_flag",
    needs: "flags.write",
    max: 30,
  },
  { name: "audit", method: "GET", url: "/admin/audit", needs: "audit.read", max: 120 },
  { name: "issues list", method: "GET", url: "/admin/issues", needs: "issues.read", max: 120 },
  {
    name: "issue detail",
    method: "GET",
    url: `/admin/issues/${MISSING_FINGERPRINT}`,
    needs: "issues.read",
    max: 120,
  },
  {
    name: "issue update",
    method: "PATCH",
    url: `/admin/issues/${MISSING_FINGERPRINT}`,
    needs: "issues.write",
    max: 30,
    body: { status: "resolved" },
  },
];

const request = (route: AdminRoute, who?: { jar: Jar }) =>
  ctx.harness.call(route.method, route.url, {
    ...(who ? { jar: who.jar } : {}),
    ...(route.body ? { body: route.body } : {}),
  });

describe("every admin route", () => {
  const withoutPermission = new Map<Permission, Admin>();
  let noSecondFactor: Person;
  let plain: Person;

  beforeAll(async () => {
    noSecondFactor = await ctx.adminWithoutTwoFactor("super_admin");
    plain = await ctx.harness.signedInUser();
    for (const permission of new Set(ROUTES.map((route) => route.needs))) {
      withoutPermission.set(permission, await ctx.admin(await ctx.roleLacking(permission)));
    }
  }, 180_000);

  for (const route of ROUTES) {
    describe(`${route.method} ${route.name}`, () => {
      it("answers 401 without a session", async () => {
        expectError(await request(route), 401, "AUTH_REQUIRED");
      });

      it("answers 403 to a signed-in user without any role", async () => {
        expectError(await request(route, plain), 403, "FORBIDDEN");
      });

      it(`answers 403 to an admin that holds everything except ${route.needs}`, async () => {
        const admin = withoutPermission.get(route.needs);
        if (!admin) throw new Error("fixture missing");
        expectError(await request(route, admin), 403, "FORBIDDEN");
      });

      it("answers 403 two_factor_required to a permitted account without two-factor", async () => {
        expectError(await request(route, noSecondFactor), 403, "FORBIDDEN", "two_factor_required");
      });
    });
  }

  it("asks for a fresh login on every dangerous route, and on no other", async () => {
    const admin = await ctx.admin("super_admin");
    await ctx.makeSessionStale(admin.userId);
    for (const route of ROUTES) {
      const res = await request(route, admin);
      if (route.fresh) {
        expect(res.statusCode, route.name).toBe(401);
        expect(res.json(), route.name).toMatchObject({
          code: "AUTH_REQUIRED",
          details: { reason: "reauth", maxAgeMinutes: 10 },
        });
      } else {
        expect(res.body, route.name).not.toContain("reauth");
      }
    }
  });

  it("limits every route (reads 120, writes 30 per minute per IP)", async () => {
    for (const route of ROUTES) {
      await expectRateLimited(ctx.harness, {
        method: route.method,
        url: route.url,
        max: route.max,
        ...(route.body ? { body: route.body } : {}),
      });
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
describe("bootstrap to /admin", () => {
  it("lets an account made super_admin by the CLI in once it has two-factor on", async () => {
    const user = await ctx.harness.signedInUser();
    expect((await grantSuperAdmin(ctx.owner.db, user.email)).kind).toBe("granted");
    await ctx.rbac.bustUser(user.userId);

    expectError(await call("GET", "/admin/stats", user), 403, "FORBIDDEN", "two_factor_required");
    await ctx.harness.enableTwoFactor(user);
    expect((await call("GET", "/admin/stats", user)).statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /admin/stats", () => {
  it("counts accounts that are not deleted, organizations and open issue groups", async () => {
    const admin = await ctx.admin("support");
    const before = adminStatsSchema.parse((await call("GET", "/admin/stats", admin)).json());

    const fresh = await ctx.harness.signedInUser();
    const gone = await ctx.harness.signedInUser();
    await ctx.owner.db
      .update(users)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(users.id, fresh.userId));
    await ctx.owner.db
      .update(users)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(users.id, gone.userId));
    await insertOrg(ctx.owner.db, {
      createdBy: fresh.userId,
      members: [{ userId: fresh.userId, role: "org_admin" }],
    });
    await ctx.owner.db
      .insert(errorEvents)
      .values(event({ fingerprint: tag() + tag(), status: "new" }));

    const after = adminStatsSchema.parse((await call("GET", "/admin/stats", admin)).json());
    // one suspended account counts, the deleted one does not
    expect(after.users.total - before.users.total).toBe(1);
    expect(after.users.active - before.users.active).toBe(0);
    expect(after.users.suspended - before.users.suspended).toBe(1);
    expect(after.users.newLast7Days - before.users.newLast7Days).toBe(1);
    expect(after.orgs.total - before.orgs.total).toBe(1);
    expect(after.issues.open - before.issues.open).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /admin/users", () => {
  it("searches by name, email and phone prefix, escapes LIKE wildcards, hides placeholder emails", async () => {
    const admin = await ctx.admin("support");
    const t = tag();
    const alice = await ctx.harness.signedInUser({ email: `alice.${t}@example.com` });
    await ctx.harness.signedInUser({ email: `bob.${t}@example.com` });
    await ctx.owner.db
      .update(users)
      .set({ name: `Zainab 100%${t}_x` })
      .where(eq(users.id, alice.userId));
    const phone = `+2010${randomInt(10_000_000, 99_999_999)}`;
    const phoneUser = await ctx.insertUser({
      name: "Phone Person",
      email: `p-${t}@phone.wasfa.invalid`,
      phone,
    });

    const search = async (query: string) =>
      adminUserListResponseSchema.parse((await call("GET", `/admin/users?${query}`, admin)).json());

    // email contains
    expect((await search(`q=alice.${t}`)).items.map((u) => u.id)).toEqual([alice.userId]);
    expect((await search(`q=${t}`)).items).toHaveLength(2);
    // name contains, case-insensitive; `%` and `_` in the search are literal
    expect((await search(`q=zainab`)).items.map((u) => u.id)).toContain(alice.userId);
    expect((await search(`q=${encodeURIComponent(`100%${t}`)}`)).items.map((u) => u.id)).toEqual([
      alice.userId,
    ]);
    expect((await search(`q=${encodeURIComponent(`%${t}`)}`)).items.map((u) => u.id)).toEqual([
      alice.userId,
    ]);
    expect(
      (await search(`q=${encodeURIComponent("_")}`)).items.every((u) =>
        /_/.test(`${u.name}${u.email}`),
      ),
    ).toBe(true);
    // phone prefix
    const byPhone = await search(`q=${encodeURIComponent(phone.slice(0, 9))}`);
    expect(byPhone.items.map((u) => u.id)).toContain(phoneUser);
    const phoneRow = (await search(`q=${encodeURIComponent(phone)}`)).items[0];
    expect(phoneRow).toMatchObject({ id: phoneUser, email: null, phone });
    // the placeholder address is not searchable and never shown
    expect((await search(`q=p-${t}`)).items).toEqual([]);
    expect(JSON.stringify(await search(`q=${encodeURIComponent(phone)}`))).not.toContain("invalid");
  });

  it("filters by status and role, and pages with a keyset cursor without gaps or repeats", async () => {
    const admin = await ctx.admin("support");
    const t = tag();
    const people = [];
    for (let i = 0; i < 5; i += 1) {
      people.push(await ctx.harness.signedInUser({ email: `page${i}.${t}@example.com` }));
    }
    await ctx.harness.grantRole(at(people, 1).userId, "support");
    await ctx.owner.db
      .update(users)
      .set({ status: "suspended", suspendedReason: "test" })
      .where(eq(users.id, at(people, 2).userId));

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/admin/users?q=${t}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = adminUserListResponseSchema.parse((await call("GET", url, admin)).json());
      expect(page.items.length).toBeLessThanOrEqual(2);
      ids.push(...page.items.map((u) => u.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    // newest account first
    expect(ids).toEqual(people.map((p) => p.userId).reverse());

    const suspended = adminUserListResponseSchema.parse(
      (await call("GET", `/admin/users?q=${t}&status=suspended`, admin)).json(),
    );
    expect(suspended.items.map((u) => u.id)).toEqual([at(people, 2).userId]);
    expect(suspended.items[0]?.status).toBe("suspended");

    const supporters = adminUserListResponseSchema.parse(
      (await call("GET", `/admin/users?q=${t}&role=support`, admin)).json(),
    );
    expect(supporters.items.map((u) => u.id)).toEqual([at(people, 1).userId]);
    expect(supporters.items[0]?.roles).toEqual(["support"]);
  });

  it("rejects bad input with field paths", async () => {
    const admin = await ctx.admin("support");
    for (const query of [
      "limit=0",
      "limit=101",
      "limit=abc",
      "status=banana",
      "role=Not%20A%20Key",
      "q=",
      `q=${"x".repeat(101)}`,
      "cursor=%25%25",
      `cursor=${Buffer.from("not|a|cursor").toString("base64url")}`,
      `cursor=${Buffer.from(`2026-01-01T00:00:00.000000Z|not-a-uuid`).toString("base64url")}`,
    ]) {
      const res = await call("GET", `/admin/users?${query}`, admin);
      expect(res.statusCode, query).toBe(400);
      expect(res.json(), query).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /admin/users/:id", () => {
  it("returns the profile, roles, organizations, live sessions and the latest 20 audit rows", async () => {
    const admin = await ctx.admin("support");
    const target = await ctx.harness.signedInUser();
    await ctx.harness.call("POST", "/auth/sign-in/email", {
      body: { email: target.email, password: PASSWORD },
    });
    await ctx.harness.grantRole(target.userId, "finance");
    const orgId = await insertOrg(ctx.owner.db, {
      createdBy: target.userId,
      members: [{ userId: target.userId, role: "org_admin" }],
      name: "Detail Pharmacy",
    });
    const base = Date.now() - 60_000;
    await ctx.owner.db.insert(auditLogs).values(
      Array.from({ length: 25 }, (_, i) => ({
        actorId: i % 5 === 0 ? target.userId : null,
        action: "fixture.touch",
        targetType: "user",
        targetId: target.userId,
        createdAt: new Date(base + i * 1000),
      })),
    );

    const res = await call("GET", `/admin/users/${target.userId}`, admin);
    expect(res.statusCode).toBe(200);
    const detail = adminUserDetailSchema.parse(res.json());
    expect(detail.user).toMatchObject({
      id: target.userId,
      email: target.email,
      status: "active",
      roles: ["finance"],
      twoFactorEnabled: false,
      suspendedReason: null,
      deletedAt: null,
    });
    expect(detail.organizations).toEqual([
      { id: orgId, name: "Detail Pharmacy", type: "pharmacy", role: "org_admin" },
    ]);
    expect(detail.sessions).toHaveLength(2);
    expect(detail.recentAudit).toHaveLength(20);
    const times = detail.recentAudit.map((row) => row.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(detail.recentAudit[0]?.action).toBe("fixture.touch");
    // the audit rows where the user is the actor carry their name
    expect(detail.recentAudit.find((row) => row.actorId === target.userId)?.actorName).toBe(
      "Test User",
    );
  });

  it("answers 404 for an unknown id and 400 for a malformed one", async () => {
    const admin = await ctx.admin("support");
    expectError(await call("GET", `/admin/users/${MISSING_ID}`, admin), 404, "NOT_FOUND");
    expectError(await call("GET", "/admin/users/not-a-uuid", admin), 400, "VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------------------------
describe("suspend and unsuspend", () => {
  it("ends every session at once, queues the notice, audits without personal data, and can be undone", async () => {
    const admin = await ctx.admin("admin");
    const target = await ctx.harness.signedInUser();
    await ctx.harness.call("POST", "/auth/sign-in/email", {
      body: { email: target.email, password: PASSWORD },
    });
    expect((await call("GET", "/me", target)).statusCode).toBe(200);
    const reason = "Abuse reported by three customers";

    const res = await call("POST", `/admin/users/${target.userId}/suspend`, admin, { reason });
    expect(res.statusCode, res.body).toBe(200);
    expect(adminSuspendResponseSchema.parse(res.json())).toEqual({ status: "suspended" });

    // the open session is dead on the very next request, and nothing is left in the table
    expectError(await call("GET", "/me", target), 401, "AUTH_REQUIRED");
    expect(
      await ctx.owner.db.select().from(sessions).where(eq(sessions.userId, target.userId)),
    ).toEqual([]);
    const [row] = await ctx.owner.db.select().from(users).where(eq(users.id, target.userId));
    expect(row).toMatchObject({ status: "suspended", suspendedReason: reason });

    // signing in again is refused
    const signIn = await ctx.harness.call("POST", "/auth/sign-in/email", {
      body: { email: target.email, password: PASSWORD },
    });
    expect(signIn.statusCode).not.toBe(200);

    // the notice is queued for the account's own address
    const [job] = await ctx.jobsFor(target.email);
    expect(emailSendPayloadSchema.parse(job?.data)).toMatchObject({
      template: "account_suspended",
      to: target.email,
    });

    // audit: actor, target, status before/after and the reason; never the address
    const audit = await ctx.auditRowsFor("user.suspend", target.userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      targetType: "user",
      before: { status: "active" },
      after: { status: "suspended", reason },
    });
    expect(JSON.stringify(audit[0])).not.toContain(target.email);

    // the detail page shows it
    const detail = adminUserDetailSchema.parse(
      (await call("GET", `/admin/users/${target.userId}`, admin)).json(),
    );
    expect(detail.user).toMatchObject({ status: "suspended", suspendedReason: reason });
    expect(detail.sessions).toEqual([]);
    expect(detail.recentAudit[0]?.action).toBe("user.suspend");
    expect(detail.recentAudit[0]?.actorName).toBe("Test User");

    // suspended twice is a conflict, not a second audit row
    expectError(
      await call("POST", `/admin/users/${target.userId}/suspend`, admin, { reason }),
      409,
      "CONFLICT",
      "invalid_status",
    );
    expect(await ctx.auditRowsFor("user.suspend", target.userId)).toHaveLength(1);

    // unsuspend
    const back = await call("POST", `/admin/users/${target.userId}/unsuspend`, admin, {
      reason: "Appeal accepted",
    });
    expect(back.statusCode, back.body).toBe(200);
    expect(adminSuspendResponseSchema.parse(back.json())).toEqual({ status: "active" });
    const [restored] = await ctx.owner.db.select().from(users).where(eq(users.id, target.userId));
    expect(restored).toMatchObject({ status: "active", suspendedReason: null });
    const undone = await ctx.auditRowsFor("user.unsuspend", target.userId);
    expect(undone).toHaveLength(1);
    expect(undone[0]).toMatchObject({
      before: { status: "suspended" },
      after: { status: "active", reason: "Appeal accepted" },
    });
    expect(
      (
        await ctx.harness.call("POST", "/auth/sign-in/email", {
          body: { email: target.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(200);
    expectError(
      await call("POST", `/admin/users/${target.userId}/unsuspend`, admin, { reason }),
      409,
      "CONFLICT",
      "invalid_status",
    );
  });

  it("refuses to suspend yourself, and an admin cannot suspend a super_admin", async () => {
    const admin = await ctx.admin("admin");
    const boss = await ctx.admin("super_admin");
    const other = await ctx.admin("super_admin");

    expectError(
      await call("POST", `/admin/users/${admin.userId}/suspend`, admin, REASON),
      409,
      "CONFLICT",
      "self_action",
    );
    expectError(
      await call("POST", `/admin/users/${boss.userId}/suspend`, admin, REASON),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expect(await ctx.auditRowsFor("user.suspend", boss.userId)).toEqual([]);

    // another super_admin may
    expect(
      (await call("POST", `/admin/users/${other.userId}/suspend`, boss, REASON)).statusCode,
    ).toBe(200);
    expectError(await call("GET", "/me", other), 401, "AUTH_REQUIRED");

    // ...and only a super_admin may restore them.
    expectError(
      await call("POST", `/admin/users/${other.userId}/unsuspend`, admin, REASON),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expect(
      (await call("POST", `/admin/users/${other.userId}/unsuspend`, boss, REASON)).statusCode,
    ).toBe(200);
  });

  it("validates the reason and the id, and answers 404 for an unknown user", async () => {
    const admin = await ctx.admin("admin");
    const target = await ctx.harness.signedInUser();
    for (const body of [{}, { reason: "no" }, { reason: "   " }, { reason: "x".repeat(501) }]) {
      const res = await call("POST", `/admin/users/${target.userId}/suspend`, admin, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { fields: ["reason"] },
      });
    }
    expectError(
      await call("POST", "/admin/users/nope/suspend", admin, REASON),
      400,
      "VALIDATION_FAILED",
    );
    expectError(
      await call("POST", `/admin/users/${MISSING_ID}/suspend`, admin, REASON),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("POST", `/admin/users/${MISSING_ID}/unsuspend`, admin, REASON),
      404,
      "NOT_FOUND",
    );
    // nothing was suspended and nothing audited
    expect(await ctx.auditRowsFor("user.suspend", target.userId)).toEqual([]);
    expect((await call("GET", "/me", target)).statusCode).toBe(200);
  });

  it("sends no notice to a phone-only account (its address is a placeholder)", async () => {
    const admin = await ctx.admin("admin");
    const placeholder = `ph-${tag()}@phone.wasfa.invalid`;
    const userId = await ctx.insertUser({ name: "Phone Only", email: placeholder });
    const res = await call("POST", `/admin/users/${userId}/suspend`, admin, REASON);
    expect(res.statusCode, res.body).toBe(200);
    expect(await ctx.noJobsFor(placeholder)).toBe(true);
    expect(await ctx.auditRowsFor("user.suspend", userId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("organizations", () => {
  it("lists, searches and pages organizations, and shows members and pending invitations", async () => {
    const admin = await ctx.admin("support");
    const t = tag();
    const founder = await ctx.harness.signedInUser();
    const member = await ctx.harness.signedInUser();
    const orgIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      orgIds.push(
        await insertOrg(ctx.owner.db, {
          createdBy: founder.userId,
          members:
            i === 0
              ? [
                  { userId: founder.userId, role: "org_admin" },
                  { userId: member.userId, role: "org_member" },
                ]
              : [{ userId: founder.userId, role: "org_admin" }],
          name: `Orchid ${i} ${t}`,
        }),
      );
    }
    await ctx.owner.db.insert(organizationInvites).values([
      invite(at(orgIds, 0), { expiresAt: new Date(Date.now() + 86_400_000) }),
      invite(at(orgIds, 0), { expiresAt: new Date(Date.now() - 1_000) }),
      invite(at(orgIds, 0), {
        expiresAt: new Date(Date.now() + 86_400_000),
        acceptedAt: new Date(),
      }),
    ]);

    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/admin/orgs?q=${t}&limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const page = adminOrgListResponseSchema.parse((await call("GET", url, admin)).json());
      all.push(...page.items.map((o) => o.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(2);
    expect(all).toEqual([...orgIds].reverse());

    const first = adminOrgListResponseSchema
      .parse((await call("GET", `/admin/orgs?q=${t}`, admin)).json())
      .items.find((org) => org.id === orgIds[0]);
    expect(first).toMatchObject({
      name: `Orchid 0 ${t}`,
      memberCount: 2,
      country: "EG",
      city: null,
    });

    const detail = adminOrgDetailSchema.parse(
      (await call("GET", `/admin/orgs/${orgIds[0]}`, admin)).json(),
    );
    expect(detail.memberCount).toBe(2);
    expect(detail.pendingInvites).toBe(1);
    expect(detail.members.map((m) => [m.userId, m.role]).sort()).toEqual(
      [
        [founder.userId, "org_admin"],
        [member.userId, "org_member"],
      ].sort(),
    );
    // members never carry contact data
    expect(Object.keys(detail.members[0] ?? {}).sort()).toEqual([
      "joinedAt",
      "name",
      "role",
      "userId",
    ]);

    expectError(await call("GET", `/admin/orgs/${MISSING_ID}`, admin), 404, "NOT_FOUND");
    expectError(await call("GET", "/admin/orgs/x", admin), 400, "VALIDATION_FAILED");
    expectError(await call("GET", "/admin/orgs?limit=500", admin), 400, "VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------------------------
describe("settings", () => {
  it("lists every registry key, validates writes with field paths, and the change reaches /settings/public", async () => {
    const admin = await ctx.admin("admin");
    const list = adminSettingsResponseSchema.parse(
      (await call("GET", "/admin/settings", admin)).json(),
    );
    expect(list.items.map((item) => item.key).sort()).toEqual([...SETTING_KEYS].sort());
    expect(list.items.find((item) => item.key === "auth")?.visibility).toBe("admin");
    expect(list.items.find((item) => item.key === "branding")?.visibility).toBe("public");

    // invalid: field paths only, nothing stored, nothing audited
    const invalid = await call("PUT", "/admin/settings/contact", admin, {
      value: { whatsapp: "not a number", telegram: "no" },
    });
    expect(invalid.statusCode).toBe(400);
    const body = invalid.json<{ code: string; details: { fields: string[] } }>();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.details.fields).toEqual(expect.arrayContaining(["whatsapp", "telegram"]));
    expect(JSON.stringify(body)).not.toContain("not a number");
    expectError(
      await call("PUT", "/admin/settings/nope", admin, { value: {} }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await ctx.auditRowsFor("setting.update", "contact")).toEqual([]);

    const nameEn = `Wasfa ${tag()}`;
    const res = await call("PUT", "/admin/settings/branding", admin, {
      value: { nameEn, nameAr: "وصفة" },
    });
    expect(res.statusCode, res.body).toBe(200);
    const item = adminSettingSchema.parse(res.json());
    expect(item).toMatchObject({
      key: "branding",
      visibility: "public",
      value: { nameEn, nameAr: "وصفة", logoUrl: null },
      updatedBy: admin.userId,
    });
    expect(item.updatedAt).not.toBeNull();

    const publicSettings = await ctx.harness.call("GET", "/settings/public");
    expect(publicSettings.json()).toMatchObject({ branding: { nameEn } });
    const again = adminSettingsResponseSchema.parse(
      (await call("GET", "/admin/settings", admin)).json(),
    );
    expect(again.items.find((i) => i.key === "branding")).toMatchObject({
      value: { nameEn },
      updatedBy: admin.userId,
    });

    const rows = await auditRows(ctx.owner.db, "setting.update", admin.userId);
    expect(rows.filter((row) => row.targetId === "branding")).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetType: "setting", after: { nameEn } });
  });

  it("does not let a reader write", async () => {
    const marketing = await ctx.admin("marketing");
    expect((await call("GET", "/admin/settings", marketing)).statusCode).toBe(200);
    expectError(
      await call("PUT", "/admin/settings/free_tier", marketing, { value: { monthlyAnalyses: 1 } }),
      403,
      "FORBIDDEN",
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("feature flags", () => {
  it("creates, updates, lists and deletes a flag, with an audit row per write", async () => {
    const admin = await ctx.admin("admin");
    const key = `flag_${tag()}`;

    const created = await call("PUT", `/admin/flags/${key}`, admin, { enabled: true, rules: {} });
    expect(created.statusCode, created.body).toBe(200);
    expect(adminFlagSchema.parse(created.json())).toMatchObject({
      key,
      enabled: true,
      rules: { type: "all" },
    });

    const updated = await call("PUT", `/admin/flags/${key}`, admin, {
      enabled: true,
      rules: { type: "percentage", percentage: 25 },
    });
    expect(adminFlagSchema.parse(updated.json()).rules).toEqual({
      type: "percentage",
      percentage: 25,
    });

    const list = adminFlagListResponseSchema.parse(
      (await call("GET", "/admin/flags", admin)).json(),
    );
    expect(list.items.filter((flag) => flag.key === key)).toHaveLength(1);

    const audit = await ctx.auditRowsFor("flag.update", key);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorId: admin.userId, targetType: "flag" });

    // the member-facing endpoint sees it (percentage 25 may be off for this user, but the key is known)
    expect(
      (await call("GET", "/flags", admin)).json<{ flags: Record<string, boolean> }>().flags,
    ).toHaveProperty(key);

    const deleted = await call("DELETE", `/admin/flags/${key}`, admin);
    expect(deleted.statusCode).toBe(204);
    expect(await ctx.auditRowsFor("flag.delete", key)).toHaveLength(1);
    expectError(await call("DELETE", `/admin/flags/${key}`, admin), 404, "NOT_FOUND");
    expect(
      adminFlagListResponseSchema
        .parse((await call("GET", "/admin/flags", admin)).json())
        .items.some((flag) => flag.key === key),
    ).toBe(false);
  });

  it("rejects bad keys and bad rules with field paths, and stores nothing", async () => {
    const admin = await ctx.admin("admin");
    const key = `flag_${tag()}`;
    for (const body of [
      {},
      { enabled: "yes", rules: {} },
      { enabled: true, rules: { type: "percentage", percentage: 150 } },
      { enabled: true, rules: { type: "user", userIds: ["not-a-uuid"] } },
      { enabled: true, rules: { type: "nope" } },
    ]) {
      const res = await call("PUT", `/admin/flags/${key}`, admin, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expectError(
      await call("PUT", "/admin/flags/BadKey", admin, { enabled: true, rules: {} }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await ctx.auditRowsFor("flag.update", key)).toEqual([]);
  });

  it("lets a reader list but not write", async () => {
    const marketing = await ctx.admin("marketing");
    expect((await call("GET", "/admin/flags", marketing)).statusCode).toBe(200);
    expectError(
      await call("PUT", "/admin/flags/some_flag", marketing, { enabled: true, rules: {} }),
      403,
      "FORBIDDEN",
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("GET /admin/audit", () => {
  it("filters by actor, action, target and time, joins the actor name, and pages through ties", async () => {
    const admin = await ctx.admin("admin");
    const reader = await ctx.admin("admin");
    const targetId = randomUUID();
    const t0 = Date.now() - 3_600_000;
    const stamp = (minutes: number) => new Date(t0 + minutes * 60_000);
    // rows 3 and 4 share a timestamp: the id breaks the tie
    await ctx.owner.db.insert(auditLogs).values([
      {
        actorId: admin.userId,
        action: "fixture.alpha",
        targetType: "thing",
        targetId,
        createdAt: stamp(1),
      },
      {
        actorId: null,
        action: "fixture.alpha",
        targetType: "thing",
        targetId,
        createdAt: stamp(2),
      },
      {
        actorId: admin.userId,
        action: "fixture.beta",
        targetType: "thing",
        targetId,
        createdAt: stamp(3),
      },
      {
        actorId: reader.userId,
        action: "fixture.beta",
        targetType: "thing",
        targetId,
        createdAt: stamp(3),
      },
      {
        actorId: admin.userId,
        action: "fixture.beta",
        targetType: "other",
        targetId,
        createdAt: stamp(4),
      },
    ]);

    const list = async (query: string) =>
      auditListResponseSchema.parse(
        (await call("GET", `/admin/audit?targetId=${targetId}&${query}`, reader)).json(),
      );

    const everything = await list("");
    expect(everything.items).toHaveLength(5);
    expect(everything.nextCursor).toBeNull();
    const created = everything.items.map((row) => row.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    expect(everything.items.find((row) => row.actorId === admin.userId)?.actorName).toBe(
      "Test User",
    );
    expect(everything.items.find((row) => row.actorId === null)?.actorName).toBeNull();

    expect((await list(`actorId=${admin.userId}`)).items).toHaveLength(3);
    expect((await list("action=fixture.alpha")).items).toHaveLength(2);
    expect((await list("targetType=other")).items).toHaveLength(1);
    expect(
      (await list(`from=${stamp(2).toISOString()}&to=${stamp(3).toISOString()}`)).items,
    ).toHaveLength(3);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(`limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual(everything.items.map((row) => row.id));
  });

  it("rejects malformed filters", async () => {
    const admin = await ctx.admin("admin");
    for (const query of [
      "actorId=nope",
      "action=Has%20Spaces",
      `action=${"a".repeat(65)}`,
      "from=yesterday",
      "to=2026-13-45",
      "limit=1000",
      `targetId=${"x".repeat(101)}`,
      "cursor=%25",
    ]) {
      const res = await call("GET", `/admin/audit?${query}`, admin);
      expect(res.statusCode, query).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------------------------
function event(overrides: Partial<NewErrorEvent> & { fingerprint: string }): NewErrorEvent {
  return {
    ref: `WSF-${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`,
    code: "INTERNAL",
    route: "/fixture",
    method: "GET",
    message: "fixture failure",
    ...overrides,
  };
}

function invite(
  orgId: string,
  values: { expiresAt: Date; acceptedAt?: Date },
): typeof organizationInvites.$inferInsert {
  return {
    orgId,
    email: `invitee-${tag()}@example.com`,
    tokenHash: randomBytes(32).toString("hex"),
    ...values,
  };
}

describe("issues", () => {
  it("groups a thrown error by fingerprint, lets an admin resolve it (audited), and shows a regression as new", async () => {
    const admin = await ctx.admin("admin");
    const find = async (route: string) =>
      issueListResponseSchema
        .parse((await call("GET", "/admin/issues?limit=100", admin)).json())
        .items.find((issue) => issue.route === route);

    for (let i = 0; i < 2; i += 1) {
      const boom = await ctx.harness.call("GET", "/__probe/boom");
      expect(boom.statusCode).toBe(500);
    }
    expect((await ctx.harness.call("GET", "/__probe/other")).statusCode).toBe(500);

    const boom = await find("/__probe/boom");
    expect(boom).toMatchObject({
      code: "INTERNAL",
      method: "GET",
      count: 2,
      affectedUsers: 0,
      status: "new",
      message: "probe failure",
    });
    expect(boom?.fingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(boom?.sampleRef).toMatch(/^WSF-/);
    expect(new Date(boom?.firstSeen ?? 0).getTime()).toBeLessThanOrEqual(
      new Date(boom?.lastSeen ?? 0).getTime(),
    );
    // a different route is a different group
    const other = await find("/__probe/other");
    expect(other?.count).toBe(1);
    expect(other?.fingerprint).not.toBe(boom?.fingerprint);

    const fingerprint = boom?.fingerprint ?? "";
    const detail = issueDetailSchema.parse(
      (await call("GET", `/admin/issues/${fingerprint}`, admin)).json(),
    );
    expect(detail.events).toHaveLength(2);
    expect(detail.events[0]?.ref).toBe(detail.sampleRef);
    expect(detail.events[0]?.stack).toContain("probe failure");

    // resolve
    const resolved = await call("PATCH", `/admin/issues/${fingerprint}`, admin, {
      status: "resolved",
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(issueSchema.parse(resolved.json())).toMatchObject({ status: "resolved", count: 2 });
    const audit = await ctx.auditRowsFor("issue.status", fingerprint);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.userId,
      targetType: "issue",
      before: { status: "new" },
      after: { status: "resolved" },
    });
    expect((await find("/__probe/boom"))?.status).toBe("resolved");
    const resolvedOnly = issueListResponseSchema.parse(
      (await call("GET", "/admin/issues?status=resolved&limit=100", admin)).json(),
    );
    expect(resolvedOnly.items.some((issue) => issue.fingerprint === fingerprint)).toBe(true);
    const newOnly = issueListResponseSchema.parse(
      (await call("GET", "/admin/issues?status=new&limit=100", admin)).json(),
    );
    expect(newOnly.items.some((issue) => issue.fingerprint === fingerprint)).toBe(false);

    // the same error again: the group is back to "new" with a higher count
    expect((await ctx.harness.call("GET", "/__probe/boom")).statusCode).toBe(500);
    expect(await find("/__probe/boom")).toMatchObject({ status: "new", count: 3 });

    // investigating, then back to resolved
    expect(
      (await call("PATCH", `/admin/issues/${fingerprint}`, admin, { status: "investigating" }))
        .statusCode,
    ).toBe(200);
    expect((await find("/__probe/boom"))?.status).toBe("investigating");
    expect(await ctx.auditRowsFor("issue.status", fingerprint)).toHaveLength(2);
  });

  it("counts distinct affected users and shows only the latest 20 events of a group", async () => {
    const admin = await ctx.admin("support");
    const fingerprint = randomBytes(16).toString("hex");
    const [a, b] = [randomUUID(), randomUUID()];
    const base = Date.UTC(2031, 0, 1);
    await ctx.owner.db.insert(errorEvents).values(
      Array.from({ length: 25 }, (_, i) =>
        event({
          fingerprint,
          route: "/fixture/many",
          userId: i % 3 === 0 ? a : i % 3 === 1 ? b : null,
          createdAt: new Date(base + i * 1000),
        }),
      ),
    );
    const detail = issueDetailSchema.parse(
      (await call("GET", `/admin/issues/${fingerprint}`, admin)).json(),
    );
    expect(detail).toMatchObject({ count: 25, affectedUsers: 2, route: "/fixture/many" });
    expect(detail.events).toHaveLength(20);
    expect(detail.firstSeen).toBe(new Date(base).toISOString());
    expect(detail.lastSeen).toBe(new Date(base + 24_000).toISOString());
    expect(detail.events[0]?.createdAt).toBe(detail.lastSeen);
  });

  it("pages through every group without repeats, newest first", async () => {
    const admin = await ctx.admin("support");
    const base = Date.UTC(2032, 0, 1);
    for (let i = 0; i < 3; i += 1) {
      await ctx.owner.db
        .insert(errorEvents)
        .values(
          event({
            fingerprint: randomBytes(16).toString("hex"),
            createdAt: new Date(base + i * 1000),
          }),
        );
    }
    // two groups whose last event is in the same instant: the fingerprint breaks the tie
    const tie = new Date(base + 10_000);
    for (let i = 0; i < 2; i += 1) {
      await ctx.owner.db
        .insert(errorEvents)
        .values(event({ fingerprint: randomBytes(16).toString("hex"), createdAt: tie }));
    }

    const seen: { fingerprint: string; lastSeen: string }[] = [];
    let cursor: string | null = null;
    do {
      const page = issueListResponseSchema.parse(
        (
          await call("GET", `/admin/issues?limit=2${cursor ? `&cursor=${cursor}` : ""}`, admin)
        ).json(),
      );
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    const counted = await ctx.owner.db.execute<{ groups: number }>(
      sql`select count(distinct fingerprint)::int as groups from error_events`,
    );
    const groups = counted[0]?.groups ?? -1;
    expect(seen).toHaveLength(groups);
    expect(new Set(seen.map((issue) => issue.fingerprint)).size).toBe(groups);
    const times = seen.map((issue) => issue.lastSeen);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("validates fingerprints and statuses, answers 404 for an unknown group, and keeps readers out of writes", async () => {
    const admin = await ctx.admin("admin");
    for (const fingerprint of ["ABC", "short", "zz".repeat(8), "A".repeat(32)]) {
      expectError(
        await call("GET", `/admin/issues/${fingerprint}`, admin),
        400,
        "VALIDATION_FAILED",
      );
    }
    expectError(await call("GET", `/admin/issues/${MISSING_FINGERPRINT}`, admin), 404, "NOT_FOUND");
    expectError(
      await call("PATCH", `/admin/issues/${MISSING_FINGERPRINT}`, admin, { status: "resolved" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("PATCH", `/admin/issues/${MISSING_FINGERPRINT}`, admin, { status: "done" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await ctx.auditRowsFor("issue.status", MISSING_FINGERPRINT)).toEqual([]);

    const support = await ctx.admin("support");
    expect((await call("GET", "/admin/issues", support)).statusCode).toBe(200);
    expectError(
      await call("PATCH", `/admin/issues/${MISSING_FINGERPRINT}`, support, { status: "resolved" }),
      403,
      "FORBIDDEN",
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe("no personal data in the audit trail", () => {
  it("keeps emails and phones out of every row written by the admin routes", async () => {
    const admin = await ctx.admin("admin");
    const target = await ctx.harness.signedInUser();
    await call("POST", `/admin/users/${target.userId}/suspend`, admin, {
      reason: `Complaint from ${target.email} about +201012345678`,
    });
    const [row] = await ctx.auditRowsFor("user.suspend", target.userId);
    const text = JSON.stringify(row);
    expect(text).not.toContain(target.email);
    expect(text).not.toContain("01012345678");
  });
});
