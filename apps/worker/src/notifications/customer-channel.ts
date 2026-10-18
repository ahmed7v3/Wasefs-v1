import { createHash } from "node:crypto";

import { customerContact, type Database } from "@wasfa/db";
import { PAYMENT_REJECT_REASONS } from "@wasfa/shared/billing";
import {
  WA_CUSTOMER_CHECK_DELAY_MS,
  WA_CUSTOMER_LIST,
  WA_CUSTOMER_MAX_TEXT,
  waCustomerBudgetKey,
  waCustomerDay,
  waCustomerResultKey,
  type CustomerMessageKind,
  type CustomerMessagePayload,
  type CustomerWhatsappCheckPayload,
  type WaCustomerMessage,
} from "@wasfa/shared/customer-messages";
import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";

import { readSetting } from "../settings.js";

import type { EmailSendInput } from "@wasfa/shared/email";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

/*
 * Customer notifications (owner decision, 2026-10-17): WhatsApp when the customer verified their
 * phone through our WhatsApp number, has not sent STOP, the owner switched the channel on, the
 * caps leave room and it is within the sending hours; email otherwise, and email again whenever the
 * bridge did not confirm a WhatsApp send within a few minutes.
 */

export type CustomerChannelOutcome = "whatsapp" | "email" | "deferred" | "none";

export interface CustomerChannelDeps {
  db: Database;
  redis: Redis;
  logger: Logger;
  webOrigin: string;
  enqueueEmail(payload: EmailSendInput, jobId: string): Promise<void>;
  /** Re-runs `customer.notify` later (outside the sending hours). */
  defer(payload: CustomerMessagePayload, delayMs: number, jobId: string): Promise<void>;
  /** Schedules `customer.whatsapp_check`. */
  scheduleCheck(
    payload: CustomerWhatsappCheckPayload,
    delayMs: number,
    jobId: string,
  ): Promise<void>;
  now?: () => Date;
}

/** A uuid derived from the notification key: the same notification is always the same message. */
export function messageIdFor(key: string): string {
  const hex = createHash("sha256").update(`customer-message:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** BullMQ job ids may not contain `:`. */
export function jobIdFor(prefix: string, key: string): string {
  return `${prefix}-${key.replaceAll(":", "-")}`;
}

function jidKey(jid: string): string {
  return createHash("sha256").update(jid).digest("hex").slice(0, 24);
}

// --- Sending hours --------------------------------------------------------------------------------

interface SendWindow {
  timezone: string;
  startHour: number;
  endHour: number;
}

function localHour(now: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number(hour);
}

export function withinWindow(now: Date, window: SendWindow): boolean {
  const hour = localHour(now, window.timezone);
  return hour >= window.startHour && hour < window.endHour;
}

/** Milliseconds until the next window opens (searched in 5-minute steps over two days). */
export function msUntilWindow(now: Date, window: SendWindow): number {
  for (let step = 1; step <= 2 * 24 * 12; step++) {
    const at = new Date(now.getTime() + step * 5 * 60_000);
    if (withinWindow(at, window)) return step * 5 * 60_000;
  }
  return 24 * 60 * 60_000;
}

// --- Budget ---------------------------------------------------------------------------------------

/** Takes one message from the day's total and from this person's share, both or neither. */
const RESERVE = `
local total = tonumber(redis.call('GET', KEYS[1]) or '0')
local mine = tonumber(redis.call('GET', KEYS[2]) or '0')
if total >= tonumber(ARGV[1]) or mine >= tonumber(ARGV[2]) then return 0 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 172800)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], 172800)
return 1
`;

function budgetKeys(jid: string, now: Date): [string, string] {
  const day = waCustomerDay(now);
  return [waCustomerBudgetKey(day), `${waCustomerBudgetKey(day)}:${jidKey(jid)}`];
}

// --- Rendering ------------------------------------------------------------------------------------

const KIND_KEYS: Record<Exclude<CustomerMessageKind, "subscription_reminder">, MessageKey> = {
  subscription_activated: "whatsapp.customer.subscriptionActivated",
  payment_received: "whatsapp.customer.paymentReceived",
  payment_rejected: "whatsapp.customer.paymentRejected",
  payment_resubmit: "whatsapp.customer.paymentResubmit",
  order_refunded: "whatsapp.customer.orderRefunded",
  offer: "whatsapp.customer.offer",
  withdrawal_requested: "whatsapp.customer.withdrawalRequested",
  withdrawal_approved: "whatsapp.customer.withdrawalApproved",
  withdrawal_rejected: "whatsapp.customer.withdrawalRejected",
  withdrawal_paid: "whatsapp.customer.withdrawalPaid",
  withdrawal_canceled: "whatsapp.customer.withdrawalCanceled",
  payout_destination_added: "whatsapp.customer.payoutDestinationAdded",
};

function asText(params: CustomerMessagePayload["params"]): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]));
}

/** The message text: one template per kind, an optional note, the link, and the STOP footer. */
export function renderCustomerWhatsapp(
  kind: CustomerMessageKind,
  locale: Locale,
  params: CustomerMessagePayload["params"],
  link: string | null,
): string {
  const values = asText(params);
  let key: MessageKey;
  if (kind === "subscription_reminder") {
    const slot = values.slot ?? "d1";
    key =
      slot === "expired"
        ? "whatsapp.customer.reminder.expired"
        : slot.startsWith("g")
          ? "whatsapp.customer.reminder.grace"
          : "whatsapp.customer.reminder.ending";
  } else {
    key = KIND_KEYS[kind];
  }
  if (kind === "payment_rejected") {
    const code = (PAYMENT_REJECT_REASONS as readonly string[]).includes(values.reason ?? "")
      ? values.reason
      : "other";
    values.reason = t(`email.paymentRejected.reason.${code ?? "other"}` as MessageKey, {}, locale);
  }
  const lines = [t(key, values, locale)];
  if (values.note) lines.push(t("whatsapp.customer.note", { note: values.note }, locale));
  if (link) lines.push(link);
  lines.push("", t("whatsapp.customer.footer", {}, locale));
  return lines.join("\n").slice(0, WA_CUSTOMER_MAX_TEXT);
}

// --- Delivery -------------------------------------------------------------------------------------

async function sendEmail(
  deps: CustomerChannelDeps,
  key: string,
  email: EmailSendInput | undefined,
): Promise<boolean> {
  if (!email) return false;
  await deps.enqueueEmail(email, jobIdFor("customer-email", key));
  return true;
}

/** `customer.notify`. Returns where the message went (for tests and logs). */
export async function deliverCustomerMessage(
  payload: CustomerMessagePayload,
  deps: CustomerChannelDeps,
): Promise<CustomerChannelOutcome> {
  const now = deps.now?.() ?? new Date();
  const contact = await customerContact(deps.db, payload.userId);
  if (!contact) return "none";
  // A suspended account still gets its documents (receipts), never WhatsApp or anything else.
  if (!contact.active) {
    return payload.emailAlways && (await sendEmail(deps, payload.key, payload.email))
      ? "email"
      : "none";
  }
  const emailAlready = payload.emailAlways
    ? await sendEmail(deps, payload.key, payload.email)
    : false;

  const settings = (await readSetting(deps.db, "whatsapp")).customerMessages;
  const jid = contact.whatsappJid;
  if (!settings.enabled || !jid) {
    if (emailAlready) return "email";
    return (await sendEmail(deps, payload.key, payload.email)) ? "email" : "none";
  }

  if (!withinWindow(now, settings)) {
    // Only the WhatsApp part waits; a receipt mail has already gone.
    await deps.defer(
      { ...payload, emailAlways: false, email: emailAlready ? undefined : payload.email },
      msUntilWindow(now, settings),
      jobIdFor("customer-later", payload.key),
    );
    return "deferred";
  }

  const [totalKey, mineKey] = budgetKeys(jid, now);
  const reserved = Number(
    await deps.redis.eval(
      RESERVE,
      2,
      totalKey,
      mineKey,
      String(settings.dailyCap),
      String(settings.perUserDailyCap),
    ),
  );
  if (reserved !== 1) {
    deps.logger.info({ kind: payload.kind, reason: "cap" }, "Customer WhatsApp over budget");
    if (emailAlready) return "email";
    return (await sendEmail(deps, payload.key, payload.email)) ? "email" : "none";
  }

  const link = payload.path ? new URL(payload.path, deps.webOrigin).toString() : null;
  const message: WaCustomerMessage = {
    id: messageIdFor(payload.key),
    jid,
    kind: payload.kind,
    text: renderCustomerWhatsapp(payload.kind, contact.locale, payload.params, link),
    createdAt: now.getTime(),
  };
  await deps.redis.lpush(WA_CUSTOMER_LIST, JSON.stringify(message));
  await deps.scheduleCheck(
    {
      messageId: message.id,
      key: payload.key,
      ...(emailAlready || !payload.email ? {} : { email: payload.email }),
    },
    WA_CUSTOMER_CHECK_DELAY_MS,
    jobIdFor("customer-check", payload.key),
  );
  return "whatsapp";
}

/**
 * `customer.whatsapp_check`: claims the message's result first (`expired`, NX), so a bridge that
 * gets to it later will not send it. Anything but a confirmed send falls back to the email.
 */
export async function checkCustomerWhatsapp(
  payload: CustomerWhatsappCheckPayload,
  deps: Pick<CustomerChannelDeps, "redis" | "enqueueEmail" | "logger">,
): Promise<"sent" | "fallback" | "none"> {
  const key = waCustomerResultKey(payload.messageId);
  const claimed = await deps.redis.set(key, "expired", "EX", 86_400, "NX");
  const result = claimed === "OK" ? "expired" : await deps.redis.get(key);
  if (result === "sent" || result === "sending") return "sent";
  deps.logger.info({ result }, "Customer WhatsApp not sent; falling back to email");
  if (!payload.email) return "none";
  await deps.enqueueEmail(payload.email, jobIdFor("customer-email", payload.key));
  return "fallback";
}
