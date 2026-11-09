import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { AdsWhatsappService } from "../ads/ads-whatsapp.service.js";
import { SettingsService } from "../settings/settings.service.js";

import { escapeHtml } from "./telegram-render.js";

import type { TelegramApi } from "./telegram-api.client.js";
import type { BotLocale } from "./telegram-types.js";

/**
 * The ad after a delivered result or answer, as ONE separate message. The selection is the WhatsApp
 * machinery (`AdsWhatsappService`): same creatives, floor (ads-free plans), caps, quiet hours, ad
 * label and tracked link. No analysis or message text reaches it. Switched off by
 * `telegramBot.adsEnabled`; any failure is logged by name only and never touches the reply.
 */
@Injectable()
export class TelegramAdsService {
  constructor(
    private readonly ads: AdsWhatsappService,
    private readonly settings: SettingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("TelegramAds");
  }

  async sendAfterDelivery(
    api: TelegramApi,
    chat: { chatId: number; userId: string | null },
    locale: BotLocale,
  ): Promise<void> {
    try {
      if (!(await this.settings.get("telegramBot")).adsEnabled) return;
      const offer = await this.ads.maybeTelegramAd(chat, "after_rx_done", {
        moment: "delivered",
        locale,
      });
      if (offer === null) return;
      await api.sendMessage(chat.chatId, escapeHtml(offer.text), {
        replyMarkup: { inline_keyboard: [[{ text: "🔗", url: offer.link }]] },
      });
      // Caps and the impression are recorded only after the message went out.
      await offer.confirmSent();
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram ad skipped",
      );
    }
  }
}
