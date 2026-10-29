import { PAYMENT_REJECT_REASONS } from "@wasfa/shared/billing";
import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";
import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";

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
  const name = displayName((item.name ?? "").trim() !== "" ? (item.name ?? "") : item.rawText.trim());
  const head = [name, item.strength, formLabel(item.form, locale)]
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

/**
 * The finished reading as at most `caps.maxMessagesPerTurn` messages: the medicine list first (cut
 * from its end if it is long), then ONE closing message that always holds the disclaimer and the link
 * to the full result. With a single message allowed, the list gives way to the closing text.
 */
export function rxDoneParts(
  result: RxResult,
  link: string,
  caps: MessageCaps,
  locale: Locale,
): string[] {
  const lines = result.items
    .map((item) => rxItemLine(item, locale))
    .filter((line) => line.trim() !== "")
    .map((line, index) =>
      t("whatsapp.agent.event.rxDone.item", { index: index + 1, line }, locale),
    );
  const closing = [
    result.unreadableRegions.length > 0
      ? t("whatsapp.agent.event.rxDone.unreadable", {}, locale)
      : "",
    t("rx.disclaimer", {}, locale),
    `${t("whatsapp.agent.event.rxDone.link", {}, locale)}\n${link}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  const header = t("whatsapp.agent.event.rxDone.header", { count: lines.length }, locale);
  const list = lines.length === 0 ? header : `${header}\n${lines.join("\n")}`;

  if (caps.maxMessagesPerTurn < 2) {
    const room = Math.max(0, caps.maxReplyChars - closing.length - 2);
    const head = splitReply(list, 1, Math.max(1, room))[0];
    return [head === undefined || room === 0 ? closing : `${head}\n\n${closing}`];
  }
  const listParts = splitReply(list, caps.maxMessagesPerTurn - 1, caps.maxReplyChars);
  return [...listParts, ...splitReply(closing, 1, caps.maxReplyChars)];
}

export const rxFailedText = (locale: Locale): string =>
  t("whatsapp.agent.event.rxFailed", {}, locale);

export const documentFailedText = (locale: Locale): string =>
  t("whatsapp.agent.event.documentFailed", {}, locale);
