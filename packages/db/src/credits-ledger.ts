import { and, asc, eq, lte, sql } from "drizzle-orm";

import { isUniqueViolation } from "./pg-errors.js";
import {
  creditLedger,
  creditReservations,
  creditWallets,
  type CreditLedgerEntry,
  type CreditReservation,
  type CreditWallet,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { CreditLedgerKind } from "@wasfa/shared/ai";

/*
 * The credits state machine (phase2.md, Decisions 4 and 5): reserve -> settle -> release, plus
 * grants, adjustments and refunds. It is plain functions over a `Database` so the API (CreditsRepo)
 * and the worker (monthly grants, the sweeper) run the very same transactions.
 *
 * Rules every operation follows:
 *  - One operation = one transaction. The WALLET row is locked first (`FOR UPDATE`), then the
 *    reservation row: a single lock order, so concurrent operations never deadlock.
 *  - `credit_wallets.balance` changes only together with the `credit_ledger` row that explains it,
 *    in the same transaction, and `balance_after` is stored on that row. SUM(amount) of a wallet's
 *    ledger always equals its balance.
 *  - Every ledger row has an idempotency key; a retried operation finds its row and returns it
 *    without changing anything. The check happens under the wallet lock, so a race cannot slip by.
 *  - Credits are integers. The ledger is append-only (the `wasfa_api` role cannot UPDATE it).
 */

export interface WalletOwner {
  type: "user" | "org";
  id: string;
}

export type LedgerErrorReason =
  | "insufficient_credits"
  | "insufficient_balance"
  | "idempotency_key_reused"
  | "reservation_not_found"
  | "invalid_amount";

/** An expected refusal; the API turns it into an `AppError`, the worker just logs it. */
export class LedgerError extends Error {
  constructor(readonly reason: LedgerErrorReason) {
    super(`Credit ledger refused: ${reason}`);
    this.name = "LedgerError";
  }
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export const RESERVATION_DEFAULT_TTL_SECONDS = 900;
const SWEEP_DEFAULT_LIMIT = 500;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const IDEMPOTENCY_KEY_CONSTRAINT = "credit_ledger_idempotency_key_key";

export interface LedgerWrite {
  entry: CreditLedgerEntry;
  walletId: string;
  balanceBefore: number;
  balanceAfter: number;
  /** True when the idempotency key was already used: nothing changed. */
  replayed: boolean;
}

export interface ReservationResult {
  reservation: CreditReservation;
  /** True when the idempotency key was already used: the existing reservation is returned. */
  replayed: boolean;
}

export interface SettleResult {
  reservation: CreditReservation;
  /** False when the reservation was already closed: nothing changed. */
  changed: boolean;
  /** Credits actually charged (the actual, capped at the reserved amount). */
  charged: number;
  /** Credits the call used beyond its reservation; they are not charged (the caller logs a warning). */
  overage: number;
}

export interface ReleaseResult {
  reservation: CreditReservation;
  changed: boolean;
}

const ownerValues = (owner: WalletOwner) =>
  owner.type === "user" ? { ownerUserId: owner.id } : { ownerOrgId: owner.id };

const ownerCondition = (owner: WalletOwner) =>
  owner.type === "user"
    ? eq(creditWallets.ownerUserId, owner.id)
    : eq(creditWallets.ownerOrgId, owner.id);

function requirePositive(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError("invalid_amount");
}

/** The wallet of `owner`, created on first use, locked until the transaction ends. */
async function lockOwnerWallet(tx: Transaction, owner: WalletOwner): Promise<CreditWallet> {
  const lock = () => tx.select().from(creditWallets).where(ownerCondition(owner)).for("update");
  const [existing] = await lock();
  if (existing) return existing;
  // Two first uses can race: the loser's insert does nothing and its re-select waits for the winner.
  await tx
    .insert(creditWallets)
    .values({ ...ownerValues(owner), balance: 0 })
    .onConflictDoNothing();
  const [created] = await lock();
  if (!created) throw new Error("Wallet could not be created");
  return created;
}

async function lockWalletById(tx: Transaction, walletId: string): Promise<CreditWallet> {
  const [wallet] = await tx
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.id, walletId))
    .for("update");
  if (!wallet) throw new Error("Wallet disappeared");
  return wallet;
}

async function findByKey(tx: Transaction, key: string): Promise<CreditLedgerEntry | undefined> {
  const [row] = await tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, key));
  return row;
}

interface NewEntry {
  kind: CreditLedgerKind;
  amount: number;
  idempotencyKey: string;
  reservationId?: string | undefined;
  aiUsageId?: string | undefined;
  actorId?: string | undefined;
  reason?: string | undefined;
}

/** Appends one ledger row and moves the (already locked) wallet's balance by the same amount. */
async function append(
  tx: Transaction,
  wallet: CreditWallet,
  balance: number,
  entry: NewEntry,
): Promise<{ row: CreditLedgerEntry; balance: number }> {
  const balanceAfter = balance + entry.amount;
  const [row] = await tx
    .insert(creditLedger)
    .values({
      walletId: wallet.id,
      kind: entry.kind,
      amount: entry.amount,
      balanceAfter,
      reservationId: entry.reservationId ?? null,
      aiUsageId: entry.aiUsageId ?? null,
      actorId: entry.actorId ?? null,
      reason: entry.reason ?? null,
      idempotencyKey: entry.idempotencyKey,
    })
    .returning();
  if (!row) throw new Error("Ledger row was not stored");
  await tx
    .update(creditWallets)
    .set({ balance: balanceAfter, updatedAt: sql`now()` })
    .where(eq(creditWallets.id, wallet.id));
  return { row, balance: balanceAfter };
}

/**
 * Runs one operation in a transaction. If two callers still collide on an idempotency key (it
 * cannot happen for the same wallet, which is locked, but the keys are caller-chosen), the loser's
 * transaction rolled back, and running it once more finds the winner's row and returns it.
 */
async function transact<T>(db: Database, run: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(run);
  } catch (error) {
    if (!isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) throw error;
    return db.transaction(run);
  }
}

/** The wallet of `owner`, created on first use. */
export async function ensureWallet(db: Database, owner: WalletOwner): Promise<CreditWallet> {
  return db.transaction((tx) => lockOwnerWallet(tx, owner));
}

function writeResult(
  walletId: string,
  entry: CreditLedgerEntry,
  balanceBefore: number,
  replayed: boolean,
): LedgerWrite {
  return { entry, walletId, balanceBefore, balanceAfter: entry.balanceAfter, replayed };
}

/** A replayed key must belong to the same wallet; a clash across wallets is a caller bug. */
function sameWallet(existing: CreditLedgerEntry, wallet: CreditWallet): void {
  if (existing.walletId !== wallet.id) throw new LedgerError("idempotency_key_reused");
}

/**
 * Holds `amount` credits for an in-flight call. `insufficient_credits` when the balance is lower.
 * A retry with the same `idempotencyKey` returns the original reservation and holds nothing more.
 */
export async function reserve(
  db: Database,
  owner: WalletOwner,
  amount: number,
  options: {
    idempotencyKey: string;
    purpose: string;
    ttlSeconds?: number;
    now?: Date;
  },
): Promise<ReservationResult> {
  requirePositive(amount);
  const key = `reserve:${options.idempotencyKey}`;
  return transact(db, async (tx) => {
    const wallet = await lockOwnerWallet(tx, owner);
    const existing = await findByKey(tx, key);
    if (existing) {
      sameWallet(existing, wallet);
      const [reservation] = existing.reservationId
        ? await tx
            .select()
            .from(creditReservations)
            .where(eq(creditReservations.id, existing.reservationId))
        : [];
      if (!reservation) throw new Error("Reservation of a stored ledger row is missing");
      return { reservation, replayed: true };
    }
    if (wallet.balance < amount) throw new LedgerError("insufficient_credits");

    const now = options.now ?? new Date();
    const ttlMs = (options.ttlSeconds ?? RESERVATION_DEFAULT_TTL_SECONDS) * 1_000;
    const [reservation] = await tx
      .insert(creditReservations)
      .values({
        walletId: wallet.id,
        amount,
        purpose: options.purpose,
        status: "open",
        expiresAt: new Date(now.getTime() + ttlMs),
      })
      .returning();
    if (!reservation) throw new Error("Reservation was not stored");
    await append(tx, wallet, wallet.balance, {
      kind: "usage_reserve",
      amount: -amount,
      idempotencyKey: key,
      reservationId: reservation.id,
      reason: options.purpose,
    });
    return { reservation, replayed: false };
  });
}

/** Wallet first, then the reservation: the single lock order. `undefined` when it does not exist. */
async function lockReservation(
  tx: Transaction,
  reservationId: string,
): Promise<{ wallet: CreditWallet; reservation: CreditReservation } | undefined> {
  const [head] = await tx
    .select({ walletId: creditReservations.walletId })
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId));
  if (!head) return undefined;
  const wallet = await lockWalletById(tx, head.walletId);
  const [reservation] = await tx
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId))
    .for("update");
  return reservation ? { wallet, reservation } : undefined;
}

/**
 * Closes an open reservation with the actual cost: returns the whole hold (`release` row), then
 * charges `min(actual, reserved)` (`usage_settle` row). A closed reservation is returned as is.
 */
export async function settle(
  db: Database,
  reservationId: string,
  actual: number,
  options: { aiUsageId?: string } = {},
): Promise<SettleResult> {
  if (!Number.isSafeInteger(actual) || actual < 0) throw new LedgerError("invalid_amount");
  return transact(db, async (tx) => {
    const locked = await lockReservation(tx, reservationId);
    if (!locked) throw new LedgerError("reservation_not_found");
    const { wallet, reservation } = locked;
    if (reservation.status !== "open") {
      return { reservation, changed: false, charged: reservation.settledAmount ?? 0, overage: 0 };
    }

    const charged = Math.min(actual, reservation.amount);
    let balance = wallet.balance;
    balance = (
      await append(tx, wallet, balance, {
        kind: "release",
        amount: reservation.amount,
        idempotencyKey: `release:${reservation.id}`,
        reservationId: reservation.id,
        reason: "settled",
      })
    ).balance;
    if (charged > 0) {
      await append(tx, wallet, balance, {
        kind: "usage_settle",
        amount: -charged,
        idempotencyKey: `settle:${reservation.id}`,
        reservationId: reservation.id,
        aiUsageId: options.aiUsageId,
      });
    }
    const [updated] = await tx
      .update(creditReservations)
      .set({ status: "settled", settledAmount: charged, updatedAt: sql`now()` })
      .where(eq(creditReservations.id, reservation.id))
      .returning();
    if (!updated) throw new Error("Reservation was not updated");
    return { reservation: updated, changed: true, charged, overage: actual - charged };
  });
}

async function releaseLocked(
  tx: Transaction,
  locked: { wallet: CreditWallet; reservation: CreditReservation },
  status: "released" | "expired",
  reason: string,
): Promise<ReleaseResult> {
  const { wallet, reservation } = locked;
  if (reservation.status !== "open") return { reservation, changed: false };
  await append(tx, wallet, wallet.balance, {
    kind: "release",
    amount: reservation.amount,
    idempotencyKey: `release:${reservation.id}`,
    reservationId: reservation.id,
    reason,
  });
  const [updated] = await tx
    .update(creditReservations)
    .set({ status, settledAmount: 0, updatedAt: sql`now()` })
    .where(eq(creditReservations.id, reservation.id))
    .returning();
  if (!updated) throw new Error("Reservation was not updated");
  return { reservation: updated, changed: true };
}

/** Returns an open reservation's whole hold (a failed call). A closed reservation is returned as is. */
export async function release(
  db: Database,
  reservationId: string,
  reason = "released",
): Promise<ReleaseResult> {
  return transact(db, async (tx) => {
    const locked = await lockReservation(tx, reservationId);
    if (!locked) throw new LedgerError("reservation_not_found");
    return releaseLocked(tx, locked, "released", reason);
  });
}

export interface SweepResult {
  released: number;
  failed: number;
}

/**
 * Releases open reservations past their expiry (a crashed job never settled or released them).
 * Each one is its own transaction, so one bad row never blocks the others; whatever is left over
 * is picked up by the next run.
 */
export async function sweepExpired(
  db: Database,
  now: Date,
  limit = SWEEP_DEFAULT_LIMIT,
): Promise<SweepResult> {
  const due = await db
    .select({ id: creditReservations.id })
    .from(creditReservations)
    .where(and(eq(creditReservations.status, "open"), lte(creditReservations.expiresAt, now)))
    .orderBy(asc(creditReservations.expiresAt))
    .limit(limit);

  const outcome: SweepResult = { released: 0, failed: 0 };
  for (const { id } of due) {
    try {
      const result = await transact(db, async (tx) => {
        const locked = await lockReservation(tx, id);
        // A settle that won the wallet lock first closed it; an extended one is not due any more.
        if (!locked || locked.reservation.expiresAt.getTime() > now.getTime()) {
          return { changed: false };
        }
        return releaseLocked(tx, locked, "expired", "expired");
      });
      if (result.changed) outcome.released++;
    } catch {
      // Driver messages can quote row values; the caller only needs to know that one failed.
      outcome.failed++;
    }
  }
  return outcome;
}

/** Applies a signed change under the lock; `refuseBelowZero` turns an overdraw into a refusal. */
async function writeEntry(
  db: Database,
  owner: WalletOwner,
  entry: NewEntry,
  refuseBelowZero: boolean,
): Promise<LedgerWrite> {
  return transact(db, async (tx) => {
    const wallet = await lockOwnerWallet(tx, owner);
    const existing = await findByKey(tx, entry.idempotencyKey);
    if (existing) {
      sameWallet(existing, wallet);
      return writeResult(wallet.id, existing, existing.balanceAfter - existing.amount, true);
    }
    if (refuseBelowZero && wallet.balance + entry.amount < 0) {
      throw new LedgerError("insufficient_balance");
    }
    const { row } = await append(tx, wallet, wallet.balance, entry);
    return writeResult(wallet.id, row, wallet.balance, false);
  });
}

/** An admin's manual correction. A retry with the same key changes nothing. */
export async function adjust(
  db: Database,
  owner: WalletOwner,
  delta: number,
  options: { reason: string; actorId: string; idempotencyKey: string },
): Promise<LedgerWrite> {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new LedgerError("invalid_amount");
  return writeEntry(
    db,
    owner,
    {
      kind: "admin_adjust",
      amount: delta,
      idempotencyKey: `adjust:${options.idempotencyKey}`,
      actorId: options.actorId,
      reason: options.reason,
    },
    true,
  );
}

/** The monthly plan grant for `period` (`YYYY-MM`, UTC): at most once per owner and period. */
export async function grant(
  db: Database,
  owner: WalletOwner,
  amount: number,
  period: string,
): Promise<LedgerWrite> {
  requirePositive(amount);
  if (!PERIOD_PATTERN.test(period)) throw new Error("period must be YYYY-MM");
  return writeEntry(
    db,
    owner,
    {
      kind: "grant",
      amount,
      idempotencyKey: `grant:${owner.type}:${owner.id}:${period}`,
      reason: `monthly:${period}`,
    },
    false,
  );
}

/**
 * Expires the unused part of the monthly grant of `period` (`YYYY-MM`, the month that just ended),
 * right before the next grant. The rule: expire min(current balance, that period's grant amount).
 * The balance is what is left after every spend (credits held by open reservations are already out
 * of it), so a user never loses more than the free credits they were given for that month, and
 * credits topped up by an admin or refunded beyond the grant survive. Nothing is written when the
 * owner has no grant for the period or nothing is left. Idempotent per wallet and period.
 */
export async function expireUnused(
  db: Database,
  owner: WalletOwner,
  period: string,
): Promise<LedgerWrite | null> {
  if (!PERIOD_PATTERN.test(period)) throw new Error("period must be YYYY-MM");
  return transact(db, async (tx) => {
    const wallet = await lockOwnerWallet(tx, owner);
    const key = `expiry:${wallet.id}:${period}`;
    const existing = await findByKey(tx, key);
    if (existing) return writeResult(wallet.id, existing, existing.balanceAfter - existing.amount, true);

    const granted = await findByKey(tx, `grant:${owner.type}:${owner.id}:${period}`);
    if (!granted || granted.amount <= 0) return null;
    const amount = Math.min(wallet.balance, granted.amount);
    if (amount <= 0) return null;
    const { row } = await append(tx, wallet, wallet.balance, {
      kind: "expiry",
      amount: -amount,
      idempotencyKey: key,
      reason: `expired:${period}`,
    });
    return writeResult(wallet.id, row, wallet.balance, false);
  });
}

/** Gives credits back ("no result, no charge"). A retry with the same key changes nothing. */
export async function refund(
  db: Database,
  owner: WalletOwner,
  amount: number,
  options: { reason: string; idempotencyKey: string; reservationId?: string },
): Promise<LedgerWrite> {
  requirePositive(amount);
  return writeEntry(
    db,
    owner,
    {
      kind: "refund",
      amount,
      idempotencyKey: `refund:${options.idempotencyKey}`,
      reason: options.reason,
      reservationId: options.reservationId,
    },
    false,
  );
}

/** `YYYY-MM` of a moment, in UTC: the grant period. */
export function grantPeriod(now: Date): string {
  return now.toISOString().slice(0, 7);
}
