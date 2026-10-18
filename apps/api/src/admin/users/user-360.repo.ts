import { Inject, Injectable } from "@nestjs/common";
import {
  aiUsage,
  auditLogs,
  couponRedemptions,
  coupons,
  creditLedger,
  creditWallets,
  orders,
  organizationMembers,
  organizations,
  payments,
  planPrices,
  plans,
  pointsLedger,
  pointsWallets,
  referralCodes,
  referrals,
  refunds,
  sessions,
  subscriptionEvents,
  subscriptions,
  userNotes,
  users,
  withdrawalRequests,
} from "@wasfa/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@wasfa/shared/billing";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, asc, desc, eq, gte, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

const PAID_ORDER_STATUSES = ["paid", "partially_refunded", "refunded"] as const;

/** Where a timeline item comes from (the public `source`); the sort key below is finer. */
export type TimelineSource =
  "session" | "order" | "subscription" | "credit" | "points" | "admin" | "note";

export interface TimelineRow {
  id: string;
  /** `occurred_at` as exact text with microseconds (the cursor and the sort use it). */
  at: string;
  /** One constant per query: the middle part of the `(occurred_at, key, id)` order. */
  key: string;
  source: TimelineSource;
  kind: string;
  summaryKey: string;
  params: Record<string, unknown>;
}

export interface TimelineCursor {
  at: string;
  key: string;
  id: string;
}

const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{6}Z$/;
const CURSOR_KEY = /^[a-z_.]{1,40}$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(`${cursor.at}|${cursor.key}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeTimelineCursor(raw: string | undefined): TimelineCursor | undefined {
  if (raw === undefined) return undefined;
  const [at, key, id, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (
    rest.length > 0 ||
    at === undefined ||
    key === undefined ||
    id === undefined ||
    !CURSOR_AT.test(at) ||
    Number.isNaN(Date.parse(at)) ||
    !CURSOR_KEY.test(key) ||
    !CURSOR_ID.test(id)
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["cursor"] } });
  }
  return { at, key, id };
}

/**
 * "Strictly after the cursor" in the merged order `(occurred_at, key, id)` descending, for the
 * query whose constant sort key is `key`: a source whose key sorts above the cursor's has nothing
 * at the cursor's instant left to show; one that sorts below it still has its rows at that instant.
 */
function afterTimelineCursor(
  cursor: TimelineCursor | undefined,
  key: string,
  at: AnyColumn,
  id: AnyColumn,
): SQL | undefined {
  if (!cursor) return undefined;
  const instant = sql`${cursor.at}::timestamptz`;
  if (key > cursor.key) return sql`${at} < ${instant}`;
  if (key < cursor.key) return sql`${at} <= ${instant}`;
  return sql`(${at}, ${id}) < (${instant}, ${cursor.id}::uuid)`;
}

/** Newest first; the merge order of the timeline. */
export function compareTimeline(a: TimelineRow, b: TimelineRow): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  if (a.key !== b.key) return a.key < b.key ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

const liveStatuses = [...LIVE_SUBSCRIPTION_STATUSES];

/** The read side of the user 360 page: summary, timeline, billing, credits and referrals. */
@Injectable()
export class AdminUser360Repo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  // --- Summary ----------------------------------------------------------------------------------

  async liveSubscription(userId: string) {
    const [row] = await this.db
      .select({
        id: subscriptions.id,
        planKey: plans.key,
        planNameAr: plans.nameAr,
        planNameEn: plans.nameEn,
        status: subscriptions.status,
        source: subscriptions.source,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(eq(subscriptions.ownerUserId, userId), inArray(subscriptions.status, liveStatuses)),
      );
    return row;
  }

  /** The personal wallet and the wallet of every organization the user is an active member of. */
  async wallets(userId: string) {
    const [personal] = await this.db
      .select({ id: creditWallets.id, balance: creditWallets.balance })
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, userId));
    const orgs = await this.db
      .select({
        orgId: organizations.id,
        name: organizations.name,
        walletId: creditWallets.id,
        balance: creditWallets.balance,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .leftJoin(creditWallets, eq(creditWallets.ownerOrgId, organizations.id))
      .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, "active")))
      .orderBy(asc(organizationMembers.joinedAt));
    return { personal, orgs };
  }

  async lastSeen(userId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: sql<Date | null>`max(${sessions.updatedAt})` })
      .from(sessions)
      .where(eq(sessions.userId, userId));
    return row?.at ? new Date(row.at) : null;
  }

  /** Paid orders minus completed refunds, per currency. Never summed across currencies. */
  async lifetimeRevenue(userId: string): Promise<Record<string, number>> {
    const [paid, refunded] = await Promise.all([
      this.db
        .select({
          currency: orders.currency,
          total: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::float8`,
        })
        .from(orders)
        .where(
          and(eq(orders.ownerUserId, userId), inArray(orders.status, [...PAID_ORDER_STATUSES])),
        )
        .groupBy(orders.currency),
      this.db
        .select({
          currency: refunds.currency,
          total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::float8`,
        })
        .from(refunds)
        .innerJoin(payments, eq(payments.id, refunds.paymentId))
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(and(eq(orders.ownerUserId, userId), eq(refunds.status, "succeeded")))
        .groupBy(refunds.currency),
    ]);
    const revenue: Record<string, number> = {};
    for (const row of paid) revenue[row.currency] = row.total;
    for (const row of refunded) revenue[row.currency] = (revenue[row.currency] ?? 0) - row.total;
    return revenue;
  }

  async lifetimeAiCostUsdMicros(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8` })
      .from(aiUsage)
      .where(eq(aiUsage.userId, userId));
    return row?.total ?? 0;
  }

  async referralSource(userId: string) {
    const referrer = alias(users, "referrer");
    const [row] = await this.db
      .select({
        referralId: referrals.id,
        code: referralCodes.code,
        codeKind: referralCodes.kind,
        source: referrals.source,
        status: referrals.status,
        referrerName: referrer.name,
      })
      .from(referrals)
      .innerJoin(referralCodes, eq(referralCodes.id, referrals.codeId))
      .leftJoin(referrer, eq(referrer.id, referrals.referrerUserId))
      .where(eq(referrals.refereeUserId, userId));
    return row;
  }

  // --- Timeline ---------------------------------------------------------------------------------

  /**
   * One page of the merged history, newest first. Each source is read with its own index-friendly
   * query for `limit + 1` rows strictly after the cursor; the union of those rows contains the next
   * `limit + 1` rows of the merge (any row of the merge that is not in its own source's first
   * `limit + 1` has at least `limit + 1` rows before it), so merging and cutting is exact.
   */
  async timeline(
    userId: string,
    cursor: TimelineCursor | undefined,
    limit: number,
  ): Promise<TimelineRow[]> {
    const take = limit + 1;
    const lists = await Promise.all([
      this.sessionRows(userId, cursor, take),
      this.orderRows(userId, cursor, take),
      this.subscriptionRows(userId, cursor, take),
      this.creditRows(userId, cursor, take),
      this.pointsRows(userId, cursor, take),
      this.adminRows(userId, cursor, take),
      this.noteRows(userId, cursor, take),
    ]);
    return lists.flat().sort(compareTimeline).slice(0, take);
  }

  private async sessionRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "session.signin";
    const rows = await this.db
      .select({ id: sessions.id, at: stamp(sessions.createdAt) })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), afterTimelineCursor(cursor, key, sessions.createdAt, sessions.id)))
      .orderBy(desc(sessions.createdAt), desc(sessions.id))
      .limit(take);
    return rows.map((row) => ({
      ...row,
      key,
      source: "session",
      kind: "signin",
      summaryKey: "admin.timeline.session.signin",
      params: {},
    }));
  }

  private async orderRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const own = eq(orders.ownerUserId, userId);
    const [created, paid, refunded] = await Promise.all([
      this.db
        .select({
          id: orders.id,
          at: stamp(orders.createdAt),
          number: orders.number,
          orderKind: orders.kind,
          totalMinor: orders.totalMinor,
          currency: orders.currency,
        })
        .from(orders)
        .where(and(own, afterTimelineCursor(cursor, "order.created", orders.createdAt, orders.id)))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(take),
      this.db
        .select({
          id: orders.id,
          at: stamp(orders.paidAt),
          number: orders.number,
          orderKind: orders.kind,
          totalMinor: orders.totalMinor,
          currency: orders.currency,
        })
        .from(orders)
        .where(
          and(
            own,
            sql`${orders.paidAt} is not null`,
            afterTimelineCursor(cursor, "order.paid", orders.paidAt, orders.id),
          ),
        )
        .orderBy(desc(orders.paidAt), desc(orders.id))
        .limit(take),
      this.db
        .select({
          id: refunds.id,
          at: stamp(refunds.createdAt),
          number: orders.number,
          totalMinor: refunds.amountMinor,
          currency: refunds.currency,
        })
        .from(refunds)
        .innerJoin(payments, eq(payments.id, refunds.paymentId))
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .where(
          and(
            own,
            eq(refunds.status, "succeeded"),
            afterTimelineCursor(cursor, "order.refunded", refunds.createdAt, refunds.id),
          ),
        )
        .orderBy(desc(refunds.createdAt), desc(refunds.id))
        .limit(take),
    ]);
    const params = (row: { number: string; totalMinor: number; currency: string }) => ({
      orderNumber: row.number,
      amountMinor: row.totalMinor,
      currency: row.currency,
    });
    return [
      ...created.map((row): TimelineRow => ({
        id: row.id,
        at: row.at,
        key: "order.created",
        source: "order",
        kind: "created",
        summaryKey: "admin.timeline.order.created",
        params: { ...params(row), orderKind: row.orderKind },
      })),
      ...paid.map((row): TimelineRow => ({
        id: row.id,
        at: row.at,
        key: "order.paid",
        source: "order",
        kind: "paid",
        summaryKey: "admin.timeline.order.paid",
        params: params(row),
      })),
      ...refunded.map((row): TimelineRow => ({
        id: row.id,
        at: row.at,
        key: "order.refunded",
        source: "order",
        kind: "refunded",
        summaryKey: "admin.timeline.order.refunded",
        params: params(row),
      })),
    ];
  }

  private async subscriptionRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "subscription.event";
    const rows = await this.db
      .select({
        id: subscriptionEvents.id,
        at: stamp(subscriptionEvents.createdAt),
        type: subscriptionEvents.type,
        planKey: plans.key,
        action: sql<string | null>`${subscriptionEvents.data}->>'action'`,
        planChangeKind: sql<string | null>`${subscriptionEvents.data}->>'kind'`,
      })
      .from(subscriptionEvents)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionEvents.subscriptionId))
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(
        and(
          eq(subscriptions.ownerUserId, userId),
          afterTimelineCursor(cursor, key, subscriptionEvents.createdAt, subscriptionEvents.id),
        ),
      )
      .orderBy(desc(subscriptionEvents.createdAt), desc(subscriptionEvents.id))
      .limit(take);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      key,
      source: "subscription",
      kind: row.type,
      summaryKey: `admin.timeline.subscription.${row.type}`,
      params: {
        planKey: row.planKey,
        ...(row.action ? { action: row.action } : {}),
        ...(row.planChangeKind ? { changeKind: row.planChangeKind } : {}),
      },
    }));
  }

  private async creditRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "credit.ledger";
    const rows = await this.db
      .select({
        id: creditLedger.id,
        at: stamp(creditLedger.createdAt),
        kind: creditLedger.kind,
        amount: creditLedger.amount,
        balanceAfter: creditLedger.balanceAfter,
      })
      .from(creditLedger)
      .innerJoin(creditWallets, eq(creditWallets.id, creditLedger.walletId))
      .where(
        and(
          eq(creditWallets.ownerUserId, userId),
          afterTimelineCursor(cursor, key, creditLedger.createdAt, creditLedger.id),
        ),
      )
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(take);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      key,
      source: "credit",
      kind: row.kind,
      summaryKey: `admin.timeline.credit.${row.kind}`,
      params: { amount: row.amount, balanceAfter: row.balanceAfter },
    }));
  }

  private async pointsRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "points.ledger";
    const rows = await this.db
      .select({
        id: pointsLedger.id,
        at: stamp(pointsLedger.createdAt),
        kind: pointsLedger.kind,
        bucket: pointsLedger.bucket,
        amount: pointsLedger.amount,
      })
      .from(pointsLedger)
      .innerJoin(pointsWallets, eq(pointsWallets.id, pointsLedger.walletId))
      .where(
        and(
          eq(pointsWallets.userId, userId),
          afterTimelineCursor(cursor, key, pointsLedger.createdAt, pointsLedger.id),
        ),
      )
      .orderBy(desc(pointsLedger.createdAt), desc(pointsLedger.id))
      .limit(take);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      key,
      source: "points",
      kind: row.kind,
      summaryKey: `admin.timeline.points.${row.kind}`,
      params: { amount: row.amount, bucket: row.bucket },
    }));
  }

  /** Admin actions that targeted this user (suspension, plan change, PHI access, contact reveal...). */
  private async adminRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "admin.audit";
    const rows = await this.db
      .select({
        id: auditLogs.id,
        at: stamp(auditLogs.createdAt),
        action: auditLogs.action,
        actorId: auditLogs.actorId,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.targetType, "user"),
          eq(auditLogs.targetId, userId),
          afterTimelineCursor(cursor, key, auditLogs.createdAt, auditLogs.id),
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(take);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      key,
      source: "admin",
      kind: row.action,
      summaryKey: `admin.timeline.admin.${row.action}`,
      params: { actorId: row.actorId },
    }));
  }

  private async noteRows(
    userId: string,
    cursor: TimelineCursor | undefined,
    take: number,
  ): Promise<TimelineRow[]> {
    const key = "note.created";
    const rows = await this.db
      .select({
        id: userNotes.id,
        at: stamp(userNotes.createdAt),
        body: userNotes.body,
        pinned: userNotes.pinned,
        authorId: userNotes.authorId,
      })
      .from(userNotes)
      .where(
        and(eq(userNotes.userId, userId), afterTimelineCursor(cursor, key, userNotes.createdAt, userNotes.id)),
      )
      .orderBy(desc(userNotes.createdAt), desc(userNotes.id))
      .limit(take);
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      key,
      source: "note",
      kind: "created",
      summaryKey: "admin.timeline.note.created",
      params: { body: row.body, pinned: row.pinned, authorId: row.authorId },
    }));
  }

  // --- Billing ----------------------------------------------------------------------------------

  subscriptionList(userId: string) {
    return this.db
      .select({
        id: subscriptions.id,
        planKey: plans.key,
        status: subscriptions.status,
        source: subscriptions.source,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        pendingChange: subscriptions.pendingChange,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.ownerUserId, userId))
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(10);
  }

  subscriptionHistory(userId: string) {
    return this.db
      .select({
        id: subscriptionEvents.id,
        type: subscriptionEvents.type,
        data: subscriptionEvents.data,
        actorId: subscriptionEvents.actorId,
        createdAt: subscriptionEvents.createdAt,
      })
      .from(subscriptionEvents)
      .innerJoin(subscriptions, eq(subscriptions.id, subscriptionEvents.subscriptionId))
      .where(eq(subscriptions.ownerUserId, userId))
      .orderBy(desc(subscriptionEvents.createdAt), desc(subscriptionEvents.id))
      .limit(50);
  }

  ordersPage(userId: string, cursor: Cursor | undefined, limit: number) {
    return this.db
      .select({
        id: orders.id,
        number: orders.number,
        kind: orders.kind,
        status: orders.status,
        totalMinor: orders.totalMinor,
        currency: orders.currency,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        cursorAt: stamp(orders.createdAt),
      })
      .from(orders)
      .where(
        and(
          eq(orders.ownerUserId, userId),
          cursor ? afterCursor(orders.createdAt, orders.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);
  }

  paymentsOfOrders(orderIds: readonly string[]) {
    if (orderIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        id: payments.id,
        orderId: payments.orderId,
        reference: payments.reference,
        methodKey: payments.methodKey,
        status: payments.status,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(inArray(payments.orderId, [...orderIds]))
      .orderBy(desc(payments.createdAt), desc(payments.id));
  }

  couponsRedeemed(userId: string) {
    return this.db
      .select({
        id: couponRedemptions.id,
        code: coupons.code,
        status: couponRedemptions.status,
        reservedAt: couponRedemptions.reservedAt,
        confirmedAt: couponRedemptions.confirmedAt,
      })
      .from(couponRedemptions)
      .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
      .where(eq(couponRedemptions.ownerUserId, userId))
      .orderBy(desc(couponRedemptions.reservedAt), desc(couponRedemptions.id))
      .limit(50);
  }

  /** The plans that have an active price in `currency`, with their shortest period. */
  async pricedPlans(currency: string): Promise<Array<{ key: string; months: number }>> {
    const rows = await this.db
      .select({ key: plans.key, months: planPrices.months })
      .from(planPrices)
      .innerJoin(plans, eq(plans.id, planPrices.planId))
      .where(
        and(
          eq(planPrices.currency, currency),
          eq(planPrices.active, true),
          eq(plans.isDefault, false),
        ),
      )
      .orderBy(asc(plans.sort), asc(plans.key), asc(planPrices.months));
    const first = new Map<string, number>();
    for (const row of rows) if (!first.has(row.key)) first.set(row.key, row.months);
    return [...first].map(([key, months]) => ({ key, months }));
  }

  // --- Credits ----------------------------------------------------------------------------------

  /** Credits spent and cost per task and day over the last `days` days. */
  usageByTaskDay(userId: string, since: Date) {
    const day = sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt} at time zone 'utc'), 'YYYY-MM-DD')`;
    return this.db
      .select({
        day,
        task: aiUsage.task,
        calls: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${aiUsage.creditsCharged}), 0)::int`,
        costUsdMicros: sql<number>`coalesce(sum(${aiUsage.costUsdMicros}), 0)::float8`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
      .groupBy(day, aiUsage.task)
      .orderBy(desc(day), asc(aiUsage.task));
  }

  // --- Referrals --------------------------------------------------------------------------------

  async ownCode(userId: string) {
    const [row] = await this.db
      .select({
        id: referralCodes.id,
        code: referralCodes.code,
        kind: referralCodes.kind,
        active: referralCodes.active,
      })
      .from(referralCodes)
      .where(eq(referralCodes.ownerUserId, userId))
      .orderBy(asc(referralCodes.createdAt))
      .limit(1);
    return row;
  }

  async invitees(userId: string) {
    const rows = await this.db
      .select({
        referralId: referrals.id,
        refereeName: users.name,
        status: referrals.status,
        fraudScore: referrals.fraudScore,
        flags: referrals.flags,
        createdAt: referrals.createdAt,
        pendingPoints: sql<number>`coalesce((select sum(${pointsLedger.amount}) from ${pointsLedger} where ${pointsLedger.referenceType} = 'referral' and ${pointsLedger.referenceId} = ${referrals.id} and ${pointsLedger.bucket} = 'pending'), 0)::int`,
        settledPoints: sql<number>`coalesce((select sum(${pointsLedger.amount}) from ${pointsLedger} where ${pointsLedger.referenceType} = 'referral' and ${pointsLedger.referenceId} = ${referrals.id} and ${pointsLedger.bucket} <> 'pending'), 0)::int`,
      })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.refereeUserId))
      .where(eq(referrals.referrerUserId, userId))
      .orderBy(desc(referrals.createdAt), desc(referrals.id))
      .limit(50);
    return rows;
  }

  async pointsWallet(userId: string) {
    const [row] = await this.db.select().from(pointsWallets).where(eq(pointsWallets.userId, userId));
    return row;
  }

  pointsLedgerPage(walletId: string, cursor: Cursor | undefined, limit: number) {
    return this.db
      .select({
        id: pointsLedger.id,
        kind: pointsLedger.kind,
        bucket: pointsLedger.bucket,
        amount: pointsLedger.amount,
        referenceType: pointsLedger.referenceType,
        releaseAt: pointsLedger.releaseAt,
        actorId: pointsLedger.actorId,
        createdAt: pointsLedger.createdAt,
        cursorAt: stamp(pointsLedger.createdAt),
      })
      .from(pointsLedger)
      .where(
        and(
          eq(pointsLedger.walletId, walletId),
          cursor ? afterCursor(pointsLedger.createdAt, pointsLedger.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(pointsLedger.createdAt), desc(pointsLedger.id))
      .limit(limit + 1);
  }

  withdrawalsSummary(userId: string) {
    return this.db
      .select({
        status: withdrawalRequests.status,
        count: sql<number>`count(*)::int`,
        points: sql<number>`coalesce(sum(${withdrawalRequests.points}), 0)::int`,
      })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, userId))
      .groupBy(withdrawalRequests.status)
      .orderBy(asc(withdrawalRequests.status));
  }
}
