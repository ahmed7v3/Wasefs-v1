import { z } from "zod";

/*
 * `GET /me/notification-prefs` and `PUT|PATCH /me/notification-prefs`: how the customer is reached.
 * WhatsApp is possible only with a phone verified through our WhatsApp number. Marketing mail is a
 * separate opt-in (GROWTH §6): off until the person says yes, and always one tap to turn off.
 */

export const updateNotificationPrefsSchema = z
  .object({ whatsapp: z.boolean().optional(), marketing: z.boolean().optional() })
  .refine((value) => value.whatsapp !== undefined || value.marketing !== undefined, {
    message: "nothing to change",
  });
export type UpdateNotificationPrefsInput = z.output<typeof updateNotificationPrefsSchema>;

export const notificationPrefsResponseSchema = z.object({
  whatsapp: z.object({
    /** The account has a verified phone, so WhatsApp messages can reach it. */
    available: z.boolean(),
    /** The customer has not turned them off (by STOP or here). */
    enabled: z.boolean(),
    /** The owner switched customer messages on; when false nothing is sent on WhatsApp. */
    active: z.boolean(),
  }),
  /** Marketing and lifecycle mail: on only after an explicit opt-in that no opt-out has withdrawn. */
  marketing: z.object({ enabled: z.boolean() }),
});
export type NotificationPrefsResponse = z.output<typeof notificationPrefsResponseSchema>;
