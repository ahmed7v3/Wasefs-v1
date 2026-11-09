import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { Public } from "../common/auth.guard.js";
import { SkipOriginCheck } from "../common/origin.guard.js";
import { RateLimit } from "../common/rate-limit.js";

import { TelegramBotService } from "./telegram-bot.service.js";
import { webhookSecretMatches } from "./telegram-secret.js";
import { TelegramTokenService } from "./telegram-token.service.js";
import { telegramUpdateSchema } from "./telegram-types.js";

/**
 * Telegram's webhook. No cookie and no browser: authenticity is the secret header Telegram echoes
 * (derived from the encryption key), which is why the origin check is skipped. A wrong secret is 401;
 * everything else is 200 at once, because Telegram retries (and then stalls) on a slow or failing
 * endpoint: the update itself is processed after the answer.
 */
@Controller("webhooks/telegram")
export class TelegramWebhookController {
  constructor(
    private readonly tokens: TelegramTokenService,
    private readonly bot: TelegramBotService,
  ) {}

  @Post()
  @Public()
  @SkipOriginCheck()
  @HttpCode(200)
  @RateLimit(6_000)
  async receive(
    @Body() body: unknown,
    @Headers("x-telegram-bot-api-secret-token") secret: string | string[] | undefined,
  ): Promise<{ ok: true }> {
    if (!webhookSecretMatches(secret, this.tokens.webhookSecret())) {
      throw new AppError(ErrorCode.INVALID_SIGNATURE);
    }
    const update = telegramUpdateSchema.safeParse(body);
    // A body we cannot read is acknowledged too: Telegram would only resend the same thing.
    if (update.success) await this.bot.accept(update.data);
    return { ok: true };
  }
}
