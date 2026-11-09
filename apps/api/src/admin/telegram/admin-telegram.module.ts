import { Module } from "@nestjs/common";

import { TelegramBotModule } from "../../telegram-bot/telegram-bot.module.js";

import { AdminTelegramController } from "./admin-telegram.controller.js";
import { AdminTelegramRepo } from "./admin-telegram.repo.js";
import { AdminTelegramService } from "./admin-telegram.service.js";

/** The admin panel of the Telegram bot (`/admin/telegram`). */
@Module({
  imports: [TelegramBotModule],
  controllers: [AdminTelegramController],
  providers: [AdminTelegramRepo, AdminTelegramService],
})
export class AdminTelegramModule {}
