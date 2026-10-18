import { MARKETING_OPT_OUT_VIA } from "@wasfa/shared/growth";
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { inList, timestamps } from "./columns.js";
import { users } from "./users.js";

export const WHATSAPP_OPT_OUT_SOURCES = ["whatsapp", "account"] as const;

/**
 * How a customer wants to be reached. No row = the defaults (WhatsApp on when their phone is
 * verified). A STOP sent to our WhatsApp number or the switch on the account page sets the opt-out;
 * START or the switch clears it.
 */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid()
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    whatsappOptedOutAt: timestamp({ withTimezone: true }),
    whatsappOptedOutVia: text({ enum: WHATSAPP_OPT_OUT_SOURCES }),
    // Marketing (lifecycle) mail consent, separate from the transactional channel above. Consent =
    // opted in and not opted out since; no row means no consent (GROWTH §6).
    marketingOptedInAt: timestamp({ withTimezone: true }),
    marketingOptedOutAt: timestamp({ withTimezone: true }),
    marketingOptedOutVia: text({ enum: MARKETING_OPT_OUT_VIA }),
    // No marketing before this moment: 30 days after a refund or complaint, 90 after the last call.
    marketingSilencedUntil: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    check(
      "notification_prefs_opt_out_via_check",
      sql`${table.whatsappOptedOutVia} is null or ${inList(table.whatsappOptedOutVia, WHATSAPP_OPT_OUT_SOURCES)}`,
    ),
    check(
      "notification_prefs_opt_out_pair_check",
      sql`(${table.whatsappOptedOutAt} is null) = (${table.whatsappOptedOutVia} is null)`,
    ),
    check(
      "notification_prefs_marketing_opt_out_via_check",
      sql`${table.marketingOptedOutVia} is null or ${inList(table.marketingOptedOutVia, MARKETING_OPT_OUT_VIA)}`,
    ),
    check(
      "notification_prefs_marketing_opt_out_pair_check",
      sql`(${table.marketingOptedOutAt} is null) = (${table.marketingOptedOutVia} is null)`,
    ),
  ],
);

export type NotificationPrefs = typeof notificationPrefs.$inferSelect;
