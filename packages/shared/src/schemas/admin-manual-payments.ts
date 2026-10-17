import { z } from "zod";

import { PAYMENT_REJECT_REASONS } from "../billing.js";

export const adminPaymentIdSchema = z.object({ id: z.uuid() });
export const reviewQuerySchema = z.object({
  cursor: z.string().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const reviewOverrideSchema = z.object({ override: z.boolean().default(false) });
export const approveManualPaymentSchema = z.object({
  ...reviewOverrideSchema.shape,
  note: z.string().trim().max(500).optional(),
});
export const rejectManualPaymentSchema = z
  .object({
    ...reviewOverrideSchema.shape,
    reason: z.enum(PAYMENT_REJECT_REASONS),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.reason === "other" || value.reason === "amount_differs") && !value.note)
      ctx.addIssue({ code: "custom", path: ["note"], message: "required" });
  });
export const requestProofSchema = z.object({
  note: z.string().trim().max(500).optional(),
  override: z.boolean().default(false),
});

export const adminManualPaymentDetailSchema = z.object({
  id: z.uuid(),
  payment: z.object({
    id: z.uuid(),
    reference: z.string(),
    status: z.string(),
    amountMinor: z.number().int(),
    currency: z.string(),
    methodKey: z.string(),
    txnId: z.string().nullable(),
    senderPhoneMasked: z.string().nullable(),
    flags: z.array(z.string()),
    proofSubmissions: z.number().int(),
    reviewedBy: z.uuid().nullable(),
    reviewedAt: z.date().nullable(),
    secondApprovedBy: z.uuid().nullable(),
    secondApprovedAt: z.date().nullable(),
    reviewNote: z.string().nullable(),
    rejectReason: z.string().nullable(),
    createdAt: z.date(),
  }),
  order: z.object({
    id: z.uuid(),
    number: z.string(),
    kind: z.string(),
    planKey: z.string().nullable(),
    months: z.number().int().nullable(),
    totalMinor: z.number().int(),
    currency: z.string(),
    status: z.string(),
    expiresAt: z.date(),
  }),
  method: z.object({ key: z.string(), name: z.string() }),
  user: z.object({
    name: z.string().nullable(),
    phoneMasked: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  proofUrl: z.string().nullable(),
  proofUrlExpiresInSeconds: z.number().int().nullable(),
  /** The payment has a proof but no link could be signed right now. */
  proofUnavailable: z.boolean(),
  paidOrdersCount: z.number().int(),
  earlierRejected: z.array(z.unknown()),
  lockHolder: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
});
