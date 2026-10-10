import { LOCALES } from "@wasfa/shared/i18n";
import { E164_PATTERN } from "@wasfa/shared/identity";
import {
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_STATUSES,
  CONTACT_TOPICS,
} from "@wasfa/shared/schemas/contact";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { citext, idColumn, inList, matches, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * Messages from the public contact form. Stored as data and never rendered as HTML. The sender may
 * be a visitor without an account; `user_id` is set only when a session was present, and cleared
 * (not the row) if that user is ever removed. Email and phone are personal data typed into the form,
 * so the anonymization worker does not reach them; retention is decided with the Phase 4 tickets.
 */
export const contactMessages = pgTable(
  "contact_messages",
  {
    id: idColumn(),
    name: text().notNull(),
    email: citext(),
    phone: text(),
    topic: text({ enum: CONTACT_TOPICS }).notNull(),
    message: text().notNull(),
    locale: text({ enum: LOCALES }).notNull().default("ar"),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    status: text({ enum: CONTACT_STATUSES }).notNull().default("new"),
    ...timestamps(),
  },
  (table) => [
    check("contact_messages_topic_check", inList(table.topic, CONTACT_TOPICS)),
    check("contact_messages_status_check", inList(table.status, CONTACT_STATUSES)),
    check("contact_messages_locale_check", inList(table.locale, LOCALES)),
    check(
      "contact_messages_phone_format_check",
      sql`${table.phone} is null or ${matches(table.phone, E164_PATTERN.source)}`,
    ),
    check(
      "contact_messages_message_length_check",
      sql`char_length(${table.message}) between 1 and ${sql.raw(String(CONTACT_MESSAGE_MAX_LENGTH))}`,
    ),
    // A message nobody can answer is useless: at least one way to reach the sender.
    check("contact_messages_contact_check", sql`num_nonnulls(${table.email}, ${table.phone}) >= 1`),
    index("contact_messages_status_created_idx").on(table.status, table.createdAt),
  ],
);

export type ContactMessage = typeof contactMessages.$inferSelect;
export type NewContactMessage = typeof contactMessages.$inferInsert;
