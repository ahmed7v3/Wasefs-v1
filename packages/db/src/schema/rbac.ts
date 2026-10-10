import { PERMISSION_PATTERN, ROLE_KEY_PATTERN } from "@wasfa/shared/permissions";
import {
  index,
  boolean,
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { matches, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * Platform roles (global, not per organization). Permission strings are NOT a table: the catalog is
 * `PERMISSIONS` in `@wasfa/shared/permissions`. `role_permissions` only says which roles hold which
 * catalog entries, so admins can edit roles from the panel while code stays the source of what exists.
 */

export const roles = pgTable(
  "roles",
  {
    key: text().primaryKey(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    // System roles are seeded, cannot be deleted, and `super_admin` cannot be edited.
    isSystem: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [check("roles_key_check", matches(table.key, ROLE_KEY_PATTERN.source))],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleKey: text()
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    permission: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleKey, table.permission], name: "role_permissions_pkey" }),
    check(
      "role_permissions_permission_check",
      matches(table.permission, PERMISSION_PATTERN.source),
    ),
  ],
);

/**
 * Which platform roles a user holds. The implicit `user` role has no row. Ownership column:
 * `user_id`. The primary key starts with `user_id`, so it also serves "roles of this user".
 */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // RESTRICT: deleting a role that is still granted must be an explicit, audited revoke first.
    roleKey: text()
      .notNull()
      .references(() => roles.key, { onDelete: "restrict" }),
    // Null for grants made by the bootstrap CLI (audited as `system`).
    grantedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleKey], name: "user_roles_pkey" }),
    // "Who holds this role?" (needed to protect the last `super_admin`).
    index("user_roles_role_key_idx").on(table.roleKey),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
