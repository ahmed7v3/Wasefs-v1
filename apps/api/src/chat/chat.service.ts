import { Injectable } from "@nestjs/common";
import {
  chatMessagesPageSchema,
  chatPartSchema,
  isChatSkill,
  type ChatListQuery,
  type ChatMessagesQuery,
  type ChatMessageView,
  type ChatPart,
  type ChatSummaryView,
  type CreateChatInput,
  type UpdateChatInput,
} from "@wasfa/shared/schemas/chat";

import { decodeCursor, toPage } from "../admin/common/keyset.js";

import { ChatRepo, type MessageRow } from "./chat.repo.js";

import type { Chat } from "@wasfa/db";
import type { z } from "zod";

export function chatView(chat: Chat): ChatSummaryView {
  return {
    id: chat.id,
    title: chat.title,
    // A skill that was retired since the chat started reads as a plain chat.
    skill: isChatSkill(chat.skill) ? chat.skill : null,
    archived: chat.archived,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
  };
}

/** `parts` is free JSON in the table; only well-formed entries are shown. */
function partsOf(raw: unknown): ChatPart[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = chatPartSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function messageView(row: MessageRow | Omit<MessageRow, "cursorAt">): ChatMessageView {
  return {
    id: row.id,
    // Chats hold no system messages; if one ever appears it must not read as the user's.
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    status: row.status,
    parts: partsOf(row.parts),
    creditsCharged: row.creditsCharged,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Chat CRUD for the caller's own chats. Streaming an answer is `ChatTurnService`. */
@Injectable()
export class ChatService {
  constructor(private readonly repo: ChatRepo) {}

  async create(userId: string, input: CreateChatInput): Promise<{ id: string }> {
    const chat = await this.repo.create(userId, input.skill ?? null);
    return { id: chat.id };
  }

  async get(userId: string, chatId: string): Promise<ChatSummaryView> {
    return chatView(await this.repo.require(userId, chatId));
  }

  async list(userId: string, query: ChatListQuery) {
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.list(userId, {
      cursor,
      limit: query.limit,
      q: query.q,
      archived: query.archived === "true",
    });
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(chatView), nextCursor: page.nextCursor };
  }

  async update(userId: string, chatId: string, input: UpdateChatInput): Promise<ChatSummaryView> {
    return chatView(
      await this.repo.update(userId, chatId, {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      }),
    );
  }

  async remove(userId: string, chatId: string): Promise<void> {
    // The scoped repo says "not found" for a foreign chat too, in both cases the same answer.
    await this.repo.require(userId, chatId);
    await this.repo.remove(userId, chatId);
  }

  async messages(
    userId: string,
    chatId: string,
    query: ChatMessagesQuery,
  ): Promise<z.output<typeof chatMessagesPageSchema>> {
    // Ownership first: a foreign chat is `NOT_FOUND` even when the cursor is malformed.
    await this.repo.require(userId, chatId);
    const cursor = decodeCursor(query.cursor, "uuid");
    const rows = await this.repo.messagesPage(userId, chatId, cursor, query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(messageView), nextCursor: page.nextCursor };
  }
}
