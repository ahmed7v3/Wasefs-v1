import { z } from "zod";

import { ALERT_KINDS } from "../billing.js";

export const alertCursorSchema = z.object({
  cursor: z.string().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const alertIdParamSchema = z.object({ deliveryId: z.uuid() });
export const resolveAlertParamSchema = z.object({ alertId: z.uuid() });
export const adminAlertPrefsSchema = z.object({
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  telegramEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  telegramChatId: z
    .string()
    .regex(/^-?\d{5,20}$/)
    .nullable(),
  mutedKinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length),
});
