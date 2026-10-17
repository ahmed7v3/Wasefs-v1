import { z } from "zod";

export const paymentMethodKeyParamSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
});
const accountDisplay = z
  .string()
  .trim()
  .min(5)
  .max(120)
  .regex(
    /^(?:(?:01[0125]\d{8}|\+201[0125]\d{8}|00201[0125]\d{8})|[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{3,64})$/,
  );
export const accountChangeSchema = z.object({
  accountDisplay,
  accountHolder: z.string().trim().max(120).nullable().optional(),
  reason: z.string().trim().min(1).max(500),
  totpCode: z.string().regex(/^\d{6,8}$/),
});
