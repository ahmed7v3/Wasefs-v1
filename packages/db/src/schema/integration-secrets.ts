import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { inList } from "./columns.js";
import { users } from "./users.js";

/** Third-party credentials kept outside `site_settings` (docs/WA-AGENT.md section 7). */
export const INTEGRATION_SECRET_KEYS = ["elevenlabs"] as const;
export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number];

/**
 * One encrypted API key per integration, set and cleared from the admin panel. The value is sealed
 * with `encryptSecret` and the AAD `integration_secret:<key>` (so it cannot be replayed into another
 * row); `key_hint` is the masked form shown to admins. No HTTP route ever returns the value.
 */
export const integrationSecrets = pgTable(
  "integration_secrets",
  {
    key: text({ enum: INTEGRATION_SECRET_KEYS }).primaryKey(),
    valueEnc: text().notNull(),
    keyHint: text().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [check("integration_secrets_key_check", inList(table.key, INTEGRATION_SECRET_KEYS))],
);

export type IntegrationSecret = typeof integrationSecrets.$inferSelect;
