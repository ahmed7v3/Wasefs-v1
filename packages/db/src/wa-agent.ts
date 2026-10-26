import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { users } from "./schema/users.js";
import { waConversations, waMessages, type WaConversation } from "./schema/wa-agent.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { WaAgentKind } from "@wasfa/shared/schemas/wa-agent";

/*
 * The WhatsApp AI agent's transcript (docs/WA-AGENT.md). Plain functions over a `Database` or a
 * transaction, shared by the api (consumers, outbound service) and the worker (retention). The
 * transcript belongs to no single user: reading it is an admin permission (`wa_agent.inbox`), so
 * there is no per-owner scoping here; account linking is by the verified phone only.
 */

type Handle = Database | Transaction;

/** The id of the account whose VERIFIED phone is `phone`, or null (guest). */
export async function findVerifiedUserIdByPhone(db: Handle, phone: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), eq(users.phoneVerified, true), isNull(users.anonymizedAt)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The conversation of `jid`, created on first contact. A given phone refreshes the link to the
 * account (re-resolved on every message); an unresolved LID (no phone) keeps what is known.
 */
export async function upsertConversation(
  db: Handle,
  input: { jid: string; phone: string | null; userId: string | null },
): Promise<WaConversation> {
  const [row] = await db
    .insert(waConversations)
    .values({ jid: input.jid, phone: input.phone, userId: input.userId })
    .onConflictDoUpdate({
      target: waConversations.jid,
      set:
        input.phone === null
          ? { updatedAt: new Date() }
          : { phone: input.phone, userId: input.userId, updatedAt: new Date() },
    })
    .returning();
  if (row === undefined) throw new Error("wa_conversations upsert returned no row");
  return row;
}

export async function getConversation(db: Handle, id: string): Promise<WaConversation | null> {
  const [row] = await db.select().from(waConversations).where(eq(waConversations.id, id));
  return row ?? null;
}

export interface InboundMessageInput {
  conversationId: string;
  direction: "in" | "owner";
  kind: WaAgentKind;
  text?: string | undefined;
  media?: { key: string; mime: string; bytes: number; seconds?: number | undefined } | undefined;
  waMessageId: string;
  /** Epoch ms the message was sent; never stored in the future. */
  ts: number;
}

/**
 * Stores one message the bridge saw; a redelivered one (same WhatsApp id) is a no-op. A customer
 * message also moves the chat's `last_inbound_at`. Returns the row id, or null for a duplicate.
 */
export async function insertInbound(
  db: Handle,
  input: InboundMessageInput,
): Promise<string | null> {
  const at = new Date(Math.min(input.ts, Date.now()));
  const [row] = await db
    .insert(waMessages)
    .values({
      conversationId: input.conversationId,
      direction: input.direction,
      kind: input.kind,
      text: input.text ?? null,
      mediaKey: input.media?.key ?? null,
      mediaMime: input.media?.mime ?? null,
      mediaBytes: input.media?.bytes ?? null,
      mediaSeconds: input.media?.seconds ?? null,
      waMessageId: input.waMessageId,
      // What the owner typed was already sent by their phone.
      status: input.direction === "owner" ? "sent" : "received",
      createdAt: at,
    })
    .onConflictDoNothing({ target: waMessages.waMessageId })
    .returning({ id: waMessages.id });
  if (row === undefined) return null;
  if (input.direction === "in") {
    await db
      .update(waConversations)
      .set({
        lastInboundAt: sql`greatest(coalesce(${waConversations.lastInboundAt}, ${at}), ${at})`,
        updatedAt: new Date(),
      })
      .where(eq(waConversations.id, input.conversationId));
  }
  return row.id;
}

export type OutboundPartRow =
  | { kind: "text"; text: string }
  | { kind: "image" | "document" | "voice"; mediaKey: string; text?: string | undefined };

const OUTBOUND_KIND: Record<OutboundPartRow["kind"], WaAgentKind> = {
  text: "text",
  image: "image",
  document: "document",
  voice: "audio",
};

/** Queues the parts of one reply as `out` / `queued` rows; returns their ids in order. */
export async function insertOutbound(
  db: Handle,
  conversationId: string,
  parts: readonly OutboundPartRow[],
): Promise<string[]> {
  const rows = await db
    .insert(waMessages)
    .values(
      parts.map((part) => ({
        conversationId,
        direction: "out" as const,
        kind: OUTBOUND_KIND[part.kind],
        text: part.text ?? null,
        mediaKey: part.kind === "text" ? null : part.mediaKey,
        status: "queued" as const,
      })),
    )
    .returning({ id: waMessages.id });
  // One statement gives every row the same timestamp; the UUIDv7 ids keep the order.
  return rows.map((row) => row.id);
}

/**
 * Records the bridge's verdict for a queued part. Only a `queued` row changes, so a replayed report
 * is harmless. A sent part moves the chat's `last_outbound_at`. Returns the conversation id, or null
 * when nothing changed.
 */
export async function markOutbound(
  db: Handle,
  messageId: string,
  status: "sent" | "dropped",
  detail: { reason?: string | undefined; waMessageId?: string | undefined } = {},
): Promise<string | null> {
  const [row] = await db
    .update(waMessages)
    .set({
      status,
      dropReason: status === "dropped" ? (detail.reason ?? "unknown") : null,
      waMessageId: detail.waMessageId ?? null,
    })
    .where(and(eq(waMessages.id, messageId), eq(waMessages.status, "queued")))
    .returning({ conversationId: waMessages.conversationId });
  if (row === undefined) return null;
  if (status === "sent") {
    await db
      .update(waConversations)
      .set({ lastOutboundAt: new Date(), updatedAt: new Date() })
      .where(eq(waConversations.id, row.conversationId));
  }
  return row.conversationId;
}

/**
 * Pauses the chat until `until` (never shortens a longer pause; a blocked chat stays blocked).
 * Returns the conversation, or null when it does not exist.
 */
export async function pauseConversation(
  db: Handle,
  conversationId: string,
  until: Date,
): Promise<WaConversation | null> {
  const [row] = await db
    .update(waConversations)
    .set({
      status: sql`case when ${waConversations.status} = 'blocked' then 'blocked' else 'paused' end`,
      pausedUntil: sql`greatest(coalesce(${waConversations.pausedUntil}, ${until}), ${until})`,
      updatedAt: new Date(),
    })
    .where(eq(waConversations.id, conversationId))
    .returning();
  return row ?? null;
}

/** Messages older than `cutoff`, with the media object to delete first. */
export async function listMessagesForRetention(
  db: Handle,
  cutoff: Date,
  limit: number,
): Promise<Array<{ id: string; mediaKey: string | null }>> {
  return db
    .select({ id: waMessages.id, mediaKey: waMessages.mediaKey })
    .from(waMessages)
    .where(lt(waMessages.createdAt, cutoff))
    .orderBy(waMessages.createdAt)
    .limit(limit);
}

export async function deleteMessages(db: Handle, ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .delete(waMessages)
    .where(inArray(waMessages.id, [...ids]))
    .returning({ id: waMessages.id });
  return rows.length;
}

/** Conversations untouched since `cutoff` that have no messages left. */
export async function deleteEmptyConversationsOlderThan(db: Handle, cutoff: Date): Promise<number> {
  const rows = await db
    .delete(waConversations)
    .where(
      and(
        lt(waConversations.updatedAt, cutoff),
        sql`not exists (select 1 from ${waMessages} where ${waMessages.conversationId} = ${waConversations.id})`,
      ),
    )
    .returning({ id: waConversations.id });
  return rows.length;
}

/** The admin's resume: the agent may answer this chat again (also lifts a block). */
export async function resumeConversation(
  db: Handle,
  conversationId: string,
): Promise<WaConversation | null> {
  const [row] = await db
    .update(waConversations)
    .set({ status: "active", pausedUntil: null, updatedAt: new Date() })
    .where(eq(waConversations.id, conversationId))
    .returning();
  return row ?? null;
}

/** The admin's block: nothing is sent to this chat until it is resumed. */
export async function blockConversation(
  db: Handle,
  conversationId: string,
): Promise<WaConversation | null> {
  const [row] = await db
    .update(waConversations)
    .set({ status: "blocked", updatedAt: new Date() })
    .where(eq(waConversations.id, conversationId))
    .returning();
  return row ?? null;
}
