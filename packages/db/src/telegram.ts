import { and, asc, count, desc, eq, gt, isNotNull, sql } from "drizzle-orm";

import {
  telegramChats,
  telegramMessages,
  type TelegramChat,
  type TelegramMessageRole,
} from "./schema/telegram.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

type Handle = Database | Transaction;

/** Messages kept per chat for follow-up questions; older ones are pruned on insert. */
export const TELEGRAM_KEEP_MESSAGES = 40;

/** What Telegram reports about the sender of an update. */
export interface TelegramProfile {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
}

/** The chat row, created on first contact; every update refreshes the profile and `last_seen_at`. */
export async function upsertTelegramChat(
  db: Handle,
  chatId: number,
  profile?: TelegramProfile,
): Promise<TelegramChat> {
  const now = new Date();
  await db
    .insert(telegramChats)
    .values({ chatId, ...profile, lastSeenAt: now })
    .onConflictDoUpdate({
      target: telegramChats.chatId,
      set: { ...profile, lastSeenAt: now },
    });
  const [row] = await db.select().from(telegramChats).where(eq(telegramChats.chatId, chatId));
  if (!row) throw new Error("telegram chat missing after upsert");
  return row;
}

export type TelegramChatPatch = Partial<
  Pick<
    TelegramChat,
    | "userId"
    | "locale"
    | "contextResetAt"
    | "lastRxId"
    | "blocked"
    | "adsHidden"
    | "phone"
    | "phoneSharedAt"
    | "startedAt"
  >
>;

export async function patchTelegramChat(
  db: Handle,
  chatId: number,
  patch: TelegramChatPatch,
): Promise<void> {
  await db
    .update(telegramChats)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(telegramChats.chatId, chatId));
}

/** Stores one message and keeps only the newest `TELEGRAM_KEEP_MESSAGES` of the chat. */
export async function addTelegramMessage(
  db: Handle,
  chatId: number,
  role: TelegramMessageRole,
  content: string,
): Promise<void> {
  await db.insert(telegramMessages).values({ chatId, role, content });
  await db.execute(sql`
    DELETE FROM telegram_messages
    WHERE chat_id = ${chatId}
      AND id NOT IN (
        SELECT id FROM telegram_messages WHERE chat_id = ${chatId}
        ORDER BY id DESC LIMIT ${TELEGRAM_KEEP_MESSAGES}
      )`);
}

/** The newest `limit` messages since `since` (all when null), oldest first. */
export async function recentTelegramMessages(
  db: Handle,
  chatId: number,
  since: Date | null,
  limit: number,
): Promise<{ role: TelegramMessageRole; content: string }[]> {
  const rows = await db
    .select({ role: telegramMessages.role, content: telegramMessages.content })
    .from(telegramMessages)
    .where(
      since === null
        ? eq(telegramMessages.chatId, chatId)
        : and(eq(telegramMessages.chatId, chatId), gt(telegramMessages.createdAt, since)),
    )
    .orderBy(desc(telegramMessages.id))
    .limit(limit);
  return rows.reverse();
}

/** Chats and linked chats, for the admin status card. */
export async function telegramChatCounts(
  db: Handle,
): Promise<{ chats: number; linkedChats: number; sharedPhones: number }> {
  const [all] = await db.select({ n: count() }).from(telegramChats);
  const [linked] = await db
    .select({ n: count() })
    .from(telegramChats)
    .where(isNotNull(telegramChats.userId));
  const [shared] = await db
    .select({ n: count() })
    .from(telegramChats)
    .where(isNotNull(telegramChats.phone));
  return { chats: all?.n ?? 0, linkedChats: linked?.n ?? 0, sharedPhones: shared?.n ?? 0 };
}

/** The chats linked to an account (the admin's own chat, for the test broadcast). */
export async function telegramChatsOfUser(db: Handle, userId: string): Promise<TelegramChat[]> {
  return db
    .select()
    .from(telegramChats)
    .where(and(eq(telegramChats.userId, userId), eq(telegramChats.blocked, false)))
    .orderBy(asc(telegramChats.createdAt));
}
