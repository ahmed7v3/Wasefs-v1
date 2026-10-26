import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { users } from "./schema/users.js";
import { waConversations, waMessages, type WaMessage } from "./schema/wa-agent.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

/*
 * What one agent turn reads and writes besides the transport (docs/WA-AGENT.md work package B):
 * the recent transcript, which customer messages a turn already took, the rolling summary and the per-message meta.
 * Kept apart from `wa-agent.ts` (transport and admin inbox). No scoping by owner: the transcript
 * belongs to the platform, the api binds a turn to one conversation.
 */

type Handle = Database | Transaction;

/** The columns of a message the agent shows to a model. */
export type TurnMessage = Pick<
  WaMessage,
  "id" | "direction" | "kind" | "text" | "mediaKey" | "mediaMime" | "mediaBytes" | "createdAt"
> & {
  /**
   * A turn took this customer message (`meta.turn`). Answered-ness is tracked on the message, not
   * inferred from order: a message sent while the agent was thinking is stamped with the sender's
   * clock, which can fall before the reply that was queued after it.
   */
  answered: boolean;
};

const turnColumns = {
  id: waMessages.id,
  direction: waMessages.direction,
  kind: waMessages.kind,
  text: waMessages.text,
  mediaKey: waMessages.mediaKey,
  mediaMime: waMessages.mediaMime,
  mediaBytes: waMessages.mediaBytes,
  createdAt: waMessages.createdAt,
  answered: sql<boolean>`${waMessages.meta} ? 'turn'`,
};

/**
 * The newest `limit` messages that were really delivered or received (a dropped reply never
 * reached the customer), oldest first.
 */
export async function recentTurnMessages(
  db: Handle,
  conversationId: string,
  limit: number,
): Promise<TurnMessage[]> {
  const rows = await db
    .select(turnColumns)
    .from(waMessages)
    .where(and(eq(waMessages.conversationId, conversationId), ne(waMessages.status, "dropped")))
    .orderBy(desc(waMessages.createdAt), desc(waMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** Messages created after `after` (all of them when null), oldest first, at most `limit`. */
export async function turnMessagesAfter(
  db: Handle,
  conversationId: string,
  after: Date | null,
  limit: number,
): Promise<TurnMessage[]> {
  return db
    .select(turnColumns)
    .from(waMessages)
    .where(
      and(
        eq(waMessages.conversationId, conversationId),
        ne(waMessages.status, "dropped"),
        after === null ? undefined : gt(waMessages.createdAt, after),
      ),
    )
    .orderBy(asc(waMessages.createdAt), asc(waMessages.id))
    .limit(limit);
}

export async function countTurnMessagesAfter(
  db: Handle,
  conversationId: string,
  after: Date | null,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(waMessages)
    .where(
      and(
        eq(waMessages.conversationId, conversationId),
        ne(waMessages.status, "dropped"),
        after === null ? undefined : gt(waMessages.createdAt, after),
      ),
    );
  return row?.total ?? 0;
}

/**
 * Adds `meta` to the rows' metadata (keys already there stay). A turn stamps `turn` on the customer
 * messages it takes, and its tool names, counts and cost on the replies it queues; never arguments.
 */
export async function setMessagesMeta(
  db: Handle,
  messageIds: readonly string[],
  meta: Record<string, unknown>,
): Promise<void> {
  if (messageIds.length === 0) return;
  await db
    .update(waMessages)
    .set({ meta: sql`${waMessages.meta} || ${JSON.stringify(meta)}::jsonb` })
    .where(inArray(waMessages.id, [...messageIds]));
}

export async function setConversationSummary(
  db: Handle,
  conversationId: string,
  summary: string,
): Promise<void> {
  await db
    .update(waConversations)
    .set({ summary, updatedAt: new Date() })
    .where(eq(waConversations.id, conversationId));
}

export interface TurnUser {
  name: string;
  status: "active" | "suspended" | "deleted";
}

/** The first-name source and standing of the account a chat is linked to. */
export async function findTurnUser(db: Handle, userId: string): Promise<TurnUser | null> {
  const [row] = await db
    .select({ name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** How many of these messages the bridge has not reported on yet. */
export async function countQueuedMessages(
  db: Handle,
  messageIds: readonly string[],
): Promise<number> {
  if (messageIds.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(waMessages)
    .where(and(inArray(waMessages.id, [...messageIds]), eq(waMessages.status, "queued")));
  return row?.total ?? 0;
}
