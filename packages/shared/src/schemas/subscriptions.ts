import { z } from "zod";

import {
  ORDER_KINDS,
  ORDER_STATUSES,
  SUBSCRIPTION_SOURCES,
  SUBSCRIPTION_STATUSES,
} from "../billing.js";
import { PLAN_KEY_PATTERN } from "../plans.js";

import { monthsSchema, paymentMethodKeySchema } from "./billing.js";

/*
 * The customer's own subscription and order history (BILLING §7). Prices are never sent by the
 * client; a renewal asks the quote engine for the same plan again.
 */

const isoDate = z.iso.datetime({ offset: true });

/** `POST /me/trial`. */
export const startTrialSchema = z.object({
  planKey: z.string().max(40).regex(PLAN_KEY_PATTERN),
});
export type StartTrialInput = z.output<typeof startTrialSchema>;

/** `POST /me/subscription/renew-quote`: the plan comes from the subscription, never the body. */
export const renewQuoteSchema = z.object({
  methodKey: paymentMethodKeySchema.optional(),
  months: monthsSchema.optional(),
});
export type RenewQuoteInput = z.output<typeof renewQuoteSchema>;

export const subscriptionViewSchema = z.object({
  id: z.uuid(),
  plan: z.object({ key: z.string(), nameAr: z.string(), nameEn: z.string() }),
  status: z.enum(SUBSCRIPTION_STATUSES),
  source: z.enum(SUBSCRIPTION_SOURCES),
  currentPeriodStart: isoDate,
  currentPeriodEnd: isoDate,
  monthsPaid: z.number().int().min(0),
  cancelAtPeriodEnd: z.boolean(),
  graceUntil: isoDate.nullable(),
  pendingChange: z
    .object({ planKey: z.string(), months: z.number().int(), effectiveAt: isoDate })
    .nullable(),
  nextCreditGrantAt: isoDate.nullable(),
});
export type SubscriptionView = z.output<typeof subscriptionViewSchema>;

export const mySubscriptionResponseSchema = z.object({
  subscription: subscriptionViewSchema.nullable(),
  trialAvailable: z.boolean(),
});
export type MySubscriptionResponse = z.output<typeof mySubscriptionResponseSchema>;

/** `GET /me/orders`: newest first, keyset paginated. */
export const myOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(100).optional(),
});
export type MyOrdersQuery = z.output<typeof myOrdersQuerySchema>;

export const myOrderSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  kind: z.enum(ORDER_KINDS),
  planKey: z.string().nullable(),
  packKey: z.string().nullable(),
  months: z.number().int().nullable(),
  totalMinor: z.number().int(),
  currency: z.string(),
  status: z.enum(ORDER_STATUSES),
  createdAt: isoDate,
  paidAt: isoDate.nullable(),
  receiptAvailable: z.boolean(),
});
export const myOrdersResponseSchema = z.object({
  items: z.array(myOrderSchema),
  nextCursor: z.string().nullable(),
});
export type MyOrdersResponse = z.output<typeof myOrdersResponseSchema>;
