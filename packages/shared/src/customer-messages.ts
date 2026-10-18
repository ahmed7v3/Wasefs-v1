import { z } from "zod";

import { emailSendPayloadSchema } from "./email.js";

/*
 * Customer notifications over WhatsApp (owner decision, 2026-10-17): a customer whose phone was
 * verified by sending our WhatsApp number the code gets their billing and subscription messages
 * there; everyone else, and every message WhatsApp could not take, gets email. The worker decides
 * and renders; the bridge only sends what passes its own guard. Texts are keyed templates, so a
 * compromised producer cannot make the bridge say arbitrary things.
 */

export const CUSTOMER_MESSAGE_KINDS = [
  "subscription_activated",
  "payment_received",
  "subscription_reminder",
  "payment_rejected",
  "payment_resubmit",
  "order_refunded",
  "offer",
  "withdrawal_requested",
  "withdrawal_approved",
  "withdrawal_rejected",
  "withdrawal_paid",
  "withdrawal_canceled",
  "payout_destination_added",
] as const;
export type CustomerMessageKind = (typeof CUSTOMER_MESSAGE_KINDS)[number];

/** Redis list the worker `LPUSH`es messages onto and the bridge `BRPOP`s. */
export const WA_CUSTOMER_LIST = "wa:customer";
/** Redis list of STOP / START commands the bridge received; the worker applies them. */
export const WA_CUSTOMER_PREFS_LIST = "wa:customer_prefs";
/** Jids that sent STOP: the bridge refuses them even if a message was already queued. */
export const WA_CUSTOMER_OPTOUT_SET = "wa:customer_optout_jids";

/** A queued message older than this is dropped by the bridge (the worker has sent the email). */
export const WA_CUSTOMER_MAX_AGE_MS = 3 * 60_000;
/** When the worker checks whether the bridge sent it, and falls back to email if not. */
export const WA_CUSTOMER_CHECK_DELAY_MS = 4 * 60_000;
export const WA_CUSTOMER_MAX_TEXT = 1_000;

/** Where the bridge records what happened to message `id` (claimed with NX, so it is decided once). */
export function waCustomerResultKey(id: string): string {
  return `wa:customer:result:${id}`;
}

/** The UTC day of a moment, `YYYY-MM-DD`: the one format every counter key below uses. */
export function waCustomerDay(at: number | Date): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Messages the bridge really sent to customers on UTC `day` (`YYYY-MM-DD`). */
export function waCustomerSentKey(day: string): string {
  return `wa:cust:sent:${day}`;
}

/** Messages the worker handed to the bridge on UTC `day`, all customers together. */
export function waCustomerBudgetKey(day: string): string {
  return `wa:cust:budget:${day}`;
}

/** The personal chat of a phone number in E.164 (`+2010...` -> `2010...@s.whatsapp.net`). */
export function jidForPhone(e164: string): string {
  return `${e164.replace(/^\+/, "")}@s.whatsapp.net`;
}

export const waCustomerMessageSchema = z.object({
  id: z.uuid(),
  jid: z.string().regex(/^\d{8,15}@s\.whatsapp\.net$/),
  text: z.string().min(1).max(WA_CUSTOMER_MAX_TEXT),
  kind: z.enum(CUSTOMER_MESSAGE_KINDS),
  /** Epoch ms when the worker queued it. */
  createdAt: z.number().int().positive(),
});
export type WaCustomerMessage = z.output<typeof waCustomerMessageSchema>;

export const waCustomerPrefCommandSchema = z.object({
  action: z.enum(["stop", "start"]),
  digits: z.string().regex(/^\d{8,15}$/),
  jid: z.string().regex(/^\d{8,15}@s\.whatsapp\.net$/),
});
export type WaCustomerPrefCommand = z.output<typeof waCustomerPrefCommandSchema>;

const paramValue = z.union([z.string().max(500), z.number()]);

/**
 * `customer.notify` (notifications queue): one notification for one user. `email` is the fallback
 * (sent when WhatsApp is not possible or did not go out) or, with `emailAlways`, sent in any case
 * (receipts are documents).
 */
export const customerMessagePayloadSchema = z.object({
  /** Stable per notification, e.g. `order_paid:<orderId>`: retries and duplicates collapse. */
  key: z.string().regex(/^[\w.:-]{1,160}$/),
  userId: z.uuid(),
  kind: z.enum(CUSTOMER_MESSAGE_KINDS),
  params: z.record(z.string(), paramValue).default({}),
  /** In-app path the message links to; the worker makes it absolute with `WEB_ORIGIN`. */
  path: z
    .string()
    .regex(/^\/[\w\-./?=&%]*$/)
    .max(300)
    .nullable()
    .default(null),
  email: emailSendPayloadSchema.optional(),
  emailAlways: z.boolean().default(false),
});
export type CustomerMessagePayload = z.output<typeof customerMessagePayloadSchema>;
export type CustomerMessageInput = z.input<typeof customerMessagePayloadSchema>;

/** `customer.whatsapp_check`: did the bridge send `messageId`? If not, the fallback mail goes. */
export const customerWhatsappCheckPayloadSchema = z.object({
  messageId: z.uuid(),
  key: z.string().regex(/^[\w.:-]{1,160}$/),
  email: emailSendPayloadSchema.optional(),
});
export type CustomerWhatsappCheckPayload = z.output<typeof customerWhatsappCheckPayloadSchema>;
