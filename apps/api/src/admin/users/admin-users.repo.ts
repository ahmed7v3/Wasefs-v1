import { Inject, Injectable } from "@nestjs/common";
import {
  organizationMembers,
  organizations,
  sessions,
  userProfiles,
  roles,
  userRoles,
  users,
  type Session,
  type UserProfile,
} from "@wasfa/db";
import { PHONE_PLACEHOLDER_EMAIL_DOMAIN } from "@wasfa/shared/identity";
import { and, asc, desc, eq, gt, ilike, inArray, like, notIlike, or, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { scopedRepo, type ScopedRepo } from "../../common/scoped-repo.js";
import { afterCursor, escapeLike, stamp, type Cursor } from "../common/keyset.js";

import type { Locale } from "@wasfa/shared/i18n";
import type { AccountType, OrgMemberRole, OrgType, UserStatus } from "@wasfa/shared/identity";

export interface UserListRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: UserStatus;
  accountType: AccountType;
  createdAt: Date;
  lastLoginAt: Date | null;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface UserDetailRow extends Omit<UserListRow, "cursorAt"> {
  suspendedReason: string | null;
  twoFactorEnabled: boolean;
  deletedAt: Date | null;
  locale: Locale;
}

export interface UserSearch {
  q?: string | undefined;
  status?: UserStatus | undefined;
  role?: string | undefined;
}

export interface MembershipRow {
  id: string;
  name: string;
  type: OrgType;
  role: OrgMemberRole;
}

export type SuspendOutcome =
  | { kind: "changed"; email: string; name: string; locale: Locale }
  | { kind: "invalid_status" }
  | { kind: "not_found" };

export type RevokeOutcome = "revoked" | "not_held" | "last_super_admin";

/** A phone-looking search: an optional `+` followed by digits. */
const PHONE_SEARCH = /^[+]?[0-9]{4,15}$/;

const listColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: users.phone,
  emailVerified: users.emailVerified,
  phoneVerified: users.phoneVerified,
  status: users.status,
  accountType: users.accountType,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

/** The queries behind `/admin/users`: search, detail, suspension and role assignment. */
@Injectable()
export class AdminUsersRepo {
  private readonly ownedSessions: ScopedRepo<typeof sessions>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.ownedSessions = scopedRepo(handle.db, {
      table: sessions,
      scope: sessions.userId,
      id: sessions.id,
    });
  }

  /** `limit + 1` rows, newest account first. */
  list(search: UserSearch, cursor: Cursor | undefined, limit: number): Promise<UserListRow[]> {
    const conditions: (SQL | undefined)[] = [];
    if (search.q !== undefined) {
      const pattern = `%${escapeLike(search.q)}%`;
      const matchers: (SQL | undefined)[] = [
        ilike(users.name, pattern),
        // The placeholder address of a phone-only account is not something an admin searches by.
        and(
          ilike(users.email, pattern),
          notIlike(users.email, `%@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`),
        ),
      ];
      if (PHONE_SEARCH.test(search.q)) {
        matchers.push(like(users.phone, `+${escapeLike(search.q.replace(/^[+]/, ""))}%`));
      }
      conditions.push(or(...matchers));
    }
    if (search.status !== undefined) conditions.push(eq(users.status, search.status));
    if (search.role !== undefined) {
      conditions.push(
        inArray(
          users.id,
          this.handle.db
            .select({ id: userRoles.userId })
            .from(userRoles)
            .where(eq(userRoles.roleKey, search.role)),
        ),
      );
    }
    if (cursor) conditions.push(afterCursor(users.createdAt, users.id, cursor, "uuid"));

    return this.handle.db
      .select({ ...listColumns, cursorAt: stamp(users.createdAt) })
      .from(users)
      .where(and(...conditions))
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(limit + 1);
  }

  /** Role keys of several users at once (the list page), keyed by user id. */
  async rolesOf(userIds: readonly string[]): Promise<Map<string, string[]>> {
    const byUser = new Map<string, string[]>();
    if (userIds.length === 0) return byUser;
    const rows = await this.handle.db
      .select({ userId: userRoles.userId, roleKey: userRoles.roleKey })
      .from(userRoles)
      .where(inArray(userRoles.userId, [...userIds]))
      .orderBy(asc(userRoles.roleKey));
    for (const row of rows)
      byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.roleKey]);
    return byUser;
  }

  async find(userId: string): Promise<UserDetailRow | undefined> {
    const [row] = await this.handle.db
      .select({
        ...listColumns,
        suspendedReason: users.suspendedReason,
        twoFactorEnabled: users.twoFactorEnabled,
        deletedAt: users.deletedAt,
        locale: users.locale,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row;
  }

  async profile(userId: string): Promise<UserProfile | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return row;
  }

  async memberships(userId: string): Promise<MembershipRow[]> {
    return this.handle.db
      .select({
        id: organizations.id,
        name: organizations.name,
        type: organizations.type,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .where(eq(organizationMembers.userId, userId))
      .orderBy(asc(organizationMembers.joinedAt));
  }

  /** Sessions that can still be used, read through the owner-scoped repository. */
  liveSessions(userId: string): Promise<Session[]> {
    return this.ownedSessions.list(userId, gt(sessions.expiresAt, new Date()));
  }

  async roleKeys(userId: string): Promise<string[]> {
    const rows = await this.handle.db
      .select({ roleKey: userRoles.roleKey })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(userRoles.roleKey));
    return rows.map((row) => row.roleKey);
  }

  /**
   * Active -> suspended and every session of the user deleted, in one transaction: there is no
   * moment where the account is suspended but a cookie still works.
   */
  suspend(userId: string, reason: string): Promise<SuspendOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [changed] = await tx
        .update(users)
        .set({ status: "suspended", suspendedReason: reason })
        .where(and(eq(users.id, userId), eq(users.status, "active")))
        .returning({ email: users.email, name: users.name, locale: users.locale });
      if (!changed) {
        const [existing] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, userId));
        return existing ? { kind: "invalid_status" } : { kind: "not_found" };
      }
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      return { kind: "changed", ...changed };
    });
  }

  /** Suspended -> active. `invalid_status` / `not_found` tell the caller why nothing changed. */
  async unsuspend(userId: string): Promise<"changed" | "invalid_status" | "not_found"> {
    return this.handle.db.transaction(async (tx) => {
      const changed = await tx
        .update(users)
        .set({ status: "active", suspendedReason: null })
        .where(and(eq(users.id, userId), eq(users.status, "suspended")))
        .returning({ id: users.id });
      if (changed.length > 0) return "changed";
      const [existing] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, userId));
      return existing ? "invalid_status" : "not_found";
    });
  }

  /** True when the row was new; a role the user already holds is left alone. */
  async grantRole(userId: string, roleKey: string, grantedBy: string): Promise<boolean> {
    const inserted = await this.handle.db
      .insert(userRoles)
      .values({ userId, roleKey, grantedBy })
      .onConflictDoNothing()
      .returning({ roleKey: userRoles.roleKey });
    return inserted.length > 0;
  }

  /**
   * Removes a role. For `super_admin` the role row is locked and the holders are counted inside the
   * transaction, so two super admins revoking each other at the same moment cannot leave none.
   */
  revokeRole(userId: string, roleKey: string, protectLast: boolean): Promise<RevokeOutcome> {
    return this.handle.db.transaction(async (tx) => {
      if (protectLast) {
        // Same lock the role editor takes, so the count below cannot move under us.
        await tx.select({ key: roles.key }).from(roles).where(eq(roles.key, roleKey)).for("update");
        const holders = await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleKey, roleKey));
        const holds = holders.some((holder) => holder.userId === userId);
        if (holds && holders.length <= 1) return "last_super_admin";
      }
      const removed = await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.roleKey, roleKey)))
        .returning({ roleKey: userRoles.roleKey });
      return removed.length > 0 ? "revoked" : "not_held";
    });
  }
}
