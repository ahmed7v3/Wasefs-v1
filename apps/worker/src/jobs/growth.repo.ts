import { growthMailLog, type Database } from "@wasfa/db";
import { ANONYMIZED_EMAIL_DOMAIN, PHONE_PLACEHOLDER_EMAIL_DOMAIN } from "@wasfa/shared/identity";
import { sql } from "drizzle-orm";


import type { GrowthMailKind } from "@wasfa/shared/growth";
import type { Locale } from "@wasfa/shared/i18n";

/** A person a lifecycle step may concern, with what a mail needs (never health data). */
export interface LifecyclePerson {
  id: string;
  email: string;
  name: string;
  locale: Locale;
}

const iso = (date: Date) => date.toISOString();
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const person = (row: { id: string; email: string; name: string; locale: string }): LifecyclePerson => ({
  id: row.id,
  email: row.email,
  name: row.name,
  locale: row.locale === "en" ? "en" : "ar",
});

/**
 * Active, verified accounts that may get marketing mail now: an opt-in not withdrawn, no silence
 * running, past the quiet first hours, under the weekly cap, and a real (verified, non-placeholder)
 * address. Every candidate query below goes through this filter.
 */
const MAILABLE = (now: Date, quietHours: number, maxPerWeek: number) => sql`
  u.status = 'active'
  and u.email_verified = true
  and u.email not like ${`%@${PHONE_PLACEHOLDER_EMAIL_DOMAIN}`}
  and u.email not like ${`%@${ANONYMIZED_EMAIL_DOMAIN}`}
  and u.created_at <= ${iso(new Date(now.getTime() - quietHours * HOUR_MS))}::timestamptz
  and exists (
    select 1 from notification_prefs n
    where n.user_id = u.id
      and n.marketing_opted_in_at is not null
      and (n.marketing_opted_out_at is null or n.marketing_opted_out_at < n.marketing_opted_in_at)
      and (n.marketing_silenced_until is null or n.marketing_silenced_until <= ${iso(now)}::timestamptz)
  )
  and (
    select count(*) from growth_mail_log m
    where m.user_id = u.id and m.sent_at > ${iso(new Date(now.getTime() - 7 * DAY_MS))}::timestamptz
  ) < ${maxPerWeek}
`;

/** No live subscription and never a paid order: still on the free plan. */
const STILL_FREE = sql`
  not exists (
    select 1 from subscriptions s
    where s.owner_user_id = u.id and s.status in ('trialing', 'active', 'grace')
  )
  and not exists (
    select 1 from orders o where o.owner_user_id = u.id and o.paid_at is not null and o.total_minor > 0
  )
`;

const notMailed = (kind: GrowthMailKind) => sql`
  not exists (select 1 from growth_mail_log m where m.user_id = u.id and m.kind = ${kind})
`;

export interface MailGate {
  now: Date;
  quietHours: number;
  maxPerWeek: number;
  limit: number;
}

/** Day 1, no analysis yet: the photo guide (GROWTH §6; a guide, no offer). */
export async function dayOneCandidates(db: Database, gate: MailGate): Promise<LifecyclePerson[]> {
  const rows = await db.execute<{ id: string; email: string; name: string; locale: string }>(sql`
    select u.id, u.email, u.name, u.locale from users u
    where u.created_at <= ${iso(new Date(gate.now.getTime() - DAY_MS))}::timestamptz
      and u.created_at > ${iso(new Date(gate.now.getTime() - 3 * DAY_MS))}::timestamptz
      and not exists (select 1 from rx_analyses a where a.owner_user_id = u.id)
      and ${notMailed("day1_guide")}
      and ${MAILABLE(gate.now, gate.quietHours, gate.maxPerWeek)}
    order by u.created_at limit ${gate.limit}
  `);
  return rows.map(person);
}

/** Day 3 with at least one finished analysis: the value recap. */
export async function dayThreeCandidates(
  db: Database,
  gate: MailGate,
): Promise<(LifecyclePerson & { analyses: number; drugs: number })[]> {
  const rows = await db.execute<{
    id: string;
    email: string;
    name: string;
    locale: string;
    analyses: number;
    drugs: number;
  }>(sql`
    select u.id, u.email, u.name, u.locale,
      (select count(*)::int from rx_analyses a where a.owner_user_id = u.id and a.status = 'done') as analyses,
      (select coalesce(sum(case when jsonb_typeof(a.result->'items') = 'array' then jsonb_array_length(a.result->'items') else 0 end), 0)::int
        from rx_analyses a where a.owner_user_id = u.id and a.status = 'done') as drugs
    from users u
    where u.created_at <= ${iso(new Date(gate.now.getTime() - 3 * DAY_MS))}::timestamptz
      and u.created_at > ${iso(new Date(gate.now.getTime() - 5 * DAY_MS))}::timestamptz
      and exists (select 1 from rx_analyses a where a.owner_user_id = u.id and a.status = 'done')
      and ${notMailed("day3_value")}
      and ${MAILABLE(gate.now, gate.quietHours, gate.maxPerWeek)}
    order by u.created_at limit ${gate.limit}
  `);
  return rows.map((row) => ({ ...person(row), analyses: row.analyses, drugs: row.drugs }));
}

/**
 * Who has earned the welcome offer (day `afterDays`, at least `minAnalyses` finished analyses,
 * still free). Only the week after the mark: an old account is not offered a "welcome".
 * Consent is not needed here: the offer itself is in-app; the mail is a separate, gated step.
 */
export async function welcomeOfferCandidates(
  db: Database,
  input: { now: Date; afterDays: number; minAnalyses: number; limit: number },
): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    select u.id from users u
    where u.status = 'active'
      and u.created_at <= ${iso(new Date(input.now.getTime() - input.afterDays * DAY_MS))}::timestamptz
      and u.created_at > ${iso(new Date(input.now.getTime() - (input.afterDays + 7) * DAY_MS))}::timestamptz
      and (select count(*) from rx_analyses a where a.owner_user_id = u.id and a.status = 'done') >= ${input.minAnalyses}
      and ${STILL_FREE}
      and not exists (select 1 from personal_offers p where p.owner_user_id = u.id and p.rule_key = 'welcome_offer')
    order by u.created_at limit ${input.limit}
  `);
  return rows.map((row) => row.id);
}

/** People whose paid period ended `afterExpiryDays` ago (a 4-day window) and who did not come back. */
export async function winbackCandidates(
  db: Database,
  input: { now: Date; afterExpiryDays: number; limit: number },
): Promise<string[]> {
  const until = new Date(input.now.getTime() - input.afterExpiryDays * DAY_MS);
  const since = new Date(until.getTime() - 4 * DAY_MS);
  const rows = await db.execute<{ id: string }>(sql`
    select distinct u.id from users u
    join subscriptions s on s.owner_user_id = u.id
    where u.status = 'active'
      and s.status = 'expired' and s.source = 'paid'
      and s.current_period_end <= ${iso(until)}::timestamptz
      and s.current_period_end > ${iso(since)}::timestamptz
      and not exists (
        select 1 from subscriptions l where l.owner_user_id = u.id and l.status in ('trialing', 'active', 'grace')
      )
    limit ${input.limit}
  `);
  return rows.map((row) => row.id);
}

/** Open offers of a rule not yet announced by mail (the mail's period key is the offer id). */
export async function offersToMail(
  db: Database,
  input: { ruleKey: string; kind: GrowthMailKind } & MailGate,
): Promise<(LifecyclePerson & { offerId: string; expiresAt: Date; percentBps: number })[]> {
  const rows = await db.execute<{
    id: string;
    email: string;
    name: string;
    locale: string;
    offer_id: string;
    expires_at: string;
    value: number;
  }>(sql`
    select u.id, u.email, u.name, u.locale, p.id as offer_id, p.expires_at, coalesce(pr.value, 0) as value
    from personal_offers p
    join users u on u.id = p.owner_user_id
    left join promotions pr on pr.id = p.promotion_id
    where p.rule_key = ${input.ruleKey}
      and p.consumed_at is null
      and p.expires_at > ${iso(new Date(input.now.getTime() + 6 * HOUR_MS))}::timestamptz
      and (pr.kind is null or pr.kind = 'percent')
      and not exists (
        select 1 from growth_mail_log m where m.user_id = u.id and m.kind = ${input.kind} and m.period_key = p.id::text
      )
      and ${MAILABLE(input.now, input.quietHours, input.maxPerWeek)}
    order by p.created_at limit ${input.limit}
  `);
  return rows.map((row) => ({
    ...person(row),
    offerId: row.offer_id,
    expiresAt: new Date(row.expires_at),
    percentBps: row.value,
  }));
}

/** Expiry + 30 days, still free: the last gentle message (then 90 days of silence). */
export async function lastCallCandidates(
  db: Database,
  gate: MailGate,
): Promise<(LifecyclePerson & { subscriptionId: string })[]> {
  const until = new Date(gate.now.getTime() - 30 * DAY_MS);
  const since = new Date(until.getTime() - 3 * DAY_MS);
  const rows = await db.execute<{
    id: string;
    email: string;
    name: string;
    locale: string;
    subscription_id: string;
  }>(sql`
    select distinct on (u.id) u.id, u.email, u.name, u.locale, s.id as subscription_id
    from users u
    join subscriptions s on s.owner_user_id = u.id
    where s.status = 'expired' and s.source = 'paid'
      and s.current_period_end <= ${iso(until)}::timestamptz
      and s.current_period_end > ${iso(since)}::timestamptz
      and not exists (
        select 1 from subscriptions l where l.owner_user_id = u.id and l.status in ('trialing', 'active', 'grace')
      )
      and not exists (
        select 1 from growth_mail_log m where m.user_id = u.id and m.kind = 'last_call' and m.period_key = s.id::text
      )
      and ${MAILABLE(gate.now, gate.quietHours, gate.maxPerWeek)}
    order by u.id, s.current_period_end desc
    limit ${gate.limit}
  `);
  return rows.map((row) => ({ ...person(row), subscriptionId: row.subscription_id }));
}

/**
 * Claims one lifecycle mail: the unique `(user, kind, period)` row makes it at-most-once even when
 * two workers run the same hour. Returns false when it was already claimed.
 */
export async function claimMail(
  db: Database,
  userId: string,
  kind: GrowthMailKind,
  periodKey: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .insert(growthMailLog)
    .values({ userId, kind, periodKey, sentAt: now })
    .onConflictDoNothing()
    .returning({ id: growthMailLog.id });
  return rows.length > 0;
}
