import { Inject, Injectable } from "@nestjs/common";
import { experiments, type Experiment } from "@wasfa/db";
import { desc, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { CreateExperimentInput, UpdateExperimentInput } from "@wasfa/shared/schemas/growth";

export interface VariantCounts {
  variant: string;
  exposures: number;
  conversions: number;
  refunds: number;
  supportContacts: number;
  promptDismissals: number;
  unsubscribes: number;
}

export interface FunnelCounts {
  pricingSessions: number;
  signups: number;
  activated: number;
  activatedPaid: number;
  ordersCreated: number;
  ordersPaid: number;
  methodMix: { method: string; count: number }[];
  prompts: { kind: string; shown: number; clicked: number; dismissed: number }[];
  tastesStarted: number;
  tastesCompleted: number;
  offersShown: number;
  offersUsed: number;
  referralSignups: number;
  referralPaid: number;
  inviters: number;
}

const iso = (date: Date) => date.toISOString();

/** Experiments and the funnel: aggregate counts only, no row of anyone's data leaves this file. */
@Injectable()
export class AdminExperimentsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  list(): Promise<Experiment[]> {
    return this.db.select().from(experiments).orderBy(desc(experiments.createdAt));
  }

  async find(id: string): Promise<Experiment | undefined> {
    const [row] = await this.db.select().from(experiments).where(eq(experiments.id, id));
    return row;
  }

  /** Inserts a draft; `null` when the key is already taken. */
  async create(input: CreateExperimentInput): Promise<Experiment | null> {
    const [row] = await this.db
      .insert(experiments)
      .values({
        key: input.key,
        name: input.name,
        flagKey: input.flagKey,
        variants: input.variants,
        status: "draft",
        minSampleSize: input.minSampleSize,
      })
      .onConflictDoNothing({ target: experiments.key })
      .returning();
    return row ?? null;
  }

  async update(id: string, change: UpdateExperimentInput & Partial<Pick<Experiment, "status" | "startedAt" | "endedAt">>) {
    const [row] = await this.db
      .update(experiments)
      .set({ ...change, updatedAt: new Date() })
      .where(eq(experiments.id, id))
      .returning();
    return row;
  }

  /**
   * Per variant, among the users who saw it between `from` and `to`: who paid within 30 days of
   * their first exposure, and the guardrails (refunds, support contacts, prompt dismissals,
   * unsubscribes) after it. Prompt experiments (`prompt_<kind>`) only count exposures of that kind.
   */
  async variantCounts(experiment: Experiment, from: Date, to: Date): Promise<VariantCounts[]> {
    const promptKind = experiment.key.startsWith("prompt_") ? experiment.key.slice(7) : null;
    const variants = experiment.variants.map((variant) => variant.key);
    const rows = await this.db.execute<{
      variant: string;
      exposures: number;
      conversions: number;
      refunds: number;
      support_contacts: number;
      prompt_dismissals: number;
      unsubscribes: number;
    }>(sql`
      with exposed as (
        select e.user_id, e.variant, min(e.occurred_at) as first_at
        from growth_events e
        where e.user_id is not null
          and e.variant in (${sql.join(
            variants.map((variant) => sql`${variant}`),
            sql`, `,
          )})
          and e.occurred_at >= ${iso(from)}::timestamptz and e.occurred_at < ${iso(to)}::timestamptz
          and (${promptKind}::text is null or e.props->>'kind' = ${promptKind}::text)
        group by e.user_id, e.variant
      )
      select x.variant,
        count(*)::int as exposures,
        count(*) filter (where exists (
          select 1 from orders o
          where o.owner_user_id = x.user_id and o.paid_at >= x.first_at
            and o.paid_at < x.first_at + interval '30 days' and o.total_minor > 0
        ))::int as conversions,
        count(*) filter (where exists (
          select 1 from refunds r
          join payments p on p.id = r.payment_id
          join orders o on o.id = p.order_id
          where o.owner_user_id = x.user_id and r.created_at >= x.first_at
        ))::int as refunds,
        count(*) filter (where exists (
          select 1 from contact_messages c where c.user_id = x.user_id and c.created_at >= x.first_at
        ))::int as support_contacts,
        count(*) filter (where exists (
          select 1 from growth_events d
          where d.user_id = x.user_id and d.name = 'prompt_dismissed' and d.occurred_at >= x.first_at
        ))::int as prompt_dismissals,
        count(*) filter (where exists (
          select 1 from notification_prefs n
          where n.user_id = x.user_id and n.marketing_opted_out_at >= x.first_at
        ))::int as unsubscribes
      from exposed x
      group by x.variant
    `);
    return rows.map((row) => ({
      variant: row.variant,
      exposures: row.exposures,
      conversions: row.conversions,
      refunds: row.refunds,
      supportContacts: row.support_contacts,
      promptDismissals: row.prompt_dismissals,
      unsubscribes: row.unsubscribes,
    }));
  }

  /** Every step of the GROWTH §9 funnel for one window, in a single round of aggregate queries. */
  async funnel(from: Date, to: Date, promptKind: string | null): Promise<FunnelCounts> {
    const f = iso(from);
    const t = iso(to);
    const [steps] = await this.db.execute<{
      pricing_sessions: number;
      signups: number;
      activated: number;
      activated_paid: number;
      orders_created: number;
      orders_paid: number;
      tastes_started: number;
      tastes_completed: number;
      offers_shown: number;
      offers_used: number;
      referral_signups: number;
      referral_paid: number;
      inviters: number;
    }>(sql`
      with signups as (
        select u.id, u.created_at from users u
        where u.created_at >= ${f}::timestamptz and u.created_at < ${t}::timestamptz
      ),
      activated as (
        select s.id, min(a.finished_at) as at
        from signups s join rx_analyses a on a.owner_user_id = s.id and a.status = 'done'
        where a.finished_at < s.created_at + interval '24 hours'
        group by s.id
      ),
      window_referrals as (
        select r.* from referrals r
        where r.created_at >= ${f}::timestamptz and r.created_at < ${t}::timestamptz
      )
      select
        (select count(distinct session_id)::int from growth_events
          where name = 'pricing_viewed' and occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz) as pricing_sessions,
        (select count(*)::int from signups) as signups,
        (select count(*)::int from activated) as activated,
        (select count(*)::int from activated x where exists (
          select 1 from orders o where o.owner_user_id = x.id and o.total_minor > 0
            and o.paid_at >= x.at and o.paid_at < x.at + interval '30 days')) as activated_paid,
        (select count(*)::int from orders where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz and total_minor > 0) as orders_created,
        (select count(*)::int from orders where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz and total_minor > 0 and paid_at is not null) as orders_paid,
        (select count(*)::int from growth_events where name = 'taste_started' and occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz) as tastes_started,
        (select count(*)::int from growth_events where name = 'taste_completed' and occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz) as tastes_completed,
        (select count(*)::int from growth_events where name = 'offer_shown' and occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz) as offers_shown,
        (select count(*)::int from personal_offers where consumed_at >= ${f}::timestamptz and consumed_at < ${t}::timestamptz) as offers_used,
        (select count(*)::int from window_referrals) as referral_signups,
        (select count(*)::int from window_referrals r where exists (
          select 1 from orders o where o.owner_user_id = r.referee_user_id and o.paid_at is not null and o.total_minor > 0)) as referral_paid,
        (select count(distinct referrer_user_id)::int from window_referrals where referrer_user_id is not null) as inviters
    `);
    const methodMix = await this.db.execute<{ method: string; count: number }>(sql`
      select p.method_key as method, count(*)::int as count
      from payments p
      where p.status = 'succeeded' and p.updated_at >= ${f}::timestamptz and p.updated_at < ${t}::timestamptz
      group by p.method_key order by count desc
    `);
    const prompts = await this.db.execute<{
      kind: string;
      shown: number;
      clicked: number;
      dismissed: number;
    }>(sql`
      select props->>'kind' as kind,
        count(*) filter (where name = 'prompt_shown')::int as shown,
        count(*) filter (where name = 'prompt_clicked')::int as clicked,
        count(*) filter (where name = 'prompt_dismissed')::int as dismissed
      from growth_events
      where name in ('prompt_shown', 'prompt_clicked', 'prompt_dismissed')
        and occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz
        and props ? 'kind'
        and (${promptKind}::text is null or props->>'kind' = ${promptKind}::text)
      group by props->>'kind' order by shown desc
    `);
    return {
      pricingSessions: steps?.pricing_sessions ?? 0,
      signups: steps?.signups ?? 0,
      activated: steps?.activated ?? 0,
      activatedPaid: steps?.activated_paid ?? 0,
      ordersCreated: steps?.orders_created ?? 0,
      ordersPaid: steps?.orders_paid ?? 0,
      methodMix: [...methodMix],
      prompts: [...prompts],
      tastesStarted: steps?.tastes_started ?? 0,
      tastesCompleted: steps?.tastes_completed ?? 0,
      offersShown: steps?.offers_shown ?? 0,
      offersUsed: steps?.offers_used ?? 0,
      referralSignups: steps?.referral_signups ?? 0,
      referralPaid: steps?.referral_paid ?? 0,
      inviters: steps?.inviters ?? 0,
    };
  }
}
