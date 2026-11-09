import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { inList } from "./columns.js";
import { rxAnalyses } from "./rx.js";
import { users } from "./users.js";

export const TELEGRAM_MESSAGE_ROLES = ["user", "assistant"] as const;
export type TelegramMessageRole = (typeof TELEGRAM_MESSAGE_ROLES)[number];

/** Chat languages of the Telegram bot. */
export const TELEGRAM_LOCALES = ["ar", "en"] as const;

/*
 * The Telegram prescription bot (docs/TELEGRAM-BOT.md). One row per Telegram chat; `user_id` is set
 * only after the person shared their own verified phone number. `context_reset_at` is "محادثة جديدة":
 * messages before it are not sent to the model any more.
 */
export const telegramChats = pgTable(
  "telegram_chats",
  {
    chatId: bigint({ mode: "number" }).primaryKey(),
    // Profile as Telegram reports it (never logged); the phone only after the share-number button.
    telegramUserId: bigint({ mode: "number" }),
    username: text(),
    firstName: text(),
    lastName: text(),
    languageCode: text(),
    phone: text(),
    phoneSharedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    locale: text({ enum: TELEGRAM_LOCALES }).notNull().default("ar"),
    contextResetAt: timestamp({ withTimezone: true }),
    lastRxId: uuid().references(() => rxAnalyses.id, { onDelete: "set null" }),
    blocked: boolean().notNull().default(false),
    // "Hide ads" pressed (or /ads_on to undo): no Telegram ad is sent to this chat while true.
    adsHidden: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("telegram_chats_locale_check", inList(table.locale, TELEGRAM_LOCALES)),
    index("telegram_chats_user_idx").on(table.userId),
  ],
);

/** The last 40 messages per chat (pruned on insert): the context of follow-up questions. */
export const telegramMessages = pgTable(
  "telegram_messages",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    chatId: bigint({ mode: "number" })
      .notNull()
      .references(() => telegramChats.chatId, { onDelete: "cascade" }),
    role: text({ enum: TELEGRAM_MESSAGE_ROLES }).notNull(),
    content: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("telegram_messages_role_check", inList(table.role, TELEGRAM_MESSAGE_ROLES)),
    index("telegram_messages_chat_created_idx").on(table.chatId, table.createdAt),
  ],
);

export type TelegramChat = typeof telegramChats.$inferSelect;
export type TelegramMessage = typeof telegramMessages.$inferSelect;
