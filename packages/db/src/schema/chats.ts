import { CHAT_MESSAGE_STATUSES, CHAT_ROLES } from "@wasfa/shared/ai";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { aiUsage } from "./ai.js";
import { idColumn, inList, timestamps } from "./columns.js";
import { ownerCheck, ownerColumns } from "./owner.js";
import { users } from "./users.js";

/*
 * Chats are personal even inside an organization: the owner decides whose wallet pays and who may
 * be billed, `user_id` decides who may read. Every chat query filters on both.
 */
export const chats = pgTable(
  "chats",
  {
    id: idColumn(),
    ...ownerColumns(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    title: text(),
    // Key of the chat skill (a prompt preset); null for a plain chat.
    skill: text(),
    archived: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("chats", table),
    index("chats_user_updated_idx").on(table.userId, table.updatedAt.desc()),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: idColumn(),
    chatId: uuid()
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text({ enum: CHAT_ROLES }).notNull(),
    // Plain text; never logged. Image file ids and sources live in `parts`.
    content: text().notNull().default(""),
    parts: jsonb().notNull().default([]),
    status: text({ enum: CHAT_MESSAGE_STATUSES }).notNull().default("done"),
    aiUsageId: uuid().references(() => aiUsage.id, { onDelete: "set null" }),
    creditsCharged: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("chat_messages_role_check", inList(table.role, CHAT_ROLES)),
    check("chat_messages_status_check", inList(table.status, CHAT_MESSAGE_STATUSES)),
    check("chat_messages_parts_check", sql`jsonb_typeof(${table.parts}) = 'array'`),
    check("chat_messages_credits_check", sql`${table.creditsCharged} >= 0`),
    index("chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
  ],
);

/** Rolling summary of the older part of a long chat, so the prompt stays small. */
export const chatSummaries = pgTable("chat_summaries", {
  chatId: uuid()
    .primaryKey()
    .references(() => chats.id, { onDelete: "cascade" }),
  summary: text().notNull(),
  // The last message the summary covers. CASCADE: if it is deleted the summary is stale, so it goes.
  throughMessageId: uuid()
    .notNull()
    .references(() => chatMessages.id, { onDelete: "cascade" }),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type ChatSummary = typeof chatSummaries.$inferSelect;
export type NewChatSummary = typeof chatSummaries.$inferInsert;
