import { Inject, Injectable } from "@nestjs/common";
import { waConversations, waToolEffects, type Transaction } from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import { DB, type DbHandle } from "../../../common/database.js";

import { StaleFenceError, type ToolEffectsPort } from "./tool.js";

type Db = DbHandle["db"] | Transaction;

/** `wa_tool_effects` pending row; false when the key already has one. Also used inside the rx start transaction. */
export async function insertPendingEffect(
  db: Db,
  input: { key: string; turnId: string; tool: string },
): Promise<boolean> {
  const rows = await db
    .insert(waToolEffects)
    .values({ key: input.key, turnId: input.turnId, tool: input.tool, state: "pending" })
    .onConflictDoNothing()
    .returning({ key: waToolEffects.key });
  return rows.length > 0;
}

/** Pending to done with the result; a row that is already done keeps the first result. */
export async function markEffectDone(
  db: Db,
  key: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db
    .update(waToolEffects)
    .set({ state: "done", result, updatedAt: new Date() })
    .where(and(eq(waToolEffects.key, key), eq(waToolEffects.state, "pending")));
}

/**
 * The conversation must still be at `fence`. Inside a transaction the row is locked `for share`, so a
 * newer turn (which bumps the fence) waits for this transaction and the check cannot go stale before it commits.
 */
export async function assertFenceIn(
  db: Db,
  conversationId: string,
  fence: number,
  lock: boolean,
): Promise<void> {
  const query = db
    .select({ fence: waConversations.turnFence })
    .from(waConversations)
    .where(eq(waConversations.id, conversationId));
  const [row] = await (lock ? query.for("share") : query);
  if (row?.fence !== fence) throw new StaleFenceError(conversationId);
}

/** The only place `wa_tool_effects` is read or written for the tools' exactly-once protocol. */
@Injectable()
export class ToolEffectsRepo implements ToolEffectsPort {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async begin(key: string, turnId: string, tool: string) {
    if (await insertPendingEffect(this.handle.db, { key, turnId, tool })) {
      return { state: "fresh" as const };
    }
    const [row] = await this.handle.db
      .select({ state: waToolEffects.state, result: waToolEffects.result })
      .from(waToolEffects)
      .where(eq(waToolEffects.key, key));
    if (row?.state === "done" && row.result !== null) {
      return { state: "done" as const, result: row.result };
    }
    return { state: "pending" as const };
  }

  markDone(key: string, result: Record<string, unknown>): Promise<void> {
    return markEffectDone(this.handle.db, key, result);
  }

  assertFence(conversationId: string, fence: number): Promise<void> {
    return assertFenceIn(this.handle.db, conversationId, fence, false);
  }
}
