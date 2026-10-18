import { newId } from "@wasfa/shared/ids";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import {
  pointsLedger,
  pointsWallets,
  rewardDebts,
  type PointsLedgerEntry,
  type PointsWallet,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type {
  PointsBucket,
  PointsLedgerKind,
  PointsReferenceType,
} from "@wasfa/shared/rewards";

/*
 * The points ledger (REFERRALS-REWARDS §4): plain functions over a transaction, shared by the API
 * (conversion) and the worker (rewards, release, reversal), like `credits-ledger.ts`.
 *
 * Rules every movement follows:
 *  - The WALLET row is locked (`FOR UPDATE`) before anything is read or written, so concurrent
 *    movements of one user are serialised and a bucket can never be overdrawn. Lock order across
 *    tables is order, then referral, then wallet (the callers take the first two).
 *  - A wallet bucket changes only together with the ledger rows that explain it, in the same
 *    transaction. SUM(amount) of a wallet's rows of a bucket always equals that bucket.
 *  - Every row has an idempotency key; a retried movement finds its rows and returns them.
 *  - Points are integers; the ledger is append-only (the `wasfa_api` role cannot UPDATE it).
 *  - Reversing points that were already spent never takes a bucket below zero: the shortfall is a
 *    `reward_debts` row that future earnings offset.
 */

export type PointsLedgerErrorReason =
  | "insufficient_points"
  | "invalid_amount"
  | "idempotency_key_reused"
  | "open_reward_debt"
  | "below_minimum";

/** An expected refusal; the API turns it into an `AppError`, the worker just logs it. */
export class PointsLedgerError extends Error {
  constructor(readonly reason: PointsLedgerErrorReason) {
    super(`Points ledger refused: ${reason}`);
    this.name = "PointsLedgerError";
  }
}

export interface PointsRowInput {
  bucket: PointsBucket;
  /** Signed, never zero. */
  amount: number;
  idempotencyKey: string;
  /** For `reward_pending` rows: when the hold ends. */
  releaseAt?: Date | null;
}

export interface PointsMoveInput {
  userId: string;
  kind: PointsLedgerKind;
  /** Rows of one movement share it; a new id when omitted. */
  groupId?: string;
  rows: readonly PointsRowInput[];
  referenceType?: PointsReferenceType | null;
  referenceId?: string | null;
  ruleId?: string | null;
  actorId?: string | null;
  reason?: string | null;
  /** Added to `lifetime_earned` (never below zero overall). */
  lifetimeDelta?: number;
}

export interface PointsMoveResult {
  wallet: PointsWallet;
  entries: PointsLedgerEntry[];
  /** True when the idempotency keys were already used: nothing changed. */
  replayed: boolean;
}

export const bucketOf = (wallet: PointsWallet, bucket: PointsBucket): number =>
  bucket === "pending" ? wallet.pending : bucket === "cash" ? wallet.cash : wallet.creditOnly;

const bucketColumn = {
  pending: "pending",
  cash: "cash",
  credit_only: "creditOnly",
} as const satisfies Record<PointsBucket, keyof PointsWallet>;

/** The user's wallet, created on first use, locked until the transaction ends. */
export async function lockPointsWallet(tx: Transaction, userId: string): Promise<PointsWallet> {
  const lock = () => tx.select().from(pointsWallets).where(eq(pointsWallets.userId, userId)).for("update");
  const [existing] = await lock();
  if (existing) return existing;
  // Two first uses can race: the loser's insert does nothing and its re-select waits for the winner.
  await tx.insert(pointsWallets).values({ userId }).onConflictDoNothing();
  const [created] = await lock();
  if (!created) throw new Error("Points wallet could not be created");
  return created;
}

/** The wallet of `userId`, created on first use. */
export async function ensurePointsWallet(db: Database, userId: string): Promise<PointsWallet> {
  return db.transaction((tx) => lockPointsWallet(tx, userId));
}

/**
 * One movement: ledger rows plus the wallet change, under the wallet lock. `insufficient_points`
 * when any bucket would go below zero; a replayed key returns the stored rows.
 */
export async function pointsMove(tx: Transaction, input: PointsMoveInput): Promise<PointsMoveResult> {
  if (input.rows.length === 0) throw new PointsLedgerError("invalid_amount");
  for (const row of input.rows) {
    if (!Number.isSafeInteger(row.amount) || row.amount === 0) {
      throw new PointsLedgerError("invalid_amount");
    }
  }
  const wallet = await lockPointsWallet(tx, input.userId);
  const keys = input.rows.map((row) => row.idempotencyKey);
  const existing = await tx
    .select()
    .from(pointsLedger)
    .where(inArray(pointsLedger.idempotencyKey, keys))
    .orderBy(asc(pointsLedger.createdAt), asc(pointsLedger.id));
  if (existing.length > 0) {
    // A key that belongs to someone else's wallet is a caller bug, never a replay.
    if (existing.some((row) => row.walletId !== wallet.id)) {
      throw new PointsLedgerError("idempotency_key_reused");
    }
    return { wallet, entries: existing, replayed: true };
  }

  const next = { pending: wallet.pending, cash: wallet.cash, creditOnly: wallet.creditOnly };
  for (const row of input.rows) next[bucketColumn[row.bucket]] += row.amount;
  if (next.pending < 0 || next.cash < 0 || next.creditOnly < 0) {
    throw new PointsLedgerError("insufficient_points");
  }

  const groupId = input.groupId ?? newId();
  const entries = await tx
    .insert(pointsLedger)
    .values(
      input.rows.map((row) => ({
        walletId: wallet.id,
        groupId,
        kind: input.kind,
        bucket: row.bucket,
        amount: row.amount,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        ruleId: input.ruleId ?? null,
        idempotencyKey: row.idempotencyKey,
        releaseAt: row.releaseAt ?? null,
        actorId: input.actorId ?? null,
        reason: input.reason ?? null,
      })),
    )
    .returning();
  const lifetimeEarned = Math.max(0, wallet.lifetimeEarned + (input.lifetimeDelta ?? 0));
  const [updated] = await tx
    .update(pointsWallets)
    .set({ ...next, lifetimeEarned, updatedAt: sql`now()` })
    .where(eq(pointsWallets.id, wallet.id))
    .returning();
  if (!updated) throw new Error("Points wallet was not updated");
  return { wallet: updated, entries, replayed: false };
}

// --- Reward debts ---------------------------------------------------------------------------------

/** Points still owed by the user (reversed rewards that were already spent), waived debts excluded. */
export async function openDebtTotal(tx: Transaction | Database, userId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${rewardDebts.remaining}), 0)::int` })
    .from(rewardDebts)
    .where(and(eq(rewardDebts.userId, userId), gt(rewardDebts.remaining, 0)));
  return row?.total ?? 0;
}

/**
 * Offsets new earnings against open debts, oldest first. Returns how much of `amount` was absorbed;
 * the caller credits only the rest. Call it under the wallet lock (inside `lockPointsWallet`'s
 * transaction) so two earnings cannot absorb the same debt twice.
 */
export async function offsetDebts(tx: Transaction, userId: string, amount: number): Promise<number> {
  if (amount <= 0) return 0;
  const debts = await tx
    .select()
    .from(rewardDebts)
    .where(and(eq(rewardDebts.userId, userId), gt(rewardDebts.remaining, 0)))
    .orderBy(asc(rewardDebts.createdAt), asc(rewardDebts.id))
    .for("update");
  let left = amount;
  for (const debt of debts) {
    if (left === 0) break;
    const take = Math.min(left, debt.remaining);
    await tx
      .update(rewardDebts)
      .set({ remaining: debt.remaining - take, updatedAt: sql`now()` })
      .where(eq(rewardDebts.id, debt.id));
    left -= take;
  }
  return amount - left;
}

// --- Reconciliation -------------------------------------------------------------------------------

export interface PointsReconcileResult {
  wallets: number;
  drifted: number;
  /** At most `PointsReconcileOptions.reportLimit` wallet ids, for the alert. */
  walletIds: string[];
}

/**
 * Compares every wallet bucket with the sum of its ledger rows of that bucket. A wallet change and
 * its rows commit together, so a mismatch means a bug or a manual edit, never a race: each query is
 * one statement (one snapshot).
 */
export async function reconcilePoints(db: Database, reportLimit = 50): Promise<PointsReconcileResult> {
  const drift = sql`
    from points_wallets w
    left join (
      select wallet_id,
        coalesce(sum(amount) filter (where bucket = 'pending'), 0) as pending,
        coalesce(sum(amount) filter (where bucket = 'cash'), 0) as cash,
        coalesce(sum(amount) filter (where bucket = 'credit_only'), 0) as credit_only
      from points_ledger group by wallet_id
    ) l on l.wallet_id = w.id
  `;
  const mismatch = sql`(
    w.pending <> coalesce(l.pending, 0) or w.cash <> coalesce(l.cash, 0)
    or w.credit_only <> coalesce(l.credit_only, 0)
  )`;
  const totals = await db.execute<{ wallets: number; drifted: number }>(sql`
    select count(*)::int as wallets, (count(*) filter (where ${mismatch}))::int as drifted ${drift}
  `);
  const { wallets = 0, drifted = 0 } = totals[0] ?? {};
  let walletIds: string[] = [];
  if (drifted > 0) {
    const rows = await db.execute<{ id: string }>(sql`
      select w.id ${drift} where ${mismatch} order by w.id limit ${reportLimit}
    `);
    walletIds = rows.map((row) => row.id);
  }
  return { wallets, drifted, walletIds };
}
