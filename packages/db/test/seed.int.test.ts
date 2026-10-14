import { PERMISSION_KEYS, SYSTEM_ROLE_KEYS } from "@wasfa/shared/permissions";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rolePermissions, roles, siteSettings } from "../src/schema/index.js";
import { DEFAULT_SITE_SETTINGS, SYSTEM_ROLE_SEEDS, seedDefaults } from "../src/seed-data.js";

import { startTestDb, type TestDb } from "./db-fixture.js";

let fixture: TestDb;

beforeAll(async () => {
  fixture = await startTestDb();
}, 180_000);

afterAll(async () => {
  await fixture?.stop();
});

async function snapshot() {
  const { db } = fixture.handle;
  return {
    settings: await db.select().from(siteSettings).orderBy(asc(siteSettings.key)),
    roles: await db.select().from(roles).orderBy(asc(roles.key)),
    permissions: await db
      .select()
      .from(rolePermissions)
      .orderBy(asc(rolePermissions.roleKey), asc(rolePermissions.permission)),
  };
}

describe("seedDefaults", () => {
  it("is idempotent: a second run inserts nothing and changes nothing", async () => {
    const first = await seedDefaults(fixture.handle.db);
    expect(first.settings).toBe(DEFAULT_SITE_SETTINGS.length);
    expect(first.roles).toBe(SYSTEM_ROLE_KEYS.length);
    expect(first.rolePermissions).toBeGreaterThan(0);

    const before = await snapshot();
    expect(before.settings.map((row) => row.key)).toEqual(
      expect.arrayContaining(DEFAULT_SITE_SETTINGS.map((row) => row.key)),
    );

    expect(await seedDefaults(fixture.handle.db)).toEqual({
      settings: 0,
      roles: 0,
      rolePermissions: 0,
      plans: 0,
      planEntitlements: 0,
      aiProviders: 0,
      aiModels: 0,
      aiTaskRoutes: 0,
    });
    expect(await snapshot()).toEqual(before);
  });

  it("seeds every system role with its permission set, and super_admin with the whole catalog", async () => {
    await seedDefaults(fixture.handle.db);
    const { db } = fixture.handle;

    const seededRoles = await db.select().from(roles);
    expect(seededRoles.map((role) => role.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
    expect(seededRoles.every((role) => role.isSystem)).toBe(true);

    for (const seed of SYSTEM_ROLE_SEEDS) {
      const granted = await db
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleKey, seed.key));
      expect(granted.map((row) => row.permission).sort()).toEqual([...seed.permissions].sort());
    }

    const superAdmin = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleKey, "super_admin"));
    expect(superAdmin.map((row) => row.permission).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it("never overwrites what an admin changed: edited permissions and names survive a re-seed", async () => {
    const { db } = fixture.handle;
    await seedDefaults(db);

    // An admin removes a permission from `admin`, edits `support`'s name, and grants `marketing` something extra.
    await db
      .delete(rolePermissions)
      .where(
        and(eq(rolePermissions.roleKey, "admin"), eq(rolePermissions.permission, "settings.write")),
      );
    await db.update(roles).set({ nameEn: "Help desk" }).where(eq(roles.key, "support"));
    await db.insert(rolePermissions).values({ roleKey: "marketing", permission: "audit.read" });
    const edited = await snapshot();

    expect((await seedDefaults(db)).rolePermissions).toBe(0);
    expect(await snapshot()).toEqual(edited);
  });
});
