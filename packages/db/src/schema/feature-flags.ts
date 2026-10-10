import { boolean, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { timestamps } from "./columns.js";

export const featureFlags = pgTable("feature_flags", {
  key: text().primaryKey(),
  enabled: boolean().notNull().default(false),
  // Targeting: all / plan / org / user / percentage (shape defined by the api).
  rules: jsonb().notNull().default({}),
  ...timestamps(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
