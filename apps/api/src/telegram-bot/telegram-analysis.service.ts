import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { isAppError } from "@wasfa/shared/errors";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../common/redis.js";
import { CreditsService } from "../credits/credits.service.js";
import { FilesService } from "../files/files.service.js";
import { ObjectStorage } from "../files/object-storage.js";
import { RxService } from "../rx/rx.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { usageReason } from "../wa-agent/commerce/usage-errors.js";

import { TelegramAdsService } from "./telegram-ads.service.js";
import { TelegramApiError, type TelegramApi } from "./telegram-api.client.js";
import { tg, type TelegramKey } from "./telegram-i18n.js";
import { resultKeyboard, retryKeyboard, urlKeyboard } from "./telegram-keyboards.js";
import { TelegramPdfService } from "./telegram-pdf.service.js";
import { formatAnalysis } from "./telegram-render.js";
import { bumpStat } from "./telegram-stats.js";
import { TelegramRepo } from "./telegram.repo.js";

import type { BotLocale, ReplyMarkup, TelegramPhoto } from "./telegram-types.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { RxView } from "@wasfa/shared/schemas/rx";

/** Telegram photos are at most 10 MB for bots to download in practice; also the upload limit of the web. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PROCESSING_WAIT_MS = 30_000;
const PROCESSING_POLL_MS = 1_000;
const POLL_EVERY_MS = 2_000;
const POLL_MAX_MS = 180_000;
/** The same pictures within this window are one analysis (never charged twice). */
const DEDUPE_TTL_SECONDS = 3_600;

export interface AnalysisContext {
  tg: TelegramApi;
  chatId: number;
  user: AuthenticatedUser;
  locale: BotLocale;
  /** Web app origin, for the "full result" and "top up" buttons. */
  webOrigin: string;
}

const STAGE_OF_STATUS: Record<string, TelegramKey> = {
  queued: "stage.reading",
  processing: "stage.reading",
  verifying: "stage.matching",
};

/**
 * The photo flow: pictures from Telegram become the user's own `rx_page` files and go through
 * `RxService.create`, the same entry as the web and WhatsApp (credit hold, quota, kill switch, page
 * limits). Billing is entirely the rx service's; this class never touches a balance except to read it
 * for the "not enough credits" message.
 */
@Injectable()
export class TelegramAnalysisService {
  /** Waits of the status poll; tests shorten them. */
  readonly timing = {
    pollEveryMs: POLL_EVERY_MS,
    pollMaxMs: POLL_MAX_MS,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };

  constructor(
    private readonly files: FilesService,
    private readonly rx: RxService,
    private readonly credits: CreditsService,
    private readonly settings: SettingsService,
    private readonly storage: ObjectStorage,
    private readonly repo: TelegramRepo,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
    private readonly telegramAds: TelegramAdsService,
    private readonly pdf: TelegramPdfService,
  ) {
    this.logger.setContext("TelegramAnalysis");
  }

  /** Reads the pictures as one analysis and reports progress by editing one message. */
  async analyze(ctx: AnalysisContext, photos: readonly TelegramPhoto[]): Promise<void> {
    const { tg: api, chatId, locale } = ctx;
    const dedupeKey = this.dedupeKey(chatId, photos);
    const claimed = await this.redis.set(dedupeKey, "pending", "EX", DEDUPE_TTL_SECONDS, "NX");
    if (claimed !== "OK") {
      const known = await this.redis.get(dedupeKey);
      // Finished before: show it again, free of charge. Still running: say so.
      if (known !== null && known !== "pending") {
        await this.reopen(ctx, known);
        return;
      }
      await api.sendMessage(chatId, tg(locale, "rx.pending"));
      return;
    }
    let started = false;
    try {
      await api.sendChatAction(chatId, "upload_photo").catch(() => undefined);
      const progress = await api.sendMessage(chatId, tg(locale, "stage.received"));
      const stage = this.stageEditor(ctx, progress.message_id);

      const fileIds = await this.importPhotos(ctx, photos);
      if (typeof fileIds === "string") {
        await stage(fileIds, retryKeyboard(locale, null));
        return;
      }
      await stage("stage.reading");
      const created = await this.rx.create(ctx.user, { fileIds, mode: "balanced" });
      started = true;
      await this.redis.set(dedupeKey, created.id, "EX", DEDUPE_TTL_SECONDS);
      void bumpStat(this.redis, "analyses");
      this.logger.info({ rxId: created.id, pages: fileIds.length }, "Telegram analysis started");

      const view = await this.waitFor(ctx, created.id, stage);
      if (view === null) {
        await stage("rx.timeout", retryKeyboard(locale, null));
        return;
      }
      if (view.status !== "done") {
        await this.redis.del(dedupeKey);
        await stage("rx.failed", retryKeyboard(locale, created.id));
        return;
      }
      await stage("stage.done");
      await this.sendResult(ctx, view, { fresh: true });
    } catch (error) {
      if (!started) await this.redis.del(dedupeKey).catch(() => undefined);
      await this.explain(ctx, error, photos.length);
    }
  }

  /** Re-runs an analysis on its own stored pages (an identical one is answered from the rx cache, free). */
  async rerun(ctx: AnalysisContext, rxId: string): Promise<void> {
    const { tg: api, chatId, locale } = ctx;
    let view: RxView;
    try {
      view = await this.rx.get(ctx.user, rxId);
    } catch {
      await api.sendMessage(chatId, tg(locale, "rx.notFound"));
      return;
    }
    const fileIds = view.files.filter((file) => !file.imageDeleted).map((file) => file.fileId);
    if (fileIds.length === 0 || fileIds.length < view.files.length) {
      await api.sendMessage(chatId, tg(locale, "rx.rerunGone"), {
        replyMarkup: retryKeyboard(locale, null),
      });
      return;
    }
    const progress = await api.sendMessage(chatId, tg(locale, "rx.again"));
    const stage = this.stageEditor(ctx, progress.message_id);
    try {
      const created = await this.rx.create(ctx.user, { fileIds, mode: "balanced" });
      void bumpStat(this.redis, "analyses");
      const next = await this.waitFor(ctx, created.id, stage);
      if (next === null) {
        await stage("rx.timeout", retryKeyboard(locale, null));
      } else if (next.status !== "done") {
        await stage("rx.failed", retryKeyboard(locale, created.id));
      } else {
        await stage("stage.done");
        await this.sendResult(ctx, next, { fresh: true });
      }
    } catch (error) {
      await this.explain(ctx, error, fileIds.length);
    }
  }

  /** Shows a stored analysis of the user (ownership is the rx service's: someone else's id is not found). */
  async reopen(ctx: AnalysisContext, rxId: string): Promise<void> {
    const { tg: api, chatId, locale } = ctx;
    let view: RxView;
    try {
      view = await this.rx.get(ctx.user, rxId);
    } catch {
      await api.sendMessage(chatId, tg(locale, "rx.notFound"));
      return;
    }
    if (view.status === "done") {
      await this.sendResult(ctx, view);
    } else if (view.status === "failed" || view.status === "refunded") {
      await api.sendMessage(chatId, tg(locale, "rx.failedOld"));
    } else {
      await api.sendMessage(chatId, tg(locale, "rx.pending"));
    }
  }

  /**
   * The finished reading as messages, the buttons on the last one; it becomes the chat's active analysis.
   * A `fresh` result (just analysed, not reopened from history) is followed by its PDF when `autoPdf` is on.
   */
  async sendResult(
    ctx: AnalysisContext,
    view: RxView,
    options: { fresh?: boolean } = {},
  ): Promise<void> {
    const { tg: api, chatId, locale } = ctx;
    if (view.result === null) {
      await api.sendMessage(chatId, tg(locale, "rx.empty"));
      return;
    }
    const parts = formatAnalysis(view.result, locale);
    const keyboard = resultKeyboard(locale, view.id, `${ctx.webOrigin}/analyze/${view.id}`);
    for (const [index, part] of parts.entries()) {
      const last = index === parts.length - 1;
      await api.sendMessage(chatId, part, last ? { replyMarkup: keyboard } : {});
    }
    // The newest reading is what follow-up questions are about.
    await this.repo.patchChat(chatId, { lastRxId: view.id, contextResetAt: new Date() });
    if (options.fresh === true) this.autoPdf(ctx, view.id);
    // After the result, never inside it: one separate ad message when the rules allow.
    await this.telegramAds.sendAfterDelivery(api, { chatId, userId: ctx.user.id }, locale);
  }

  /**
   * Starts the PDF after the text result, without waiting for it (a render takes seconds): the text
   * is already delivered, and any failure is the PDF service's to show on its own message.
   */
  private autoPdf(ctx: AnalysisContext, rxId: string): void {
    void (async () => {
      if (!(await this.settings.get("telegramBot")).autoPdf) return;
      await this.pdf.sendPdf(ctx, rxId);
    })().catch((error: unknown) => {
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram auto PDF failed",
      );
    });
  }

  /** The "not enough credits" message: price, balance and a top-up button. */
  async insufficient(ctx: AnalysisContext, pages: number): Promise<string> {
    const [rx, wallet] = await Promise.all([
      this.settings.get("rx"),
      this.credits.forUser(ctx.user.id),
    ]);
    return tg(ctx.locale, "rx.insufficient", {
      price: rx.creditsPerPage * pages,
      balance: wallet.wallet.balance,
    });
  }

  // --- internals -----------------------------------------------------------------------------

  private dedupeKey(chatId: number, photos: readonly TelegramPhoto[]): string {
    const ids = photos.map((photo) => photo.uniqueId).sort();
    return `tg:rx:${String(chatId)}:${ids.join(".")}`.slice(0, 200);
  }

  /** Edits the progress message; a failed edit (message gone, rate limit) never stops the analysis. */
  private stageEditor(ctx: AnalysisContext, messageId: number) {
    let shown: string | null = null;
    return async (key: TelegramKey, replyMarkup?: ReplyMarkup): Promise<void> => {
      const text = tg(ctx.locale, key);
      if (text === shown) return;
      shown = text;
      await ctx.tg
        .editMessageText(ctx.chatId, messageId, text, { replyMarkup })
        .catch(() => undefined);
    };
  }

  /** Downloads and imports every picture; a string result is the i18n key of why not. */
  private async importPhotos(
    ctx: AnalysisContext,
    photos: readonly TelegramPhoto[],
  ): Promise<string[] | TelegramKey> {
    const viewer = { id: ctx.user.id, orgIds: [] };
    const fileIds: string[] = [];
    for (const photo of photos) {
      let bytes: Uint8Array;
      try {
        bytes = await ctx.tg.downloadFile(photo.fileId, PHOTO_MAX_BYTES);
      } catch (error) {
        if (error instanceof TelegramApiError && error.code === 413) return "photo.tooBig";
        throw error;
      }
      // A temporary object in the bucket, imported as the user's own file and removed at once.
      const tempKey = `wa/tg/${randomUUID()}`;
      await this.storage.put(tempKey, bytes, photo.mime);
      try {
        fileIds.push(
          await this.files.importObject(viewer, {
            sourceKey: tempKey,
            purpose: "rx_page",
            mime: photo.mime,
            bytes: bytes.length,
          }),
        );
      } finally {
        await this.storage.remove(tempKey).catch(() => undefined);
      }
    }
    const statuses = await Promise.all(
      fileIds.map((fileId) =>
        this.files.awaitProcessed(viewer, fileId, {
          timeoutMs: PROCESSING_WAIT_MS,
          pollMs: PROCESSING_POLL_MS,
        }),
      ),
    );
    if (statuses.includes("rejected")) return "rx.unreadableImage";
    if (statuses.some((status) => status !== "processed")) return "rx.stillProcessing";
    return fileIds;
  }

  /** Polls every 2 s up to 3 min, moving the progress message with the status; null = still running. */
  private async waitFor(
    ctx: AnalysisContext,
    rxId: string,
    stage: (key: TelegramKey) => Promise<void>,
  ): Promise<RxView | null> {
    for (let waited = 0; waited <= this.timing.pollMaxMs; waited += this.timing.pollEveryMs) {
      const view = await this.rx.get(ctx.user, rxId);
      const next = STAGE_OF_STATUS[view.status];
      if (next === undefined) return view;
      await stage(next);
      await this.timing.sleep(this.timing.pollEveryMs);
    }
    return null;
  }

  /** A friendly message for a refusal; anything unknown is logged by name only and shown as generic. */
  private async explain(ctx: AnalysisContext, error: unknown, pages: number): Promise<void> {
    const { tg: api, chatId, locale } = ctx;
    if (error instanceof TelegramApiError && error.isBlocked) throw error;
    const reason = usageReason(error);
    if (reason === "insufficient_credits") {
      const text = await this.insufficient(ctx, pages);
      await api.sendMessage(chatId, text, {
        replyMarkup: urlKeyboard(tg(locale, "btn.topup"), `${ctx.webOrigin}/pricing`),
      });
      return;
    }
    const key: TelegramKey =
      reason === "quota_reached" || reason === "plan_feature"
        ? "rx.quota"
        : reason === "busy"
          ? "rx.busy"
          : reason === "unavailable"
            ? "rx.unavailable"
            : reason === "too_many_pages"
              ? "rx.tooMany"
              : "rx.failed";
    if (key === "rx.failed") {
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown", app: isAppError(error) },
        "Telegram analysis failed",
      );
    }
    const max = isAppError(error) ? Number(error.details?.["maxPages"] ?? 0) : 0;
    await api.sendMessage(chatId, tg(locale, key, { max }), {
      replyMarkup: retryKeyboard(locale, null),
    });
  }
}
