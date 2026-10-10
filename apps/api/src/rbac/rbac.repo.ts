import { Inject, Injectable } from "@nestjs/common";
import { organizationMembers, rolePermissions, userRoles } from "@wasfa/db";
import { eq, inArray } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

/** Reads behind permission resolution. Writes arrive with the admin role editor (Phase 8). */
@Injectable()
export class RbacRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async roleKeys(userId: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ roleKey: userRoles.roleKey })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    return rows.map((row) => row.roleKey);
  }

  async permissionsOf(roleKeys: string[]): Promise<string[]> {
    if (roleKeys.length === 0) return [];
    const rows = await this.handle.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleKey, roleKeys));
    return rows.map((row) => row.permission);
  }

  async orgIds(userId: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId));
    return rows.map((row) => row.orgId);
  }

  async userIdsWithRole(roleKey: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleKey, roleKey));
    return rows.map((row) => row.userId);
  }
}
