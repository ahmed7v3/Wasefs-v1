import { Inject, Injectable } from "@nestjs/common";
import {
  adjust as adjustLedger,
  creditLedger,
  creditWallets,
  ensureWallet as ensureLedgerWallet,
  grant as grantLedger,
  organizations,
  refund as refundLedger,
  release as releaseLedger,
  reserve as reserveLedger,
  settle as settleLedger,
  sweepExpired as sweepLedger,
  users,
  type CreditLedgerEntry,
  type CreditWallet,
  type LedgerWrite,
  type ReleaseResult,
  type ReservationResult,
  type SettleResult,
  type SweepResult,
  type WalletOwner,
} from "@wasfa/db";
import { and, desc, eq, gte, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { afterCursor, escapeLike, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

export interface LedgerRow extends CreditLedgerEntry {
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface WalletRow {
  id: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  balance: number;
  updatedAt: Date;
  ownerName: string | null;
  ownerEmail: string | null;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

const creditLedgerColumns = {
  id: creditLedger.id,
  walletId: creditLedger.walletId,
  kind: creditLedger.kind,
  amount: creditLedger.amount,
  balanceAfter: creditLedger.balanceAfter,
  reservationId: creditLedger.reservationId,
  aiUsageId: creditLedger.aiUsageId,
  actorId: creditLedger.actorId,
  reason: creditLedger.reason,
  idempotencyKey: creditLedger.idempotencyKey,
  createdAt: creditLedger.createdAt,
};

/**
 * Every query of the credits module. The state machine itself (reserve, settle, release, ...) is
 * `@wasfa/db`'s `credits-ledger`, shared with the worker so both run the very same transactions.
 */
@Injectable()
export class CreditsRepo {
  private readonly userWallets: ScopedRepo<typeof creditWallets>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.userWallets = scopedRepo(handle.db, {
      table: creditWallets,
      scope: creditWallets.ownerUserId,
      id: creditWallets.id,
    });
  }

  ensureWallet(owner: WalletOwner): Promise<CreditWallet> {
    return ensureLedgerWallet(this.handle.db, owner);
  }

  reserve(
    owner: WalletOwner,
    amount: number,
    options: { idempotencyKey: string; purpose: string; ttlSeconds?: number },
  ): Promise<ReservationResult> {
    return reserveLedger(this.handle.db, owner, amount, options);
  }

  settle(
    reservationId: string,
    actual: number,
    options: { aiUsageId?: string } = {},
  ): Promise<SettleResult> {
    return settleLedger(this.handle.db, reservationId, actual, options);
  }

  release(reservationId: string, reason?: string): Promise<ReleaseResult> {
    return releaseLedger(this.handle.db, reservationId, reason);
  }

  sweepExpired(now: Date, limit?: number): Promise<SweepResult> {
    return sweepLedger(this.handle.db, now, limit);
  }

  adjust(
    owner: WalletOwner,
    delta: number,
    options: { reason: string; actorId: string; idempotencyKey: string },
  ): Promise<LedgerWrite> {
    return adjustLedger(this.handle.db, owner, delta, options);
  }

  grant(owner: WalletOwner, amount: number, period: string): Promise<LedgerWrite> {
    return grantLedger(this.handle.db, owner, amount, period);
  }

  refund(
    owner: WalletOwner,
    amount: number,
    options: { reason: string; idempotencyKey: string },
  ): Promise<LedgerWrite> {
    return refundLedger(this.handle.db, owner, amount, options);
  }

  /** The signed-in user's own wallet; `undefined` until it is first used. */
  async personalWallet(userId: string): Promise<CreditWallet | undefined> {
    const [wallet] = await this.userWallets.list(userId);
    return wallet;
  }

  /** Credits the personal wallet of the user spent (settled usage) since `since`; no wallet means 0. */
  async usedSince(userId: string, since: Date): Promise<number> {
    const wallet = await this.personalWallet(userId);
    if (!wallet) return 0;
    const [row] = await this.handle.db
      .select({ total: sql<number>`coalesce(sum(-${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.walletId, wallet.id),
          eq(creditLedger.kind, "usage_settle"),
          gte(creditLedger.createdAt, since),
        ),
      );
    return row?.total ?? 0;
  }

  async findWallet(walletId: string): Promise<CreditWallet | undefined> {
    const [wallet] = await this.handle.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.id, walletId));
    return wallet;
  }

  /** Whether the owner is a real, live account (an anonymized user or a missing organization is not). */
  async ownerExists(owner: WalletOwner): Promise<boolean> {
    if (owner.type === "user") {
      const [row] = await this.handle.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.id, owner.id), isNull(users.anonymizedAt), ne(users.status, "deleted")),
        );
      return row !== undefined;
    }
    const [row] = await this.handle.db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, owner.id));
    return row !== undefined;
  }

  /** `limit + 1` entries of one wallet, newest first. */
  ledgerPage(walletId: string, cursor: Cursor | undefined, limit: number): Promise<LedgerRow[]> {
    const conditions: (SQL | undefined)[] = [eq(creditLedger.walletId, walletId)];
    if (cursor)
      conditions.push(afterCursor(creditLedger.createdAt, creditLedger.id, cursor, "uuid"));
    return this.handle.db
      .select({ ...creditLedgerColumns, cursorAt: stamp(creditLedger.createdAt) })
      .from(creditLedger)
      .where(and(...conditions))
      .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
      .limit(limit + 1);
  }

  /** `limit + 1` wallets with who owns them, newest first. */
  async walletPage(
    q: string | undefined,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<WalletRow[]> {
    const conditions: (SQL | undefined)[] = [];
    if (q !== undefined) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        or(
          ilike(users.name, pattern),
          ilike(users.email, pattern),
          ilike(organizations.name, pattern),
        ),
      );
    }
    if (cursor) {
      conditions.push(afterCursor(creditWallets.createdAt, creditWallets.id, cursor, "uuid"));
    }
    const rows = await this.handle.db
      .select({
        id: creditWallets.id,
        ownerUserId: creditWallets.ownerUserId,
        ownerOrgId: creditWallets.ownerOrgId,
        balance: creditWallets.balance,
        updatedAt: creditWallets.updatedAt,
        userName: users.name,
        orgName: organizations.name,
        ownerEmail: users.email,
        cursorAt: stamp(creditWallets.createdAt),
      })
      .from(creditWallets)
      .leftJoin(users, eq(users.id, creditWallets.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, creditWallets.ownerOrgId))
      .where(and(...conditions))
      .orderBy(desc(creditWallets.createdAt), desc(creditWallets.id))
      .limit(limit + 1);
    // A wallet has exactly one owner, so one of the two names is null.
    return rows.map(({ userName, orgName, ...row }) => ({
      ...row,
      ownerName: userName ?? orgName,
    }));
  }
}
