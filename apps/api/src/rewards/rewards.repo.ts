import { Inject, Injectable } from "@nestjs/common";
import {
  convertPointsToCredits,
  effectiveRules,
  ensureReferralCode,
  openDebtTotal,
  orders,
  pointsLedger,
  pointsWallets,
  previewConversion,
  referrals,
  tierProgress,
  users,
  type ConversionPlan,
  type ConversionResult,
  type EffectiveRule,
  type PointsWallet,
  type ReferralCode,
  type TierProgress,
} from "@wasfa/db";
import { and, eq, ne, or, sql, type SQL } from "drizzle-orm";

import { afterCursor, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

export interface ActivityRow {
  id: string;
  kind: (typeof pointsLedger.$inferSelect)["kind"];
  bucket: (typeof pointsLedger.$inferSelect)["bucket"];
  amount: number;
  reason: string | null;
  releaseAt: Date | null;
  createdAt: Date;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
  /** Who the reward came from (the invited person); the service reduces the name to initials. */
  refereeUserId: string | null;
  refereeName: string | null;
}

export interface Counts {
  invited: number;
  verified: number;
  paid: number;
}

/**
 * Every query of the caller's rewards page. Balances and the ledger are the caller's own (the
 * wallet is found through `scopedRepo`); the rules and conversion are `@wasfa/db`'s, shared with the worker.
 */
@Injectable()
export class RewardsRepo {
  private readonly wallets: ScopedRepo<typeof pointsWallets>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.wallets = scopedRepo(handle.db, {
      table: pointsWallets,
      scope: pointsWallets.userId,
      id: pointsWallets.id,
    });
  }

  ensureCode(userId: string): Promise<ReferralCode> {
    return ensureReferralCode(this.handle.db, userId);
  }

  /** The caller's wallet; undefined until their first reward. */
  async wallet(userId: string): Promise<PointsWallet | undefined> {
    const [wallet] = await this.wallets.list(userId);
    return wallet;
  }

  /** The soonest hold end among rewards that are still pending, or null. */
  async soonestRelease(userId: string): Promise<Date | null> {
    const rows = await this.handle.db.execute<{ at: Date | null }>(sql`
      select min(l.release_at) as at
      from points_ledger l
      join points_wallets w on w.id = l.wallet_id
      where w.user_id = ${userId} and l.kind = 'reward_pending' and l.release_at is not null
        and not exists (
          select 1 from points_ledger x
          where x.idempotency_key in (
            'release:' || l.id::text || ':in',
            'reverse:' || l.id::text || ':pending',
            'reverse:' || l.id::text || ':cash',
            'reverse:' || l.id::text || ':credit_only'
          )
        )
    `);
    const at = rows[0]?.at ?? null;
    return at === null ? null : new Date(at);
  }

  openDebt(userId: string): Promise<number> {
    return openDebtTotal(this.handle.db, userId);
  }

  /** Invited / verified / paid, by the person who was invited through the caller's code. */
  async counts(userId: string): Promise<Counts> {
    const [row] = await this.handle.db
      .select({
        invited: sql<number>`count(*)::int`,
        verified: sql<number>`(count(*) filter (where ${referrals.status} in ('qualified', 'rewarded')))::int`,
        paid: sql<number>`(count(*) filter (where exists (
          select 1 from ${orders}
          where ${orders.ownerUserId} = ${referrals.refereeUserId}
            and ${orders.status} in ('paid', 'partially_refunded')
        )))::int`,
      })
      .from(referrals)
      .where(eq(referrals.referrerUserId, userId));
    return { invited: row?.invited ?? 0, verified: row?.verified ?? 0, paid: row?.paid ?? 0 };
  }

  effectiveRules(programId: string, now: Date): Promise<EffectiveRule[]> {
    return effectiveRules(this.handle.db, programId, now);
  }

  tier(userId: string, programId: string, now: Date): Promise<TierProgress> {
    return tierProgress(this.handle.db, userId, programId, now);
  }

  /** `limit + 1` movements of the caller's wallet, newest first; the pending side of a release is not shown. */
  async activityPage(
    userId: string,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<ActivityRow[]> {
    const viaReferral = and(
      eq(pointsLedger.referenceType, "referral"),
      eq(referrals.id, pointsLedger.referenceId),
    );
    const viaOrder = and(
      eq(pointsLedger.referenceType, "order"),
      eq(orders.id, pointsLedger.referenceId),
    );
    const refereeId = sql<string | null>`coalesce(${referrals.refereeUserId}, ${orders.ownerUserId})`;
    const conditions: (SQL | undefined)[] = [
      eq(pointsWallets.userId, userId),
      or(ne(pointsLedger.kind, "reward_release"), ne(pointsLedger.bucket, "pending")),
    ];
    if (cursor) {
      conditions.push(afterCursor(pointsLedger.createdAt, pointsLedger.id, cursor, "uuid"));
    }
    return this.handle.db
      .select({
        id: pointsLedger.id,
        kind: pointsLedger.kind,
        bucket: pointsLedger.bucket,
        amount: pointsLedger.amount,
        reason: pointsLedger.reason,
        releaseAt: pointsLedger.releaseAt,
        createdAt: pointsLedger.createdAt,
        cursorAt: stamp(pointsLedger.createdAt),
        refereeUserId: refereeId,
        refereeName: users.name,
      })
      .from(pointsLedger)
      .innerJoin(pointsWallets, eq(pointsWallets.id, pointsLedger.walletId))
      .leftJoin(referrals, viaReferral)
      .leftJoin(orders, viaOrder)
      .leftJoin(users, eq(users.id, refereeId))
      .where(and(...conditions))
      .orderBy(sql`${pointsLedger.createdAt} desc`, sql`${pointsLedger.id} desc`)
      .limit(limit + 1);
  }

  preview(userId: string, points: number): Promise<ConversionPlan> {
    return previewConversion(this.handle.db, userId, points);
  }

  convert(userId: string, points: number, requestId: string): Promise<ConversionResult> {
    return convertPointsToCredits(this.handle.db, { userId, points, requestId });
  }
}
