import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { idColumn, timestamps } from "./columns.js";

// One row per unexpected error, keyed by the user-visible `WSF-XXXX-XXXX` reference.
// `context` and `stack` must be redacted by the writer (see api exception filter).
export const errorEvents = pgTable(
  "error_events",
  {
    id: idColumn(),
    ref: text().notNull().unique(),
    fingerprint: text().notNull(),
    code: text().notNull(),
    route: text(),
    method: text(),
    userId: uuid(),
    requestId: text(),
    message: text(),
    context: jsonb(),
    stack: text(),
    // new | investigating | resolved
    status: text().notNull().default("new"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamps().updatedAt,
  },
  (table) => [
    check(
      "error_events_status_check",
      sql`${table.status} in ('new', 'investigating', 'resolved')`,
    ),
    index("error_events_fingerprint_idx").on(table.fingerprint),
    index("error_events_created_at_idx").on(table.createdAt),
  ],
);

export type ErrorEvent = typeof errorEvents.$inferSelect;
export type NewErrorEvent = typeof errorEvents.$inferInsert;
