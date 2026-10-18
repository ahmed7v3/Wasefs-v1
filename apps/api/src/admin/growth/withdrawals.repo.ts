import { Inject, Injectable } from "@nestjs/common";
import {
  approveWithdrawal,
  markWithdrawalPaid,
  orders,
  payoutDestinations,
  payoutMethods,
  pointsLedger,
  pointsWallets,
  referrals,
  rejectWithdrawal,
  rewardsSettingsOf,
  rewardDebts,
  users,
  withdrawalRequests,
  type ApproveResult,
  type PayoutDestination,
  type PayoutMethod,
  type PointsWallet,
  type User,
  type WithdrawalRequest,
  type WithdrawalResult,
} from "@wasfa/db";
import { and, asc, desc, eq, gt, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

export interface QueueRow {
  request: WithdrawalRequest;
  user: User;
  cursorAt: string;
}

export interface TotalsRow {
  status: WithdrawalRequest["status"];
  currency: string;
  count: number;
  points: number;
  amountMinor: number;
}

export interface FundingRow {
  at: Date;
  points: number;
  reason: string | null;
  referralId: string | null;
  orderId: string | null;
  refereeName: string | null;
}

export interface ExportRow {
  request: WithdrawalRequest;
  user: User;
  methodKey: string | null;
}

/**
 * Every query of the admin withdrawals console. Reads here; the state changes are `@wasfa/db`'s
 * transactions (request lock, wallet lock, ledger rows, alerts and notices commit together).
 */
@Injectable()
export class AdminWithdrawalsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The rewards settings read straight from the database: money rules never run on a cached copy. */
  rewardsSettings() {
    return rewardsSettingsOf(this.handle.db);
  }

  approve(id: string, adminId: string, now: Date): Promise<ApproveResult> {
    return approveWithdrawal(this.handle.db, { id, adminId, now });
  }

  reject(
    id: string,
    adminId: string,
    reasonKey: string,
    note: string | undefined,
  ): Promise<WithdrawalResult> {
    return rejectWithdrawal(this.handle.db, { id, adminId, reasonKey, note });
  }

  markPaid(
    id: string,
    adminId: string,
    transferReference: string,
    proofFileId: string | undefined,
    now: Date,
  ): Promise<WithdrawalResult> {
    return markWithdrawalPaid(this.handle.db, { id, adminId, transferReference, proofFileId, now });
  }

  /** `limit + 1` requests, newest first. */
  queue(
    filter: { status?: WithdrawalRequest["status"]; flag?: string },
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<QueueRow[]> {
    const conditions: (SQL | undefined)[] = [
      filter.status ? eq(withdrawalRequests.status, filter.status) : undefined,
      filter.flag ? sql`${withdrawalRequests.flags} @> ${JSON.stringify([filter.flag])}::jsonb` : undefined,
      cursor
        ? afterCursor(withdrawalRequests.createdAt, withdrawalRequests.id, cursor, "uuid")
        : undefined,
    ];
    return this.handle.db
      .select({ request: withdrawalRequests, user: users, cursorAt: stamp(withdrawalRequests.createdAt) })
      .from(withdrawalRequests)
      .innerJoin(users, eq(users.id, withdrawalRequests.userId))
      .where(and(...conditions))
      .orderBy(desc(withdrawalRequests.createdAt), desc(withdrawalRequests.id))
      .limit(limit + 1);
  }

  /** Waiting, approved-not-paid and paid this month, per currency. */
  totals(monthStart: Date): Promise<TotalsRow[]> {
    return this.handle.db
      .select({
        status: withdrawalRequests.status,
        currency: withdrawalRequests.currency,
        count: sql<number>`count(*)::int`,
        points: sql<number>`coalesce(sum(${withdrawalRequests.points}), 0)::int`,
        amountMinor: sql<number>`coalesce(sum(${withdrawalRequests.amountMinor}), 0)::int`,
      })
      .from(withdrawalRequests)
      .where(
        or(
          inArray(withdrawalRequests.status, ["requested", "approved"]),
          and(eq(withdrawalRequests.status, "paid"), gte(withdrawalRequests.paidAt, monthStart)),
        ),
      )
      .groupBy(withdrawalRequests.status, withdrawalRequests.currency);
  }

  async detail(id: string) {
    const [row] = await this.handle.db
      .select({
        request: withdrawalRequests,
        user: users,
        destination: payoutDestinations,
        method: payoutMethods,
      })
      .from(withdrawalRequests)
      .innerJoin(users, eq(users.id, withdrawalRequests.userId))
      .innerJoin(payoutDestinations, eq(payoutDestinations.id, withdrawalRequests.destinationId))
      .innerJoin(payoutMethods, eq(payoutMethods.id, payoutDestinations.methodId))
      .where(eq(withdrawalRequests.id, id));
    return row as
      | { request: WithdrawalRequest; user: User; destination: PayoutDestination; method: PayoutMethod }
      | undefined;
  }

  async wallet(userId: string): Promise<PointsWallet | undefined> {
    const [wallet] = await this.handle.db
      .select()
      .from(pointsWallets)
      .where(eq(pointsWallets.userId, userId));
    return wallet;
  }

  async openDebt(userId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`coalesce(sum(${rewardDebts.remaining}), 0)::int` })
      .from(rewardDebts)
      .where(and(eq(rewardDebts.userId, userId), gt(rewardDebts.remaining, 0)));
    return row?.total ?? 0;
  }

  /** The released cash rewards behind the balance, newest first. */
  async funding(userId: string, limit = 20): Promise<FundingRow[]> {
    const refereeId = sql<string | null>`coalesce(${referrals.refereeUserId}, ${orders.ownerUserId})`;
    return this.handle.db
      .select({
        at: pointsLedger.createdAt,
        points: pointsLedger.amount,
        reason: pointsLedger.reason,
        referralId: referrals.id,
        orderId: orders.id,
        refereeName: users.name,
      })
      .from(pointsLedger)
      .innerJoin(pointsWallets, eq(pointsWallets.id, pointsLedger.walletId))
      .leftJoin(
        referrals,
        and(eq(pointsLedger.referenceType, "referral"), eq(referrals.id, pointsLedger.referenceId)),
      )
      .leftJoin(
        orders,
        and(eq(pointsLedger.referenceType, "order"), eq(orders.id, pointsLedger.referenceId)),
      )
      .leftJoin(users, eq(users.id, refereeId))
      .where(
        and(
          eq(pointsWallets.userId, userId),
          eq(pointsLedger.kind, "reward_release"),
          eq(pointsLedger.bucket, "cash"),
        ),
      )
      .orderBy(desc(pointsLedger.createdAt), desc(pointsLedger.id))
      .limit(limit);
  }

  previous(userId: string, exceptId: string): Promise<WithdrawalRequest[]> {
    return this.handle.db
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.userId, userId), ne(withdrawalRequests.id, exceptId)))
      .orderBy(desc(withdrawalRequests.createdAt))
      .limit(10);
  }

  /** Requests created, or paid, inside `[from, to)`. */
  async exportRows(from: Date, to: Date): Promise<ExportRow[]> {
    const rows = await this.handle.db
      .select({ request: withdrawalRequests, user: users, methodKey: payoutMethods.key })
      .from(withdrawalRequests)
      .innerJoin(users, eq(users.id, withdrawalRequests.userId))
      .leftJoin(payoutDestinations, eq(payoutDestinations.id, withdrawalRequests.destinationId))
      .leftJoin(payoutMethods, eq(payoutMethods.id, payoutDestinations.methodId))
      .where(
        or(
          and(gte(withdrawalRequests.createdAt, from), lt(withdrawalRequests.createdAt, to)),
          and(gte(withdrawalRequests.paidAt, from), lt(withdrawalRequests.paidAt, to)),
        ),
      )
      .orderBy(asc(withdrawalRequests.createdAt), asc(withdrawalRequests.id));
    return rows;
  }

  async userName(id: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, id));
    return row?.name ?? null;
  }
}
