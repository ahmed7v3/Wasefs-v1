import { Inject, Injectable } from "@nestjs/common";
import {
  createTasteGrant,
  attachTasteAnalysis,
  experiments,
  growthEvents,
  organizationMembers,
  personalOffers,
  planEntitlements,
  plans,
  promotions,
  recordGrowthEvent,
  rxAnalyses,
  subscriptions,
  tasteGrants,
  tasteUsageSince,
  type GrowthEventRecord,
  type PersonalOffer,
  type RxAnalysis,
  type TasteGrant,
  type TasteUsage,
} from "@wasfa/db";
import { TASTE_FEATURE, type GrowthPromptKind } from "@wasfa/shared/growth";
import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

const DAY_MS = 86_400_000;

/** What the cooldown rule needs about one prompt kind for one user. */
export interface PromptHistory {
  dismissals: number;
  lastDismissedAt: Date | null;
  lastShownAt: Date | null;
}

export interface ActiveOffer {
  offer: PersonalOffer;
  promotion: {
    kind: "percent" | "fixed" | "bonus_credits" | "extra_months";
    value: number;
    currency: string | null;
    titleAr: string;
    titleEn: string;
  } | null;
}

/**
 * Reads and writes of the conversion engine. Every user-owned query is scoped by the caller's id;
 * the public proof numbers are aggregate counts only.
 */
@Injectable()
export class GrowthRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  recordEvent(event: GrowthEventRecord): Promise<boolean> {
    return recordGrowthEvent(this.db, event);
  }

  /** The user's own analysis, or undefined. */
  async analysisOf(userId: string, rxId: string): Promise<RxAnalysis | undefined> {
    const [row] = await this.db
      .select()
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.id, rxId), eq(rxAnalyses.ownerUserId, userId)));
    return row;
  }

  /** Which finished analysis of the user this is (1 = the first), counted by finish time. */
  async doneAnalysisNumber(userId: string, row: RxAnalysis): Promise<number> {
    if (row.finishedAt === null) return 0;
    const [result] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(rxAnalyses)
      .where(
        and(
          eq(rxAnalyses.ownerUserId, userId),
          eq(rxAnalyses.status, "done"),
          // The cutoff is read from the row itself: a JS Date keeps milliseconds, Postgres keeps
          // microseconds, so a `finished_at` written by `now()` would fall after its own ISO copy.
          sql`finished_at <= (select own.finished_at from rx_analyses own where own.id = ${row.id})`,
        ),
      );
    return result?.total ?? 0;
  }

  /** True when the analysis is itself a taste (a Deep re-run): it never offers another one. */
  async isTasteAnalysis(rxId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: tasteGrants.id })
      .from(tasteGrants)
      .where(eq(tasteGrants.analysisId, rxId))
      .limit(1);
    return row !== undefined;
  }

  /** Dismissals of one prompt kind (last 180 days) and the last shown/dismissed times. */
  async promptHistory(userId: string, kind: GrowthPromptKind, now: Date): Promise<PromptHistory> {
    const since = new Date(now.getTime() - 180 * DAY_MS).toISOString();
    const [row] = await this.db
      .select({
        dismissals: sql<number>`count(*) filter (where ${growthEvents.name} = 'prompt_dismissed')::int`,
        lastDismissedAt: sql<string | null>`max(${growthEvents.occurredAt}) filter (where ${growthEvents.name} = 'prompt_dismissed')`,
        lastShownAt: sql<string | null>`max(${growthEvents.occurredAt}) filter (where ${growthEvents.name} = 'prompt_shown')`,
      })
      .from(growthEvents)
      .where(
        and(
          eq(growthEvents.userId, userId),
          inArray(growthEvents.name, ["prompt_shown", "prompt_dismissed"]),
          sql`${growthEvents.props}->>'kind' = ${kind}`,
          sql`${growthEvents.occurredAt} >= ${since}::timestamptz`,
        ),
      );
    return {
      dismissals: row?.dismissals ?? 0,
      lastDismissedAt: row?.lastDismissedAt ? new Date(row.lastDismissedAt) : null,
      lastShownAt: row?.lastShownAt ? new Date(row.lastShownAt) : null,
    };
  }

  /** The user's live subscription (active, or in grace), if any. */
  async liveSubscription(userId: string) {
    const [row] = await this.db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        source: subscriptions.source,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.ownerUserId, userId),
          inArray(subscriptions.status, ["active", "trialing", "grace"]),
        ),
      )
      .orderBy(desc(subscriptions.currentPeriodEnd))
      .limit(1);
    return row;
  }

  /** Active members and this UTC month's analyses made in the organization's context. */
  async orgUsage(orgId: string, now: Date): Promise<{ members: number; analyses: number }> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [members] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.status, "active")));
    const analyses = await this.db.execute<{ total: number }>(sql`
      select count(*)::int as total
      from credit_reservations r
      join credit_wallets w on w.id = r.wallet_id
      where w.owner_org_id = ${orgId} and r.purpose = 'rx' and r.created_at >= ${monthStart}::timestamptz
    `);
    return { members: members?.total ?? 0, analyses: analyses[0]?.total ?? 0 };
  }

  /** Personal offers still open (not used, not past their server deadline), with their discount. */
  async activeOffers(userId: string, now: Date): Promise<ActiveOffer[]> {
    const rows = await this.db
      .select({ offer: personalOffers, promotion: promotions })
      .from(personalOffers)
      .leftJoin(promotions, eq(promotions.id, personalOffers.promotionId))
      .where(
        and(
          eq(personalOffers.ownerUserId, userId),
          isNull(personalOffers.consumedAt),
          gt(personalOffers.expiresAt, now),
        ),
      )
      .orderBy(asc(personalOffers.expiresAt));
    return rows.map(({ offer, promotion }) => ({
      offer,
      promotion: promotion
        ? {
            kind: promotion.kind,
            value: promotion.value,
            currency: promotion.currency,
            titleAr: promotion.titleAr,
            titleEn: promotion.titleEn,
          }
        : null,
    }));
  }

  async markOfferShown(userId: string, offerId: string): Promise<void> {
    await this.db
      .update(personalOffers)
      .set({ shownCount: sql`${personalOffers.shownCount} + 1` })
      .where(and(eq(personalOffers.id, offerId), eq(personalOffers.ownerUserId, userId)));
  }

  /** Finished analyses and the medicines they listed (the value ledger). */
  async valueOf(userId: string): Promise<{ analyses: number; drugs: number }> {
    const [row] = await this.db
      .select({
        analyses: sql<number>`count(*)::int`,
        drugs: sql<number>`coalesce(sum(case when jsonb_typeof(${rxAnalyses.result}->'items') = 'array' then jsonb_array_length(${rxAnalyses.result}->'items') else 0 end), 0)::int`,
      })
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.ownerUserId, userId), eq(rxAnalyses.status, "done")));
    return { analyses: row?.analyses ?? 0, drugs: row?.drugs ?? 0 };
  }

  /** Finished analyses of everyone in the last 7 days (a real total for the social-proof line). */
  async analysesSince(since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.status, "done"), gte(rxAnalyses.finishedAt, since)));
    return row?.total ?? 0;
  }

  /** Paid subscriptions started in the window, per plan key, largest first. */
  async paidSubscriptionShare(since: Date): Promise<{ planKey: string; total: number }[]> {
    return this.db
      .select({ planKey: plans.key, total: sql<number>`count(*)::int` })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(and(eq(subscriptions.source, "paid"), gte(subscriptions.createdAt, since)))
      .groupBy(plans.key)
      .orderBy(desc(sql`count(*)`));
  }

  async runningExperiments() {
    return this.db.select().from(experiments).where(eq(experiments.status, "running"));
  }

  async experimentByKey(key: string) {
    const [row] = await this.db.select().from(experiments).where(eq(experiments.key, key));
    return row;
  }

  /**
   * The cheapest public plan that sells Deep reading: a taste is routed through its model and its
   * name is the calm "available in …" line afterwards.
   */
  async deepPlan(): Promise<{ id: string; key: string; nameAr: string; nameEn: string } | undefined> {
    const [row] = await this.db
      .select({ id: plans.id, key: plans.key, nameAr: plans.nameAr, nameEn: plans.nameEn })
      .from(plans)
      .innerJoin(planEntitlements, eq(planEntitlements.planId, plans.id))
      .where(
        and(
          eq(plans.visibility, "public"),
          eq(plans.isDefault, false),
          eq(planEntitlements.task, "rx_extract"),
          eq(planEntitlements.allowed, true),
          sql`'deep' = any(${planEntitlements.modes})`,
        ),
      )
      .orderBy(asc(plans.monthlyCredits), asc(plans.sort))
      .limit(1);
    return row;
  }

  tasteUsage(userId: string, since: Date): Promise<TasteUsage> {
    return tasteUsageSince(this.db, userId, since);
  }

  async grantTaste(input: {
    userId: string;
    requestId: string;
    sourceAnalysisId: string;
    credits: number;
    now: Date;
  }): Promise<{ grant: TasteGrant; created: boolean }> {
    return this.db.transaction((tx) => createTasteGrant(tx, input));
  }

  attachTaste(grantId: string, analysisId: string, now: Date): Promise<boolean> {
    return attachTasteAnalysis(this.db, grantId, analysisId, now);
  }

  async tasteGrantOf(userId: string, grantId: string): Promise<TasteGrant | undefined> {
    const [row] = await this.db
      .select()
      .from(tasteGrants)
      .where(
        and(
          eq(tasteGrants.id, grantId),
          eq(tasteGrants.ownerUserId, userId),
          eq(tasteGrants.feature, TASTE_FEATURE),
        ),
      );
    return row;
  }

  /** A taste already made from this analysis (the same prescription is tasted once). */
  async tasteFromSource(userId: string, sourceAnalysisId: string): Promise<TasteGrant | undefined> {
    const [row] = await this.db
      .select()
      .from(tasteGrants)
      .where(
        and(
          eq(tasteGrants.ownerUserId, userId),
          eq(tasteGrants.sourceAnalysisId, sourceAnalysisId),
        ),
      )
      .limit(1);
    return row;
  }

  /** The processed files (in page order) of an analysis, to read the same pages again. */
  async pageFileIds(analysisId: string): Promise<string[]> {
    const rows = await this.db.execute<{ file_id: string }>(sql`
      select file_id from rx_pages where analysis_id = ${analysisId} order by page_no
    `);
    return rows.map((row) => row.file_id);
  }
}
