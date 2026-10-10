import { pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/*
 * Baileys auth state for the WhatsApp bridge (Task 1.5): the linked-device credentials and Signal
 * keys. Every `value` is AES-256-GCM ciphertext (`encryptSecret`, key `ENCRYPTION_KEY`, AAD
 * `wa_session:<session>:<key>`), so a database dump alone cannot impersonate the linked phone and a
 * row copied to another key does not decrypt. Not user data: no ownership column, no PII.
 */
export const waSessions = pgTable(
  "wa_sessions",
  {
    // One row set per linked number; `default` until a second number exists.
    session: text().notNull(),
    // `creds`, or `<signal key type>:<id>` such as `session:1234.0` or `pre-key:17`.
    key: text().notNull(),
    value: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.session, table.key], name: "wa_sessions_pkey" })],
);

export type WaSessionRow = typeof waSessions.$inferSelect;
