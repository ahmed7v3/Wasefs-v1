import { Module } from "@nestjs/common";

import { TelegramBotModule } from "../../telegram-bot/telegram-bot.module.js";

import { AdminTelegramAdsController } from "./admin-telegram-ads.controller.js";
import { AdminTelegramAdsService } from "./admin-telegram-ads.service.js";
import { AdminTelegramController } from "./admin-telegram.controller.js";
import { AdminTelegramRepo } from "./admin-telegram.repo.js";
import { AdminTelegramService } from "./admin-telegram.service.js";

/** The admin panel of the Telegram bot (`/admin/telegram`) and of its own ads (`/admin/telegram/ads`). */
@Module({
  imports: [TelegramBotModule],
  controllers: [AdminTelegramController, AdminTelegramAdsController],
  providers: [AdminTelegramRepo, AdminTelegramService, AdminTelegramAdsService],
})
export class AdminTelegramModule {}
