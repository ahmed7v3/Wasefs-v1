import { Inject, Injectable } from "@nestjs/common";
import { waOutbox, type WaOutboxRow } from "@wasfa/db";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { WaOutboxKind } from "@wasfa/shared/schemas/wa-agent";

/** A row `delivering` for longer than this belongs to a crashed deliverer and is handed back. */
const STALE_DELIVERING_MS = 2 * 60_000;

export interface NewOutboxRow {
  conversationId: string;
  kind: WaOutboxKind;
  refId: string | null;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  paidWork: boolean;
}

/**
 * Every SQL statement of `wa_outbox` (docs/WA-AGENT-RUNTIME.md §9, §17.1). Each transition is a
 * conditional update on the state it expects, so a duplicate event or a second deliverer changes nothing.
 */
@Injectable()
export class WaOutboxRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `waiting` -> `ready` for the result route of an analysis; the row, or null when there is no waiting route. */
  async routeResult(rxId: string, payload: Record<string, unknown>): Promise<WaOutboxRow | null> {
    const [row] = await this.handle.db
      .update(waOutbox)
      .set({ state: "ready", payload, nextAttemptAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(waOutbox.kind, "rx_result"),
          eq(waOutbox.refId, rxId),
          eq(waOutbox.state, "waiting"),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Whether a route (in any state) exists for the analysis. */
  async hasRoute(rxId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: waOutbox.id })
      .from(waOutbox)
      .where(and(eq(waOutbox.kind, "rx_result"), eq(waOutbox.refId, rxId)))
      .limit(1);
    return row !== undefined;
  }

  /** A `ready` row; a repeated key does nothing (null). */
  async insertReady(row: NewOutboxRow): Promise<WaOutboxRow | null> {
    const [created] = await this.handle.db
      .insert(waOutbox)
      .values({ ...row, state: "ready" })
      .onConflictDoNothing({ target: waOutbox.idempotencyKey })
      .returning();
    return created ?? null;
  }

  /** Gives the rows of a crashed deliverer back; returns how many. */
  async recoverStale(): Promise<number> {
    const rows = await this.handle.db
      .update(waOutbox)
      .set({ state: "ready", updatedAt: sql`now()` })
      .where(
        and(
          eq(waOutbox.state, "delivering"),
          lte(waOutbox.updatedAt, sql`now() - ${STALE_DELIVERING_MS} * interval '1 millisecond'`),
        ),
      )
      .returning({ id: waOutbox.id });
    return rows.length;
  }

  /**
   * Due rows (`ready`, and `held` ones whose re-check time came) -> `delivering`, in one transaction.
   * `skip locked`: two deliverers never claim the same row.
   */
  async claimDue(limit: number, conversationId?: string): Promise<WaOutboxRow[]> {
    return this.handle.db.transaction(async (tx) => {
      const due = await tx
        .select({ id: waOutbox.id })
        .from(waOutbox)
        .where(
          and(
            inArray(waOutbox.state, ["ready", "held"]),
            lte(waOutbox.nextAttemptAt, sql`now()`),
            conversationId === undefined ? undefined : eq(waOutbox.conversationId, conversationId),
          ),
        )
        .orderBy(asc(waOutbox.nextAttemptAt), asc(waOutbox.id))
        .limit(limit)
        .for("update", { skipLocked: true });
      if (due.length === 0) return [];
      return tx
        .update(waOutbox)
        .set({ state: "delivering", updatedAt: sql`now()` })
        .where(
          inArray(
            waOutbox.id,
            due.map((row) => row.id),
          ),
        )
        .returning();
    });
  }

  /** The customer wrote again: the chat's held items are due now. */
  async releaseHeld(conversationId: string): Promise<number> {
    const rows = await this.handle.db
      .update(waOutbox)
      .set({ state: "ready", nextAttemptAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(waOutbox.conversationId, conversationId), eq(waOutbox.state, "held")))
      .returning({ id: waOutbox.id });
    return rows.length;
  }

  /** Back to `ready` later, without counting an attempt (lock busy, stale fence). */
  async requeue(id: string, delayMs: number): Promise<void> {
    await this.set(id, "ready", { delayMs });
  }

  /** Nothing may be sent now; looked at again after `recheckMs` (or when the customer writes). */
  async hold(id: string, recheckMs: number): Promise<void> {
    await this.set(id, "held", { delayMs: recheckMs });
  }

  async markDelivered(id: string): Promise<void> {
    await this.handle.db
      .update(waOutbox)
      .set({ state: "delivered", deliveredAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
      .where(and(eq(waOutbox.id, id), eq(waOutbox.state, "delivering")));
  }

  /** A failed attempt: `ready` again after `delayMs`, the error class kept. */
  async retry(id: string, attempts: number, delayMs: number, errorClass: string): Promise<void> {
    await this.set(id, "ready", { delayMs, attempts, errorClass });
  }

  async markDead(id: string, attempts: number, errorClass: string): Promise<void> {
    await this.set(id, "dead", { attempts, errorClass });
  }

  private async set(
    id: string,
    state: "ready" | "held" | "dead",
    change: { delayMs?: number; attempts?: number; errorClass?: string },
  ): Promise<void> {
    await this.handle.db
      .update(waOutbox)
      .set({
        state,
        updatedAt: sql`now()`,
        ...(change.delayMs === undefined
          ? {}
          : { nextAttemptAt: sql`now() + ${change.delayMs} * interval '1 millisecond'` }),
        ...(change.attempts === undefined ? {} : { attempts: change.attempts }),
        ...(change.errorClass === undefined ? {} : { lastError: change.errorClass }),
      })
      .where(and(eq(waOutbox.id, id), eq(waOutbox.state, "delivering")));
  }
}
