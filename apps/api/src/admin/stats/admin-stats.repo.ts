import { Inject, Injectable } from "@nestjs/common";
import { organizations, users } from "@wasfa/db";
import { sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

export interface UserCounts {
  total: number;
  active: number;
  suspended: number;
  newLast7Days: number;
}

/** The counts on the admin dashboard. */
@Injectable()
export class AdminStatsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Deleted accounts are not counted anywhere (they are waiting to be anonymized). */
  async userCounts(): Promise<UserCounts> {
    const [row] = await this.handle.db
      .select({
        total: sql<number>`(count(*) filter (where ${users.status} <> 'deleted'))::int`,
        active: sql<number>`(count(*) filter (where ${users.status} = 'active'))::int`,
        suspended: sql<number>`(count(*) filter (where ${users.status} = 'suspended'))::int`,
        newLast7Days: sql<number>`(count(*) filter (where ${users.status} <> 'deleted' and ${users.createdAt} >= now() - interval '7 days'))::int`,
      })
      .from(users);
    return row ?? { total: 0, active: 0, suspended: 0, newLast7Days: 0 };
  }

  async orgCount(): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizations);
    return row?.total ?? 0;
  }

  /** Issue groups whose latest event is not resolved. */
  async openIssueCount(): Promise<number> {
    const rows = await this.handle.db.execute<{ open: number }>(sql`
      select count(*)::int as open
      from (
        select distinct on (fingerprint) status
        from error_events
        order by fingerprint, created_at desc, id desc
      ) latest
      where status <> 'resolved'
    `);
    return rows[0]?.open ?? 0;
  }
}
