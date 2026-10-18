import { ar, t, type MessageKey } from "@wasfa/shared/i18n";

import { formatNumber } from "./admin-format";

import type { MeRewards, RewardActivityEntry } from "@wasfa/shared/schemas/rewards";

/*
 * Words for the rewards page. The API sends numbers and keys; the sentences are written here, in
 * the i18n files. Nothing in this module computes what a person is owed: the arithmetic shown
 * (basis points as a percent) is display only, and credits always come from the preview endpoint.
 */

type Offer = MeRewards["offers"]["referrer"][number];
type Side = "referrer" | "referee";

/** «50 نقطة» / «20% من قيمة الدفع» / «20 رصيد»: the reward without the event. */
export function rewardText(offer: Pick<Offer, "rewardKind" | "value">): string {
  switch (offer.rewardKind) {
    case "fixed_points":
      return t("rewardsPage.reward.fixed_points", { value: formatNumber(offer.value) });
    case "fixed_credits":
      return t("rewardsPage.reward.fixed_credits", { value: formatNumber(offer.value) });
    case "percent_of_net_bps":
      return t("rewardsPage.reward.percent_of_net_bps", { value: formatPercent(offer.value) });
  }
}

/** Basis points as a percent without a trailing zero: 2000 -> «20», 1250 -> «12.5». */
export function formatPercent(bps: number): string {
  return String(Math.round(bps) / 100);
}

/** One offer as a sentence from the point of view of `side`: «50 نقطة عند توثيق حساب صديقك». */
export function offerSentence(offer: Offer, side: Side): string {
  return t(`rewardsPage.offer.${side}.${offer.event}`, { reward: rewardText(offer) });
}

/** The events a person recognizes first, in the order the hero lists them. */
const HERO_EVENTS: readonly Offer["event"][] = ["referee_verified", "first_payment"];

/**
 * The hero line: «أنت: … · صديقك: …». Only offers worth something are listed, and at most the sign-up
 * and first-payment ones, so the line stays one line; the rest is in «كيف يعمل».
 */
export function heroSummary(offers: MeRewards["offers"]): { you: string; friend: string } {
  const pick = (list: readonly Offer[], side: Side): string[] =>
    HERO_EVENTS.flatMap((event) => {
      const offer = list.find((candidate) => candidate.event === event && candidate.value > 0);
      return offer ? [offerSentence(offer, side)] : [];
    });
  const friend = pick(offers.referee, "referee");
  if (offers.refereeDiscountBps > 0) {
    friend.push(
      t("rewardsPage.offer.referee.discount", {
        percent: formatPercent(offers.refereeDiscountBps),
      }),
    );
  }
  const separator = t("rewardsPage.listSeparator");
  return { you: pick(offers.referrer, "referrer").join(separator), friend: friend.join(separator) };
}

/** Longest hold among the referrer's offers: the honest «ستُضاف خلال» upper bound for the explanation. */
export function longestHoldDays(offers: MeRewards["offers"]): number {
  return offers.referrer.reduce((longest, offer) => Math.max(longest, offer.holdDays), 0);
}

/** The text of a share (WhatsApp, Telegram): the link plus one friendly sentence. */
export function shareMessage(link: string): string {
  return t("rewardsPage.share.message", { link });
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function telegramShareUrl(link: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

/** Whole days from `now` until `releaseAt`, at least 1: «ستُضاف خلال X يوم». */
export function daysUntil(releaseAt: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(releaseAt) - now) / 86_400_000));
}

function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(ar, key);
}

/** The line of one ledger movement: its label (falling back to the kind), what earned it and who, initials only. */
export function activityLines(entry: RewardActivityEntry): {
  title: string;
  detail: string | null;
} {
  const labelKey = isMessageKey(entry.labelKey)
    ? entry.labelKey
    : (`rewards.activity.${entry.kind}` as const);
  const title = t(labelKey);
  if (entry.event === null) return { title, detail: null };
  const event = t(`rewards.event.${entry.event}`);
  return {
    title,
    detail: entry.refereeInitials ? `${event} (${entry.refereeInitials})` : event,
  };
}

/** «+598 نقطة» / «-100 نقطة», signed. */
export function signedPoints(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return t("rewardsPage.points", { count: `${sign}${formatNumber(Math.abs(amount))}` });
}
