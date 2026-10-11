import { sql } from "drizzle-orm";

import type { Database } from "@wasfa/db";

/*
 * The one query of the monthly grant. The credit state machine itself (`grant`, `sweepExpired`) is
 * `@wasfa/db`'s `credits-ledger`, shared with the API. The worker connects as the restricted role.
 */

export interface GrantCandidate {
  userId: string;
  monthlyCredits: number;
}

const FIRST_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Users who are due the monthly grant of `period` and have not got it yet, by id after `afterId`.
 * "Due": an active, verified account whose effective plan (the newest open assignment, else the
 * default plan) gives more than zero credits. An unverified account cannot use the AI features, so
 * it is not paid before it is verified; the daily run picks it up the day it is.
 */
export async function findGrantCandidates(
  db: Database,
  now: Date,
  period: string,
  afterId: string | null,
  limit: number,
): Promise<GrantCandidate[]> {
  const at = now.toISOString();
  const rows = await db.execute<{ user_id: string; monthly_credits: number }>(sql`
    select u.id as user_id, p.monthly_credits
    from users u
    cross join lateral (
      select coalesce(
        (
          select pa.plan_id
          from plan_assignments pa
          where pa.owner_user_id = u.id
            and pa.starts_at <= ${at}::timestamptz
            and (pa.ends_at is null or pa.ends_at > ${at}::timestamptz)
          order by pa.starts_at desc, pa.id desc
          limit 1
        ),
        (select id from plans where is_default)
      ) as plan_id
    ) effective
    join plans p on p.id = effective.plan_id
    where u.status = 'active'
      and u.anonymized_at is null
      and (u.email_verified or u.phone_verified)
      and u.id > ${afterId ?? FIRST_ID}::uuid
      and p.monthly_credits > 0
      and not exists (
        select 1
        from credit_ledger l
        where l.idempotency_key = 'grant:user:' || u.id::text || ':' || ${period}::text
      )
    order by u.id
    limit ${limit}
  `);
  return rows.map((row) => ({ userId: row.user_id, monthlyCredits: row.monthly_credits }));
}
