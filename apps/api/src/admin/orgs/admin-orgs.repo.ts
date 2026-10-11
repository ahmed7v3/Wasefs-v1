import { Inject, Injectable } from "@nestjs/common";
import { organizationInvites, organizationMembers, organizations, users } from "@wasfa/db";
import { and, asc, desc, eq, gt, ilike, isNull, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, escapeLike, stamp, type Cursor } from "../common/keyset.js";

import type { OrgMemberRole, OrgType } from "@wasfa/shared/identity";

export interface OrgRow {
  id: string;
  name: string;
  type: OrgType;
  country: string;
  city: string | null;
  memberCount: number;
  createdAt: Date;
}

export interface OrgListRow extends OrgRow {
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface OrgMemberRow {
  userId: string;
  name: string;
  role: OrgMemberRole;
  joinedAt: Date;
}

const memberCount = sql<number>`(select count(*)::int from organization_members where organization_members.org_id = organizations.id)`;

const orgColumns = {
  id: organizations.id,
  name: organizations.name,
  type: organizations.type,
  country: organizations.country,
  city: organizations.city,
  createdAt: organizations.createdAt,
  memberCount,
};

/** Cross-organization reads for the admin panel (`orgs.read`). Members never expose email or phone. */
@Injectable()
export class AdminOrgsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `limit + 1` rows, newest first. */
  list(q: string | undefined, cursor: Cursor | undefined, limit: number): Promise<OrgListRow[]> {
    const conditions: (SQL | undefined)[] = [
      q === undefined ? undefined : ilike(organizations.name, `%${escapeLike(q)}%`),
      cursor === undefined
        ? undefined
        : afterCursor(organizations.createdAt, organizations.id, cursor, "uuid"),
    ];
    return this.handle.db
      .select({ ...orgColumns, cursorAt: stamp(organizations.createdAt) })
      .from(organizations)
      .where(and(...conditions))
      .orderBy(desc(organizations.createdAt), desc(organizations.id))
      .limit(limit + 1);
  }

  async find(orgId: string): Promise<OrgRow | undefined> {
    const [row] = await this.handle.db
      .select(orgColumns)
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row;
  }

  members(orgId: string): Promise<OrgMemberRow[]> {
    return this.handle.db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        role: organizationMembers.role,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, orgId))
      .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.userId));
  }

  /** Invitations that can still be accepted. */
  async pendingInvites(orgId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.orgId, orgId),
          isNull(organizationInvites.acceptedAt),
          gt(organizationInvites.expiresAt, new Date()),
        ),
      );
    return row?.total ?? 0;
  }
}
