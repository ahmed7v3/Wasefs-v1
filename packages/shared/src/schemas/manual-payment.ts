import { z } from "zod";

import { PAYMENT_REJECT_REASONS, PAYMENT_STATUSES } from "../billing.js";

const senderPhoneInput = z
  .string()
  .trim()
  .regex(/^(?:01[0125]\d{8}|\+201[0125]\d{8}|00201[0125]\d{8})$/);

export const manualPaymentIdParamSchema = z.object({ id: z.uuid() });
export const manualOrderIdParamSchema = z.object({ id: z.uuid() });
export const submitPaymentProofSchema = z.object({
  txnId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,64}$/),
  senderPhone: senderPhoneInput.transform((value) => {
    const digits = value.replace(/^\+/, "").replace(/^00/, "");
    return digits.startsWith("20") ? `0${digits.slice(2)}` : digits;
  }),
  fileId: z.uuid(),
});
export type SubmitPaymentProofInput = z.output<typeof submitPaymentProofSchema>;

export const manualPaymentStatusSchema = z.object({
  status: z.enum(PAYMENT_STATUSES),
  rejectReason: z.enum(PAYMENT_REJECT_REASONS).nullable(),
  submissionsLeft: z.number().int().min(0),
});

export const manualPaymentInstructionsSchema = z.object({
  method: z.object({ key: z.string(), nameAr: z.string(), nameEn: z.string() }),
  instructionsAr: z.string(),
  instructionsEn: z.string(),
  accountDisplay: z.string(),
  accountHolder: z.string().nullable(),
  reference: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expiresAt: z.string().datetime(),
  reviewSlaMinutes: z.number().int().positive(),
  submissionsLeft: z.number().int().min(0),
  status: z.enum(PAYMENT_STATUSES),
  rejectReason: z.enum(PAYMENT_REJECT_REASONS).nullable(),
});
