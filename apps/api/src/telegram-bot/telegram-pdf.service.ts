import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../common/redis.js";
import { ObjectStorage } from "../files/object-storage.js";
import { RxService } from "../rx/rx.service.js";

import { TelegramApiError, type SentMessage, type TelegramApi } from "./telegram-api.client.js";
import { tg } from "./telegram-i18n.js";
import { pdfRetryKeyboard } from "./telegram-keyboards.js";
import { TelegramPdfQueue } from "./telegram-pdf-queue.js";

import type { BotLocale } from "./telegram-types.js";
import type { AuthenticatedUser } from "../common/current-user.js";

/** A finished PDF is reused for a week: same analysis, same language, same file. */
export const PDF_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const PDF_RENDER_TIMEOUT_MS = 45_000;
/** Telegram accepts 50 MB from bots; an analysis PDF is a few hundred KB, so this is a sanity cap. */
const PDF_MAX_BYTES = 20 * 1024 * 1024;
/** Keeps a double tap on the button from rendering the same file twice. */
const LOCK_TTL_SECONDS = 60;

export interface PdfContext {
  tg: TelegramApi;
  chatId: number;
  user: AuthenticatedUser;
  locale: BotLocale;
}

export const pdfCacheKey = (rxId: string, locale: BotLocale): string => `tg:pdf:${rxId}:${locale}`;

/**
 * Sends the PDF of an analysis as a Telegram document. The worker (the only place with Typst) renders
 * it; the api reads the stored bytes and uploads them, so Telegram never fetches a URL of ours.
 * Ownership is the rx service's. A failure is shown on the progress message with a retry button and
 * never touches the text result already delivered.
 */
@Injectable()
export class TelegramPdfService {
  constructor(
    private readonly rx: RxService,
    private readonly storage: ObjectStorage,
    private readonly queue: TelegramPdfQueue,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("TelegramPdf");
  }

  /** True when the document went out. Only a blocked bot is rethrown (the router remembers it). */
  async sendPdf(ctx: PdfContext, rxId: string): Promise<boolean> {
    const { tg: api, chatId, locale } = ctx;
    const view = await this.rx.get(ctx.user, rxId).catch(() => null);
    if (view?.status !== "done" || view.result === null) {
      await api.sendMessage(chatId, tg(locale, "rx.notFound"));
      return false;
    }
    const lockKey = `tg:pdf:lock:${rxId}:${locale}`;
    if ((await this.redis.set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX")) !== "OK") {
      await api.sendMessage(chatId, tg(locale, "pdf.preparing"));
      return false;
    }
    let progress: SentMessage | null = null;
    try {
      await api.sendChatAction(chatId, "upload_document").catch(() => undefined);
      progress = await api.sendMessage(chatId, tg(locale, "pdf.preparing"));
      const bytes = await this.bytesOf(rxId, locale);
      await api.sendDocument(
        chatId,
        {
          bytes,
          filename: `wasfa-analysis-${view.createdAt.slice(0, 10)}.pdf`,
          contentType: "application/pdf",
        },
        { caption: tg(locale, "pdf.caption") },
      );
      // ads: after_pdf wired by the main session
      await api.deleteMessage(chatId, progress.message_id).catch(() => undefined);
      return true;
    } catch (error) {
      if (error instanceof TelegramApiError && error.isBlocked) throw error;
      this.logger.warn(
        {
          rxId,
          error: error instanceof Error ? error.name : "unknown",
          reason: error instanceof Error ? error.message.slice(0, 120) : undefined,
        },
        "Telegram PDF failed",
      );
      const options = { replyMarkup: pdfRetryKeyboard(locale, rxId) };
      const text = tg(locale, "pdf.failed");
      if (progress === null) await api.sendMessage(chatId, text, options).catch(() => undefined);
      else
        await api
          .editMessageText(chatId, progress.message_id, text, options)
          .catch(() => undefined);
      return false;
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /** The PDF bytes: from the cached key when the object is still there, else a fresh render. */
  private async bytesOf(rxId: string, locale: BotLocale): Promise<Uint8Array> {
    const cacheKey = pdfCacheKey(rxId, locale);
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      try {
        return await this.storage.getBytes(cached, PDF_MAX_BYTES);
      } catch {
        // The object is gone (storage cleanup): render again.
      }
    }
    const key = await this.queue.render({ analysisId: rxId, locale }, PDF_RENDER_TIMEOUT_MS);
    await this.redis.set(cacheKey, key, "EX", PDF_CACHE_TTL_SECONDS);
    return this.storage.getBytes(key, PDF_MAX_BYTES);
  }
}
