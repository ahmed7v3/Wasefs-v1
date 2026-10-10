import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns.js";

// Admin-editable site configuration; code holds safe defaults only (cached in Redis by the api).
export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid(),
  ...timestamps(),
});

export type SiteSetting = typeof siteSettings.$inferSelect;
export type NewSiteSetting = typeof siteSettings.$inferInsert;
