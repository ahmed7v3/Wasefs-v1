import { z } from "zod";

/*
 * Response shapes the web reads that the shared schemas package does not export as zod: the
 * receipt is built by `buildReceipt` (an interface in `@wasfa/shared/subscriptions`), so its mirror
 * lives here and is parsed at the boundary like every other API answer.
 */

export const receiptSchema = z.object({
  number: z.string(),
  issuedAt: z.string(),
  paidAt: z.string().nullable(),
  status: z.string(),
  currency: z.string(),
  buyer: z.object({
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  company: z.object({
    legalName: z.string().nullable(),
    address: z.string().nullable(),
    taxId: z.string().nullable(),
  }),
  item: z.object({
    kind: z.string(),
    planKey: z.string().nullable(),
    packKey: z.string().nullable(),
    months: z.number().int().nullable(),
  }),
  lines: z.array(
    z.object({ kind: z.string(), labelKey: z.string(), amountMinor: z.number().int() }),
  ),
  taxMode: z.enum(["added", "inclusive"]).nullable(),
  totals: z.object({
    subtotalMinor: z.number().int(),
    discountMinor: z.number().int(),
    taxMinor: z.number().int(),
    feeMinor: z.number().int(),
    totalMinor: z.number().int(),
    refundedMinor: z.number().int(),
    netPaidMinor: z.number().int(),
  }),
  payment: z
    .object({
      methodKey: z.string(),
      methodNameAr: z.string(),
      methodNameEn: z.string(),
      reference: z.string(),
    })
    .nullable(),
  refunds: z.array(z.object({ amountMinor: z.number().int(), refundedAt: z.string() })),
});
export type ReceiptView = z.output<typeof receiptSchema>;

/** `POST /billing/orders/:id/cancel` answers with the order's status. */
export const cancelOrderResponseSchema = z.object({ status: z.string() }).passthrough();
