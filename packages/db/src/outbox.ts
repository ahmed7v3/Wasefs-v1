import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";

import { outbox, type OutboxEntry } from "./schema/billing.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { CustomerMessageInput } from "@wasfa/shared/customer-messages";

/*
 * The transactional outbox (BILLING §5.3). A money change writes its side effects as rows in the
 * same transaction; this drainer runs each one exactly once on the database side: the handler
 * runs in a savepoint of the transaction that marks the row processed, so its database writes
 * (an in-app notification) and the "done" mark commit together. Effects outside the database
 * (queueing a mail) must be idempotent by the entry id, because a crash after them and before the
 * commit runs the handler again.
 */

export type OutboxPostCommitAction =
  | { kind: "alert_delivery"; deliveryId: string; jobId: string }
  | {
      kind: "alert_digest";
      adminUserId: string;
      channel: "email" | "telegram" | "whatsapp";
      windowStart: string;
      delayMs: number;
    }
  | { kind: "customer_message"; payload: CustomerMessageInput; jobId: string };

export type OutboxHandler = (tx: Transaction, entry: OutboxEntry) => Promise<unknown>;

export interface DrainResult {
  processed: number;
  failed: number;
  /** Rows with no handler for their topic yet: parked for a day, never lost. */
  parked: number;
}

/** After this many failures an entry is retried once a day only, and logged by the caller. */
export const OUTBOX_MAX_FAST_ATTEMPTS = 10;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** 1, 2, 4 ... minutes, at most 6 hours; daily after `OUTBOX_MAX_FAST_ATTEMPTS`. */
export function outboxBackoffMs(attempts: number): number {
  if (attempts >= OUTBOX_MAX_FAST_ATTEMPTS) return DAY_MS;
  return Math.min(2 ** Math.max(0, attempts - 1) * MINUTE_MS, 6 * 60 * MINUTE_MS);
}

/** Processes up to `limit` due entries, one transaction each; concurrent drainers skip locked rows. */
export async function drainOutbox(
  db: Database,
  handlers: Readonly<Record<string, OutboxHandler>>,
  now = new Date(),
  limit = 50,
  afterCommit?: (action: OutboxPostCommitAction) => Promise<void>,
): Promise<DrainResult> {
  const result: DrainResult = { processed: 0, failed: 0, parked: 0 };
  for (let i = 0; i < limit; i++) {
    const transactionResult = await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(outbox)
        .where(and(isNull(outbox.processedAt), lte(outbox.availableAt, now)))
        .orderBy(asc(outbox.availableAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!entry) return { outcome: "empty" as const, actions: [] as OutboxPostCommitAction[] };
      const handler = handlers[entry.topic];
      if (!handler) {
        await tx
          .update(outbox)
          .set({ availableAt: new Date(now.getTime() + DAY_MS), lastError: "no_handler" })
          .where(eq(outbox.id, entry.id));
        return { outcome: "parked" as const, actions: [] as OutboxPostCommitAction[] };
      }
      let actions: OutboxPostCommitAction[] | undefined;
      try {
        const handlerResult = await tx.transaction((savepoint) => handler(savepoint, entry));
        if (Array.isArray(handlerResult)) {
          actions = handlerResult as OutboxPostCommitAction[];
        }
      } catch (error) {
        const attempts = entry.attempts + 1;
        await tx
          .update(outbox)
          .set({
            attempts,
            availableAt: new Date(now.getTime() + outboxBackoffMs(attempts)),
            // The error class only: messages can quote row values.
            lastError: error instanceof Error ? error.name.slice(0, 100) : "error",
          })
          .where(eq(outbox.id, entry.id));
        return { outcome: "failed" as const, actions: [] as OutboxPostCommitAction[] };
      }
      await tx
        .update(outbox)
        .set({ processedAt: now, attempts: sql`${outbox.attempts} + 1`, lastError: null })
        .where(eq(outbox.id, entry.id));
      return { outcome: "processed" as const, actions: actions ?? [] };
    });
    const { outcome, actions } = transactionResult;
    if (outcome === "empty") break;
    result[outcome]++;
    if (outcome === "processed" && afterCommit) {
      for (const action of actions) {
        try {
          await afterCommit(action);
        } catch {
          // The pending-delivery sweeper retries a queue add that failed after this commit.
        }
      }
    }
  }
  return result;
}
