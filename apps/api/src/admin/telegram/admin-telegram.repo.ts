import { Inject, Injectable } from "@nestjs/common";
import {
  clearIntegrationSecret,
  getIntegrationSecretMeta,
  setIntegrationSecret,
  telegramChatCounts,
  telegramChatsOfUser,
} from "@wasfa/db";

import { DB, type DbHandle } from "../../common/database.js";

const KEY = "telegram" as const;

/** Every query behind `/admin/telegram`: the token masked state, chat counts, the chat of the acting admin. */
@Injectable()
export class AdminTelegramRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  tokenMeta() {
    return getIntegrationSecretMeta(this.handle.db, KEY);
  }

  setToken(token: string, encKey: Buffer, actorId: string) {
    return setIntegrationSecret(this.handle.db, KEY, token, encKey, actorId);
  }

  clearToken(): Promise<boolean> {
    return clearIntegrationSecret(this.handle.db, KEY);
  }

  counts() {
    return telegramChatCounts(this.handle.db);
  }

  chatsOfUser(userId: string) {
    return telegramChatsOfUser(this.handle.db, userId);
  }
}
