import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";

import { tg } from "./telegram-i18n.js";

import type { BotLocale } from "./telegram-types.js";
import type { RxResult, RxResultItem } from "@wasfa/shared/schemas/rx";

/** Telegram's limit for one text message. */
export const TELEGRAM_MAX_CHARS = 4096;

/** Escapes text for `parse_mode: HTML`. Everything that came from a person or a model goes through it. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A model answer as Telegram HTML: escaped first, then the few markdown marks models like to use
 * (`**bold**`, `` `code` ``, `- ` bullets) become tags, so nothing the model wrote can inject markup.
 */
export function modelTextToHtml(text: string): string {
  return escapeHtml(text.trim())
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/^#{1,6}[ \t]+(.+)$/gm, "<b>$1</b>");
}

/**
 * Cuts `text` into messages of at most `max` characters, at a paragraph break when it can, else a line
 * break, else a space, else hard. Pieces are trimmed and none is empty. Callers split plain or
 * line-balanced text (no tag spans a line), so a cut never lands inside an open tag.
 */
export function splitMessage(text: string, max = TELEGRAM_MAX_CHARS): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    const at = cut > max / 2 ? cut : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "") parts.push(rest);
  return parts.filter((part) => part !== "");
}

const filled = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const nameOf = (item: RxResultItem): string =>
  displayName(filled(item.name) ? item.name.trim() : item.rawText.trim());

function medicineBlock(item: RxResultItem, locale: BotLocale): string {
  const head = [
    `<b>${escapeHtml(clip(nameOf(item), 120))}</b>`,
    ...(item.match === "likely" ? [tg(locale, "rx.likely")] : []),
    ...[item.strength, formLabel(item.form, locale)]
      .filter(filled)
      .map((part) => escapeHtml(clip(part, 60))),
  ].join(" ");
  const line = (
    icon: string,
    key: "rx.dose" | "rx.frequency" | "rx.duration" | "rx.notes",
    value: string | null,
  ): string[] =>
    filled(value) ? [`${icon} ${tg(locale, key)}: ${escapeHtml(clip(value.trim(), 200))}`] : [];
  const purpose = item.details?.purpose;
  const doubtful = item.badge === "low" || item.verified === "unreadable";
  return [
    `💊 ${head}`,
    ...line("•", "rx.dose", item.dose),
    ...line("•", "rx.frequency", item.frequency),
    ...line("•", "rx.duration", item.duration),
    ...line("•", "rx.notes", item.notes),
    ...(filled(purpose)
      ? [`ℹ️ ${tg(locale, "rx.purpose")}: ${escapeHtml(clip(purpose.trim(), 300))}`]
      : []),
    ...(doubtful ? [tg(locale, "rx.low")] : []),
  ].join("\n");
}

/**
 * The finished reading as HTML messages of at most 4096 characters. A medicine block is never cut in
 * half (blocks are packed whole); the disclaimer always closes the last message.
 */
export function formatAnalysis(result: RxResult, locale: BotLocale): string[] {
  const named = result.items.filter((item) => nameOf(item) !== "");
  if (named.length === 0) return [`${tg(locale, "rx.empty")}\n\n${tg(locale, "rx.disclaimer")}`];
  const overview = result.overview?.summary;
  const blocks = [
    [
      tg(locale, "rx.header", { count: named.length }),
      ...(filled(result.date)
        ? [tg(locale, "rx.date", { date: escapeHtml(result.date.trim()) })]
        : []),
    ].join("\n"),
    ...named.map((item) => medicineBlock(item, locale)),
    ...(filled(overview)
      ? [tg(locale, "rx.overview", { value: escapeHtml(overview.trim()) })]
      : []),
    ...(result.unreadableRegions.length > 0 ? [tg(locale, "rx.unreadable")] : []),
    tg(locale, "rx.disclaimer"),
  ];
  const messages: string[] = [];
  for (const block of blocks) {
    const last = messages.at(-1);
    if (last !== undefined && last.length + 2 + block.length <= TELEGRAM_MAX_CHARS) {
      messages[messages.length - 1] = `${last}\n\n${block}`;
    } else {
      messages.push(...splitMessage(block));
    }
  }
  return messages;
}

/** One line per medicine, plain text, for the "copy summary" button. */
export function summaryLines(result: RxResult, locale: BotLocale): string {
  const lines = result.items
    .filter((item) => nameOf(item) !== "")
    .map((item) => {
      const head = [nameOf(item), item.strength, formLabel(item.form, locale)]
        .filter(filled)
        .join(" ");
      const how = [item.dose, item.frequency, item.duration].filter(filled).join("، ");
      return how === "" ? `• ${head}` : `• ${head} — ${how}`;
    });
  return [tg(locale, "rx.summaryTitle"), ...lines].join("\n");
}

/** The summary as `<pre>` messages (tap-to-copy in Telegram), within the size limit. */
export function summaryMessages(result: RxResult, locale: BotLocale): string[] {
  return splitMessage(summaryLines(result, locale), TELEGRAM_MAX_CHARS - 200).map(
    (part) => `<pre>${escapeHtml(part)}</pre>`,
  );
}
