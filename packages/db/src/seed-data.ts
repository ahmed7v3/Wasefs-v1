import {
  PERMISSION_KEYS,
  type Label,
  type Permission,
  type SystemRoleKey,
} from "@wasfa/shared/permissions";
import { SETTING_KEYS, settingDefault } from "@wasfa/shared/settings";

import { rolePermissions, roles, siteSettings, type NewSiteSetting } from "./schema/index.js";
import { seedAiProduct, type AiSeedResult } from "./seed-ai.js";

import type { Database } from "./client.js";

// Safe defaults only, derived from the settings registry so code and seed cannot drift. Admins edit
// these in the panel, so seeding never overwrites existing rows.
export const DEFAULT_SITE_SETTINGS: readonly NewSiteSetting[] = SETTING_KEYS.map((key) => ({
  key,
  value: settingDefault(key),
}));

export interface SystemRoleSeed {
  key: SystemRoleKey;
  name: Label;
  permissions: readonly Permission[];
}

/*
 * Default permission sets of the system roles (typed against the catalog, so a typo cannot compile).
 * They are only the starting point: once a role exists, the database is the truth and the seed
 * never touches it again. Notes on the choices:
 * - `user` has none: ordinary users act on their own data through ownership checks, not permissions.
 * - `admin` can grant roles but not edit them (`roles.write`). The role-assignment endpoint must also
 *   refuse to grant a role holding permissions the actor lacks, or `users.roles.write` would let an
 *   admin promote themselves to `super_admin` (Task 1.10, SECURITY.md).
 * - `super_admin` lists everything for display; the resolver treats it as a wildcard (Task 1.6).
 */
export const SYSTEM_ROLE_SEEDS: readonly SystemRoleSeed[] = [
  { key: "user", name: { ar: "مستخدم", en: "User" }, permissions: [] },
  {
    key: "support",
    name: { ar: "الدعم", en: "Support" },
    permissions: ["users.read", "orgs.read", "issues.read"],
  },
  {
    key: "marketing",
    name: { ar: "التسويق", en: "Marketing" },
    permissions: ["settings.read", "flags.read"],
  },
  {
    key: "finance",
    name: { ar: "المالية", en: "Finance" },
    permissions: ["users.read", "orgs.read"],
  },
  {
    key: "admin",
    name: { ar: "مدير", en: "Admin" },
    permissions: [
      "users.read",
      "users.suspend",
      "users.roles.write",
      "orgs.read",
      "orgs.write",
      "roles.read",
      "settings.read",
      "settings.write",
      "flags.read",
      "flags.write",
      "audit.read",
      "issues.read",
      "issues.write",
    ],
  },
  { key: "super_admin", name: { ar: "مدير عام", en: "Super admin" }, permissions: PERMISSION_KEYS },
];

export interface SeedResult extends AiSeedResult {
  /** Site settings inserted by this run. */
  settings: number;
  /** System roles created by this run. */
  roles: number;
  /** Permission grants created by this run (only for roles created by this run). */
  rolePermissions: number;
}

/**
 * Idempotent and insert-only: existing settings and existing roles are left exactly as they are,
 * including permissions an admin has since removed. Permissions are seeded only together with a
 * role that did not exist yet, in the same transaction, so a role can never be left half-seeded.
 */
export async function seedDefaults(db: Database): Promise<SeedResult> {
  const insertedSettings = await db
    .insert(siteSettings)
    .values([...DEFAULT_SITE_SETTINGS])
    .onConflictDoNothing({ target: siteSettings.key })
    .returning({ key: siteSettings.key });

  const { insertedRoles, insertedPermissions } = await db.transaction(async (tx) => {
    const created = await tx
      .insert(roles)
      .values(
        SYSTEM_ROLE_SEEDS.map((role) => ({
          key: role.key,
          nameAr: role.name.ar,
          nameEn: role.name.en,
          isSystem: true,
        })),
      )
      .onConflictDoNothing({ target: roles.key })
      .returning({ key: roles.key });

    const createdKeys = new Set(created.map((row) => row.key));
    const grants = SYSTEM_ROLE_SEEDS.filter((role) => createdKeys.has(role.key)).flatMap((role) =>
      role.permissions.map((permission) => ({ roleKey: role.key, permission })),
    );
    if (grants.length > 0) {
      await tx.insert(rolePermissions).values(grants);
    }
    return { insertedRoles: created.length, insertedPermissions: grants.length };
  });

  const aiProduct = await seedAiProduct(db);

  return {
    settings: insertedSettings.length,
    roles: insertedRoles,
    rolePermissions: insertedPermissions,
    ...aiProduct,
  };
}
