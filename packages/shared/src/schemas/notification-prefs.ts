import { z } from "zod";

/*
 * `GET /me/notification-prefs` and `PUT /me/notification-prefs`: how the customer is reached.
 * WhatsApp is possible only with a phone verified through our WhatsApp number.
 */

export const updateNotificationPrefsSchema = z.object({ whatsapp: z.boolean() });
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
});
export type NotificationPrefsResponse = z.output<typeof notificationPrefsResponseSchema>;
