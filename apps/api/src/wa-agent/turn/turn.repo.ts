import { Inject, Injectable } from "@nestjs/common";
import {
  insertOutbound,
  waConversations,
  waMessages,
  waTurns,
  type OutboundPartRow,
  type TurnMessage,
  type WaTurn,
} from "@wasfa/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import { StaleFenceError } from "./lock.js";

import type { StepTrace, TurnTraceStep } from "./agent-round.js";
import type { FailureClass, WaTurnState } from "@wasfa/shared/wa-agent/failure";

type Tx = Parameters<Parameters<DbHandle["db"]["transaction"]>[0]>[0];

/** Unanswered customer messages one round reads (a long silence followed by a flood is cut here). */
const UNANSWERED_LIMIT = 50;

const LIVE_STATES = ["queued", "running", "deferred"] as const;

export interface TurnEnd {
  conversationId: string;
  turnId: string;
  fence: number;
  /** The inbound rows this turn answers (linked in the same transaction). */
  inboundIds: readonly string[];
  costUsdMicros: number;
  trace: readonly TurnTraceStep[];
  /** Per model call (`wa_turns.trace.steps`). */
  steps?: readonly StepTrace[];
  /** Failure end: the class and the `WSF-` reference stored on the turn. */
  causeClass?: FailureClass;
  errorRef?: string;
  /** The turn already waited once for the customer-text limit (read back by the next run). */
  rateDeferred?: boolean;
  /** False for a deferral: the inbound rows stay unlinked so the retry answers them (section 17.5). */
  link?: boolean;
}

/**
 * Every SQL statement of the v2 turn engine (docs/WA-AGENT-RUNTIME.md §17). The writes that end a turn
 * run in one transaction that first locks the conversation row and compares its `turn_fence` with the
 * turn's: a holder that lost the lock is refused with `StaleFenceError` and changes nothing.
 */
@Injectable()
export class TurnRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Takes the conversation's next fence; call right after the Redis lock was acquired. */
  async bumpFence(conversationId: string): Promise<number> {
    const [row] = await this.handle.db
      .update(waConversations)
      .set({ turnFence: sql`${waConversations.turnFence} + 1` })
      .where(eq(waConversations.id, conversationId))
      .returning({ fence: waConversations.turnFence });
    if (row === undefined) throw new Error("conversation not found");
    return row.fence;
  }

  /** Customer messages no reply was queued for yet, oldest first (owner rows are `direction = 'owner'`). */
  async unanswered(conversationId: string): Promise<TurnMessage[]> {
    return this.handle.db
      .select({
        id: waMessages.id,
        direction: waMessages.direction,
        kind: waMessages.kind,
        text: waMessages.text,
        mediaKey: waMessages.mediaKey,
        mediaMime: waMessages.mediaMime,
        mediaBytes: waMessages.mediaBytes,
        createdAt: waMessages.createdAt,
        answered: sql<boolean>`false`,
      })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "in"),
          isNull(waMessages.turnId),
        ),
      )
      .orderBy(asc(waMessages.createdAt), asc(waMessages.id))
      .limit(UNANSWERED_LIMIT);
  }

  /** When the oldest customer message still waiting for an answer arrived; null when none waits. */
  async oldestUnansweredAt(conversationId: string): Promise<Date | null> {
    const [row] = await this.handle.db
      .select({ createdAt: waMessages.createdAt })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "in"),
          isNull(waMessages.turnId),
        ),
      )
      .orderBy(asc(waMessages.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  }

  async hasUnanswered(conversationId: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: waMessages.id })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "in"),
          isNull(waMessages.turnId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * The turn this run works on: the conversation's latest live turn again (a retry; `attempt + 1`) or a
   * new one, `running` under `fence` for `inboundIds`.
   */
  async begin(
    conversationId: string,
    fence: number,
    inboundIds: readonly string[],
  ): Promise<WaTurn> {
    return this.handle.db.transaction(async (tx) => {
      const [live] = await tx
        .select({ id: waTurns.id })
        .from(waTurns)
        .where(
          and(eq(waTurns.conversationId, conversationId), inArray(waTurns.state, [...LIVE_STATES])),
        )
        .orderBy(desc(waTurns.startedAt))
        .limit(1)
        .for("update");
      if (live !== undefined) {
        const [row] = await tx
          .update(waTurns)
          .set({
            state: "running",
            fence,
            inboundIds: [...inboundIds],
            attempt: sql`${waTurns.attempt} + 1`,
          })
          .where(eq(waTurns.id, live.id))
          .returning();
        if (row === undefined) throw new Error("turn vanished");
        return row;
      }
      const [row] = await tx
        .insert(waTurns)
        .values({ conversationId, state: "running", fence, inboundIds: [...inboundIds] })
        .returning();
      if (row === undefined) throw new Error("turn not created");
      return row;
    });
  }

  /**
   * Queues the reply rows, links the inbound rows and closes the turn `replied`, all under the fence.
   * Returns the new rows' ids in order; the caller adds the stream entry only after this returned.
   */
  async commitReply(
    end: TurnEnd,
    parts: readonly OutboundPartRow[],
    state: WaTurnState = "replied",
  ): Promise<string[]> {
    return this.handle.db.transaction(async (tx) => {
      await assertFence(tx, end.conversationId, end.fence);
      const ids = await insertOutbound(tx, end.conversationId, parts, end.turnId);
      await this.finish(tx, end, state);
      return ids;
    });
  }

  /** Closes a turn that sends nothing (`dropped_policy`), linking its inbound rows, under the fence. */
  async closeQuietly(end: TurnEnd, state: WaTurnState): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await assertFence(tx, end.conversationId, end.fence);
      await this.finish(tx, end, state);
    });
  }

  /**
   * The stream entry could not be added after `commitReply`: unlink the inbound rows and reopen the turn,
   * so the retry answers them (otherwise the customer would be left in silence with the rows marked done).
   */
  async reopen(end: Pick<TurnEnd, "turnId" | "fence">): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await tx
        .update(waMessages)
        .set({ turnId: null })
        .where(and(eq(waMessages.turnId, end.turnId), eq(waMessages.direction, "in")));
      await tx
        .update(waTurns)
        .set({ state: "running", endedAt: null })
        .where(and(eq(waTurns.id, end.turnId), eq(waTurns.fence, end.fence)));
    });
  }

  private async finish(tx: Tx, end: TurnEnd, state: WaTurnState): Promise<void> {
    const live = state === "deferred";
    if (end.inboundIds.length > 0 && end.link !== false) {
      await tx
        .update(waMessages)
        .set({ turnId: end.turnId })
        .where(and(inArray(waMessages.id, [...end.inboundIds]), isNull(waMessages.turnId)));
    }
    const [closed] = await tx
      .update(waTurns)
      .set({
        state,
        // A deferred turn is still live: its retry reuses the row.
        endedAt: live ? null : new Date(),
        costUsdMicros: end.costUsdMicros,
        causeClass: end.causeClass ?? null,
        errorRef: end.errorRef ?? null,
        trace: {
          steps: end.steps ?? [],
          events: end.trace,
          ...(end.rateDeferred === true ? { rateDeferred: true } : {}),
        },
      })
      .where(and(eq(waTurns.id, end.turnId), eq(waTurns.fence, end.fence)))
      .returning({ id: waTurns.id });
    if (closed === undefined) throw new StaleFenceError(end.conversationId);
  }
}

/** Locks the conversation row and compares its fence: a bump by the next holder waits for our commit. */
async function assertFence(tx: Tx, conversationId: string, fence: number): Promise<void> {
  const [row] = await tx
    .select({ fence: waConversations.turnFence })
    .from(waConversations)
    .where(eq(waConversations.id, conversationId))
    .for("no key update");
  if (row?.fence !== fence) throw new StaleFenceError(conversationId);
}
