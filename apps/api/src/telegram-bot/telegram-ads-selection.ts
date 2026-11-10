import type {
  TelegramAdTargeting,
  TelegramAdTrigger,
  TelegramAdsSettings,
} from "@wasfa/shared/telegram-ads";

/*
 * The deterministic part of Telegram ad delivery: which gates stop an ad, which creatives are
 * eligible, which one is drawn. Pure and synchronous, so every rule is unit-tested without Redis or a
 * database. The inputs carry no message, prescription or analysis content. Every admin LIMIT applies
 * only when its `enabled` switch is on; the safety floor (medicine, ad-free plans, hidden chats) is
 * code and cannot be switched off.
 */

export type Rng = () => number;

export interface TelegramAdChatFacts {
  locale: "ar" | "en";
  /** Linked to a Wasfa account. */
  linked: boolean;
  adsHidden: boolean;
}

/** What Redis has counted for this chat and for everyone, as of now. */
export interface TelegramAdCounters {
  chatToday: number;
  chatThisWeek: number;
  /** A previous ad to this chat is still inside the minimum gap. */
  gapActive: boolean;
  globalToday: number;
}

export interface TelegramAdCampaignFacts {
  id: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  dailyImpressionCap: number | null;
  totalImpressionCap: number | null;
}

export interface TelegramAdCreativeFacts {
  id: string;
  status: string;
  category: string;
  weight: number;
  startsAt: Date | null;
  endsAt: Date | null;
  targeting: TelegramAdTargeting;
}

export interface TelegramAdCandidateFacts {
  creative: TelegramAdCreativeFacts;
  campaign: TelegramAdCampaignFacts;
}

export interface TelegramAdCampaignCounts {
  today: number;
  total: number;
}

export type TelegramAdLimitBlock = "chat_day" | "chat_week" | "gap" | "global_day";

export type TelegramAdGateBlock = "disabled" | "trigger" | "hidden" | "ads_free" | "quiet_hours";

/** The medicine floor, compared the way an admin could mistype it (case, spaces). */
export function isMedicineCategory(category: string): boolean {
  return category.trim().toLowerCase() === "medicine";
}

function minutesOf(hhmm: string): number {
  const [hours = "0", minutes = "0"] = hhmm.split(":");
  return Number(hours) * 60 + Number(minutes);
}

/** Minutes since local midnight of `now` in `timeZone` (an unknown zone falls back to Cairo). */
export function localMinutes(now: Date, timeZone: string): number {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
    return get("hour") * 60 + get("minute");
  };
  try {
    return read(timeZone);
  } catch {
    return read("Africa/Cairo");
  }
}

/** `start`-`end` may wrap midnight (23:00-08:00); equal bounds mean no quiet hours. */
export function inQuietWindow(minutes: number, start: string, end: string): boolean {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/** Quiet hours apply only when the admin switched them on. */
export function quietHoursActive(settings: TelegramAdsSettings, now: Date): boolean {
  const quiet = settings.quietHours;
  if (!quiet.enabled) return false;
  return inQuietWindow(localMinutes(now, quiet.timezone), quiet.start, quiet.end);
}

/**
 * The cheap gates before any counter is read: switch, trigger, hidden chat, ad-free plan, quiet
 * hours. Order matters only for the reason reported.
 */
export function preGate(input: {
  settings: TelegramAdsSettings;
  trigger: TelegramAdTrigger;
  chat: TelegramAdChatFacts;
  adsFree: boolean;
  now: Date;
}): TelegramAdGateBlock | null {
  const { settings, trigger, chat, adsFree, now } = input;
  if (!settings.enabled) return "disabled";
  if (!settings.triggers.includes(trigger)) return "trigger";
  // The person's own choice, honoured while the hide feature is on.
  if (chat.adsHidden && settings.allowHide) return "hidden";
  if (adsFree) return "ads_free";
  if (quietHoursActive(settings, now)) return "quiet_hours";
  return null;
}

/** The numeric limits: each blocks only when its own switch is on. */
export function limitGate(
  settings: TelegramAdsSettings,
  counters: TelegramAdCounters,
): TelegramAdLimitBlock | null {
  if (settings.maxPerChatPerDay.enabled && counters.chatToday >= settings.maxPerChatPerDay.value) {
    return "chat_day";
  }
  if (
    settings.maxPerChatPerWeek.enabled &&
    counters.chatThisWeek >= settings.maxPerChatPerWeek.value
  ) {
    return "chat_week";
  }
  if (settings.minGapMinutes.enabled && settings.minGapMinutes.value > 0 && counters.gapActive) {
    return "gap";
  }
  if (settings.globalDailyLimit.enabled && counters.globalToday >= settings.globalDailyLimit.value) {
    return "global_day";
  }
  return null;
}

/** The probability draw: off = every eligible moment passes. */
export function passesProbability(settings: TelegramAdsSettings, rng: Rng): boolean {
  if (!settings.probability.enabled) return true;
  return rng() < settings.probability.value;
}

function inWindow(item: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (item.startsAt !== null && item.startsAt.getTime() > now.getTime()) return false;
  if (item.endsAt !== null && item.endsAt.getTime() <= now.getTime()) return false;
  return true;
}

/** A campaign that is live and has budget left; `counts` is what its impressions are so far. */
export function campaignServes(
  campaign: TelegramAdCampaignFacts,
  counts: TelegramAdCampaignCounts,
  now: Date,
): boolean {
  if (campaign.status !== "active" || !inWindow(campaign, now)) return false;
  if (campaign.dailyImpressionCap !== null && counts.today >= campaign.dailyImpressionCap) {
    return false;
  }
  if (campaign.totalImpressionCap !== null && counts.total >= campaign.totalImpressionCap) {
    return false;
  }
  return true;
}

/** True when the campaign used up its total budget (it is marked `ended`). */
export function campaignExhausted(
  campaign: TelegramAdCampaignFacts,
  counts: TelegramAdCampaignCounts,
): boolean {
  return campaign.totalImpressionCap !== null && counts.total >= campaign.totalImpressionCap;
}

export function targetingMatches(
  targeting: TelegramAdTargeting,
  chat: TelegramAdChatFacts,
  trigger: TelegramAdTrigger,
): boolean {
  if (targeting.locales.length > 0 && !targeting.locales.includes(chat.locale)) return false;
  if (targeting.audience === "linked" && !chat.linked) return false;
  if (targeting.audience === "unlinked" && chat.linked) return false;
  if (targeting.triggers.length > 0 && !targeting.triggers.includes(trigger)) return false;
  return true;
}

/** Creatives that may be shown now: approved, not medicine, campaign serving, window, targeting. */
export function eligibleCandidates<T extends TelegramAdCandidateFacts>(input: {
  candidates: readonly T[];
  counts: ReadonlyMap<string, TelegramAdCampaignCounts>;
  chat: TelegramAdChatFacts;
  trigger: TelegramAdTrigger;
  now: Date;
}): T[] {
  const { candidates, counts, chat, trigger, now } = input;
  return candidates.filter(({ creative, campaign }) => {
    if (creative.status !== "approved" || isMedicineCategory(creative.category)) return false;
    if (!inWindow(creative, now)) return false;
    if (!campaignServes(campaign, counts.get(campaign.id) ?? { today: 0, total: 0 }, now)) {
      return false;
    }
    return targetingMatches(creative.targeting, chat, trigger);
  });
}

/** Weighted random: a creative of weight 300 is drawn three times as often as one of weight 100. */
export function weightedPick<T extends { creative: { weight: number } }>(
  items: readonly T[],
  rng: Rng,
): T | null {
  const total = items.reduce((sum, item) => sum + item.creative.weight, 0);
  if (items.length === 0 || total <= 0) return null;
  let cursor = rng() * total;
  for (const item of items) {
    cursor -= item.creative.weight;
    if (cursor < 0) return item;
  }
  return items[items.length - 1] ?? null;
}

/** Avoids the creative this chat saw last, unless it is the only one left. */
export function avoidRepeat<T extends { creative: { id: string } }>(
  items: readonly T[],
  lastCreativeId: string | null,
): readonly T[] {
  if (lastCreativeId === null || items.length < 2) return items;
  const others = items.filter((item) => item.creative.id !== lastCreativeId);
  return others.length > 0 ? others : items;
}
