import { escapeHtml } from "./telegram-render.js";

import type { BotLocale, InlineButton, ReplyMarkup } from "./telegram-types.js";
import type { TelegramAdButton, TelegramAdLayout } from "@wasfa/shared/telegram-ads";

/*
 * How a Telegram ad looks (pure, no I/O). Every admin text is HTML-escaped; the label, the divider and
 * the engagement buttons are ours. Ads are clearly marked, the headline is bold, the first link button
 * is the strong call to action. A hero without a usable image degrades to a card.
 */

/** Telegram's caption limit for a photo. */
export const CAPTION_MAX = 1_024;
/** Telegram's limit for callback data. */
export const CALLBACK_DATA_MAX_BYTES = 64;

const STRINGS = {
  ar: {
    label: "📢 <i>إعلان</i>",
    interested: "👍 مهتم",
    done: "✅ تم",
    hide: "🙈 إخفاء الإعلانات",
    thanks: "شكراً! 👍",
    hidden: "تم إخفاء الإعلانات",
    on: "تم تفعيل الإعلانات من جديد 📢",
    alreadyOn: "الإعلانات مفعّلة بالفعل 📢",
  },
  en: {
    label: "📢 <i>Ad</i>",
    interested: "👍 Interested",
    done: "✅ Done",
    hide: "🙈 Hide ads",
    thanks: "Thanks! 👍",
    hidden: "Ads are hidden",
    on: "Ads are back on 📢",
    alreadyOn: "Ads are already on 📢",
  },
} as const;

export const adText = (locale: BotLocale) => STRINGS[locale];

const DIVIDER = "┈┈┈┈┈┈┈┈┈┈";

export interface AdCreativeContent {
  layout: TelegramAdLayout;
  headline: string;
  body: string;
  buttons: readonly TelegramAdButton[];
  buttonsPerRow: number;
}

export interface RenderInput {
  creativeId: string;
  locale: BotLocale;
  /** The image bytes were loaded and can be uploaded. */
  hasImage: boolean;
  /** The tracked link of each button (same order as `creative.buttons`). */
  links: readonly string[];
  allowHide: boolean;
  allowReactions: boolean;
}

export interface RenderedAd {
  /** `photo` = sendPhoto with `text` as caption; `message` = sendMessage. */
  kind: "photo" | "message";
  /** Telegram HTML. */
  text: string;
  keyboard: ReplyMarkup | undefined;
}

export const reactionData = (creativeId: string) => `adr:${creativeId}`;
export const hideData = (creativeId: string) => `adh:${creativeId}`;

/** The first sentence (up to the first `.`, `!`, `?`, Arabic question mark or newline), trimmed. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[^.!?؟\n]*[.!?؟]?/.exec(trimmed);
  return (match?.[0] ?? trimmed).trim();
}

/** The caption with the body cut (on the raw text, so no entity is split) until the HTML fits. */
function fit(compose: (body: string) => string, body: string, max: number): string {
  let raw = body;
  let text = compose(escapeHtml(raw));
  while (text.length > max && raw.length > 0) {
    raw = raw.length > 40 ? `${raw.slice(0, Math.floor(raw.length * 0.85)).trimEnd()}…` : "";
    text = compose(escapeHtml(raw));
  }
  return text;
}

function textOf(creative: AdCreativeContent, layout: TelegramAdLayout, locale: BotLocale): string {
  const label = adText(locale).label;
  const headline = `<b>${escapeHtml(creative.headline)}</b>`;
  if (layout === "compact") {
    const sentence = firstSentence(creative.body);
    return `${label} · ${headline}${sentence === "" ? "" : ` — ${escapeHtml(sentence)}`}`;
  }
  const opening = layout === "card" ? `${label}\n${DIVIDER}` : label;
  const compose = (body: string) =>
    body === "" ? `${opening}\n\n${headline}` : `${opening}\n\n${headline}\n\n${body}`;
  return layout === "hero"
    ? fit(compose, creative.body, CAPTION_MAX)
    : compose(escapeHtml(creative.body));
}

function keyboardOf(creative: AdCreativeContent, input: RenderInput): ReplyMarkup | undefined {
  const rows: InlineButton[][] = [];
  const perRow = creative.buttonsPerRow === 2 ? 2 : 1;
  const links: InlineButton[] = creative.buttons.flatMap((button, index) => {
    const url = input.links[index];
    if (url === undefined) return [];
    return [{ text: index === 0 ? `👉 ${button.label}` : button.label, url }];
  });
  for (let i = 0; i < links.length; i += perRow) rows.push(links.slice(i, i + perRow));
  const copy = adText(input.locale);
  const engage: InlineButton[] = [];
  if (input.allowReactions) {
    engage.push({ text: copy.interested, callback_data: reactionData(input.creativeId) });
  }
  if (input.allowHide) engage.push({ text: copy.hide, callback_data: hideData(input.creativeId) });
  if (engage.length > 0) rows.push(engage);
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

export function renderTelegramAd(creative: AdCreativeContent, input: RenderInput): RenderedAd {
  const layout: TelegramAdLayout =
    creative.layout === "hero" && !input.hasImage ? "card" : creative.layout;
  return {
    kind: layout === "hero" ? "photo" : "message",
    text: textOf(creative, layout, input.locale),
    keyboard: keyboardOf(creative, input),
  };
}

/** The keyboard after 👍: the interest button becomes "done" (same callback, a second press is a no-op). */
export function markReacted(
  rows: readonly (readonly InlineButton[])[],
  locale: BotLocale,
): ReplyMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) =>
        "callback_data" in button && button.callback_data.startsWith("adr:")
          ? { text: adText(locale).done, callback_data: button.callback_data }
          : button,
      ),
    ),
  };
}

/** What hiding leaves under the ad: nothing. */
export const EMPTY_KEYBOARD: ReplyMarkup = { inline_keyboard: [] };
