import { TELEGRAM_AD_TRIGGERS, type TelegramAdTrigger } from "@wasfa/shared/telegram-ads";

export interface AdCounts {
  impressions: number;
  clicks: number;
  reactions: number;
  hides: number;
  reach: number;
}

/** The counts plus the two rates; with no impressions both rates are 0 (never NaN or Infinity). */
export function withRates<T extends AdCounts>(counts: T): T & { ctr: number; engagementRate: number } {
  const base = counts.impressions;
  return {
    ...counts,
    ctr: base > 0 ? counts.clicks / base : 0,
    engagementRate: base > 0 ? (counts.clicks + counts.reactions) / base : 0,
  };
}

export const isTelegramAdTrigger = (value: string): value is TelegramAdTrigger =>
  (TELEGRAM_AD_TRIGGERS as readonly string[]).includes(value);
