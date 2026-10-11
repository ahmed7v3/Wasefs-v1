import { CREDIT_LEDGER_KINDS, CREDIT_RESERVATION_STATUSES } from "@wasfa/shared/ai";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { aiUsage } from "./ai.js";
import { idColumn, inList, timestamps } from "./columns.js";
import { ownerCheck, ownerColumns } from "./owner.js";
import { users } from "./users.js";

/*
 * Credits are plain integers. A wallet belongs to one user or one organization. `balance` is only
 * ever changed in the same transaction as the `credit_ledger` row that explains it, under
 * `SELECT ... FOR UPDATE`; a nightly job reconciles it against the ledger sum.
 */
export const creditWallets = pgTable(
  "credit_wallets",
  {
    id: idColumn(),
    ...ownerColumns(),
    balance: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("credit_wallets", table),
    // One wallet per owner (NULLs are distinct, so each constraint covers its own column).
    unique("credit_wallets_owner_user_key").on(table.ownerUserId),
    unique("credit_wallets_owner_org_key").on(table.ownerOrgId),
    check("credit_wallets_balance_check", sql`${table.balance} >= 0`),
  ],
);

/** Credits held for an in-flight call: reserve the worst case, settle the actual, release the rest. */
export const creditReservations = pgTable(
  "credit_reservations",
  {
    id: idColumn(),
    walletId: uuid()
      .notNull()
      .references(() => creditWallets.id, { onDelete: "restrict" }),
    amount: integer().notNull(),
    // Null until settled; never above the reserved amount.
    settledAmount: integer(),
    status: text({ enum: CREDIT_RESERVATION_STATUSES }).notNull().default("open"),
    purpose: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    check("credit_reservations_amount_check", sql`${table.amount} > 0`),
    check(
      "credit_reservations_settled_amount_check",
      sql`${table.settledAmount} is null or (${table.settledAmount} >= 0 and ${table.settledAmount} <= ${table.amount})`,
    ),
    check("credit_reservations_status_check", inList(table.status, CREDIT_RESERVATION_STATUSES)),
    // The sweeper that releases expired reservations only looks at open ones.
    index("credit_reservations_open_expires_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} = 'open'`),
  ],
);

/*
 * Append-only financial record, kept forever: the `wasfa_api` role has SELECT and INSERT only
 * (migration 0008, like `audit_logs`). `amount` is signed (negative = credits spent); a correction
 * is a new row, never an edit. `idempotency_key` makes a retried operation a no-op.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: idColumn(),
    walletId: uuid()
      .notNull()
      .references(() => creditWallets.id, { onDelete: "restrict" }),
    kind: text({ enum: CREDIT_LEDGER_KINDS }).notNull(),
    amount: integer().notNull(),
    balanceAfter: integer().notNull(),
    reservationId: uuid().references(() => creditReservations.id, { onDelete: "restrict" }),
    aiUsageId: uuid().references(() => aiUsage.id, { onDelete: "set null" }),
    // Who did it (an admin for `admin_adjust`); null for system entries.
    actorId: uuid().references(() => users.id, { onDelete: "set null" }),
    reason: text(),
    idempotencyKey: text().notNull().unique("credit_ledger_idempotency_key_key"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("credit_ledger_kind_check", inList(table.kind, CREDIT_LEDGER_KINDS)),
    check("credit_ledger_amount_check", sql`${table.amount} <> 0`),
    check("credit_ledger_balance_after_check", sql`${table.balanceAfter} >= 0`),
    index("credit_ledger_wallet_created_idx").on(table.walletId, table.createdAt),
  ],
);

export type CreditWallet = typeof creditWallets.$inferSelect;
export type NewCreditWallet = typeof creditWallets.$inferInsert;
export type CreditReservation = typeof creditReservations.$inferSelect;
export type NewCreditReservation = typeof creditReservations.$inferInsert;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;
