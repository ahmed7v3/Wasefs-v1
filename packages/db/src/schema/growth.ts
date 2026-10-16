import { BILLING_KEY_PATTERN, PERSONAL_OFFER_KINDS } from "@wasfa/shared/billing";
import {
  EXPERIMENT_STATUSES,
  GROWTH_EVENT_NAMES,
  GROWTH_EVENT_PROPS_MAX_BYTES,
  PHI_ACCESS_REASONS,
} from "@wasfa/shared/growth";
import { SLUG_PATTERN } from "@wasfa/shared/rewards";
import { FLAG_KEY_PATTERN } from "@wasfa/shared/settings";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { promotions } from "./promotions.js";
import { referralCodes } from "./referral-codes.js";
import { users } from "./users.js";

/*
 * Growth measurement and admin support tooling (Phase 3, Task 3.1; docs/GROWTH-STRATEGY.md §9,
 * docs/ADMIN-CONSOLE-SPEC.md §8). Events are first-party, small and carry no PHI and no free text.
 */

/** Funnel events. Retention: 13 months, then deleted by a worker job. */
export const growthEvents = pgTable(
  "growth_events",
  {
    id: idColumn(),
    name: text({ enum: GROWTH_EVENT_NAMES }).notNull(),
    // Informational: null for visitors who never signed in.
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    sessionId: text().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    props: jsonb().$type<Record<string, string | number | boolean>>().notNull().default({}),
    // The experiment variant the user saw, when the event happened inside one.
    variant: text(),
  },
  (table) => [
    check("growth_events_name_check", inList(table.name, GROWTH_EVENT_NAMES)),
    check("growth_events_session_check", sql`char_length(${table.sessionId}) between 8 and 64`),
    check(
      "growth_events_props_check",
      sql`jsonb_typeof(${table.props}) = 'object' and octet_length(${table.props}::text) <= ${sql.raw(String(GROWTH_EVENT_PROPS_MAX_BYTES))}`,
    ),
    // Funnel queries and the retention job.
    index("growth_events_name_occurred_idx").on(table.name, table.occurredAt),
    index("growth_events_occurred_idx").on(table.occurredAt),
    index("growth_events_user_occurred_idx")
      .on(table.userId, table.occurredAt)
      .where(sql`${table.userId} is not null`),
  ],
);

/** Lifecycle rule data (GROWTH §6): when to create which personal offer. Toggled and measured by admins. */
export const growthRules = pgTable(
  "growth_rules",
  {
    id: idColumn(),
    key: text().notNull().unique("growth_rules_key_key"),
    name: text().notNull(),
    kind: text({ enum: PERSONAL_OFFER_KINDS }).notNull(),
    // Trigger conditions, validated by the service (e.g. { minAnalyses: 3, plan: "free" }).
    condition: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // The discount template the offer is made from.
    promotionId: uuid().references(() => promotions.id, { onDelete: "set null" }),
    validityHours: integer().notNull(),
    perOwnerLimit: integer().notNull().default(1),
    active: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    check("growth_rules_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("growth_rules_kind_check", inList(table.kind, PERSONAL_OFFER_KINDS)),
    check("growth_rules_condition_check", sql`jsonb_typeof(${table.condition}) = 'object'`),
    check("growth_rules_validity_check", sql`${table.validityHours} between 1 and 8760`),
    check("growth_rules_per_owner_limit_check", sql`${table.perOwnerLimit} >= 1`),
  ],
);

/** An A/B experiment: the variants are a feature flag with percentage rules (stable bucket per user). */
export const experiments = pgTable(
  "experiments",
  {
    id: idColumn(),
    key: text().notNull().unique("experiments_key_key"),
    name: text().notNull(),
    // The feature flag that assigns the variant; no FK, the flag may be created together with the experiment.
    flagKey: text().notNull(),
    variants: jsonb().$type<{ key: string; weight: number }[]>().notNull(),
    status: text({ enum: EXPERIMENT_STATUSES }).notNull().default("draft"),
    minSampleSize: integer(),
    startedAt: timestamp({ withTimezone: true }),
    endedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("experiments_key_check", matches(table.key, BILLING_KEY_PATTERN.source)),
    check("experiments_flag_key_check", matches(table.flagKey, FLAG_KEY_PATTERN.source)),
    check("experiments_status_check", inList(table.status, EXPERIMENT_STATUSES)),
    check(
      "experiments_variants_check",
      sql`case when jsonb_typeof(${table.variants}) = 'array' then jsonb_array_length(${table.variants}) between 2 and 10 else false end`,
    ),
    check(
      "experiments_min_sample_check",
      sql`${table.minSampleSize} is null or ${table.minSampleSize} > 0`,
    ),
    check(
      "experiments_period_check",
      sql`${table.startedAt} is null or ${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

/** Internal notes on a user (support history). Never shown to the user. */
export const userNotes = pgTable(
  "user_notes",
  {
    id: idColumn(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    authorId: uuid().references(() => users.id, { onDelete: "set null" }),
    body: text().notNull(),
    pinned: boolean().notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    check("user_notes_body_check", sql`char_length(btrim(${table.body})) between 1 and 4000`),
    index("user_notes_user_created_idx").on(table.userId, table.createdAt.desc()),
  ],
);

/**
 * A 30-minute window in which an admin may open one user's health data, for a stated reason
 * (ADMIN-CONSOLE-SPEC §8.2). Every actual view writes an `audit_logs` row (`phi.view`); this table
 * only says that the window exists.
 */
export const phiAccessSessions = pgTable(
  "phi_access_sessions",
  {
    id: idColumn(),
    adminUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: text({ enum: PHI_ACCESS_REASONS }).notNull(),
    note: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("phi_access_sessions_reason_check", inList(table.reason, PHI_ACCESS_REASONS)),
    check("phi_access_sessions_expires_check", sql`${table.expiresAt} > ${table.createdAt}`),
    index("phi_access_sessions_admin_user_expires_idx").on(
      table.adminUserId,
      table.userId,
      table.expiresAt,
    ),
  ],
);

/** `/c/<slug>`: a tracked campaign link that sets first-touch attribution and redirects (Task 3.16). */
export const campaignLinks = pgTable(
  "campaign_links",
  {
    id: idColumn(),
    slug: text().notNull().unique("campaign_links_slug_key"),
    name: text().notNull(),
    // Where the link lands: a path on our own site, never an external URL (no open redirect).
    targetPath: text().notNull().default("/"),
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    referralCodeId: uuid().references(() => referralCodes.id, { onDelete: "set null" }),
    active: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("campaign_links_slug_check", matches(table.slug, SLUG_PATTERN.source)),
    check("campaign_links_target_path_check", matches(table.targetPath, "^/([^/].*)?$")),
    check("campaign_links_utm_check", sql`jsonb_typeof(${table.utm}) = 'object'`),
  ],
);

export type GrowthEvent = typeof growthEvents.$inferSelect;
export type NewGrowthEvent = typeof growthEvents.$inferInsert;
export type GrowthRule = typeof growthRules.$inferSelect;
export type NewGrowthRule = typeof growthRules.$inferInsert;
export type Experiment = typeof experiments.$inferSelect;
export type NewExperiment = typeof experiments.$inferInsert;
export type UserNote = typeof userNotes.$inferSelect;
export type NewUserNote = typeof userNotes.$inferInsert;
export type PhiAccessSession = typeof phiAccessSessions.$inferSelect;
export type NewPhiAccessSession = typeof phiAccessSessions.$inferInsert;
export type CampaignLink = typeof campaignLinks.$inferSelect;
export type NewCampaignLink = typeof campaignLinks.$inferInsert;
