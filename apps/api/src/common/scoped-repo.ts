import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, eq, type SQL } from "drizzle-orm";

import type { Database } from "@wasfa/db";
import type { OrgMemberRole } from "@wasfa/shared/identity";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/*
 * Data that belongs to a user or an organization is only ever read or written through a scoped
 * repository (AGENT section 5.4). The owner id is a required argument of every method, so a query
 * that forgets the ownership filter does not compile, and a row that belongs to someone else looks
 * exactly like a row that does not exist: `NOT_FOUND`, never `FORBIDDEN`, so ids cannot be probed.
 *
 * Convention, enforced by ESLint (`no-restricted-syntax` in apps/api/eslint.config.mjs): services
 * and controllers never call `db.select/insert/update/delete`; they call a repository, and the
 * repositories of user-owned tables are built with `scopedRepo`.
 */

export interface ScopedTable<T extends PgTable> {
  table: T;
  /** The column holding the owner: `user_id` for personal data, `org_id` for organization data. */
  scope: PgColumn;
  /** The primary key used to address one row. */
  id: PgColumn;
}

export interface ScopedRepo<T extends PgTable> {
  list: (scopeId: string, extra?: SQL) => Promise<T["$inferSelect"][]>;
  find: (scopeId: string, rowId: string) => Promise<T["$inferSelect"] | null>;
  /** Like `find`, but a missing or foreign row throws `NOT_FOUND`. */
  require: (scopeId: string, rowId: string) => Promise<T["$inferSelect"]>;
  update: (
    scopeId: string,
    rowId: string,
    values: Partial<T["$inferInsert"]>,
  ) => Promise<T["$inferSelect"] | null>;
  /** True when a row of this owner was deleted. */
  remove: (scopeId: string, rowId: string) => Promise<boolean>;
}

export function scopedRepo<T extends PgTable>(
  db: Database,
  { table, scope, id }: ScopedTable<T>,
): ScopedRepo<T> {
  const mine = (scopeId: string, rowId: string) => and(eq(scope, scopeId), eq(id, rowId));
  // Drizzle's builder types do not carry the table generic through `from(table)`; the casts restore it.
  const select = () => db.select().from(table as PgTable);
  type Row = T["$inferSelect"];

  const find = async (scopeId: string, rowId: string): Promise<Row | null> => {
    const [row] = await select().where(mine(scopeId, rowId)).limit(1);
    return (row as Row | undefined) ?? null;
  };

  return {
    list: async (scopeId, extra) =>
      (await select().where(extra ? and(eq(scope, scopeId), extra) : eq(scope, scopeId))) as Row[],
    find,
    require: async (scopeId, rowId) => {
      const row = await find(scopeId, rowId);
      if (!row) throw new AppError(ErrorCode.NOT_FOUND);
      return row;
    },
    update: async (scopeId, rowId, values) => {
      const [row] = await db
        .update(table)
        .set(values as never)
        .where(mine(scopeId, rowId))
        .returning();
      return (row as Row | undefined) ?? null;
    },
    remove: async (scopeId, rowId) => {
      const removed = await db.delete(table).where(mine(scopeId, rowId)).returning();
      return removed.length > 0;
    },
  };
}

export interface OrgMembership {
  orgId: string;
  role: OrgMemberRole;
}

/**
 * The caller's membership in `orgId`, or `NOT_FOUND` when they are not a member (an organization
 * they do not belong to must not reveal that it exists). With `roles`, a member whose role is not
 * listed gets `FORBIDDEN`.
 */
export function requireMembership(
  memberships: readonly OrgMembership[],
  orgId: string,
  ...roles: OrgMemberRole[]
): OrgMembership {
  const membership = memberships.find((candidate) => candidate.orgId === orgId);
  if (!membership) throw new AppError(ErrorCode.NOT_FOUND);
  if (roles.length > 0 && !roles.includes(membership.role)) {
    throw new AppError(ErrorCode.FORBIDDEN);
  }
  return membership;
}
