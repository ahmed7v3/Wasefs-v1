import { z } from "zod";

import { ALERT_CHANNELS, ALERT_DELIVERY_STATUSES, ALERT_KINDS } from "../billing.js";

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

const isoInstant = z.iso.datetime({ offset: true });

/**
 * `GET /admin/alerts/health`: why admin alerts do or do not arrive. Deliveries of the last 7 days
 * per channel, by outcome and recorded reason (`not_configured`, `no_chat_id`, `not_opted_in`…),
 * the WhatsApp switches, and the signed-in admin's own channel setup.
 */
export const alertHealthSchema = z.object({
  since: isoInstant,
  channels: z.array(
    z.object({
      channel: z.enum(ALERT_CHANNELS),
      sent: z.number().int(),
      pending: z.number().int(),
      skipped: z.number().int(),
      failed: z.number().int(),
      lastSentAt: isoInstant.nullable(),
      reasons: z.array(
        z.object({
          status: z.enum(ALERT_DELIVERY_STATUSES),
          reason: z.string(),
          count: z.number().int(),
        }),
      ),
    }),
  ),
  whatsapp: z.object({
    alertsEnabled: z.boolean(),
    customerMessagesEnabled: z.boolean(),
    optedInAdmins: z.number().int(),
  }),
  me: z.object({
    emailEnabled: z.boolean(),
    telegramEnabled: z.boolean(),
    telegramChatIdSet: z.boolean(),
    whatsappEnabled: z.boolean(),
    whatsappLinked: z.boolean(),
  }),
});
export type AlertHealth = z.output<typeof alertHealthSchema>;
