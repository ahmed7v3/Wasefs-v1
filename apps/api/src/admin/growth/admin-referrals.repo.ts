import { Inject, Injectable } from "@nestjs/common";
import {
  orders,
  pointsLedger,
  pointsWallets,
  referrals,
  users,
  withdrawalRequests,
} from "@wasfa/db";
import { and, count, desc, eq, gte, inArray, lt, sql, sum } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { ReferralStatus } from "@wasfa/shared/rewards";

const PAID_STATUSES = ["paid", "partially_refunded"] as const;

export interface Window {
  from: Date;
  to: Date;
}

export interface TreeRow {
  userId: string;
  name: string;
  status: ReferralStatus | null;
  flags: string[];
  fraudScore: number;
  referrerUserId: string | null;
  pointsEarned: number;
  paidOrders: number;
}

/** Aggregates of the referral overview and the rows of the referral tree. Counts and sums only. */
@Injectable()
export class AdminReferralsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async funnel({ from, to }: Window) {
    const db = this.handle.db;
    const [[invited], [verified], [paid]] = await Promise.all([
      db
        .select({ total: count() })
        .from(referrals)
        .where(and(gte(referrals.createdAt, from), lt(referrals.createdAt, to))),
      db
        .select({ total: count() })
        .from(referrals)
        .innerJoin(users, eq(users.id, referrals.refereeUserId))
        .where(and(gte(users.phoneVerifiedAt, from), lt(users.phoneVerifiedAt, to))),
      db
        .select({ total: sql<number>`count(distinct ${referrals.id})::int` })
        .from(referrals)
        .innerJoin(orders, eq(orders.ownerUserId, referrals.refereeUserId))
        .where(
          and(
            inArray(orders.status, [...PAID_STATUSES]),
            gte(orders.paidAt, from),
            lt(orders.paidAt, to),
          ),
        ),
    ]);
    return {
      invited: invited?.total ?? 0,
      verified: verified?.total ?? 0,
      paid: paid?.total ?? 0,
    };
  }

  /** Points accrued (pending rows created), released (pending given up to a bucket) and reversed. */
  async ledgerTotals({ from, to }: Window) {
    const [row] = await this.handle.db
      .select({
        accrued: sql<number>`coalesce(sum(${pointsLedger.amount}) filter (where ${pointsLedger.kind} = 'reward_pending'), 0)::int`,
        released: sql<number>`coalesce(-sum(${pointsLedger.amount}) filter (where ${pointsLedger.kind} = 'reward_release' and ${pointsLedger.bucket} = 'pending'), 0)::int`,
        reversed: sql<number>`coalesce(-sum(${pointsLedger.amount}) filter (where ${pointsLedger.kind} = 'reward_reverse'), 0)::int`,
      })
      .from(pointsLedger)
      .where(
        and(
          inArray(pointsLedger.kind, ["reward_pending", "reward_release", "reward_reverse"]),
          gte(pointsLedger.createdAt, from),
          lt(pointsLedger.createdAt, to),
        ),
      );
    return {
      accrued: row?.accrued ?? 0,
      released: row?.released ?? 0,
      reversed: row?.reversed ?? 0,
    };
  }

  async paidOut({ from, to }: Window) {
    const rows = await this.handle.db
      .select({
        currency: withdrawalRequests.currency,
        points: sum(withdrawalRequests.points).mapWith(Number),
        amountMinor: sum(withdrawalRequests.amountMinor).mapWith(Number),
      })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.status, "paid"),
          gte(withdrawalRequests.paidAt, from),
          lt(withdrawalRequests.paidAt, to),
        ),
      )
      .groupBy(withdrawalRequests.currency);
    return {
      points: rows.reduce((total, row) => total + row.points, 0),
      amountMinor: Object.fromEntries(rows.map((row) => [row.currency, row.amountMinor])),
    };
  }

  /** Referrers ranked by invitees who paid in the window, with the points they accrued in it. */
  async topReferrers({ from, to }: Window, limit: number) {
    const db = this.handle.db;
    const ranked = await db
      .select({
        userId: referrals.referrerUserId,
        name: users.name,
        paidReferrals: sql<number>`count(distinct ${referrals.id})::int`,
      })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.referrerUserId))
      .innerJoin(orders, eq(orders.ownerUserId, referrals.refereeUserId))
      .where(
        and(
          inArray(orders.status, [...PAID_STATUSES]),
          gte(orders.paidAt, from),
          lt(orders.paidAt, to),
        ),
      )
      .groupBy(referrals.referrerUserId, users.name)
      .orderBy(desc(sql`count(distinct ${referrals.id})`), referrals.referrerUserId)
      .limit(limit);
    const ids = ranked.flatMap((row) => (row.userId ? [row.userId] : []));
    if (ids.length === 0) return [];
    const points = await db
      .select({
        userId: pointsWallets.userId,
        total: sql<number>`coalesce(sum(${pointsLedger.amount}), 0)::int`,
      })
      .from(pointsLedger)
      .innerJoin(pointsWallets, eq(pointsWallets.id, pointsLedger.walletId))
      .where(
        and(
          eq(pointsLedger.kind, "reward_pending"),
          inArray(pointsWallets.userId, ids),
          gte(pointsLedger.createdAt, from),
          lt(pointsLedger.createdAt, to),
        ),
      )
      .groupBy(pointsWallets.userId);
    const earned = new Map(points.map((row) => [row.userId, row.total]));
    return ranked.flatMap((row) =>
      row.userId
        ? [
            {
              userId: row.userId,
              name: row.name,
              paidReferrals: row.paidReferrals,
              points: earned.get(row.userId) ?? 0,
            },
          ]
        : [],
    );
  }

  /** Net (subtotal) of paid orders per currency: those of referred buyers, and all of them. */
  async revenueShare({ from, to }: Window) {
    return this.handle.db
      .select({
        currency: orders.currency,
        referralNetMinor: sql<number>`coalesce(sum(${orders.subtotalMinor}) filter (where exists (
          select 1 from ${referrals} where ${referrals.refereeUserId} = ${orders.ownerUserId}
        )), 0)::bigint`.mapWith(Number),
        totalNetMinor: sql<number>`coalesce(sum(${orders.subtotalMinor}), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(orders)
      .where(
        and(
          inArray(orders.status, [...PAID_STATUSES]),
          gte(orders.paidAt, from),
          lt(orders.paidAt, to),
        ),
      )
      .groupBy(orders.currency)
      .orderBy(orders.currency);
  }

  // --- Tree -------------------------------------------------------------------------------------

  /** Per user: name, own referral (as invitee), lifetime points and paid order count. */
  async treeRows(userIds: readonly string[]): Promise<TreeRow[]> {
    if (userIds.length === 0) return [];
    const db = this.handle.db;
    const ids = [...userIds];
    const [people, paid] = await Promise.all([
      db
        .select({
          userId: users.id,
          name: users.name,
          status: referrals.status,
          flags: referrals.flags,
          fraudScore: referrals.fraudScore,
          referrerUserId: referrals.referrerUserId,
          pointsEarned: pointsWallets.lifetimeEarned,
        })
        .from(users)
        .leftJoin(referrals, eq(referrals.refereeUserId, users.id))
        .leftJoin(pointsWallets, eq(pointsWallets.userId, users.id))
        .where(inArray(users.id, ids)),
      db
        .select({ userId: orders.ownerUserId, total: count() })
        .from(orders)
        .where(and(inArray(orders.ownerUserId, ids), inArray(orders.status, [...PAID_STATUSES])))
        .groupBy(orders.ownerUserId),
    ]);
    const paidBy = new Map(paid.map((row) => [row.userId, row.total]));
    return people.map((row) => ({
      userId: row.userId,
      name: row.name,
      status: row.status,
      flags: row.flags ?? [],
      fraudScore: row.fraudScore ?? 0,
      referrerUserId: row.referrerUserId,
      pointsEarned: row.pointsEarned ?? 0,
      paidOrders: paidBy.get(row.userId) ?? 0,
    }));
  }

  /** The people the given users invited, oldest first: `{ referrer, invitee }`. */
  async inviteesOf(referrerIds: readonly string[], limit: number) {
    if (referrerIds.length === 0) return [];
    const rows = await this.handle.db
      .select({ referrer: referrals.referrerUserId, invitee: referrals.refereeUserId })
      .from(referrals)
      .where(inArray(referrals.referrerUserId, [...referrerIds]))
      .orderBy(referrals.createdAt, referrals.id)
      .limit(limit);
    return rows.flatMap((row) =>
      row.referrer ? [{ referrer: row.referrer, invitee: row.invitee }] : [],
    );
  }

  async referrerOf(userId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ referrer: referrals.referrerUserId })
      .from(referrals)
      .where(eq(referrals.refereeUserId, userId));
    return row?.referrer ?? null;
  }

  async userExists(userId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));
    return row !== undefined;
  }
}
