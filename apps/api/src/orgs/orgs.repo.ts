import { Inject, Injectable } from "@nestjs/common";
import {
  organizationInvites,
  organizationMembers,
  organizations,
  users,
  type Database,
  type NewOrganizationInvite,
  type Organization,
  type OrganizationInvite,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

import type { OrgMemberRole, OrgType } from "@wasfa/shared/identity";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Who an invitation is addressed to: exactly one of the two. */
export type InviteTarget = { email: string } | { phone: string };

/** The caller's VERIFIED contact data; an unverified one never matches an invitation. */
export interface VerifiedIdentity {
  email: string | null;
  phone: string | null;
}

export interface UserContact {
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
}

export interface MemberRow {
  userId: string;
  name: string;
  role: OrgMemberRole;
  joinedAt: Date;
}

export interface MyInviteRow {
  id: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  role: OrgMemberRole;
  expiresAt: Date;
}

export type AcceptResult =
  | { outcome: "not_found" }
  | { outcome: "already_member" }
  | { outcome: "joined"; orgId: string; role: OrgMemberRole };

/** A subset of the editable fields; `city: null` clears it, an absent field is left alone. */
export interface OrgChanges {
  name?: string | undefined;
  type?: OrgType | undefined;
  country?: string | undefined;
  city?: string | null | undefined;
}

/** A pending join request is not a member: every membership read goes through this filter. */
const active = () => eq(organizationMembers.status, "active");

/** Unaccepted and unexpired. */
const pending = () =>
  and(isNull(organizationInvites.acceptedAt), gt(organizationInvites.expiresAt, sql`now()`));

const matchesTarget = (target: InviteTarget) =>
  "email" in target
    ? eq(organizationInvites.email, target.email)
    : eq(organizationInvites.phone, target.phone);

/**
 * The operations of one organization while its row is locked (`FOR UPDATE`). Everything that
 * could break "an organization keeps at least one org_admin" (role change, removal, leaving) or the
 * invite caps runs inside `OrgsRepo.withOrgLock`, so two concurrent requests are serialized per org.
 */
export class LockedOrg {
  constructor(
    private readonly tx: Tx,
    readonly orgId: string,
  ) {}

  async roleOf(userId: string): Promise<OrgMemberRole | null> {
    const [row] = await this.tx
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.orgId, this.orgId),
          eq(organizationMembers.userId, userId),
          active(),
        ),
      );
    return row?.role ?? null;
  }

  async memberCount(): Promise<number> {
    const [row] = await this.tx
      .select({ total: count() })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, this.orgId), active()));
    return row?.total ?? 0;
  }

  async adminCount(): Promise<number> {
    const [row] = await this.tx
      .select({ total: count() })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.orgId, this.orgId),
          eq(organizationMembers.role, "org_admin"),
          active(),
        ),
      );
    return row?.total ?? 0;
  }

  async setRole(userId: string, role: OrgMemberRole): Promise<void> {
    await this.tx
      .update(organizationMembers)
      .set({ role })
      .where(
        and(eq(organizationMembers.orgId, this.orgId), eq(organizationMembers.userId, userId)),
      );
  }

  async removeMember(userId: string): Promise<void> {
    await this.tx
      .delete(organizationMembers)
      .where(
        and(eq(organizationMembers.orgId, this.orgId), eq(organizationMembers.userId, userId)),
      );
  }

  /** Members and invites go with it (ON DELETE CASCADE). */
  async deleteOrg(): Promise<void> {
    await this.tx.delete(organizations).where(eq(organizations.id, this.orgId));
  }

  async pendingInviteCount(): Promise<number> {
    const [row] = await this.tx
      .select({ total: count() })
      .from(organizationInvites)
      .where(and(eq(organizationInvites.orgId, this.orgId), pending()));
    return row?.total ?? 0;
  }

  /** A member whose VERIFIED email / phone is the target (an unverified claim proves nothing). */
  async hasMemberWithContact(target: InviteTarget): Promise<boolean> {
    const contact =
      "email" in target
        ? and(eq(users.emailVerified, true), eq(users.email, target.email))
        : and(eq(users.phoneVerified, true), eq(users.phone, target.phone));
    const [row] = await this.tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, this.orgId), active(), contact))
      .limit(1);
    return row !== undefined;
  }

  async hasPendingInvite(target: InviteTarget): Promise<boolean> {
    const [row] = await this.tx
      .select({ id: organizationInvites.id })
      .from(organizationInvites)
      .where(and(eq(organizationInvites.orgId, this.orgId), pending(), matchesTarget(target)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Seats taken: active members plus invitations that can still be accepted. A pending join request
   * holds no seat until an org admin approves it.
   */
  async seatsTaken(): Promise<number> {
    return (await this.memberCount()) + (await this.pendingInviteCount());
  }

  async insertInvite(values: Omit<NewOrganizationInvite, "orgId">): Promise<OrganizationInvite> {
    const [row] = await this.tx
      .insert(organizationInvites)
      .values({ ...values, orgId: this.orgId })
      .returning();
    if (!row) throw new Error("invite insert returned no row");
    return row;
  }
}

/** The only place organizations, memberships and invitations touch the database. */
@Injectable()
export class OrgsRepo {
  /** Invites are organization data: addressed by (org id, invite id), never by the id alone. */
  private readonly invites: ScopedRepo<typeof organizationInvites>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.invites = scopedRepo(handle.db, {
      table: organizationInvites,
      scope: organizationInvites.orgId,
      id: organizationInvites.id,
    });
  }

  async membership(orgId: string, userId: string): Promise<{ role: OrgMemberRole } | null> {
    const [row] = await this.handle.db
      .select({ role: organizationMembers.role })
      .from(organizationMembers)
      .where(
        and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId), active()),
      );
    return row ?? null;
  }

  async findOrg(orgId: string): Promise<Organization | null> {
    const [row] = await this.handle.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row ?? null;
  }

  async listForUser(userId: string): Promise<{ org: Organization; role: OrgMemberRole }[]> {
    return this.handle.db
      .select({ org: organizations, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .where(and(eq(organizationMembers.userId, userId), active()))
      .orderBy(asc(organizations.createdAt), asc(organizations.id));
  }

  async memberCounts(orgIds: string[]): Promise<Map<string, number>> {
    if (orgIds.length === 0) return new Map();
    const rows = await this.handle.db
      .select({ orgId: organizationMembers.orgId, total: count() })
      .from(organizationMembers)
      .where(and(inArray(organizationMembers.orgId, orgIds), active()))
      .groupBy(organizationMembers.orgId);
    return new Map(rows.map((row) => [row.orgId, row.total]));
  }

  async updateOrg(orgId: string, changes: OrgChanges): Promise<Organization | null> {
    const [row] = await this.handle.db
      .update(organizations)
      .set(changes)
      .where(eq(organizations.id, orgId))
      .returning();
    return row ?? null;
  }

  async listMembers(orgId: string): Promise<MemberRow[]> {
    return this.handle.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, orgId), active()))
      .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.userId));
  }

  async findMember(orgId: string, userId: string): Promise<MemberRow | null> {
    const [row] = await this.handle.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId), active()),
      );
    return row ?? null;
  }

  /** Join requests waiting for an org admin. */
  async pendingRequests(
    orgId: string,
  ): Promise<{ userId: string; name: string; requestedAt: Date }[]> {
    return this.handle.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        requestedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.status, "pending")))
      .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.userId));
  }

  /** Runs `work` in a transaction holding the organization's row lock. */
  async withOrgLock<T>(orgId: string, work: (org: LockedOrg) => Promise<T>): Promise<T> {
    return this.handle.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .for("update");
      if (!locked) throw new AppError(ErrorCode.NOT_FOUND);
      return work(new LockedOrg(tx, orgId));
    });
  }

  // --- invitations of one organization (scoped) ---

  async pendingInvites(orgId: string): Promise<OrganizationInvite[]> {
    const rows = await this.invites.list(orgId, pending());
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  findInvite(orgId: string, inviteId: string): Promise<OrganizationInvite | null> {
    return this.invites.find(orgId, inviteId);
  }

  removeInvite(orgId: string, inviteId: string): Promise<boolean> {
    return this.invites.remove(orgId, inviteId);
  }

  // --- invitations of the caller ---

  async findContact(userId: string): Promise<UserContact | null> {
    const [row] = await this.handle.db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  async pendingInvitesFor(identity: VerifiedIdentity): Promise<MyInviteRow[]> {
    const addressed = addressedTo(identity);
    if (!addressed) return [];
    return this.handle.db
      .select({
        id: organizationInvites.id,
        orgId: organizationInvites.orgId,
        orgName: organizations.name,
        orgType: organizations.type,
        role: organizationInvites.role,
        expiresAt: organizationInvites.expiresAt,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizations.id, organizationInvites.orgId))
      .where(and(pending(), addressed))
      .orderBy(desc(organizationInvites.createdAt));
  }

  /**
   * Joins `userId` to the organization of a pending invitation that is addressed to `identity`.
   * One transaction with the invite row locked: two requests with the same token cannot both
   * succeed, and the invite cannot be consumed by anyone it was not addressed to (it simply is not
   * found, exactly like a wrong or expired token).
   */
  async acceptInvite(
    lookup: { id: string } | { tokenHash: string },
    identity: VerifiedIdentity,
    userId: string,
  ): Promise<AcceptResult> {
    const addressed = addressedTo(identity);
    if (!addressed) return { outcome: "not_found" };
    const byLookup =
      "id" in lookup
        ? eq(organizationInvites.id, lookup.id)
        : eq(organizationInvites.tokenHash, lookup.tokenHash);

    return this.handle.db.transaction(async (tx): Promise<AcceptResult> => {
      const [invite] = await tx
        .select({
          id: organizationInvites.id,
          orgId: organizationInvites.orgId,
          role: organizationInvites.role,
          invitedBy: organizationInvites.invitedBy,
        })
        .from(organizationInvites)
        .where(and(byLookup, pending(), addressed))
        .for("update");
      if (!invite) return { outcome: "not_found" };

      const inserted = await tx
        .insert(organizationMembers)
        .values({
          orgId: invite.orgId,
          userId,
          role: invite.role,
          invitedBy: invite.invitedBy,
        })
        // An invitation outranks an unapproved join request; an active member is left alone.
        .onConflictDoUpdate({
          target: [organizationMembers.orgId, organizationMembers.userId],
          set: { status: "active", role: invite.role, invitedBy: invite.invitedBy },
          setWhere: eq(organizationMembers.status, "pending"),
        })
        .returning({ userId: organizationMembers.userId });
      if (inserted.length === 0) return { outcome: "already_member" };

      await tx
        .update(organizationInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(organizationInvites.id, invite.id));
      return { outcome: "joined", orgId: invite.orgId, role: invite.role };
    });
  }
}

function addressedTo(identity: VerifiedIdentity) {
  return or(
    identity.email === null ? undefined : eq(organizationInvites.email, identity.email),
    identity.phone === null ? undefined : eq(organizationInvites.phone, identity.phone),
  );
}
