import {
  createOrderResponseSchema,
  orderStatusResponseSchema,
  quoteResponseSchema,
  recommendationResponseSchema,
  type CreateOrderResponse,
  type OrderStatusResponse,
  type QuoteResponse,
  type RecommendationResponse,
} from "@wasfa/shared/schemas/billing";
import {
  manualPaymentInstructionsSchema,
  manualPaymentStatusSchema,
} from "@wasfa/shared/schemas/manual-payment";
import {
  mySubscriptionResponseSchema,
  myOrdersResponseSchema,
  type MyOrdersResponse,
  type MySubscriptionResponse,
} from "@wasfa/shared/schemas/subscriptions";

import { api } from "./api-client";
import { quoteCall, type CheckoutTarget } from "./checkout-target";

import type { z } from "zod";

/*
 * Browser calls of the pricing, checkout and billing screens. Every answer is parsed with the shared
 * schema; the client never sends a price, only what to buy and how to pay.
 */

export type ManualInstructions = z.output<typeof manualPaymentInstructionsSchema>;
export type ProofSubmitResult = Pick<
  z.output<typeof manualPaymentStatusSchema>,
  "status" | "submissionsLeft"
>;

export function requestQuote(
  target: CheckoutTarget,
  options: {
    methodKey?: string | undefined;
    couponCode?: string | undefined;
    currency?: string | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<QuoteResponse> {
  const { path, body } = quoteCall(target, options);
  return api(path, { method: "POST", body, schema: quoteResponseSchema, signal: options.signal });
}

/** The order for a stored quote. The quote must have been priced with this same method. */
export function createOrder(
  quoteId: string,
  methodKey: string | undefined,
): Promise<CreateOrderResponse> {
  return api("/billing/orders", {
    method: "POST",
    body: { quoteId, ...(methodKey ? { methodKey } : {}), locale: "ar" },
    schema: createOrderResponseSchema,
  });
}

export function fetchOrderStatus(id: string, signal?: AbortSignal): Promise<OrderStatusResponse> {
  return api(`/billing/orders/${id}`, { schema: orderStatusResponseSchema, signal });
}

export function cancelOrder(id: string): Promise<unknown> {
  return api(`/billing/orders/${id}/cancel`, { method: "POST", body: {} });
}

export function fetchInstructions(id: string, signal?: AbortSignal): Promise<ManualInstructions> {
  return api(`/billing/orders/${id}/instructions`, {
    schema: manualPaymentInstructionsSchema,
    signal,
  });
}

export function submitProof(
  paymentId: string,
  input: { txnId: string; senderPhone: string; fileId: string },
): Promise<ProofSubmitResult> {
  return api(`/billing/payments/${paymentId}/proof`, {
    method: "POST",
    body: input,
    schema: manualPaymentStatusSchema.pick({ status: true, submissionsLeft: true }),
  });
}

export function fetchRecommendation(
  currency: string | undefined,
  signal?: AbortSignal,
): Promise<RecommendationResponse> {
  const query = currency ? `?currency=${encodeURIComponent(currency)}` : "";
  return api(`/me/recommendation${query}`, { schema: recommendationResponseSchema, signal });
}

export function cancelSubscription(): Promise<MySubscriptionResponse> {
  return api("/me/subscription/cancel", {
    method: "POST",
    body: {},
    schema: mySubscriptionResponseSchema,
  });
}

export function resumeSubscription(): Promise<MySubscriptionResponse> {
  return api("/me/subscription/resume", {
    method: "POST",
    body: {},
    schema: mySubscriptionResponseSchema,
  });
}

export function startTrial(planKey: string): Promise<MySubscriptionResponse> {
  return api("/me/trial", {
    method: "POST",
    body: { planKey },
    schema: mySubscriptionResponseSchema,
  });
}

export function fetchMyOrders(cursor?: string): Promise<MyOrdersResponse> {
  const query = new URLSearchParams({ limit: "10" });
  if (cursor) query.set("cursor", cursor);
  return api(`/me/orders?${query.toString()}`, { schema: myOrdersResponseSchema });
}
