import { Injectable } from "@nestjs/common";

import type { ReplyMarkup } from "./telegram-types.js";

const API_ROOT = "https://api.telegram.org";
const REQUEST_TIMEOUT_MS = 20_000;
/** A 429 asking for a longer pause than this is not waited out inside one update. */
const MAX_RETRY_AFTER_SECONDS = 5;

/**
 * A refusal or failure of a Bot API call. The message is Telegram's own description or a fixed word:
 * never the request URL, which carries the bot token.
 */
export class TelegramApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }

  /** The user blocked the bot or left the chat: nothing more can be sent there. */
  get isBlocked(): boolean {
    return this.code === 403;
  }
}

export interface TelegramBotUser {
  id: number;
  username?: string;
  first_name: string;
}

export interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
}

export interface SentMessage {
  message_id: number;
}

export interface SendOptions {
  replyMarkup?: ReplyMarkup | undefined;
  /** Default true: every message the bot writes is HTML. */
  html?: boolean;
}

/** A file the bot uploads (photo or document): bytes, not a URL, so Telegram never has to fetch us. */
export interface TelegramUpload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

export interface SendMediaOptions extends SendOptions {
  /** Caption (HTML unless html is false). Photos: 1024 chars max; documents: 1024 too. */
  caption?: string | undefined;
}

export const BOT_COMMANDS = {
  ar: [
    ["start", "ابدأ"],
    ["menu", "القائمة الرئيسية"],
    ["new", "محادثة جديدة"],
    ["balance", "رصيدي"],
    ["history", "سجل التحليلات"],
    ["last", "آخر تحليل"],
    ["language", "تغيير اللغة"],
    ["help", "مساعدة"],
    ["link", "ربط الحساب"],
    ["unlink", "فصل الحساب"],
    ["support", "الدعم"],
  ],
  en: [
    ["start", "Start"],
    ["menu", "Main menu"],
    ["new", "New chat"],
    ["balance", "My balance"],
    ["history", "Analysis history"],
    ["last", "Last analysis"],
    ["language", "Change language"],
    ["help", "Help"],
    ["link", "Link account"],
    ["unlink", "Unlink account"],
    ["support", "Support"],
  ],
} as const;

type Fetch = typeof fetch;

/** One bot's Bot API, bound to its token. Built per update by `TelegramApiClient.bind`. */
export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  ) {}

  private async call<T>(method: string, body: Record<string, unknown> | FormData = {}): Promise<T> {
    const isForm = body instanceof FormData;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${API_ROOT}/bot${this.token}/${method}`, {
          method: "POST",
          // A FormData body sets its own multipart content type (with the boundary).
          ...(isForm ? {} : { headers: { "content-type": "application/json" } }),
          body: isForm ? body : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // Never keep the original error: its message can contain the URL (and so the token).
        throw new TelegramApiError(0, "network");
      }
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: T;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      } | null;
      if (payload?.ok === true) return payload.result as T;
      const code = payload?.error_code ?? response.status;
      const retryAfter = payload?.parameters?.retry_after;
      if (
        code === 429 &&
        attempt === 0 &&
        retryAfter !== undefined &&
        retryAfter <= MAX_RETRY_AFTER_SECONDS
      ) {
        await this.sleep(retryAfter * 1_000);
        continue;
      }
      throw new TelegramApiError(code, payload?.description ?? "request failed", retryAfter);
    }
  }

  getMe(): Promise<TelegramBotUser> {
    return this.call("getMe");
  }

  getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.call("getWebhookInfo");
  }

  setWebhook(url: string, secretToken: string): Promise<true> {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  }

  deleteWebhook(): Promise<true> {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }

  async setMyCommands(): Promise<void> {
    const commands = (list: readonly (readonly [string, string])[]) =>
      list.map(([command, description]) => ({ command, description }));
    // The default list is Arabic (the product's first language); English clients get their own.
    await this.call("setMyCommands", { commands: commands(BOT_COMMANDS.ar) });
    await this.call("setMyCommands", {
      commands: commands(BOT_COMMANDS.en),
      language_code: "en",
    });
  }

  sendMessage(chatId: number, text: string, options: SendOptions = {}): Promise<SentMessage> {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      ...(options.html === false ? {} : { parse_mode: "HTML" }),
      link_preview_options: { is_disabled: true },
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
  }

  private mediaForm(
    chatId: number,
    field: "photo" | "document",
    file: TelegramUpload,
    options: SendMediaOptions,
  ): FormData {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set(field, new Blob([Buffer.from(file.bytes)], { type: file.contentType }), file.filename);
    if (options.caption) {
      form.set("caption", options.caption);
      if (options.html !== false) form.set("parse_mode", "HTML");
    }
    if (options.replyMarkup) form.set("reply_markup", JSON.stringify(options.replyMarkup));
    return form;
  }

  /** Sends an image with an optional caption and inline buttons (a multipart upload). */
  sendPhoto(
    chatId: number,
    photo: TelegramUpload,
    options: SendMediaOptions = {},
  ): Promise<SentMessage> {
    return this.call("sendPhoto", this.mediaForm(chatId, "photo", photo, options));
  }

  /** Sends a file (the analysis PDF) as a downloadable document (a multipart upload). */
  sendDocument(
    chatId: number,
    file: TelegramUpload,
    options: SendMediaOptions = {},
  ): Promise<SentMessage> {
    return this.call("sendDocument", this.mediaForm(chatId, "document", file, options));
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    options: SendOptions = {},
  ): Promise<void> {
    try {
      await this.call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(options.html === false ? {} : { parse_mode: "HTML" }),
        link_preview_options: { is_disabled: true },
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      });
    } catch (error) {
      // Editing to the same text is "not modified": nothing to do.
      if (error instanceof TelegramApiError && error.message.includes("not modified")) return;
      throw error;
    }
  }

  /** Replaces the buttons under a message (an empty keyboard removes them); "not modified" is fine. */
  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    replyMarkup: ReplyMarkup,
  ): Promise<void> {
    try {
      await this.call("editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: replyMarkup,
      });
    } catch (error) {
      if (error instanceof TelegramApiError && error.message.includes("not modified")) return;
      throw error;
    }
  }

  /** Removes a message (the PDF progress line once the file is sent); the caller ignores a failure. */
  async deleteMessage(chatId: number, messageId: number): Promise<void> {
    await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  async sendChatAction(
    chatId: number,
    action: "typing" | "upload_photo" | "upload_document",
  ): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  /** The bytes of a file the user sent, refusing anything over `maxBytes`. */
  async downloadFile(fileId: string, maxBytes: number): Promise<Uint8Array> {
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", {
      file_id: fileId,
    });
    if (file.file_path === undefined) throw new TelegramApiError(404, "file_path missing");
    if ((file.file_size ?? 0) > maxBytes) throw new TelegramApiError(413, "file too large");
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_ROOT}/file/bot${this.token}/${file.file_path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new TelegramApiError(0, "network");
    }
    if (!response.ok) throw new TelegramApiError(response.status, "download failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new TelegramApiError(413, "file too large");
    return bytes;
  }
}

/** Builds the bound API; replaced in tests. */
@Injectable()
export class TelegramApiClient {
  bind(token: string): TelegramApi {
    return new TelegramApi(token);
  }
}
