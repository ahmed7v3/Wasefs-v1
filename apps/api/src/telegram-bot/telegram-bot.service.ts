import { Inject, Injectable } from "@nestjs/common";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { rxListQuerySchema } from "@wasfa/shared/schemas/rx";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { CreditsService } from "../credits/credits.service.js";
import { RxService } from "../rx/rx.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { agentUser } from "../wa-agent/commerce/agent-user.js";

import { TelegramAdsService } from "./telegram-ads.service.js";
import { PHOTO_MAX_BYTES, TelegramAnalysisService } from "./telegram-analysis.service.js";
import { TelegramApiClient, TelegramApiError, type TelegramApi } from "./telegram-api.client.js";
import { TelegramChatService } from "./telegram-chat.service.js";
import { tg, type TelegramKey } from "./telegram-i18n.js";
import {
  confirmUnlink,
  contactKeyboard,
  historyKeyboard,
  languageKeyboard,
  mainMenu,
  parseCallback,
  quickReplies,
  urlKeyboard,
} from "./telegram-keyboards.js";
import { phoneFromContact } from "./telegram-link.js";
import { chatRateVerdict } from "./telegram-rate-limit.js";
import { escapeHtml, modelTextToHtml, summaryMessages } from "./telegram-render.js";
import { bumpStat } from "./telegram-stats.js";
import { TelegramTokenService } from "./telegram-token.service.js";
import { TelegramRepo } from "./telegram.repo.js";

import type {
  BotLocale,
  ReplyMarkup,
  TelegramMessage,
  TelegramPhoto,
  TelegramUpdate,
} from "./telegram-types.js";
import type { AuthenticatedUser } from "../common/current-user.js";
import type { ApiEnv } from "../config/env.js";
import type { TelegramChat, TelegramProfile } from "@wasfa/db";
import type { TelegramBotSettings } from "@wasfa/shared/settings";

const UPDATE_TTL_SECONDS = 3_600;
const GROUP_DEBOUNCE_MS = 2_500;
const GROUP_TTL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export type TelegramSender = NonNullable<TelegramMessage["from"]>;

/** The profile Telegram reports for the sender; null when the update has no sender (never logged). */
export function profileOf(from: TelegramSender | undefined): TelegramProfile | undefined {
  if (from === undefined) return undefined;
  const text = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : null;
  return {
    telegramUserId: from.id,
    username: text(from["username"]),
    firstName: text(from["first_name"]),
    lastName: text(from["last_name"]),
    languageCode: text(from["language_code"]),
  };
}

/** Everything a handler needs about the update in hand. */
interface Ctx {
  api: TelegramApi;
  chat: TelegramChat;
  chatId: number;
  locale: BotLocale;
  settings: TelegramBotSettings;
}

/**
 * The router of the Telegram bot: one update in, replies out. It decides who the person is (a chat is
 * linked to an account only by Telegram's own "share my number" proof), enforces the switch and the
 * per-chat rate limit, and sends everything that costs money or tokens through the services the web
 * and WhatsApp already use. Privacy: no message text, name, phone or token is ever logged.
 */
@Injectable()
export class TelegramBotService {
  /** Debounce of a media group (an album is one analysis); tests shorten it. */
  readonly timing = { groupDebounceMs: GROUP_DEBOUNCE_MS };
  /** How an update is run after the 200 went out; tests await it directly. */
  schedule: (job: () => Promise<void>) => void = (job) => {
    setImmediate(() => {
      void job();
    });
  };

  constructor(
    private readonly tokens: TelegramTokenService,
    private readonly client: TelegramApiClient,
    private readonly repo: TelegramRepo,
    private readonly settings: SettingsService,
    private readonly analysis: TelegramAnalysisService,
    private readonly conversation: TelegramChatService,
    private readonly ads: TelegramAdsService,
    private readonly credits: CreditsService,
    private readonly rx: RxService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("TelegramBot");
  }

  /**
   * Takes a verified webhook delivery: a repeated `update_id` (Telegram redelivers when we are slow)
   * is dropped, the rest is processed after the webhook answered. Returns whether it was new.
   */
  async accept(update: TelegramUpdate): Promise<boolean> {
    const first = await this.redis.set(
      `tg:upd:${String(update.update_id)}`,
      "1",
      "EX",
      UPDATE_TTL_SECONDS,
      "NX",
    );
    if (first !== "OK") return false;
    this.schedule(() => this.process(update));
    return true;
  }

  async process(update: TelegramUpdate): Promise<void> {
    const token = await this.tokens.get();
    if (token === null) return;
    const api = this.client.bind(token);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    try {
      if (update.callback_query) {
        const query = update.callback_query;
        // Answered first, always: the spinner on the button stops whatever happens next.
        await api.answerCallbackQuery(query.id).catch(() => undefined);
        if (chatId === undefined || query.data === undefined) return;
        const ctx = await this.context(api, chatId, query.from.id === chatId, query.from);
        if (ctx !== null) await this.onCallback(ctx, query.data);
        return;
      }
      const message = update.message;
      if (message === undefined) return;
      const ctx = await this.context(
        api,
        message.chat.id,
        message.chat.type === "private",
        message.from,
      );
      if (ctx !== null) await this.onMessage(ctx, message);
    } catch (error) {
      await this.onFailure(api, chatId, error);
    }
  }

  // --- gatekeeping -----------------------------------------------------------------------------

  /** The chat's state after the switch and the rate limit; null = nothing more to do for this update. */
  private async context(
    api: TelegramApi,
    chatId: number,
    isPrivate: boolean,
    from: TelegramSender | undefined,
  ): Promise<Ctx | null> {
    // Every update refreshes the profile and last_seen_at (one cheap upsert).
    const chat = await this.repo.chat(chatId, isPrivate ? profileOf(from) : undefined);
    const locale = chat.locale;
    if (!isPrivate) {
      await api.sendMessage(chatId, tg(locale, "chat.private"));
      return null;
    }
    const settings = await this.settings.get("telegramBot");
    if (!settings.enabled) {
      await api.sendMessage(chatId, tg(locale, "disabled"));
      return null;
    }
    const verdict = await chatRateVerdict(this.redis, chatId, Date.now());
    if (verdict !== "ok") {
      if (verdict === "warn") await api.sendMessage(chatId, tg(locale, "rate.limited"));
      return null;
    }
    if (chat.blocked) await this.repo.patchChat(chatId, { blocked: false });
    void bumpStat(this.redis, "messages");
    return { api, chat, chatId, locale, settings };
  }

  /** A blocked bot is remembered (nothing is sent there again); anything else is logged by name only. */
  private async onFailure(
    api: TelegramApi,
    chatId: number | undefined,
    error: unknown,
  ): Promise<void> {
    if (error instanceof TelegramApiError && error.isBlocked && chatId !== undefined) {
      await this.repo.patchChat(chatId, { blocked: true }).catch(() => undefined);
      return;
    }
    this.logger.error(
      {
        error: error instanceof Error ? error.name : "unknown",
        code: error instanceof TelegramApiError ? error.code : undefined,
      },
      "Telegram update failed",
    );
    if (chatId === undefined) return;
    const chat = await this.repo.chat(chatId).catch(() => null);
    await api.sendMessage(chatId, tg(chat?.locale ?? "ar", "error.generic")).catch(() => undefined);
  }

  // --- messages --------------------------------------------------------------------------------

  private async onMessage(ctx: Ctx, message: TelegramMessage): Promise<void> {
    if (message.contact) return this.link(ctx, message);
    const photos = this.photosOf(message);
    if (photos === "unsupported") {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "photo.unsupported"));
      return;
    }
    if (photos !== null) return this.onPhoto(ctx, message, photos);
    const text = message.text?.trim();
    if (text === undefined || text === "") {
      await this.menu(ctx, "unsupported");
      return;
    }
    if (text.startsWith("/")) return this.onCommand(ctx, text);
    return this.onText(ctx, text);
  }

  private async onCommand(ctx: Ctx, text: string): Promise<void> {
    // "/start@wasfa_bot payload" -> "start"
    const command = (text.split(/\s+/)[0] ?? "").slice(1).split("@")[0]?.toLowerCase() ?? "";
    switch (command) {
      case "start":
        return this.start(ctx);
      case "new":
        return this.newChat(ctx);
      case "balance":
        return this.balance(ctx);
      case "history":
        return this.history(ctx);
      case "last":
        return this.last(ctx);
      case "language":
        await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "lang.pick"), {
          replyMarkup: languageKeyboard(ctx.locale),
        });
        return;
      case "help":
        return this.help(ctx);
      case "link":
        return this.askLink(ctx);
      case "unlink":
        return this.askUnlink(ctx);
      case "support":
        return this.support(ctx);
      default:
        return this.menu(ctx, "menu.title");
    }
  }

  // --- callbacks -------------------------------------------------------------------------------

  private async onCallback(ctx: Ctx, data: string): Promise<void> {
    const { verb, arg } = parseCallback(data);
    switch (verb) {
      case "menu":
        return this.onMenu(ctx, arg);
      case "rx":
        return this.withUser(ctx, (user) => this.openRx(ctx, user, arg));
      case "rerun":
        return this.withUser(ctx, (user) =>
          UUID.test(arg)
            ? this.analysis.rerun(this.analysisCtx(ctx, user), arg)
            : Promise.resolve(),
        );
      case "ask":
        return this.withUser(ctx, (user) => this.ask(ctx, user, arg));
      case "sum":
        return this.withUser(ctx, (user) => this.summary(ctx, user, arg));
      case "unlink":
        return this.unlink(ctx, arg === "yes");
      case "lang":
        return this.setLanguage(ctx, arg === "en" ? "en" : "ar");
      default:
        return;
    }
  }

  private async onMenu(ctx: Ctx, action: string): Promise<void> {
    switch (action) {
      case "analyze":
        await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "photo.hint"));
        return;
      case "balance":
        return this.balance(ctx);
      case "last":
        return this.last(ctx);
      case "history":
        return this.history(ctx);
      case "new":
        return this.newChat(ctx);
      case "lang":
        await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "lang.pick"), {
          replyMarkup: languageKeyboard(ctx.locale),
        });
        return;
      case "help":
        return this.help(ctx);
      case "support":
        return this.support(ctx);
      default:
        return;
    }
  }

  // --- features --------------------------------------------------------------------------------

  private async start(ctx: Ctx): Promise<void> {
    if (ctx.chat.startedAt === null) {
      await this.repo.patchChat(ctx.chatId, { startedAt: new Date() });
    }
    const custom = ctx.locale === "en" ? ctx.settings.welcomeEn : ctx.settings.welcomeAr;
    // The admin's text is plain text: escaped, never trusted as markup.
    const welcome = custom.trim() === "" ? tg(ctx.locale, "welcome.default") : escapeHtml(custom);
    await ctx.api.sendMessage(ctx.chatId, welcome, { replyMarkup: this.menuMarkup(ctx) });
    if (ctx.chat.userId === null) {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "welcome.unlinked"), {
        replyMarkup: contactKeyboard(ctx.locale),
      });
    }
  }

  private async menu(ctx: Ctx, key: TelegramKey): Promise<void> {
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, key), {
      replyMarkup: this.menuMarkup(ctx),
    });
  }

  private async help(ctx: Ctx): Promise<void> {
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "help.text"), {
      replyMarkup: this.menuMarkup(ctx),
    });
  }

  private async support(ctx: Ctx): Promise<void> {
    const username = ctx.settings.supportUsername.replace(/^@/, "");
    if (username === "") {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "support.none"));
      return;
    }
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "support.text"), {
      replyMarkup: urlKeyboard(tg(ctx.locale, "btn.support"), `https://t.me/${username}`),
    });
  }

  /** "محادثة جديدة": the model forgets this chat's messages and analysis; history keeps every analysis. */
  private async newChat(ctx: Ctx): Promise<void> {
    await this.repo.patchChat(ctx.chatId, { contextResetAt: new Date(), lastRxId: null });
    await this.menu(ctx, "new.done");
  }

  private async setLanguage(ctx: Ctx, locale: BotLocale): Promise<void> {
    await this.repo.patchChat(ctx.chatId, { locale });
    await ctx.api.sendMessage(ctx.chatId, tg(locale, "lang.changed"), {
      replyMarkup: mainMenu(locale, this.supportOf(ctx)),
    });
  }

  private async balance(ctx: Ctx): Promise<void> {
    await this.withUser(ctx, async (user) => {
      const [rx, wallet] = await Promise.all([
        this.settings.get("rx"),
        this.credits.forUser(user.id),
      ]);
      const price = rx.creditsPerPage;
      const left = price > 0 ? Math.floor(wallet.wallet.balance / price) : 0;
      await ctx.api.sendMessage(
        ctx.chatId,
        tg(ctx.locale, "balance.text", { balance: wallet.wallet.balance, price, left }),
        { replyMarkup: urlKeyboard(tg(ctx.locale, "btn.topup"), `${this.webOrigin()}/pricing`) },
      );
    });
  }

  private async history(ctx: Ctx): Promise<void> {
    await this.withUser(ctx, async (user) => {
      const list = await this.rx.list(user, rxListQuerySchema.parse({ limit: 5 }));
      const done = list.items.filter((item) => item.status === "done");
      if (done.length === 0) {
        await this.menu(ctx, "history.empty");
        return;
      }
      const items = done.map((item) => ({
        id: item.id,
        label: [
          tg(ctx.locale, "history.item", {
            date: item.createdAt.slice(0, 10),
            count: item.itemCount,
          }),
          ...item.itemNames.slice(0, 1),
        ]
          .join(" — ")
          .slice(0, 60),
      }));
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "history.title"), {
        replyMarkup: historyKeyboard(items),
      });
    });
  }

  private async last(ctx: Ctx): Promise<void> {
    await this.withUser(ctx, async (user) => {
      const list = await this.rx.list(user, rxListQuerySchema.parse({ limit: 1 }));
      const latest = list.items[0];
      if (latest === undefined) {
        await this.menu(ctx, "last.none");
        return;
      }
      await this.analysis.reopen(this.analysisCtx(ctx, user), latest.id);
    });
  }

  private async openRx(ctx: Ctx, user: AuthenticatedUser, id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await this.analysis.reopen(this.analysisCtx(ctx, user), id);
  }

  /** "اسأل عن النتيجة": makes the analysis active, after the rx service proved it is the user's. */
  private async ask(ctx: Ctx, user: AuthenticatedUser, id: string): Promise<void> {
    const view = UUID.test(id) ? await this.rx.get(user, id).catch(() => null) : null;
    if (view?.status !== "done") {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "rx.notFound"));
      return;
    }
    await this.repo.patchChat(ctx.chatId, { lastRxId: view.id });
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "ask.prompt"));
  }

  private async summary(ctx: Ctx, user: AuthenticatedUser, id: string): Promise<void> {
    const view = UUID.test(id) ? await this.rx.get(user, id).catch(() => null) : null;
    if (view?.result == null) {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "rx.notFound"));
      return;
    }
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "rx.copyHint"));
    for (const part of summaryMessages(view.result, ctx.locale)) {
      await ctx.api.sendMessage(ctx.chatId, part);
    }
  }

  // --- linking ---------------------------------------------------------------------------------

  private async askLink(ctx: Ctx): Promise<void> {
    if (ctx.chat.userId !== null) {
      await this.menu(ctx, "link.already");
      return;
    }
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "link.ask"), {
      replyMarkup: contactKeyboard(ctx.locale),
    });
  }

  private async link(ctx: Ctx, message: TelegramMessage): Promise<void> {
    const attempt = phoneFromContact(message);
    if (!attempt.ok) {
      const key: TelegramKey =
        attempt.reason === "not_private"
          ? "link.private"
          : attempt.reason === "invalid_phone"
            ? "link.invalid"
            : "link.notOwn";
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, key));
      return;
    }
    // The person tapped the share button: the number is kept even when no account matches.
    await this.repo.patchChat(ctx.chatId, { phone: attempt.phone, phoneSharedAt: new Date() });
    const userId = await this.repo.userIdByPhone(attempt.phone);
    const row = userId === null ? null : await this.repo.user(userId);
    if (row?.status !== "active") {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "link.noAccount"), {
        replyMarkup: urlKeyboard(tg(ctx.locale, "btn.signup"), `${this.webOrigin()}/register`),
      });
      return;
    }
    await this.repo.patchChat(ctx.chatId, { userId: row.id });
    await ctx.api.sendMessage(
      ctx.chatId,
      tg(ctx.locale, "link.success", { name: escapeHtml(row.name.split(" ")[0] ?? "") }),
      { replyMarkup: mainMenu(ctx.locale, this.supportOf(ctx)) },
    );
    this.logger.info({ chatId: ctx.chatId }, "Telegram chat linked");
  }

  private async askUnlink(ctx: Ctx): Promise<void> {
    if (ctx.chat.userId === null) {
      await this.menu(ctx, "unlink.none");
      return;
    }
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "unlink.confirm"), {
      replyMarkup: confirmUnlink(ctx.locale),
    });
  }

  private async unlink(ctx: Ctx, confirmed: boolean): Promise<void> {
    if (!confirmed) return this.menu(ctx, "menu.title");
    await this.repo.patchChat(ctx.chatId, {
      userId: null,
      phone: null,
      phoneSharedAt: null,
      lastRxId: null,
      contextResetAt: new Date(),
    });
    await this.menu(ctx, "unlink.done");
  }

  // --- photos and questions --------------------------------------------------------------------

  /** The picture of a message, null when it has none, "unsupported" for a file that is not an image. */
  private photosOf(message: TelegramMessage): TelegramPhoto[] | "unsupported" | null {
    const sizes = message.photo;
    if (sizes !== undefined && sizes.length > 0) {
      // Sizes come smallest first: the last is the original.
      const best = sizes[sizes.length - 1];
      if (best === undefined) return null;
      return [
        {
          fileId: best.file_id,
          uniqueId: best.file_unique_id,
          mime: "image/jpeg",
          bytes: best.file_size ?? 0,
        },
      ];
    }
    const document = message.document;
    if (document === undefined) return null;
    const mime = IMAGE_MIMES.find((candidate) => candidate === document.mime_type);
    if (mime === undefined) return "unsupported";
    return [
      {
        fileId: document.file_id,
        uniqueId: document.file_unique_id,
        mime,
        bytes: document.file_size ?? 0,
      },
    ];
  }

  private async onPhoto(
    ctx: Ctx,
    message: TelegramMessage,
    photos: TelegramPhoto[],
  ): Promise<void> {
    const user = await this.userOf(ctx);
    if (user === null) return this.gate(ctx);
    if (photos.some((photo) => photo.bytes > PHOTO_MAX_BYTES)) {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "photo.tooBig"));
      return;
    }
    if (message.media_group_id === undefined) {
      await this.analysis.analyze(this.analysisCtx(ctx, user), photos);
      return;
    }
    await this.collectGroup(ctx, user, message.media_group_id, photos);
  }

  /**
   * An album arrives as one update per picture. Each is pushed to a Redis list; the first one starts a
   * 2.5 s timer (an NX lock, so another api instance cannot start a second one) and then everything
   * collected is ONE analysis.
   */
  private async collectGroup(
    ctx: Ctx,
    user: AuthenticatedUser,
    groupId: string,
    photos: TelegramPhoto[],
  ): Promise<void> {
    const listKey = `tg:mg:${String(ctx.chatId)}:${groupId}`.slice(0, 120);
    for (const photo of photos) await this.redis.rpush(listKey, JSON.stringify(photo));
    await this.redis.expire(listKey, GROUP_TTL_SECONDS);
    const first = await this.redis.set(`${listKey}:lock`, "1", "EX", GROUP_TTL_SECONDS, "NX");
    if (first !== "OK") return;
    setTimeout(() => {
      void this.flushGroup(ctx, user, listKey).catch((error: unknown) =>
        this.onFailure(ctx.api, ctx.chatId, error),
      );
    }, this.timing.groupDebounceMs);
  }

  private async flushGroup(ctx: Ctx, user: AuthenticatedUser, listKey: string): Promise<void> {
    const raw = await this.redis.lrange(listKey, 0, RX_MAX_PAGES * 2);
    await this.redis.del(listKey);
    const photos = raw.map((entry) => JSON.parse(entry) as TelegramPhoto).slice(0, RX_MAX_PAGES);
    if (photos.length === 0) return;
    await this.analysis.analyze(this.analysisCtx(ctx, user), photos);
  }

  private async onText(ctx: Ctx, text: string): Promise<void> {
    const user = await this.userOf(ctx);
    if (user === null) return this.gate(ctx);
    if (ctx.chat.lastRxId === null) {
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "followup.noRx"), {
        replyMarkup: this.menuMarkup(ctx),
      });
      return;
    }
    await ctx.api.sendChatAction(ctx.chatId, "typing").catch(() => undefined);
    try {
      const answer = await this.conversation.answer(user, ctx.chat, ctx.locale, text);
      if (answer === null) {
        await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "followup.noRx"), {
          replyMarkup: this.menuMarkup(ctx),
        });
        return;
      }
      await ctx.api.sendMessage(ctx.chatId, modelTextToHtml(answer), {
        replyMarkup: quickReplies(ctx.locale),
      });
      await this.ads.sendAfterDelivery(
        ctx.api,
        { chatId: ctx.chatId, userId: user.id },
        ctx.locale,
      );
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      this.logger.warn(
        { error: error instanceof Error ? error.name : "unknown" },
        "Telegram follow-up failed",
      );
      await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "followup.error"), {
        replyMarkup: quickReplies(ctx.locale),
      });
    }
  }

  // --- helpers ---------------------------------------------------------------------------------

  /** The friendly gate of every account-only feature: share the number, or sign up. Never an error. */
  private async gate(ctx: Ctx): Promise<void> {
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "gate.unlinked"), {
      replyMarkup: contactKeyboard(ctx.locale),
    });
    await ctx.api.sendMessage(ctx.chatId, tg(ctx.locale, "link.ask"), {
      replyMarkup: urlKeyboard(tg(ctx.locale, "btn.signup"), `${this.webOrigin()}/register`),
    });
  }

  /** Runs `run` for the linked account, or shows the gate. */
  private async withUser(ctx: Ctx, run: (user: AuthenticatedUser) => Promise<void>): Promise<void> {
    const user = await this.userOf(ctx);
    if (user === null) return this.gate(ctx);
    await run(user);
  }

  /** The account a chat is linked to, as the plain customer; a suspended or deleted one reads as unlinked. */
  private async userOf(ctx: Ctx): Promise<AuthenticatedUser | null> {
    if (ctx.chat.userId === null) return null;
    const row = await this.repo.user(ctx.chat.userId);
    return row?.status === "active" ? agentUser(row, new Date()) : null;
  }

  private analysisCtx(ctx: Ctx, user: AuthenticatedUser) {
    return {
      tg: ctx.api,
      chatId: ctx.chatId,
      user,
      locale: ctx.locale,
      webOrigin: this.webOrigin(),
    };
  }

  private menuMarkup(ctx: Ctx): ReplyMarkup {
    return mainMenu(ctx.locale, this.supportOf(ctx));
  }

  private supportOf(ctx: Ctx): string | null {
    const username = ctx.settings.supportUsername.replace(/^@/, "");
    return username === "" ? null : username;
  }

  private webOrigin(): string {
    return this.env.WEB_ORIGIN[0] ?? "";
  }
}
