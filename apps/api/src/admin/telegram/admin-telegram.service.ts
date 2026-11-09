import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../../config/env.js";
import { SettingsService } from "../../settings/settings.service.js";
import { TelegramApiClient, TelegramApiError } from "../../telegram-bot/telegram-api.client.js";
import { telegramWebhookSecret } from "../../telegram-bot/telegram-secret.js";
import { readStat } from "../../telegram-bot/telegram-stats.js";
import { TelegramTokenService } from "../../telegram-bot/telegram-token.service.js";

import { AdminTelegramRepo } from "./admin-telegram.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { TelegramSettingsInput, TelegramStatus } from "@wasfa/shared/schemas/admin-telegram";
import type { TelegramBotSettings } from "@wasfa/shared/settings";
import type { FastifyRequest } from "fastify";

/** A refusal the admin form can show: 422 with a reason code and no echo of the token. */
const unprocessable = (reason: string) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { httpStatus: 422, details: { reason } });

/**
 * The control panel of the Telegram bot. The token only travels inward: it is checked with `getMe`,
 * sealed in `integration_secrets`, and every answer carries the masked hint and the public username
 * of the bot. Never logged, never returned.
 */
@Injectable()
export class AdminTelegramService {
  constructor(
    private readonly repo: AdminTelegramRepo,
    private readonly tokens: TelegramTokenService,
    private readonly client: TelegramApiClient,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async status(): Promise<TelegramStatus> {
    const [meta, settings, counts, analysesToday, messagesToday] = await Promise.all([
      this.repo.tokenMeta(),
      this.settings.get("telegramBot"),
      this.repo.counts(),
      readStat(this.redis, "analyses"),
      readStat(this.redis, "messages"),
    ]);
    const status: TelegramStatus = {
      configured: meta !== null,
      tokenHint: meta?.hint ?? null,
      botUsername: null,
      botName: null,
      webhookUrl: null,
      webhookOk: false,
      pendingUpdates: 0,
      lastError: null,
      enabled: settings.enabled,
      stats: { ...counts, analysesToday, messagesToday },
    };
    if (meta === null) return status;
    const token = await this.tokens.get();
    if (token === null) return { ...status, lastError: "token_unreadable" };
    // Telegram being unreachable must not break the admin page: the stored state is still shown.
    try {
      const api = this.client.bind(token);
      const [me, hook] = await Promise.all([api.getMe(), api.getWebhookInfo()]);
      status.botUsername = me.username ?? null;
      status.botName = me.first_name;
      status.webhookUrl = hook.url === "" ? null : hook.url;
      status.pendingUpdates = hook.pending_update_count;
      status.lastError = hook.last_error_message ?? null;
      status.webhookOk =
        hook.url === this.tokens.webhookUrl() && hook.last_error_message === undefined;
    } catch (error) {
      status.lastError = error instanceof TelegramApiError ? error.message : "telegram_unreachable";
    }
    return status;
  }

  async setToken(actorId: string, token: string, audit: AuditScope): Promise<TelegramStatus> {
    const api = this.client.bind(token);
    try {
      await api.getMe();
    } catch {
      throw unprocessable("telegram_token_invalid");
    }
    try {
      await api.setWebhook(
        this.tokens.webhookUrl(),
        telegramWebhookSecret(encryptionKey(this.env)),
      );
      await api.setMyCommands();
    } catch (error) {
      throw unprocessable(
        error instanceof TelegramApiError && error.code === 400
          ? "telegram_webhook_rejected"
          : "telegram_unreachable",
      );
    }
    const stored = await this.repo.setToken(token, encryptionKey(this.env), actorId);
    this.tokens.invalidate();
    audit.targetId = "telegram";
    // Never the token: whether one exists and its masked hint.
    audit.after = { hasToken: true, tokenHint: stored.hint };
    return this.status();
  }

  async clearToken(audit: AuditScope): Promise<void> {
    const token = await this.tokens.get();
    if (token !== null) {
      // Best effort: the token is cleared even when Telegram cannot be reached.
      await this.client
        .bind(token)
        .deleteWebhook()
        .catch(() => undefined);
    }
    await this.repo.clearToken();
    this.tokens.invalidate();
    audit.targetId = "telegram";
    audit.after = { hasToken: false, tokenHint: null };
  }

  getSettings(): Promise<TelegramBotSettings> {
    return this.settings.get("telegramBot");
  }

  /** Saves the whole bot setting (audited by `SettingsService.set`). */
  async putSettings(
    actorId: string,
    request: FastifyRequest,
    input: TelegramSettingsInput,
  ): Promise<TelegramBotSettings> {
    await this.settings.set("telegramBot", input, { actorId, request });
    return this.getSettings();
  }

  /** Sends `text` to the acting admin own linked chat, to see the bot works end to end. */
  async broadcastTest(actorId: string, text: string): Promise<{ sent: number }> {
    const token = await this.tokens.get();
    if (token === null) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "token_missing" } });
    }
    const chats = await this.repo.chatsOfUser(actorId);
    if (chats.length === 0) {
      throw new AppError(ErrorCode.CONFLICT, { details: { reason: "no_linked_chat" } });
    }
    const api = this.client.bind(token);
    let sent = 0;
    for (const chat of chats) {
      try {
        await api.sendMessage(chat.chatId, text, { html: false });
        sent += 1;
      } catch {
        // A chat that blocked the bot is skipped; the count tells the admin what arrived.
      }
    }
    return { sent };
  }
}
