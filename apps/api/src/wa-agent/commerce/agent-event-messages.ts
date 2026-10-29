import { PAYMENT_REJECT_REASONS } from "@wasfa/shared/billing";
import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";
import { normalizeArabic } from "@wasfa/shared/normalize";
import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";
import { dayOrder, formatClock, scheduleOf, type DoseSchedule } from "@wasfa/shared/rx-schedule";

import { splitReply } from "../agent/agent-output.js";

import type { RxResult, RxResultItem } from "@wasfa/shared/schemas/rx";

/*
 * The fixed follow-up messages of the WhatsApp agent (docs/WA-AGENT.md work package C): a payment
 * decision, a finished or failed prescription reading. No model writes any of this: the facts come
 * from the database, the words from the i18n catalogue, so a medicine line is exactly what the result
 * page shows. Pure functions.
 */

export interface MessageCaps {
  maxReplyChars: number;
  maxMessagesPerTurn: number;
}

/** What the customer is paying for, in the words of the order (a plan name, or the credit pack). */
export interface OrderFacts {
  number: string;
  /** The plan's name in the message language; null for a credit pack. */
  planName: string | null;
  rejectReason: string | null;
}

export function paymentMessage(
  type: "order_paid" | "payment_rejected" | "payment_resubmit",
  order: OrderFacts,
  locale: Locale,
): string {
  const item = order.planName ?? t("whatsapp.agent.event.packItem", {}, locale);
  const values = { number: order.number, item };
  switch (type) {
    case "order_paid":
      return t("whatsapp.agent.event.paid", values, locale);
    case "payment_resubmit":
      return t("whatsapp.agent.event.resubmit", values, locale);
    case "payment_rejected": {
      const code = (PAYMENT_REJECT_REASONS as readonly string[]).includes(order.rejectReason ?? "")
        ? order.rejectReason
        : "other";
      const reason = t(`email.paymentRejected.reason.${code ?? "other"}` as MessageKey, {}, locale);
      return t("whatsapp.agent.event.rejected", { ...values, reason }, locale);
    }
  }
}

/** One medicine the way the result page lists it: name, strength and form, then how it is taken. */
export function rxItemLine(item: RxResultItem, locale: Locale): string {
  const name = displayName(
    (item.name ?? "").trim() !== "" ? (item.name ?? "") : item.rawText.trim(),
  );
  // A likely reading is named from the drug list and flagged, never presented as certain.
  const named =
    item.match === "likely"
      ? `${name} ${t("whatsapp.agent.event.rxDone.likely", {}, locale)}`
      : name;
  const head = [named, item.strength, formLabel(item.form, locale)]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" ");
  const how = [item.dose, item.frequency, item.duration]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join("، ");
  const line = how === "" ? head : `${head} — ${how}`;
  // A doubtful reading is flagged, never presented as certain.
  const doubtful = item.badge === "low" || item.verified === "unreadable";
  return doubtful
    ? `${line} ${t("whatsapp.agent.event.rxDone.lowConfidence", {}, locale)}`.trim()
    : line;
}

const MAX_PRECAUTIONS = 2;
const MAX_FINDINGS = 3;

const filled = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

// Never the Arabic directions as a name (rx-sanitize), even when only the raw line was read.
const itemName = (item: RxResultItem): string =>
  displayName(filled(item.name) ? item.name.trim() : item.rawText.trim());

const MEAL_KEYS = {
  before: "document.rx.schedule.meal.before",
  after: "document.rx.schedule.meal.after",
  with: "document.rx.schedule.meal.with",
  empty_stomach: "document.rx.schedule.meal.empty_stomach",
} as const satisfies Record<NonNullable<DoseSchedule["meal"]>, MessageKey>;

/** Whether the text already says the phrase, in either language (the doctor's text may be in either). */
function says(text: string, key: MessageKey): boolean {
  const folded = normalizeArabic(text).toLowerCase();
  return (["ar", "en"] as const).some((language) =>
    folded.includes(normalizeArabic(t(key, {}, language)).toLowerCase()),
  );
}

/**
 * The frequency as written, plus the meal, bedtime and as-needed words found elsewhere in the line
 * (the doctor's notes) when the frequency text does not already say them.
 */
function frequencyText(item: RxResultItem, schedule: DoseSchedule, locale: Locale): string | null {
  if (!filled(item.frequency)) return null;
  const frequency = item.frequency.trim();
  const extras: MessageKey[] = [
    ...(schedule.meal === null ? [] : [MEAL_KEYS[schedule.meal]]),
    ...(schedule.bedtime ? (["document.rx.schedule.bedtime"] as const) : []),
    ...(schedule.asNeeded ? (["document.rx.schedule.asNeeded"] as const) : []),
  ];
  return [
    frequency,
    ...extras.filter((key) => !says(frequency, key)).map((key) => t(key, {}, locale)),
  ].join(" ");
}

/** "8 ص · 2 م · 8 م": the suggested times, or null when the prescription does not give enough to suggest any. */
export function suggestedTimes(schedule: DoseSchedule, locale: Locale): string | null {
  if (schedule.slots.length === 0) return null;
  const suffix = {
    am: t("document.rx.schedule.am", {}, locale),
    pm: t("document.rx.schedule.pm", {}, locale),
  };
  return [...schedule.slots]
    .sort((a, b) => dayOrder(a.time) - dayOrder(b.time))
    .map((slot) => formatClock(slot.time, suffix))
    .join(" · ");
}

/**
 * One medicine with everything the prescription says about it: dose, how often (and when to meals),
 * duration, route, the doctor's instructions, what it is used for, the first precautions and the
 * suggested times. A line is left out when there is nothing to put on it; nothing is invented.
 */
export function rxMedicineBlock(item: RxResultItem, locale: Locale): string {
  const schedule = scheduleOf(item);
  const name = itemName(item);
  const rest = [item.strength, formLabel(item.form, locale)].filter(filled).join(" ");
  const heading = [t("whatsapp.agent.event.rxDone.medicine", { name }, locale), rest]
    .filter((part) => part !== "")
    .join(" ");
  const line = (
    key: "dose" | "frequency" | "duration" | "route" | "notes" | "purpose" | "times" | "precaution",
    value: string | null | undefined,
  ): string[] =>
    filled(value) ? [t(`whatsapp.agent.event.rxDone.${key}`, { value: value.trim() }, locale)] : [];
  const doubtful = item.badge === "low" || item.verified === "unreadable";
  return [
    heading,
    ...line("dose", item.dose),
    ...line("frequency", frequencyText(item, schedule, locale)),
    ...line("duration", item.duration),
    ...line("route", item.route),
    ...line("notes", item.notes),
    ...line("purpose", item.details?.purpose),
    ...(item.details?.precautions ?? [])
      .filter(filled)
      .slice(0, MAX_PRECAUTIONS)
      .flatMap((value) => line("precaution", value)),
    ...line("times", suggestedTimes(schedule, locale)),
    // A doubtful reading is flagged, never presented as certain.
    ...(doubtful ? [t("whatsapp.agent.event.rxDone.lowConfidence", {}, locale)] : []),
  ].join("\n");
}

/**
 * Joins consecutive blocks into messages of at most `max` characters. A block longer than `max` makes
 * the whole packing fail (empty list): the caller then uses the short list.
 */
function packBlocks(blocks: readonly string[], max: number): string[] {
  const messages: string[] = [];
  for (const block of blocks) {
    if (block.length > max) return [];
    const last = messages.at(-1);
    if (last !== undefined && last.length + 2 + block.length <= max) {
      messages[messages.length - 1] = `${last}\n\n${block}`;
    } else {
      messages.push(block);
    }
  }
  return messages;
}

/** The deterministic findings of the reading (duplicate ingredient, unknown strength) as short warnings. */
function findingLines(result: RxResult, locale: Locale): string[] {
  return result.findings.slice(0, MAX_FINDINGS).map((finding) => {
    const names = finding.itemIndexes
      .map((index) => result.items[index])
      .filter((entry): entry is RxResultItem => entry !== undefined)
      .map(itemName)
      .filter((name) => name !== "");
    return t(
      "whatsapp.agent.event.rxDone.finding",
      {
        text: t(`rx.finding.${finding.kind}`, {}, locale),
        items: names.length === 0 ? "" : t("rx.finding.lines", { items: names.join("، ") }, locale),
      },
      locale,
    ).trim();
  });
}

/**
 * The finished reading as at most `caps.maxMessagesPerTurn` messages: the full reading of every
 * medicine first, then ONE closing message that always holds the disclaimer and the link to the full
 * result. When the full reading does not fit the budget, the short one-line-per-medicine list is sent
 * instead (cut from its end if it is long). With a single message allowed, the list gives way to the
 * closing text. `withPdf`: a PDF follows, so the closing says so.
 */
export function rxDoneParts(
  result: RxResult,
  link: string,
  caps: MessageCaps,
  locale: Locale,
  withPdf = false,
): string[] {
  const named = result.items.filter((item) => itemName(item) !== "");
  const closing = [
    withPdf ? t("whatsapp.agent.event.rxDone.pdfNote", {}, locale) : "",
    result.unreadableRegions.length > 0
      ? t("whatsapp.agent.event.rxDone.unreadable", {}, locale)
      : "",
    t("rx.disclaimer", {}, locale),
    `${t("whatsapp.agent.event.rxDone.link", {}, locale)}\n${link}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  const header = t("whatsapp.agent.event.rxDone.header", { count: named.length }, locale);
  const date = filled(result.date)
    ? t("whatsapp.agent.event.rxDone.date", { date: result.date.trim() }, locale)
    : "";
  const overview = result.overview?.summary;

  const blocks = [
    [header, date].filter((part) => part !== "").join("\n"),
    ...named.map((item) => rxMedicineBlock(item, locale)),
    ...(filled(overview)
      ? [t("whatsapp.agent.event.rxDone.overview", { value: overview.trim() }, locale)]
      : []),
    ...(result.findings.length > 0 ? [findingLines(result, locale).join("\n")] : []),
  ];
  const lines = named
    .map((item) => rxItemLine(item, locale))
    .filter((line) => line.trim() !== "")
    .map((line, index) =>
      t("whatsapp.agent.event.rxDone.item", { index: index + 1, line }, locale),
    );
  const compact = lines.length === 0 ? header : `${header}\n${lines.join("\n")}`;

  // What the list may use: all but the closing message, or what is left beside the closing text.
  const single = caps.maxMessagesPerTurn < 2;
  const parts = single ? 1 : caps.maxMessagesPerTurn - 1;
  const chars = single ? caps.maxReplyChars - closing.length - 2 : caps.maxReplyChars;
  // Whole blocks are packed into as few messages as the cap allows; a medicine is never cut in half.
  const packed = chars < 1 ? [] : packBlocks(blocks, chars);
  // A reading that does not fit is replaced by the short list, never sent half-complete.
  const list =
    packed.length > 0 && packed.length <= parts
      ? packed
      : chars < 1
        ? []
        : splitReply(compact, parts, chars);

  if (single) {
    const head = list[0];
    return [head === undefined ? closing : `${head}\n\n${closing}`];
  }
  return [...list, ...splitReply(closing, 1, caps.maxReplyChars)];
}

export const rxFailedText = (locale: Locale): string =>
  t("whatsapp.agent.event.rxFailed", {}, locale);

export const documentFailedText = (locale: Locale): string =>
  t("whatsapp.agent.event.documentFailed", {}, locale);
