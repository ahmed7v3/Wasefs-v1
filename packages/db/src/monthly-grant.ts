import { sql } from "drizzle-orm";

import { expireUnused, grant, grantPeriod } from "./credits-ledger.js";

import type { Database } from "./client.js";

/*
 * The monthly plan grant of an account without a subscription (the free plan, or a plan an admin
 * assigned). One eligibility rule, two callers: the worker's daily `credits.grant_monthly` run, and
 * the API right before credits are needed, so a new account can use its free credits the minute it
 * is verified instead of after the next daily run. Both write the same ledger key
 * (`grant:user:<id>:<YYYY-MM>`), so an account is never paid twice for a month.
 */

export interface GrantCandidate {
  userId: string;
  monthlyCredits: number;
}

const FIRST_ID = "00000000-0000-0000-0000-000000000000";

/** `YYYY-MM` of the month before `period`. */
export function previousPeriod(period: string): string {
  const [year = 0, month = 1] = period.split("-").map(Number);
  return month === 1
    ? `${String(year - 1)}-12`
    : `${String(year)}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * Users who are due the monthly grant of `period` and have not got it yet, by id after `afterId`
 * (or only `userId`). "Due": an active, verified account without a live subscription whose effective
 * plan (the newest open assignment, else the default plan) gives more than zero credits. An
 * unverified account cannot use the AI features, so it is not paid before it is verified.
 */
export async function findMonthlyGrantCandidates(
  db: Database,
  now: Date,
  period: string,
  options: { afterId?: string | null; limit: number; userId?: string },
): Promise<GrantCandidate[]> {
  const at = now.toISOString();
  const onlyUser = options.userId === undefined ? sql`` : sql`and u.id = ${options.userId}::uuid`;
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
      and u.id > ${options.afterId ?? FIRST_ID}::uuid
      ${onlyUser}
      and p.monthly_credits > 0
      -- A live subscription is paid on its own anniversaries (subscriptions.lifecycle).
      and not exists (
        select 1
        from subscriptions s
        where s.owner_user_id = u.id
          and s.status in ('trialing', 'active', 'grace')
      )
      and not exists (
        select 1
        from credit_ledger l
        where l.idempotency_key = 'grant:user:' || u.id::text || ':' || ${period}::text
      )
    order by u.id
    limit ${options.limit}
  `);
  return rows.map((row) => ({ userId: row.user_id, monthlyCredits: row.monthly_credits }));
}

/**
 * Pays one account its grant for the current month if it is due and not paid yet: last month's
 * unused grant expires first, as in the daily run. True when credits were added now.
 */
export async function ensureMonthlyGrant(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const period = grantPeriod(now);
  const [due] = await findMonthlyGrantCandidates(db, now, period, { userId, limit: 1 });
  if (due === undefined) return false;
  const owner = { type: "user", id: userId } as const;
  await expireUnused(db, owner, previousPeriod(period));
  const write = await grant(db, owner, due.monthlyCredits, period);
  return !write.replayed;
}
