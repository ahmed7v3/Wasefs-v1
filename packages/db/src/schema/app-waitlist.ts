import { LOCALES } from "@wasfa/shared/i18n";
import { APP_PLATFORMS } from "@wasfa/shared/schemas/public-site";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";

/*
 * "Tell me when the apps launch" (BRAND-AND-HOMEPAGE §3.6). One row per address, stored lower-cased
 * so the unique key is the address itself; a second submit is a no-op. `consent_at` is the moment of
 * the explicit marketing opt-in (the form cannot be sent without it). No IP, no user id.
 * `notified_at` is set when the launch mail goes out.
 */
export const appWaitlist = pgTable(
  "app_waitlist",
  {
    id: idColumn(),
    email: text().notNull(),
    platform: text({ enum: APP_PLATFORMS }).notNull().default("both"),
    locale: text({ enum: LOCALES }).notNull().default("ar"),
    consentAt: timestamp({ withTimezone: true }).notNull(),
    notifiedAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    unique("app_waitlist_email_key").on(table.email),
    check("app_waitlist_email_lower_check", sql`${table.email} = lower(${table.email})`),
    check("app_waitlist_platform_check", inList(table.platform, APP_PLATFORMS)),
    check("app_waitlist_locale_check", inList(table.locale, LOCALES)),
    index("app_waitlist_created_idx").on(table.createdAt),
  ],
);

export type AppWaitlistEntry = typeof appWaitlist.$inferSelect;
export type NewAppWaitlistEntry = typeof appWaitlist.$inferInsert;
