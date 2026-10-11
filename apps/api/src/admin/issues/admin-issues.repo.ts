import { Inject, Injectable } from "@nestjs/common";
import { errorEvents } from "@wasfa/db";
import { desc, eq, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, type Cursor } from "../common/keyset.js";

import type { IssueStatus } from "@wasfa/shared/schemas/admin";

export interface IssueRow {
  fingerprint: string;
  code: string;
  route: string | null;
  method: string | null;
  message: string | null;
  count: number;
  affectedUsers: number;
  /** ISO text with microseconds, straight from Postgres. */
  firstSeen: string;
  lastSeen: string;
  status: IssueStatus;
  sampleRef: string;
}

export interface IssueEventRow {
  ref: string;
  createdAt: Date;
  userId: string | null;
  requestId: string | null;
  context: unknown;
  stack: string | null;
}

type RawIssue = {
  fingerprint: string;
  code: string;
  route: string | null;
  method: string | null;
  message: string | null;
  event_count: number;
  affected_users: number;
  first_seen: string;
  last_seen: string;
  status: IssueStatus;
  sample_ref: string;
};

/**
 * One row per fingerprint. The group's status is the status of its latest event, so an error that
 * happens again after being marked "resolved" (the new event starts as "new") shows up as a regression.
 * Timestamps leave Postgres as text: the driver layer would otherwise hand back strings in a format
 * that depends on the session settings.
 */
function groupedIssues(scope: SQL, where: SQL, tail: SQL): SQL {
  return sql`
    with grouped as (
      select fingerprint,
             count(*)::int as event_count,
             count(distinct user_id)::int as affected_users,
             min(created_at) as first_at,
             max(created_at) as last_at
      from error_events
      where ${scope}
      group by fingerprint
    ), latest as (
      select distinct on (fingerprint) fingerprint, code, route, method, message, ref, status
      from error_events
      where ${scope}
      order by fingerprint, created_at desc, id desc
    )
    select g.fingerprint, l.code, l.route, l.method, l.message, l.status, l.ref as sample_ref,
           g.event_count, g.affected_users,
           to_char(g.first_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as first_seen,
           to_char(g.last_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_seen
    from grouped g
    join latest l on l.fingerprint = g.fingerprint
    where ${where}
    ${tail}
  `;
}

const toIssue = (row: RawIssue): IssueRow => ({
  fingerprint: row.fingerprint,
  code: row.code,
  route: row.route,
  method: row.method,
  message: row.message,
  count: row.event_count,
  affectedUsers: row.affected_users,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  status: row.status,
  sampleRef: row.sample_ref,
});

@Injectable()
export class AdminIssuesRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `limit + 1` groups, most recently seen first. */
  async list(
    status: IssueStatus | undefined,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<IssueRow[]> {
    const conditions: SQL[] = [];
    if (status !== undefined) conditions.push(sql`l.status = ${status}`);
    if (cursor) {
      conditions.push(afterCursor(sql.raw("g.last_at"), sql.raw("g.fingerprint"), cursor, "hex"));
    }
    const where = conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`;
    const rows = await this.handle.db.execute<RawIssue>(
      groupedIssues(
        sql`true`,
        where,
        sql`order by g.last_at desc, g.fingerprint desc limit ${limit + 1}`,
      ),
    );
    return rows.map(toIssue);
  }

  async find(fingerprint: string): Promise<IssueRow | undefined> {
    const rows = await this.handle.db.execute<RawIssue>(
      groupedIssues(sql`fingerprint = ${fingerprint}`, sql`true`, sql``),
    );
    const [row] = rows;
    return row ? toIssue(row) : undefined;
  }

  /** The newest events of one group. */
  events(fingerprint: string, limit: number): Promise<IssueEventRow[]> {
    return this.handle.db
      .select({
        ref: errorEvents.ref,
        createdAt: errorEvents.createdAt,
        userId: errorEvents.userId,
        requestId: errorEvents.requestId,
        context: errorEvents.context,
        stack: errorEvents.stack,
      })
      .from(errorEvents)
      .where(eq(errorEvents.fingerprint, fingerprint))
      .orderBy(desc(errorEvents.createdAt), desc(errorEvents.id))
      .limit(limit);
  }

  /**
   * Sets the status of every event of the group and returns the group's previous status (that of
   * its latest event); `undefined` when no event has this fingerprint.
   */
  setStatus(fingerprint: string, status: IssueStatus): Promise<IssueStatus | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ status: errorEvents.status })
        .from(errorEvents)
        .where(eq(errorEvents.fingerprint, fingerprint))
        .orderBy(desc(errorEvents.createdAt), desc(errorEvents.id))
        .limit(1);
      if (!latest) return undefined;
      await tx.update(errorEvents).set({ status }).where(eq(errorEvents.fingerprint, fingerprint));
      return latest.status as IssueStatus;
    });
  }
}
