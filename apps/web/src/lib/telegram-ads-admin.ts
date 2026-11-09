import { t } from "@wasfa/shared/i18n";

import { formatNumber } from "./admin-format";

import type { TelegramAdsSettings } from "@wasfa/shared/telegram-ads";

/*
 * Pure helpers of the Telegram ads console (no React): date ranges, stats paths, the one-sentence
 * policy summary, the bot caption mirror and table sorting. Unit-tested in `test/telegram-ads.test.tsx`.
 */

export const ADS_BASE = "/admin/telegram/ads";
export const RANGE_PRESETS = [7, 30, 90] as const;

/** Telegram's caption limit when a message carries a photo. */
export const TELEGRAM_CAPTION_MAX = 1_024;

/** `YYYY-MM-DD` of a date in UTC (the API groups its days in UTC). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The last `days` days including today. */
export function presetRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { from: isoDay(from), to: isoDay(now) };
}

export function statsQuery(range: { from: string; to: string }, campaignId: string): string {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  if (campaignId !== "") query.set("campaignId", campaignId);
  return query.toString();
}

/** A ratio (0-1) as a percent text. */
export function percentText(ratio: number): string {
  const value = Number.isFinite(ratio) ? ratio * 100 : 0;
  return `${String(Math.round(value * 100) / 100)}%`;
}

type LimitKey =
  "probability" | "maxPerChatPerDay" | "maxPerChatPerWeek" | "minGapMinutes" | "globalDailyLimit";

/** The enforced limits of the settings as short phrases; a switched-off limit is not listed. */
export function activeLimitPhrases(settings: TelegramAdsSettings): string[] {
  const phrases: string[] = [];
  const on = (key: LimitKey) => settings[key].enabled;
  if (on("probability")) {
    phrases.push(
      t("admin.tgAds.policy.probability", {
        percent: Math.round(settings.probability.value * 100),
      }),
    );
  }
  if (on("maxPerChatPerDay")) {
    phrases.push(
      t("admin.tgAds.policy.perDay", { count: formatNumber(settings.maxPerChatPerDay.value) }),
    );
  }
  if (on("maxPerChatPerWeek")) {
    phrases.push(
      t("admin.tgAds.policy.perWeek", { count: formatNumber(settings.maxPerChatPerWeek.value) }),
    );
  }
  if (on("minGapMinutes")) {
    phrases.push(
      t("admin.tgAds.policy.gap", { minutes: formatNumber(settings.minGapMinutes.value) }),
    );
  }
  if (on("globalDailyLimit")) {
    phrases.push(
      t("admin.tgAds.policy.global", { count: formatNumber(settings.globalDailyLimit.value) }),
    );
  }
  if (settings.quietHours.enabled) {
    phrases.push(
      t("admin.tgAds.policy.quiet", {
        start: settings.quietHours.start,
        end: settings.quietHours.end,
        zone: settings.quietHours.timezone,
      }),
    );
  }
  return phrases;
}

/** One sentence that states the effective delivery policy of the current (unsaved) form. */
export function policySentence(settings: TelegramAdsSettings): string {
  if (!settings.enabled) return t("admin.tgAds.policy.disabled");
  if (settings.triggers.length === 0) return t("admin.tgAds.policy.noTriggers");
  const phrases = activeLimitPhrases(settings);
  if (phrases.length === 0) return t("admin.tgAds.policy.unlimited");
  return t("admin.tgAds.policy.limited", {
    moments: settings.triggers.length,
    limits: phrases.join(t("admin.tgAds.policy.joiner")),
  });
}

/** What the bot puts in the message text: label, bold headline, body (HTML parse mode, so plain here). */
export function captionParts(
  headline: string,
  body: string,
  locale: "ar" | "en",
): { label: string; headline: string; body: string } {
  return {
    label: t("admin.tgAds.preview.label", undefined, locale),
    headline: headline.trim(),
    body: body.trim(),
  };
}

/** Length of the hero caption as Telegram counts it (label line, headline line, blank line, body). */
export function heroCaptionLength(headline: string, body: string, locale: "ar" | "en"): number {
  const parts = captionParts(headline, body, locale);
  const lines = [parts.label, parts.headline];
  let length = lines.join("\n").length;
  if (parts.body !== "") length += 2 + parts.body.length;
  return length;
}

export type SortDirection = "asc" | "desc";

/** A stable copy sorted by a numeric or text key. */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => number | string,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = value(a.row);
      const right = value(b.row);
      const order =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      return order === 0 ? a.index - b.index : order * sign;
    })
    .map(({ row }) => row);
}

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next;
  next.splice(to, 0, item);
  return next;
}
