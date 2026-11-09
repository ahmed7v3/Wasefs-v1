import { Inject, Injectable } from "@nestjs/common";
import {
  addTelegramMessage,
  findVerifiedUserIdByPhone,
  getIntegrationSecret,
  patchTelegramChat,
  recentTelegramMessages,
  upsertTelegramChat,
  users,
  type TelegramChat,
  type TelegramChatPatch,
  type TelegramProfile,
  type TelegramMessageRole,
} from "@wasfa/db";
import { eq } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { AgentUserRow } from "../wa-agent/commerce/agent-commerce.repo.js";

/** Every query the bot itself makes: its chats, their short transcript, the account behind a link. */
@Injectable()
export class TelegramRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The decrypted bot token, or null when none is stored. Server use only. */
  token(encKey: Buffer | readonly Buffer[]): Promise<string | null> {
    return getIntegrationSecret(this.handle.db, "telegram", encKey);
  }

  chat(chatId: number, profile?: TelegramProfile): Promise<TelegramChat> {
    return upsertTelegramChat(this.handle.db, chatId, profile);
  }

  patchChat(chatId: number, patch: TelegramChatPatch): Promise<void> {
    return patchTelegramChat(this.handle.db, chatId, patch);
  }

  addMessage(chatId: number, role: TelegramMessageRole, content: string): Promise<void> {
    return addTelegramMessage(this.handle.db, chatId, role, content);
  }

  messages(chatId: number, since: Date | null, limit: number) {
    return recentTelegramMessages(this.handle.db, chatId, since, limit);
  }

  /** The account whose VERIFIED phone this is, or null. */
  userIdByPhone(phone: string): Promise<string | null> {
    return findVerifiedUserIdByPhone(this.handle.db, phone);
  }

  async user(userId: string): Promise<AgentUserRow | null> {
    const [row] = await this.handle.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        phoneVerified: users.phoneVerified,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }
}
