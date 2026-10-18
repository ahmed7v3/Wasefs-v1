import { Inject, Injectable } from "@nestjs/common";
import {
  organizationMembers,
  organizations,
  sessions,
  userProfiles,
  users,
  type Session,
  type UserProfile,
} from "@wasfa/db";
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

import type { Locale } from "@wasfa/shared/i18n";
import type { AccountType, OrgMemberRole, OrgType } from "@wasfa/shared/identity";

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  image: string | null;
  accountType: AccountType;
  locale: Locale;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

export interface MembershipRow {
  id: string;
  name: string;
  type: OrgType;
  role: OrgMemberRole;
}

export interface UpdateAccount {
  name?: string | undefined;
  locale?: Locale | undefined;
}

export type DeletionResult = { deletedAt: Date } | { blocked: "last_org_admin" };

const accountColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  phone: users.phone,
  phoneVerified: users.phoneVerified,
  image: users.image,
  accountType: users.accountType,
  locale: users.locale,
  twoFactorEnabled: users.twoFactorEnabled,
  createdAt: users.createdAt,
};

/** The queries behind `/me`: the account, its profile, memberships and sessions. */
@Injectable()
export class UsersRepo {
  private readonly ownedSessions: ScopedRepo<typeof sessions>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.ownedSessions = scopedRepo(handle.db, {
      table: sessions,
      scope: sessions.userId,
      id: sessions.id,
    });
  }

  async findAccount(userId: string): Promise<AccountRow | null> {
    const [row] = await this.handle.db
      .select(accountColumns)
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  async findProfile(userId: string): Promise<UserProfile | null> {
    const [row] = await this.handle.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return row ?? null;
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
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
      .orderBy(asc(organizationMembers.joinedAt));
  }

  async updateAccount(userId: string, values: UpdateAccount): Promise<void> {
    await this.handle.db
      .update(users)
      .set({
        ...(values.name !== undefined ? { name: values.name } : {}),
        ...(values.locale !== undefined ? { locale: values.locale } : {}),
      })
      .where(eq(users.id, userId));
  }

  /** Sessions that can still be used, in the caller's own scope. */
  liveSessions(userId: string): Promise<Session[]> {
    return this.ownedSessions.list(userId, gt(sessions.expiresAt, new Date()));
  }

  /** True when the caller's session existed and was removed; foreign or missing ids are `false`. */
  revokeSession(userId: string, sessionId: string): Promise<boolean> {
    return this.ownedSessions.remove(userId, sessionId);
  }

  /** Removes every session of the caller except `keepSessionId`; returns how many. */
  async revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
    const removed = await this.handle.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
      .returning({ id: sessions.id });
    return removed.length;
  }

  /**
   * The account deletion request, atomically: refuse when the caller is the only `org_admin` of an
   * organization that still has other members; otherwise mark the account deleted and end every
   * session. The anonymization itself is a worker job that runs 14 days later.
   */
  deleteAccount(userId: string): Promise<DeletionResult> {
    return this.handle.db.transaction(async (tx) => {
      const mine = tx
        .select({ orgId: organizationMembers.orgId })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.role, "org_admin"),
            eq(organizationMembers.status, "active"),
          ),
        );
      const stranded = await tx
        .select({ orgId: organizationMembers.orgId })
        .from(organizationMembers)
        .where(
          and(
            inArray(organizationMembers.orgId, mine),
            ne(organizationMembers.userId, userId),
            eq(organizationMembers.status, "active"),
          ),
        )
        .groupBy(organizationMembers.orgId)
        .having(sql`count(*) filter (where ${organizationMembers.role} = 'org_admin') = 0`);
      if (stranded.length > 0) return { blocked: "last_org_admin" } as const;

      const [updated] = await tx
        .update(users)
        .set({ status: "deleted", deletedAt: sql`now()` })
        .where(eq(users.id, userId))
        .returning({ deletedAt: users.deletedAt });
      if (!updated?.deletedAt) throw new Error("users: deletion did not stamp deleted_at");
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      return { deletedAt: updated.deletedAt };
    });
  }
}
