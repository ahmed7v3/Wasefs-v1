import {
  ALERT_CHANNELS,
  ALERT_DELIVERY_STATUSES,
  ALERT_KINDS,
  ALERT_SEVERITIES,
} from "@wasfa/shared/billing";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * Admin alerts (Phase 3, Task 3.1; docs/BILLING.md §10). `AdminAlertService.notify` writes one alert
 * and one delivery row per (admin, channel). Messages hold order / withdrawal numbers, amounts and
 * masked people only: never proof images, full phone numbers or destinations.
 */

/** Retention: 90 days, then deleted by a worker job. */
export const adminAlerts = pgTable(
  "admin_alerts",
  {
    id: idColumn(),
    kind: text({ enum: ALERT_KINDS }).notNull(),
    severity: text({ enum: ALERT_SEVERITIES }).notNull().default("info"),
    refType: text(),
    refId: text(),
    summary: text().notNull(),
    // In-app deep link, e.g. `/admin/billing/payments/<id>`.
    link: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("admin_alerts_kind_check", inList(table.kind, ALERT_KINDS)),
    check("admin_alerts_severity_check", inList(table.severity, ALERT_SEVERITIES)),
    check("admin_alerts_summary_check", sql`char_length(${table.summary}) between 1 and 500`),
    check("admin_alerts_ref_check", sql`(${table.refType} is null) = (${table.refId} is null)`),
    index("admin_alerts_created_idx").on(table.createdAt.desc()),
    // The queue badge counts open alerts.
    index("admin_alerts_open_idx")
      .on(table.kind, table.createdAt)
      .where(sql`${table.resolvedAt} is null`),
    index("admin_alerts_ref_idx")
      .on(table.refType, table.refId)
      .where(sql`${table.refType} is not null`),
  ],
);

/** One delivery per alert, admin and channel (unique): a retried fan-out never double-sends. */
export const alertDeliveries = pgTable(
  "alert_deliveries",
  {
    id: idColumn(),
    alertId: uuid()
      .notNull()
      .references(() => adminAlerts.id, { onDelete: "cascade" }),
    adminUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text({ enum: ALERT_CHANNELS }).notNull(),
    status: text({ enum: ALERT_DELIVERY_STATUSES }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    sentAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("alert_deliveries_alert_admin_channel_key").on(
      table.alertId,
      table.adminUserId,
      table.channel,
    ),
    check("alert_deliveries_channel_check", inList(table.channel, ALERT_CHANNELS)),
    check("alert_deliveries_status_check", inList(table.status, ALERT_DELIVERY_STATUSES)),
    check("alert_deliveries_attempts_check", sql`${table.attempts} >= 0`),
    // The bell: an admin's unread in-app alerts.
    index("alert_deliveries_admin_inapp_idx")
      .on(table.adminUserId, table.createdAt.desc())
      .where(sql`${table.channel} = 'in_app'`),
    index("alert_deliveries_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/** Per-admin channel preferences. WhatsApp is off until the owner approves the channel (Decision 9). */
export const adminAlertPrefs = pgTable("admin_alert_prefs", {
  userId: uuid()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  inAppEnabled: boolean().notNull().default(true),
  emailEnabled: boolean().notNull().default(true),
  telegramEnabled: boolean().notNull().default(true),
  whatsappEnabled: boolean().notNull().default(false),
  telegramChatId: text(),
  whatsappJid: text(),
  // Alert kinds this admin muted.
  mutedKinds: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps(),
});

export type AdminAlert = typeof adminAlerts.$inferSelect;
export type NewAdminAlert = typeof adminAlerts.$inferInsert;
export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type NewAlertDelivery = typeof alertDeliveries.$inferInsert;
export type AdminAlertPrefs = typeof adminAlertPrefs.$inferSelect;
export type NewAdminAlertPrefs = typeof adminAlertPrefs.$inferInsert;
