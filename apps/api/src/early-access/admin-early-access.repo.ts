import { Inject, Injectable } from "@nestjs/common";
import {
  campaignLinks,
  earlyAccessEvents,
  earlyAccessSignups,
  isUniqueViolation,
  type CampaignLink,
  type EarlyAccessEvent,
  type EarlyAccessSignup,
} from "@wasfa/db";
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type {
  AdminEarlyFilter,
  EarlySignupStatus,
  EarlySortField,
} from "@wasfa/shared/schemas/early-access";

const SLUG_CONSTRAINT = "campaign_links_slug_key";
/** Hard stops for the exports: a full table dump must not be able to exhaust memory. */
export const SIGNUP_EXPORT_LIMIT = 50_000;
export const EVENT_EXPORT_LIMIT = 100_000;

export interface EarlyScope {
  from: Date;
  to: Date;
  filter: AdminEarlyFilter;
}

export interface SignupListFilter extends EarlyScope {
  q?: string | undefined;
  status?: EarlySignupStatus | undefined;
  completed?: "yes" | "no" | undefined;
}

export interface SignupListRow {
  signup: EarlyAccessSignup;
  campaignName: string | null;
  invited: number;
}

export interface CountRow {
  key: string | null;
  n: number;
}

const s = earlyAccessSignups;
const e = earlyAccessEvents;

/** Escapes LIKE wildcards so a search for "50%" means those characters. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Events: the funnel side. Role is a sign-up property, so it does not narrow events. */
function eventConditions(scope: EarlyScope, humansOnly: boolean): SQL[] {
  const { filter } = scope;
  const conditions: (SQL | undefined)[] = [
    gte(e.occurredAt, scope.from),
    lte(e.occurredAt, scope.to),
    humansOnly ? eq(e.isBot, false) : undefined,
    filter.campaignLinkId ? eq(e.campaignLinkId, filter.campaignLinkId) : undefined,
    filter.country ? eq(e.country, filter.country) : undefined,
    filter.city ? eq(e.city, filter.city) : undefined,
    filter.device ? eq(e.device, filter.device) : undefined,
    filter.utmSource ? sql`${e.utm}->>'source' = ${filter.utmSource}` : undefined,
  ];
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

function signupConditions(scope: EarlyScope): SQL[] {
  const { filter } = scope;
  const conditions: (SQL | undefined)[] = [
    gte(s.createdAt, scope.from),
    lte(s.createdAt, scope.to),
    filter.campaignLinkId ? eq(s.campaignLinkId, filter.campaignLinkId) : undefined,
    filter.country ? eq(s.country, filter.country) : undefined,
    filter.city ? eq(s.city, filter.city) : undefined,
    filter.role ? eq(s.role, filter.role) : undefined,
    filter.device ? eq(s.device, filter.device) : undefined,
    filter.utmSource ? sql`${s.utm}->>'source' = ${filter.utmSource}` : undefined,
  ];
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

function listConditions(filter: SignupListFilter): SQL[] {
  const conditions = signupConditions(filter);
  if (filter.status) conditions.push(eq(s.status, filter.status));
  if (filter.completed) conditions.push(eq(s.stepsCompleted, filter.completed === "yes" ? 2 : 1));
  const q = filter.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const byName = sql`${s.name} ilike ${`%${likeEscape(q)}%`}`;
    conditions.push(
      digits === "" ? byName : sql`(${byName} or ${s.phoneE164} like ${`%${digits}%`})`,
    );
  }
  return conditions;
}

const invitedExpr = sql<number>`(select count(*)::int from early_access_signups inv where inv.referred_by_id = ${s.id})`;

function sortExpr(field: EarlySortField): SQL {
  switch (field) {
    case "createdAt":
      return sql`${s.createdAt}`;
    case "name":
      return sql`${s.name}`;
    case "country":
      return sql`${s.country}`;
    case "city":
      return sql`${s.city}`;
    case "role":
      return sql`${s.role}`;
    case "fairPriceMinor":
      return sql`${s.fairPriceMinor}`;
    case "probePriceMinor":
      return sql`${s.probePriceMinor}`;
    case "invited":
      return invitedExpr;
    case "status":
      return sql`${s.status}`;
  }
}

/** Admin side of the early-access data: aggregates, the sign-up table, exports and campaign links. */
@Injectable()
export class AdminEarlyAccessRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // --- Overview ------------------------------------------------------------------------------

  async overview(scope: EarlyScope) {
    const db = this.handle.db;
    const evWhere = and(...eventConditions(scope, true));
    const viewWhere = and(...eventConditions(scope, true), eq(e.type, "view"));
    const sgWhere = and(...signupConditions(scope));

    const eventDay = sql<string>`to_char(${e.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const signupDay = sql<string>`to_char(${s.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const source = sql<string>`coalesce(${e.utm}->>'source', ${e.referrerHost}, 'direct')`;
    const completedCount = sql<number>`(count(*) filter (where ${s.stepsCompleted} = 2))::int`;
    const startOfToday = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
    );
    const featureSub = db
      .select({ feature: sql<string>`unnest(${s.features})`.as("feature") })
      .from(s)
      .where(sgWhere)
      .as("feature_sub");

    const [
      viewsRow,
      uniqueRow,
      signupTotals,
      todayRow,
      seriesViews,
      seriesSignups,
      funnel,
      viewsByCountry,
      signupsByCountry,
      cities,
      roles,
      devices,
      sources,
      features,
      priceCurve,
      fairPrice,
      viewsByCampaign,
      signupsByCampaign,
      viewsByVariant,
      signupsByVariant,
    ] = await Promise.all([
      db.select({ n: count() }).from(e).where(viewWhere),
      db
        .select({ n: countDistinct(sql`coalesce(${e.visitorHash}, ${e.sessionId})`) })
        .from(e)
        .where(viewWhere),
      db
        .select({
          total: count(),
          completed: completedCount,
          invited: sql<number>`(count(*) filter (where ${s.referredById} is not null))::int`,
        })
        .from(s)
        .where(sgWhere),
      db
        .select({ n: count() })
        .from(s)
        .where(and(...signupConditions({ ...scope, from: startOfToday, to: scope.to }))),
      db.select({ key: eventDay, n: count() }).from(e).where(viewWhere).groupBy(eventDay),
      db.select({ key: signupDay, n: count() }).from(s).where(sgWhere).groupBy(signupDay),
      db
        .select({ key: e.type, n: countDistinct(e.sessionId) })
        .from(e)
        .where(evWhere)
        .groupBy(e.type),
      db.select({ key: e.country, n: count() }).from(e).where(viewWhere).groupBy(e.country),
      db.select({ key: s.country, n: count() }).from(s).where(sgWhere).groupBy(s.country),
      db
        .select({ key: s.city, country: s.country, n: count() })
        .from(s)
        .where(and(sgWhere, sql`${s.city} is not null`))
        .groupBy(s.city, s.country)
        .orderBy(desc(count()))
        .limit(50),
      db
        .select({ key: s.role, n: count() })
        .from(s)
        .where(and(sgWhere, sql`${s.role} is not null`))
        .groupBy(s.role)
        .orderBy(desc(count())),
      db
        .select({ key: e.device, n: count() })
        .from(e)
        .where(and(viewWhere, sql`${e.device} is not null`))
        .groupBy(e.device)
        .orderBy(desc(count())),
      db
        .select({ key: source, n: count() })
        .from(e)
        .where(viewWhere)
        .groupBy(source)
        .orderBy(desc(count()))
        .limit(50),
      db
        .select({ key: featureSub.feature, n: count() })
        .from(featureSub)
        .groupBy(featureSub.feature)
        .orderBy(desc(count())),
      db
        .select({
          currency: s.probeCurrency,
          priceMinor: s.probePriceMinor,
          answered: sql<number>`(count(*) filter (where ${s.probeAnswer} is not null))::int`,
          yes: sql<number>`(count(*) filter (where ${s.probeAnswer} = 'yes'))::int`,
          maybe: sql<number>`(count(*) filter (where ${s.probeAnswer} = 'maybe'))::int`,
          no: sql<number>`(count(*) filter (where ${s.probeAnswer} = 'no'))::int`,
        })
        .from(s)
        .where(sgWhere)
        .groupBy(s.probeCurrency, s.probePriceMinor)
        .orderBy(asc(s.probeCurrency), asc(s.probePriceMinor)),
      db
        .select({ currency: s.fairPriceCurrency, priceMinor: s.fairPriceMinor, n: count() })
        .from(s)
        .where(and(sgWhere, eq(s.stepsCompleted, 2)))
        .groupBy(s.fairPriceCurrency, s.fairPriceMinor)
        .orderBy(asc(s.fairPriceCurrency), asc(s.fairPriceMinor)),
      db
        .select({ key: e.campaignLinkId, n: count() })
        .from(e)
        .where(viewWhere)
        .groupBy(e.campaignLinkId),
      db
        .select({ key: s.campaignLinkId, n: count(), completed: completedCount })
        .from(s)
        .where(sgWhere)
        .groupBy(s.campaignLinkId),
      db.select({ key: e.variant, n: count() }).from(e).where(viewWhere).groupBy(e.variant),
      db.select({ key: s.variant, n: count() }).from(s).where(sgWhere).groupBy(s.variant),
    ]);

    const campaignIds = [...viewsByCampaign, ...signupsByCampaign]
      .map((row) => row.key)
      .filter((key): key is string => key !== null);
    const campaignRows =
      campaignIds.length === 0
        ? []
        : await db
            .select({ id: campaignLinks.id, name: campaignLinks.name, slug: campaignLinks.slug })
            .from(campaignLinks)
            .where(inArray(campaignLinks.id, [...new Set(campaignIds)]));

    return {
      views: viewsRow[0]?.n ?? 0,
      uniqueVisitors: uniqueRow[0]?.n ?? 0,
      signups: signupTotals[0]?.total ?? 0,
      completed: signupTotals[0]?.completed ?? 0,
      invitedJoins: signupTotals[0]?.invited ?? 0,
      today: todayRow[0]?.n ?? 0,
      seriesViews,
      seriesSignups,
      funnel,
      viewsByCountry,
      signupsByCountry,
      cities,
      roles,
      devices,
      sources,
      features,
      priceCurve,
      fairPrice,
      viewsByCampaign,
      signupsByCampaign,
      campaignRows,
      viewsByVariant,
      signupsByVariant,
    };
  }

  // --- Sign-ups ------------------------------------------------------------------------------

  async listSignups(
    filter: SignupListFilter,
    sort: EarlySortField,
    dir: "asc" | "desc",
    limit: number,
    offset: number,
  ): Promise<{ rows: SignupListRow[]; total: number }> {
    const where = and(...listConditions(filter));
    const [rows, totals] = await Promise.all([
      this.signupRows(where, sort, dir, limit, offset),
      this.handle.db.select({ n: count() }).from(s).where(where),
    ]);
    return { rows, total: totals[0]?.n ?? 0 };
  }

  /** Every match in sign-up order, capped; for the CSV export. */
  exportSignups(filter: SignupListFilter): Promise<SignupListRow[]> {
    return this.signupRows(
      and(...listConditions(filter)),
      "createdAt",
      "asc",
      SIGNUP_EXPORT_LIMIT,
      0,
    );
  }

  private async signupRows(
    where: SQL | undefined,
    sort: EarlySortField,
    dir: "asc" | "desc",
    limit: number,
    offset: number,
  ): Promise<SignupListRow[]> {
    const order =
      dir === "asc"
        ? sql`${sortExpr(sort)} asc nulls last`
        : sql`${sortExpr(sort)} desc nulls last`;
    return this.handle.db
      .select({ signup: s, campaignName: campaignLinks.name, invited: invitedExpr })
      .from(s)
      .leftJoin(campaignLinks, eq(campaignLinks.id, s.campaignLinkId))
      .where(where)
      .orderBy(order, asc(s.id))
      .limit(limit)
      .offset(offset);
  }

  async signupById(id: string): Promise<SignupListRow | undefined> {
    const [row] = await this.handle.db
      .select({ signup: s, campaignName: campaignLinks.name, invited: invitedExpr })
      .from(s)
      .leftJoin(campaignLinks, eq(campaignLinks.id, s.campaignLinkId))
      .where(eq(s.id, id))
      .limit(1);
    return row;
  }

  async patchSignup(
    id: string,
    patch: { status?: EarlySignupStatus; adminNote?: string | null },
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    await this.handle.db.update(s).set(patch).where(eq(s.id, id));
  }

  exportEvents(scope: EarlyScope): Promise<EarlyAccessEvent[]> {
    return this.handle.db
      .select()
      .from(e)
      .where(and(...eventConditions(scope, false)))
      .orderBy(asc(e.occurredAt), asc(e.id))
      .limit(EVENT_EXPORT_LIMIT);
  }

  // --- Campaign links ------------------------------------------------------------------------

  listLinks(): Promise<CampaignLink[]> {
    return this.handle.db.select().from(campaignLinks).orderBy(desc(campaignLinks.createdAt));
  }

  /** Undefined when the slug is taken. */
  async createLink(values: {
    name: string;
    slug: string;
    utm: Record<string, string>;
    createdBy: string;
  }): Promise<CampaignLink | undefined> {
    try {
      const [row] = await this.handle.db
        .insert(campaignLinks)
        .values({ ...values, targetPath: "/" })
        .returning();
      return row;
    } catch (error) {
      if (isUniqueViolation(error, SLUG_CONSTRAINT)) return undefined;
      throw error;
    }
  }

  async setLinkActive(id: string, active: boolean): Promise<CampaignLink | undefined> {
    const [row] = await this.handle.db
      .update(campaignLinks)
      .set({ active })
      .where(eq(campaignLinks.id, id))
      .returning();
    return row;
  }
}
