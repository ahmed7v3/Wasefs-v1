import { Inject, Injectable } from "@nestjs/common";
import {
  chatMessages,
  chatSummaries,
  chats,
  type Chat,
  type ChatMessage,
  type NewChatMessage,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { afterCursor, escapeLike, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

import type { HistoryRow } from "./chat-context.js";

export interface ChatRow extends Chat {
  /** `updated_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface MessageRow extends ChatMessage {
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

/**
 * Every query of the assistant. Chats are personal: a chat is found by `user_id`, and messages are
 * only ever reached through a chat of the caller (the ownership subquery on every message query),
 * so another user's chat id looks exactly like a missing one.
 */
@Injectable()
export class ChatRepo {
  private readonly ofUser: ScopedRepo<typeof chats>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.ofUser = scopedRepo(handle.db, { table: chats, scope: chats.userId, id: chats.id });
  }

  /** The caller's own chats-only guard for message queries. */
  private owned(userId: string, chatId: string): SQL {
    return sql`exists (select 1 from ${chats} where ${chats.id} = ${chatMessages.chatId} and ${chats.id} = ${chatId} and ${chats.userId} = ${userId})`;
  }

  async create(userId: string, skill: string | null): Promise<Chat> {
    const [row] = await this.handle.db
      .insert(chats)
      .values({ ownerUserId: userId, userId, skill })
      .returning();
    if (!row) throw new Error("Insert into chats returned no row");
    return row;
  }

  /** The caller's oldest live chat with exactly this title (the WhatsApp assistant keeps one), or null. */
  async findByTitle(userId: string, title: string): Promise<Chat | null> {
    const [row] = await this.handle.db
      .select()
      .from(chats)
      .where(and(eq(chats.userId, userId), eq(chats.title, title), eq(chats.archived, false)))
      .orderBy(chats.createdAt)
      .limit(1);
    return row ?? null;
  }

  /** `NOT_FOUND` for a missing or foreign chat. */
  require(userId: string, chatId: string): Promise<Chat> {
    return this.ofUser.require(userId, chatId);
  }

  async update(
    userId: string,
    chatId: string,
    values: { title?: string; archived?: boolean },
  ): Promise<Chat> {
    const row = await this.ofUser.update(userId, chatId, values);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    return row;
  }

  remove(userId: string, chatId: string): Promise<boolean> {
    return this.ofUser.remove(userId, chatId);
  }

  /** `limit + 1` chats, most recently active first. */
  list(
    userId: string,
    options: {
      cursor: Cursor | undefined;
      limit: number;
      q: string | undefined;
      archived: boolean;
    },
  ): Promise<ChatRow[]> {
    const conditions: (SQL | undefined)[] = [
      eq(chats.userId, userId),
      eq(chats.archived, options.archived),
    ];
    if (options.q !== undefined) conditions.push(ilike(chats.title, `%${escapeLike(options.q)}%`));
    if (options.cursor) {
      conditions.push(afterCursor(chats.updatedAt, chats.id, options.cursor, "uuid"));
    }
    return this.handle.db
      .select({ ...chatColumns, cursorAt: stamp(chats.updatedAt) })
      .from(chats)
      .where(and(...conditions))
      .orderBy(desc(chats.updatedAt), desc(chats.id))
      .limit(options.limit + 1);
  }

  /** `limit + 1` messages of one of the caller's chats, newest first. */
  messagesPage(
    userId: string,
    chatId: string,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<MessageRow[]> {
    const conditions: (SQL | undefined)[] = [
      eq(chatMessages.chatId, chatId),
      this.owned(userId, chatId),
    ];
    if (cursor) {
      conditions.push(afterCursor(chatMessages.createdAt, chatMessages.id, cursor, "uuid"));
    }
    return this.handle.db
      .select({ ...messageColumns, cursorAt: stamp(chatMessages.createdAt) })
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit + 1);
  }

  /** The newest `limit` messages, oldest first, with only what the prompt needs. */
  async recentMessages(userId: string, chatId: string, limit: number): Promise<HistoryRow[]> {
    const rows = await this.handle.db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        status: chatMessages.status,
      })
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), this.owned(userId, chatId)))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  async messageOf(userId: string, chatId: string, messageId: string): Promise<ChatMessage | null> {
    const [row] = await this.handle.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.chatId, chatId),
          this.owned(userId, chatId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Messages after `afterMessageId` (all when null), oldest first. */
  messagesAfter(
    userId: string,
    chatId: string,
    afterMessageId: string | null,
    limit: number,
  ): Promise<HistoryRow[]> {
    const conditions: (SQL | undefined)[] = [
      eq(chatMessages.chatId, chatId),
      this.owned(userId, chatId),
    ];
    if (afterMessageId !== null) {
      conditions.push(
        sql`(${chatMessages.createdAt}, ${chatMessages.id}) > (select m.created_at, m.id from ${chatMessages} m where m.id = ${afterMessageId} and m.chat_id = ${chatId})`,
      );
    }
    return this.handle.db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        status: chatMessages.status,
      })
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .limit(limit);
  }

  /** Answered turns of the chat: what the "every 10th answer" summary rule counts. */
  async answeredCount(userId: string, chatId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ value: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          this.owned(userId, chatId),
          eq(chatMessages.role, "assistant"),
          inArray(chatMessages.status, ["done", "stopped"]),
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * Stores a turn in one transaction: the user's message (absent when regenerating), the empty
   * `streaming` answer, and, when regenerating, the removal of the answer it replaces. The chat row
   * is locked first, so a chat deleted a moment ago is `NOT_FOUND` rather than an orphan insert.
   */
  async insertTurn(
    userId: string,
    chatId: string,
    turn: { user?: NewChatMessage; assistant: NewChatMessage; replaceId?: string },
  ): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      const [chat] = await tx
        .select({ id: chats.id })
        .from(chats)
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
        .for("update");
      if (!chat) throw new AppError(ErrorCode.NOT_FOUND);
      if (turn.replaceId !== undefined) {
        await tx
          .delete(chatMessages)
          .where(
            and(
              eq(chatMessages.id, turn.replaceId),
              eq(chatMessages.chatId, chatId),
              eq(chatMessages.role, "assistant"),
            ),
          );
      }
      if (turn.user) await tx.insert(chatMessages).values(turn.user);
      await tx.insert(chatMessages).values(turn.assistant);
      await tx.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, chatId));
    });
  }

  /** Writes the finished answer. A chat deleted while streaming simply matches no row. */
  async finishAssistant(
    userId: string,
    chatId: string,
    messageId: string,
    values: Pick<NewChatMessage, "content" | "parts" | "status" | "aiUsageId" | "creditsCharged">,
  ): Promise<void> {
    await this.handle.db
      .update(chatMessages)
      .set(values)
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.chatId, chatId),
          this.owned(userId, chatId),
        ),
      );
  }

  /** Sets the title only while the chat has none, so a rename made meanwhile is never overwritten. */
  async setTitleIfEmpty(userId: string, chatId: string, title: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(chats)
      .set({ title })
      .where(and(eq(chats.id, chatId), eq(chats.userId, userId), isNull(chats.title)))
      .returning({ id: chats.id });
    return rows.length > 0;
  }

  async summaryOf(
    userId: string,
    chatId: string,
  ): Promise<{ summary: string; throughMessageId: string } | null> {
    const [row] = await this.handle.db
      .select({ summary: chatSummaries.summary, throughMessageId: chatSummaries.throughMessageId })
      .from(chatSummaries)
      .innerJoin(chats, eq(chats.id, chatSummaries.chatId))
      .where(and(eq(chatSummaries.chatId, chatId), eq(chats.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async saveSummary(chatId: string, summary: string, throughMessageId: string): Promise<void> {
    await this.handle.db
      .insert(chatSummaries)
      .values({ chatId, summary, throughMessageId })
      .onConflictDoUpdate({
        target: chatSummaries.chatId,
        set: { summary, throughMessageId, updatedAt: new Date() },
      });
  }
}

const chatColumns = {
  id: chats.id,
  ownerUserId: chats.ownerUserId,
  ownerOrgId: chats.ownerOrgId,
  userId: chats.userId,
  title: chats.title,
  skill: chats.skill,
  archived: chats.archived,
  createdAt: chats.createdAt,
  updatedAt: chats.updatedAt,
};

const messageColumns = {
  id: chatMessages.id,
  chatId: chatMessages.chatId,
  role: chatMessages.role,
  content: chatMessages.content,
  parts: chatMessages.parts,
  status: chatMessages.status,
  aiUsageId: chatMessages.aiUsageId,
  creditsCharged: chatMessages.creditsCharged,
  createdAt: chatMessages.createdAt,
  updatedAt: chatMessages.updatedAt,
};
