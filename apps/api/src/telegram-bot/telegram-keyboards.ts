import { tg } from "./telegram-i18n.js";

import type { BotLocale, InlineButton, ReplyMarkup } from "./telegram-types.js";

/** Telegram refuses callback data over 64 bytes. */
export const CALLBACK_MAX_BYTES = 64;

/** `<verb>:<arg>`; throws when it would not fit, so an oversize id can never reach Telegram. */
export function callback(verb: string, arg = ""): string {
  const data = arg === "" ? verb : `${verb}:${arg}`;
  if (Buffer.byteLength(data) > CALLBACK_MAX_BYTES) throw new RangeError("callback data too long");
  return data;
}

/** The verb and argument of callback data; the argument may itself hold colons. */
export function parseCallback(data: string): { verb: string; arg: string } {
  const at = data.indexOf(":");
  return at < 0 ? { verb: data, arg: "" } : { verb: data.slice(0, at), arg: data.slice(at + 1) };
}

const button = (text: string, verb: string, arg = ""): InlineButton => ({
  text,
  callback_data: callback(verb, arg),
});

export function mainMenu(locale: BotLocale, support: string | null): ReplyMarkup {
  const supportButton: InlineButton =
    support === null || support === ""
      ? button(tg(locale, "btn.support"), "menu", "support")
      : { text: tg(locale, "btn.support"), url: `https://t.me/${support}` };
  return {
    inline_keyboard: [
      [button(tg(locale, "btn.analyze"), "menu", "analyze")],
      [
        button(tg(locale, "btn.balance"), "menu", "balance"),
        button(tg(locale, "btn.last"), "menu", "last"),
      ],
      [
        button(tg(locale, "btn.history"), "menu", "history"),
        button(tg(locale, "btn.new"), "menu", "new"),
      ],
      [
        button(tg(locale, "btn.language"), "menu", "lang"),
        button(tg(locale, "btn.help"), "menu", "help"),
      ],
      [supportButton],
    ],
  };
}

/** The reply keyboard with Telegram's own "share my number" button (the only proof of a number). */
export function contactKeyboard(locale: BotLocale): ReplyMarkup {
  return {
    keyboard: [[{ text: tg(locale, "btn.share"), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export const removeKeyboard: ReplyMarkup = { remove_keyboard: true };

export function resultKeyboard(locale: BotLocale, rxId: string, webUrl: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [button(tg(locale, "btn.rerun"), "rerun", rxId), button(tg(locale, "btn.ask"), "ask", rxId)],
      [button(tg(locale, "btn.copy"), "sum", rxId), { text: tg(locale, "btn.full"), url: webUrl }],
      [
        button(tg(locale, "btn.new"), "menu", "new"),
        button(tg(locale, "btn.balance"), "menu", "balance"),
      ],
    ],
  };
}

export function quickReplies(locale: BotLocale): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        button(tg(locale, "btn.new"), "menu", "new"),
        button(tg(locale, "btn.newRx"), "menu", "analyze"),
      ],
    ],
  };
}

export function urlKeyboard(text: string, url: string): ReplyMarkup {
  return { inline_keyboard: [[{ text, url }]] };
}

export function historyKeyboard(items: readonly { id: string; label: string }[]): ReplyMarkup {
  return { inline_keyboard: items.map((item) => [button(item.label, "rx", item.id)]) };
}

export function confirmUnlink(locale: BotLocale): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        button(tg(locale, "btn.yes"), "unlink", "yes"),
        button(tg(locale, "btn.no"), "unlink", "no"),
      ],
    ],
  };
}

export function languageKeyboard(locale: BotLocale): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        button(tg(locale, "btn.arabic"), "lang", "ar"),
        button(tg(locale, "btn.english"), "lang", "en"),
      ],
    ],
  };
}

export function retryKeyboard(locale: BotLocale, rxId: string | null): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        rxId === null
          ? button(tg(locale, "btn.newRx"), "menu", "analyze")
          : button(tg(locale, "btn.retry"), "rerun", rxId),
      ],
    ],
  };
}
