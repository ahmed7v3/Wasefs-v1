import { Inject, Injectable } from "@nestjs/common";
import { rolePermissions, roles, userRoles } from "@wasfa/db";
import { asc, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface RoleRow {
  key: string;
  nameAr: string;
  nameEn: string;
  isSystem: boolean;
}

export interface RoleSnapshot {
  nameAr: string;
  nameEn: string;
  permissions: string[];
}

export interface RolePatch {
  nameAr?: string | undefined;
  nameEn?: string | undefined;
  permissions?: readonly string[] | undefined;
}

const roleColumns = {
  key: roles.key,
  nameAr: roles.nameAr,
  nameEn: roles.nameEn,
  isSystem: roles.isSystem,
};

const sorted = (permissions: string[]) => [...permissions].sort();

/** Roles, their permissions and holders. The catalog of permissions is code (`@wasfa/shared/permissions`). */
@Injectable()
export class AdminRolesRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Every role, system roles first, with the number of users holding it. */
  async list(): Promise<(RoleRow & { holders: number })[]> {
    const rows = await this.handle.db
      .select({
        ...roleColumns,
        holders: sql<number>`(select count(*)::int from user_roles where user_roles.role_key = roles.key)`,
      })
      .from(roles)
      .orderBy(sql`${roles.isSystem} desc`, asc(roles.key));
    return rows;
  }

  /** `role_permissions` of every role, grouped by role key. */
  async permissionsByRole(): Promise<Map<string, string[]>> {
    const rows = await this.handle.db
      .select({ roleKey: rolePermissions.roleKey, permission: rolePermissions.permission })
      .from(rolePermissions);
    const byRole = new Map<string, string[]>();
    for (const row of rows)
      byRole.set(row.roleKey, [...(byRole.get(row.roleKey) ?? []), row.permission]);
    return byRole;
  }

  async find(key: string): Promise<RoleRow | undefined> {
    const [row] = await this.handle.db.select(roleColumns).from(roles).where(eq(roles.key, key));
    return row;
  }

  async permissionsOf(key: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleKey, key));
    return rows.map((row) => row.permission);
  }

  /** False when the key already exists. Role and permissions appear together or not at all. */
  create(
    role: { key: string; nameAr: string; nameEn: string },
    permissions: readonly string[],
  ): Promise<boolean> {
    return this.handle.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(roles)
        .values({ ...role, isSystem: false })
        .onConflictDoNothing()
        .returning({ key: roles.key });
      if (inserted.length === 0) return false;
      if (permissions.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permissions.map((permission) => ({ roleKey: role.key, permission })));
      }
      return true;
    });
  }

  /**
   * Applies the patch under a row lock; the permission set is replaced in the same transaction, so
   * nobody ever sees a role with half of its permissions. `undefined` when the role is gone.
   */
  update(
    key: string,
    patch: RolePatch,
  ): Promise<{ before: RoleSnapshot; after: RoleSnapshot } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ nameAr: roles.nameAr, nameEn: roles.nameEn })
        .from(roles)
        .where(eq(roles.key, key))
        .for("update");
      if (!current) return undefined;
      const existing = (
        await tx
          .select({ permission: rolePermissions.permission })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleKey, key))
      ).map((row) => row.permission);

      const nameAr = patch.nameAr ?? current.nameAr;
      const nameEn = patch.nameEn ?? current.nameEn;
      await tx.update(roles).set({ nameAr, nameEn }).where(eq(roles.key, key));
      let permissions = existing;
      if (patch.permissions !== undefined) {
        permissions = [...patch.permissions];
        await tx.delete(rolePermissions).where(eq(rolePermissions.roleKey, key));
        if (permissions.length > 0) {
          await tx
            .insert(rolePermissions)
            .values(permissions.map((permission) => ({ roleKey: key, permission })));
        }
      }
      return {
        before: { nameAr: current.nameAr, nameEn: current.nameEn, permissions: sorted(existing) },
        after: { nameAr, nameEn, permissions: sorted(permissions) },
      };
    });
  }

  /**
   * Deletes a custom role that nobody holds. The row lock also blocks a concurrent grant (its
   * foreign key takes a conflicting lock), so "unused" cannot change while we decide.
   */
  remove(key: string): Promise<"deleted" | "not_found" | "in_use"> {
    return this.handle.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ key: roles.key })
        .from(roles)
        .where(eq(roles.key, key))
        .for("update");
      if (!locked) return "not_found";
      const [held] = await tx
        .select({ holders: sql<number>`count(*)::int` })
        .from(userRoles)
        .where(eq(userRoles.roleKey, key));
      if ((held?.holders ?? 0) > 0) return "in_use";
      await tx.delete(roles).where(eq(roles.key, key));
      return "deleted";
    });
  }
}
