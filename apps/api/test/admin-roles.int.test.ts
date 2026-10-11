import { randomBytes } from "node:crypto";

import { rolePermissions, roles, userRoles, users } from "@wasfa/db";
import { PERMISSION_GROUPS, PERMISSION_KEYS } from "@wasfa/shared/permissions";
import {
  adminUserRolesResponseSchema,
  permissionCatalogSchema,
  roleListResponseSchema,
  roleSchema,
} from "@wasfa/shared/schemas/admin";
import { meResponseSchema } from "@wasfa/shared/schemas/user";
import { and, count, eq, ne } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID } from "./support/admin-context.js";

import type { Jar } from "./support/auth-harness.js";
import type { LightMyRequestResponse } from "fastify";

const ctx = new AdminTestContext();

beforeAll(async () => {
  await ctx.start();
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (method: Method, url: string, who: { jar: Jar }, body?: Record<string, unknown>) =>
  ctx.harness.call(method, url, { jar: who.jar, ...(body ? { body } : {}) });

const tag = () => randomBytes(3).toString("hex");
const REASON = { reason: "Needed for the on-call rota" };
const grant = (actor: { jar: Jar }, userId: string, roleKey: string) =>
  call("PUT", `/admin/users/${userId}/roles/${roleKey}`, actor, REASON);
const revoke = (actor: { jar: Jar }, userId: string, roleKey: string) =>
  call("DELETE", `/admin/users/${userId}/roles/${roleKey}`, actor, REASON);

function expectError(res: LightMyRequestResponse, status: number, code: string, reason?: string) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json()).toMatchObject({
    code,
    ...(reason ? { details: { reason } } : {}),
  });
}

const rolesOf = async (userId: string) =>
  (await ctx.owner.db.select().from(userRoles).where(eq(userRoles.userId, userId)))
    .map((row) => row.roleKey)
    .sort();

const permissionsInDb = async (roleKey: string) =>
  (
    await ctx.owner.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleKey, roleKey))
  )
    .map((row) => row.permission)
    .sort();

const mePermissions = async (who: { jar: Jar }) =>
  meResponseSchema.parse((await call("GET", "/me", who)).json()).permissions.sort();

// ---------------------------------------------------------------------------------------------
describe("granting and revoking roles", () => {
  it("takes effect at once, records the reason, and writes nothing for an idempotent repeat", async () => {
    const boss = await ctx.admin("super_admin");
    const target = await ctx.harness.signedInUser();
    expect(await mePermissions(target)).toEqual([]);

    const res = await grant(boss, target.userId, "support");
    expect(res.statusCode, res.body).toBe(200);
    expect(adminUserRolesResponseSchema.parse(res.json())).toEqual({
      roles: ["support"],
      changed: true,
    });
    // the permission cache was cleared, not left to expire in five minutes
    expect(await mePermissions(target)).toEqual(["issues.read", "orgs.read", "users.read"]);
    const [row] = await ctx.owner.db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, target.userId), eq(userRoles.roleKey, "support")));
    expect(row?.grantedBy).toBe(boss.userId);

    const audit = await ctx.auditRowsFor("role.grant", target.userId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: boss.userId,
      targetType: "user",
      after: { roleKey: "support", reason: REASON.reason },
    });
    expect(JSON.stringify(audit[0])).not.toContain(target.email);

    const again = await grant(boss, target.userId, "support");
    expect(again.statusCode).toBe(200);
    expect(adminUserRolesResponseSchema.parse(again.json()).changed).toBe(false);
    expect(await ctx.auditRowsFor("role.grant", target.userId)).toHaveLength(1);

    const removed = await revoke(boss, target.userId, "support");
    expect(removed.statusCode, removed.body).toBe(200);
    expect(adminUserRolesResponseSchema.parse(removed.json())).toEqual({
      roles: [],
      changed: true,
    });
    expect(await mePermissions(target)).toEqual([]);
    const revoked = await ctx.auditRowsFor("role.revoke", target.userId);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]).toMatchObject({
      actorId: boss.userId,
      after: { roleKey: "support", reason: REASON.reason },
    });

    const repeat = await revoke(boss, target.userId, "support");
    expect(repeat.statusCode).toBe(200);
    expect(adminUserRolesResponseSchema.parse(repeat.json()).changed).toBe(false);
    expect(await ctx.auditRowsFor("role.revoke", target.userId)).toHaveLength(1);
  });

  it("never lets anyone change their own roles, whatever they hold", async () => {
    const boss = await ctx.admin("super_admin");
    const admin = await ctx.admin("admin");
    for (const actor of [boss, admin]) {
      expectError(await grant(actor, actor.userId, "support"), 409, "CONFLICT", "self_action");
      expectError(await revoke(actor, actor.userId, "admin"), 409, "CONFLICT", "self_action");
    }
    expect(await rolesOf(admin.userId)).toEqual(["admin"]);
    expect(await ctx.auditRowsFor("role.grant", admin.userId)).toEqual([]);
  });

  it("stops an admin from promoting anyone to super_admin or to a role holding a permission the admin lacks", async () => {
    const admin = await ctx.admin("admin");
    const target = await ctx.harness.signedInUser();

    // super_admin is for super admins only
    expectError(
      await grant(admin, target.userId, "super_admin"),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    // `roles.write` is not in the admin role: a custom role holding it is out of reach
    const escalator = await ctx.customRole(["roles.write"]);
    expectError(
      await grant(admin, target.userId, escalator),
      403,
      "FORBIDDEN",
      "not_enough_permissions",
    );
    // one permission missing out of several is enough to refuse
    const mixed = await ctx.customRole(["users.read", "roles.write"]);
    expectError(
      await grant(admin, target.userId, mixed),
      403,
      "FORBIDDEN",
      "not_enough_permissions",
    );
    expect(await rolesOf(target.userId)).toEqual([]);
    expect(await ctx.auditRowsFor("role.grant", target.userId)).toEqual([]);

    // a role made only of permissions the admin holds is fine
    const harmless = await ctx.customRole(["users.read", "audit.read"]);
    expect((await grant(admin, target.userId, harmless)).statusCode).toBe(200);
    expect((await grant(admin, target.userId, "support")).statusCode).toBe(200);
    expect(await rolesOf(target.userId)).toEqual([harmless, "support"].sort());
  });

  it("applies the same limits to revoking", async () => {
    const admin = await ctx.admin("admin");
    const boss = await ctx.admin("super_admin");
    const holder = await ctx.harness.signedInUser();
    const escalator = await ctx.customRole(["roles.write"]);
    await ctx.harness.grantRole(holder.userId, escalator);

    expectError(
      await revoke(admin, boss.userId, "super_admin"),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expectError(
      await revoke(admin, holder.userId, escalator),
      403,
      "FORBIDDEN",
      "not_enough_permissions",
    );
    expect(await rolesOf(holder.userId)).toEqual([escalator]);
    expect(await rolesOf(boss.userId)).toEqual(["super_admin"]);
    expect(await ctx.auditRowsFor("role.revoke", boss.userId)).toEqual([]);
  });

  it("needs every permission of the role, not just users.roles.write", async () => {
    const limited = await ctx.admin(await ctx.customRole(["users.roles.write", "users.read"]));
    const target = await ctx.harness.signedInUser();
    // `support` also has orgs.read and issues.read
    expectError(
      await grant(limited, target.userId, "support"),
      403,
      "FORBIDDEN",
      "not_enough_permissions",
    );
    const subset = await ctx.customRole(["users.read"]);
    expect((await grant(limited, target.userId, subset)).statusCode).toBe(200);
  });

  it("lets a super_admin grant and revoke super_admin", async () => {
    const boss = await ctx.admin("super_admin");
    const target = await ctx.harness.signedInUser();
    const granted = await grant(boss, target.userId, "super_admin");
    expect(granted.statusCode, granted.body).toBe(200);
    expect(await mePermissions(target)).toHaveLength(PERMISSION_KEYS.length);
    expect((await revoke(boss, target.userId, "super_admin")).statusCode).toBe(200);
    expect(await rolesOf(target.userId)).toEqual([]);
  });

  it("validates the role, the target and the reason", async () => {
    const boss = await ctx.admin("super_admin");
    const target = await ctx.harness.signedInUser();

    // `user` is implicit: there is nothing to add or remove
    for (const send of [grant, revoke]) {
      const res = await send(boss, target.userId, "user");
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        code: "VALIDATION_FAILED",
        details: { fields: ["roleKey"] },
      });
    }
    expectError(await grant(boss, target.userId, "no_such_role"), 404, "NOT_FOUND");
    expectError(await grant(boss, MISSING_ID, "support"), 404, "NOT_FOUND");
    expectError(await grant(boss, "not-a-uuid", "support"), 400, "VALIDATION_FAILED");
    expectError(await grant(boss, target.userId, "Bad-Key"), 400, "VALIDATION_FAILED");
    for (const body of [{}, { reason: "no" }, { reason: "  " }]) {
      const res = await call("PUT", `/admin/users/${target.userId}/roles/support`, boss, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ details: { fields: ["reason"] } });
    }
    // a bodiless DELETE has no reason either
    expectError(
      await ctx.harness.call("DELETE", `/admin/users/${target.userId}/roles/support`, {
        jar: boss.jar,
      }),
      400,
      "VALIDATION_FAILED",
    );

    // a deleted account cannot be given roles
    await ctx.owner.db
      .update(users)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(users.id, target.userId));
    expectError(await grant(boss, target.userId, "support"), 409, "CONFLICT", "invalid_status");
    expect(await rolesOf(target.userId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("role editor", () => {
  it("lists roles with holders and the permission catalog with labels", async () => {
    const reader = await ctx.admin("admin");
    const list = roleListResponseSchema.parse((await call("GET", "/admin/roles", reader)).json());
    const byKey = new Map(list.items.map((role) => [role.key, role]));
    for (const key of ["user", "support", "marketing", "finance", "admin", "super_admin"]) {
      expect(byKey.get(key)?.isSystem, key).toBe(true);
    }
    expect(byKey.get("super_admin")?.permissions).toEqual(PERMISSION_KEYS);
    expect(byKey.get("support")?.permissions).toEqual(["users.read", "orgs.read", "issues.read"]);
    expect(byKey.get("admin")?.holders).toBeGreaterThanOrEqual(1);

    const catalog = permissionCatalogSchema.parse(
      (await call("GET", "/admin/permissions", reader)).json(),
    );
    expect(catalog.groups.map((group) => group.key)).toEqual(Object.keys(PERMISSION_GROUPS));
    const keys = catalog.groups.flatMap((group) => group.permissions.map((p) => p.key));
    expect([...keys].sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const group of catalog.groups) {
      expect(group.label.ar.length).toBeGreaterThan(0);
      expect(group.label.en.length).toBeGreaterThan(0);
    }
  });

  it("is for super admins only, even for someone holding roles.write", async () => {
    const editor = await ctx.admin(await ctx.customRole(["roles.write", "roles.read"]));
    const key = `edit_${tag()}`;
    const body = { key, nameAr: "x", nameEn: "x", permissions: [] };

    expect((await call("GET", "/admin/roles", editor)).statusCode).toBe(200);
    expectError(
      await call("POST", "/admin/roles", editor, body),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expectError(
      await call("PATCH", "/admin/roles/support", editor, { nameEn: "Hacked" }),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expectError(
      await ctx.harness.call("DELETE", "/admin/roles/finance", { jar: editor.jar }),
      403,
      "FORBIDDEN",
      "super_admin_only",
    );
    expect(await permissionsInDb("support")).toEqual(["issues.read", "orgs.read", "users.read"]);
    expect(await ctx.owner.db.select().from(roles).where(eq(roles.key, key))).toEqual([]);
  });

  it("creates, edits and deletes a custom role, each step audited, edits reaching holders at once", async () => {
    const boss = await ctx.admin("super_admin");
    const key = `qa_${tag()}`;

    // --- create
    const created = await call("POST", "/admin/roles", boss, {
      key,
      nameAr: "قائد الجودة",
      nameEn: "QA lead",
      permissions: ["audit.read", "users.read"],
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(roleSchema.parse(created.json())).toEqual({
      key,
      nameAr: "قائد الجودة",
      nameEn: "QA lead",
      isSystem: false,
      permissions: ["users.read", "audit.read"],
      holders: 0,
    });
    expect(await permissionsInDb(key)).toEqual(["audit.read", "users.read"]);
    const createAudit = await ctx.auditRowsFor("role.create", key);
    expect(createAudit).toHaveLength(1);
    expect(createAudit[0]).toMatchObject({
      actorId: boss.userId,
      targetType: "role",
      after: { key, nameEn: "QA lead", permissions: ["users.read", "audit.read"] },
    });
    expectError(
      await call("POST", "/admin/roles", boss, { key, nameAr: "x", nameEn: "x", permissions: [] }),
      409,
      "CONFLICT",
      "role_exists",
    );
    expect(await ctx.auditRowsFor("role.create", key)).toHaveLength(1);

    // --- a holder sees edits immediately
    const holder = await ctx.harness.signedInUser();
    expect((await grant(boss, holder.userId, key)).statusCode).toBe(200);
    expect(await mePermissions(holder)).toEqual(["audit.read", "users.read"]);

    const edited = await call("PATCH", `/admin/roles/${key}`, boss, {
      nameEn: "QA captain",
      permissions: ["users.read", "orgs.read"],
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(roleSchema.parse(edited.json())).toMatchObject({
      key,
      nameAr: "قائد الجودة",
      nameEn: "QA captain",
      permissions: ["users.read", "orgs.read"],
      holders: 1,
    });
    expect(await permissionsInDb(key)).toEqual(["orgs.read", "users.read"]);
    expect(await mePermissions(holder)).toEqual(["orgs.read", "users.read"]);
    const editAudit = await ctx.auditRowsFor("role.update", key);
    expect(editAudit).toHaveLength(1);
    expect(editAudit[0]).toMatchObject({
      before: { nameEn: "QA lead", permissions: ["audit.read", "users.read"] },
      after: { nameEn: "QA captain", permissions: ["orgs.read", "users.read"] },
    });

    // names alone leave the permissions untouched; an empty list removes them all
    const renamed = await call("PATCH", `/admin/roles/${key}`, boss, { nameAr: "قائد" });
    expect(roleSchema.parse(renamed.json()).permissions).toEqual(["users.read", "orgs.read"]);
    const emptied = await call("PATCH", `/admin/roles/${key}`, boss, { permissions: [] });
    expect(roleSchema.parse(emptied.json()).permissions).toEqual([]);
    expect(await mePermissions(holder)).toEqual([]);

    // --- delete: refused while held
    expectError(
      await ctx.harness.call("DELETE", `/admin/roles/${key}`, { jar: boss.jar }),
      409,
      "CONFLICT",
      "role_in_use",
    );
    expect((await revoke(boss, holder.userId, key)).statusCode).toBe(200);
    const deleted = await ctx.harness.call("DELETE", `/admin/roles/${key}`, { jar: boss.jar });
    expect(deleted.statusCode).toBe(204);
    expect(await ctx.owner.db.select().from(roles).where(eq(roles.key, key))).toEqual([]);
    expect(await permissionsInDb(key)).toEqual([]);
    const deleteAudit = await ctx.auditRowsFor("role.delete", key);
    expect(deleteAudit).toHaveLength(1);
    expect(deleteAudit[0]).toMatchObject({
      before: { key, nameEn: "QA captain", permissions: [] },
    });
    expectError(
      await ctx.harness.call("DELETE", `/admin/roles/${key}`, { jar: boss.jar }),
      404,
      "NOT_FOUND",
    );
  });

  it("keeps super_admin read-only and system roles undeletable", async () => {
    const boss = await ctx.admin("super_admin");
    const before = await permissionsInDb("super_admin");
    expectError(
      await call("PATCH", "/admin/roles/super_admin", boss, { permissions: [] }),
      409,
      "CONFLICT",
      "role_read_only",
    );
    expectError(
      await call("PATCH", "/admin/roles/super_admin", boss, { nameEn: "Boss" }),
      409,
      "CONFLICT",
      "role_read_only",
    );
    expect(await permissionsInDb("super_admin")).toEqual(before);

    for (const key of ["super_admin", "user", "support"]) {
      expectError(
        await ctx.harness.call("DELETE", `/admin/roles/${key}`, { jar: boss.jar }),
        409,
        "CONFLICT",
        "system_role",
      );
    }
    expect(await ctx.owner.db.select().from(roles).where(eq(roles.key, "support"))).toHaveLength(1);
    expect(await ctx.auditRowsFor("role.update", "super_admin")).toEqual([]);
    expect(await ctx.auditRowsFor("role.delete", "support")).toEqual([]);
  });

  it("validates role definitions and answers 404 for an unknown role", async () => {
    const boss = await ctx.admin("super_admin");
    const ok = { nameAr: "x", nameEn: "x", permissions: [] };
    const invalid: Record<string, unknown>[] = [
      { ...ok, key: "admin" }, // a system key
      { ...ok, key: "super_admin" },
      { ...ok, key: "Bad Key" },
      { ...ok, key: "a" },
      { ...ok, key: `x${"y".repeat(40)}` },
      { ...ok, key: "fine_key", permissions: ["not.a.permission"] },
      { ...ok, key: "fine_key", permissions: ["users.read", "users.read"] },
      { ...ok, key: "fine_key", permissions: "users.read" },
      { ...ok, key: "fine_key", nameAr: "" },
      { ...ok, key: "fine_key", nameEn: "x".repeat(61) },
      { nameAr: "x", nameEn: "x", permissions: [] },
    ];
    for (const body of invalid) {
      const res = await call("POST", "/admin/roles", boss, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect((await ctx.owner.db.select().from(roles).where(eq(roles.key, "fine_key"))).length).toBe(
      0,
    );

    const key = `val_${tag()}`;
    expect((await call("POST", "/admin/roles", boss, { ...ok, key })).statusCode).toBe(201);
    for (const body of [{}, { permissions: ["nope"] }, { nameEn: "" }, { permissions: [1] }]) {
      expect((await call("PATCH", `/admin/roles/${key}`, boss, body)).statusCode).toBe(400);
    }
    expectError(
      await call("PATCH", "/admin/roles/missing_role", boss, { nameEn: "x" }),
      404,
      "NOT_FOUND",
    );
    expectError(
      await call("PATCH", "/admin/roles/Bad-Key", boss, { nameEn: "x" }),
      400,
      "VALIDATION_FAILED",
    );
    expect(await ctx.auditRowsFor("role.update", key)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// These two tests rearrange who holds super_admin in the whole database, so they run last.
// ---------------------------------------------------------------------------------------------
async function onlySuperAdmins(...keep: string[]): Promise<void> {
  const others = await ctx.owner.db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.roleKey, "super_admin"));
  for (const { userId } of others) {
    if (!keep.includes(userId)) {
      await ctx.owner.db
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.roleKey, "super_admin")));
    }
  }
}

const superAdminHolders = async () =>
  (
    await ctx.owner.db
      .select({ total: count() })
      .from(userRoles)
      .where(and(eq(userRoles.roleKey, "super_admin"), ne(userRoles.userId, MISSING_ID)))
  )[0]?.total ?? 0;

describe("the last super_admin", () => {
  it("cannot be removed, even by someone whose cached profile still says super_admin", async () => {
    const stale = await ctx.admin("super_admin");
    const last = await ctx.harness.signedInUser();
    await ctx.harness.grantRole(last.userId, "super_admin");
    // The actor was demoted a moment ago; their cached access (5 minutes) has not caught up.
    expect((await call("GET", "/admin/stats", stale)).statusCode).toBe(200); // fills the cache
    await onlySuperAdmins(last.userId);

    expectError(
      await revoke(stale, last.userId, "super_admin"),
      409,
      "CONFLICT",
      "last_super_admin",
    );
    expect(await rolesOf(last.userId)).toEqual(["super_admin"]);
    expect(await ctx.auditRowsFor("role.revoke", last.userId)).toEqual([]);
  });

  it("survives two super admins removing each other at the same moment", async () => {
    const a = await ctx.admin("super_admin");
    const b = await ctx.admin("super_admin");
    await onlySuperAdmins(a.userId, b.userId);
    expect(await superAdminHolders()).toBe(2);

    const [first, second] = await Promise.all([
      revoke(a, b.userId, "super_admin"),
      revoke(b, a.userId, "super_admin"),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    expect(await superAdminHolders()).toBe(1);
  });
});
