import { Inject, Injectable } from "@nestjs/common";

import { API_ENV } from "../config/config.module.js";
import { encryptionKey, type ApiEnv } from "../config/env.js";

import { telegramWebhookSecret } from "./telegram-secret.js";
import { TelegramRepo } from "./telegram.repo.js";

const TTL_MS = 60_000;

/**
 * The bot token for server calls, read from the encrypted store and kept in memory for a minute. The
 * admin routes call `invalidate()` when the token is set or cleared; another api instance picks the
 * change up at the TTL. The value only goes to the Telegram client: never logged, never returned.
 */
@Injectable()
export class TelegramTokenService {
  private cached: { value: string | null; at: number } | undefined;
  /** Replaced by tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly repo: TelegramRepo,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async get(): Promise<string | null> {
    const at = this.now();
    if (this.cached && at - this.cached.at < TTL_MS) return this.cached.value;
    const value = await this.repo.token(encryptionKey(this.env));
    this.cached = { value, at };
    return value;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  /** What Telegram must echo in `x-telegram-bot-api-secret-token`. */
  webhookSecret(): string {
    return telegramWebhookSecret(encryptionKey(this.env));
  }

  webhookUrl(): string {
    return `${this.env.API_PUBLIC_URL}/webhooks/telegram`;
  }
}
