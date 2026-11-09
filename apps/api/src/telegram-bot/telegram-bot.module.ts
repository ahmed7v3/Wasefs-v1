import { Module } from "@nestjs/common";

import { AdsModule } from "../ads/ads.module.js";
import { AiRuntimeModule } from "../ai-runtime/ai-runtime.module.js";
import { CreditsModule } from "../credits/credits.module.js";
import { FilesModule } from "../files/files.module.js";
import { PlansModule } from "../plans/plans.module.js";
import { RxModule } from "../rx/rx.module.js";

import { TelegramAdsService } from "./telegram-ads.service.js";
import { TelegramAnalysisService } from "./telegram-analysis.service.js";
import { TelegramApiClient } from "./telegram-api.client.js";
import { TelegramBotService } from "./telegram-bot.service.js";
import { TelegramChatService } from "./telegram-chat.service.js";
import { TelegramPdfQueue } from "./telegram-pdf-queue.js";
import { TelegramPdfService } from "./telegram-pdf.service.js";
import { TelegramTokenService } from "./telegram-token.service.js";
import { TelegramWebhookController } from "./telegram-webhook.controller.js";
import { TelegramRepo } from "./telegram.repo.js";

/** The Telegram prescription bot (docs/TELEGRAM-BOT.md): webhook in, the rx pipeline and AI chat behind it. */
@Module({
  imports: [AdsModule, AiRuntimeModule, CreditsModule, FilesModule, PlansModule, RxModule],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramRepo,
    TelegramTokenService,
    TelegramApiClient,
    TelegramAnalysisService,
    TelegramChatService,
    TelegramAdsService,
    TelegramPdfQueue,
    TelegramPdfService,
    TelegramBotService,
  ],
  exports: [TelegramTokenService, TelegramApiClient, TelegramRepo],
})
export class TelegramBotModule {}
