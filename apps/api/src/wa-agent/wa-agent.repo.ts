import { Inject, Injectable } from "@nestjs/common";
import {
  blockConversation,
  countQueuedMessages,
  countTurnMessagesAfter,
  findTurnUser,
  findVerifiedUserIdByPhone,
  getConversation,
  getIntegrationSecret,
  insertInbound,
  insertOutbound,
  linkConversationUser,
  markOutbound,
  pauseConversation,
  recentTurnMessages,
  resumeConversation,
  setConversationSummary,
  setMessageText,
  setMessagesMeta,
  turnMessagesAfter,
  upsertConversation,
  type OutboundPartRow,
  type TurnMessage,
  type TurnUser,
  type WaConversation,
} from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

import type { WaAgentInbound } from "@wasfa/shared/schemas/wa-agent";

export interface IngestResult {
  conversation: WaConversation;
  /** False when WhatsApp's message id was stored before (a redelivered entry). */
  inserted: boolean;
}

/** The only place the WhatsApp agent touches the database. */
@Injectable()
export class WaAgentRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /**
   * Stores one inbound or owner message. The account is re-resolved from the sender's phone on every
   * message: only a VERIFIED phone links a chat to a user. An owner message also pauses the chat.
   */
  async ingest(entry: WaAgentInbound, pauseUntil: Date): Promise<IngestResult> {
    return this.handle.db.transaction(async (tx) => {
      const userId = entry.phone === null ? null : await findVerifiedUserIdByPhone(tx, entry.phone);
      let conversation = await upsertConversation(tx, {
        jid: entry.jid,
        phone: entry.phone,
        userId,
      });
      const messageId = await insertInbound(tx, {
        conversationId: conversation.id,
        direction: entry.direction,
        kind: entry.kind,
        text: entry.text,
        media: entry.media,
        mediaStatus: entry.mediaStatus,
        waMessageId: entry.waMessageId,
        ts: entry.ts,
      });
      if (messageId !== null && entry.direction === "owner") {
        conversation = (await pauseConversation(tx, conversation.id, pauseUntil)) ?? conversation;
      }
      return { conversation, inserted: messageId !== null };
    });
  }

  find(conversationId: string): Promise<WaConversation | null> {
    return getConversation(this.handle.db, conversationId);
  }

  linkUser(conversationId: string, userId: string): Promise<void> {
    return linkConversationUser(this.handle.db, conversationId, userId);
  }

  queueOutbound(conversationId: string, parts: readonly OutboundPartRow[]): Promise<string[]> {
    return insertOutbound(this.handle.db, conversationId, parts);
  }

  recordVerdict(
    messageId: string,
    status: "sent" | "dropped",
    detail: { reason?: string | undefined; waMessageId?: string | undefined } = {},
  ): Promise<string | null> {
    return markOutbound(this.handle.db, messageId, status, detail);
  }

  pause(conversationId: string, until: Date): Promise<WaConversation | null> {
    return pauseConversation(this.handle.db, conversationId, until);
  }

  resume(conversationId: string): Promise<WaConversation | null> {
    return resumeConversation(this.handle.db, conversationId);
  }

  block(conversationId: string): Promise<WaConversation | null> {
    return blockConversation(this.handle.db, conversationId);
  }

  // --- what an agent turn reads and writes (work package B) ---

  recentMessages(conversationId: string, limit: number): Promise<TurnMessage[]> {
    return recentTurnMessages(this.handle.db, conversationId, limit);
  }

  messagesAfter(conversationId: string, after: Date | null, limit: number): Promise<TurnMessage[]> {
    return turnMessagesAfter(this.handle.db, conversationId, after, limit);
  }

  countAfter(conversationId: string, after: Date | null): Promise<number> {
    return countTurnMessagesAfter(this.handle.db, conversationId, after);
  }

  setMeta(messageIds: readonly string[], meta: Record<string, unknown>): Promise<void> {
    return setMessagesMeta(this.handle.db, messageIds, meta);
  }

  saveSummary(conversationId: string, summary: string): Promise<void> {
    return setConversationSummary(this.handle.db, conversationId, summary);
  }

  findUser(userId: string): Promise<TurnUser | null> {
    return findTurnUser(this.handle.db, userId);
  }

  queuedCount(messageIds: readonly string[]): Promise<number> {
    return countQueuedMessages(this.handle.db, messageIds);
  }

  // --- voice (work package D) ---

  /** A transcript or the words of a spoken reply, with its meta (keys already there stay). */
  setText(messageId: string, text: string, meta: Record<string, unknown>): Promise<void> {
    return setMessageText(this.handle.db, messageId, text, meta);
  }

  /** The decrypted ElevenLabs key, or null when none is stored. Server use only. */
  elevenLabsKey(encKey: Buffer): Promise<string | null> {
    return getIntegrationSecret(this.handle.db, "elevenlabs", encKey);
  }
}
