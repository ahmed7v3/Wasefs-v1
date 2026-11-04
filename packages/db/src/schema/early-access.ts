import {
  EARLY_DEVICES,
  EARLY_EVENT_TYPES,
  EARLY_PRICE_CURRENCIES,
  EARLY_PROBE_ANSWERS,
  EARLY_ROLES,
  EARLY_SIGNUP_STATUSES,
  EARLY_VARIANTS,
} from "@wasfa/shared/schemas/early-access";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { campaignLinks } from "./growth.js";

// `inList` only takes lower-case literals; ISO currency codes are upper-case constants of ours.
const currencyIn = (column: AnyColumn): SQL =>
  sql`${column} in (${sql.raw(EARLY_PRICE_CURRENCIES.map((c) => `'${c}'`).join(", "))})`;

/*
 * Pre-launch waitlist on `early.wasfa.online` (docs/EARLY-ACCESS-PLAN.md §1). Events are the funnel
 * and visit counter: no raw IP is stored, `visitor_hash` is a daily-salted hash. Sign-ups are one
 * row per phone (E.164, unique); step 1 creates the row, step 2 fills the rest. Prices are integer
 * minor units + ISO currency. Personal data: readable through `/admin/early-access/*` only.
 */
export const earlyAccessEvents = pgTable(
  "early_access_events",
  {
    id: idColumn(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sessionId: text().notNull(),
    visitorHash: text(),
    type: text({ enum: EARLY_EVENT_TYPES }).notNull(),
    campaignLinkId: uuid().references(() => campaignLinks.id, { onDelete: "set null" }),
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    referrerHost: text(),
    country: text(),
    region: text(),
    city: text(),
    timezone: text(),
    device: text({ enum: EARLY_DEVICES }),
    browser: text(),
    os: text(),
    lang: text(),
    variant: text({ enum: EARLY_VARIANTS }),
    isBot: boolean().notNull().default(false),
  },
  (table) => [
    check("early_access_events_type_check", inList(table.type, EARLY_EVENT_TYPES)),
    check(
      "early_access_events_device_check",
      sql`${table.device} is null or ${inList(table.device, EARLY_DEVICES)}`,
    ),
    check(
      "early_access_events_variant_check",
      sql`${table.variant} is null or ${inList(table.variant, EARLY_VARIANTS)}`,
    ),
    check("early_access_events_utm_check", sql`jsonb_typeof(${table.utm}) = 'object'`),
    index("early_access_events_occurred_idx").on(table.occurredAt),
    index("early_access_events_type_occurred_idx").on(table.type, table.occurredAt),
    index("early_access_events_country_city_idx").on(table.country, table.city),
    index("early_access_events_campaign_idx").on(table.campaignLinkId),
    index("early_access_events_session_idx").on(table.sessionId),
  ],
);

export const earlyAccessSignups = pgTable(
  "early_access_signups",
  {
    id: idColumn(),
    phoneE164: text("phone_e164").notNull().unique("early_access_signups_phone_key"),
    phoneCountry: text().notNull(),
    name: text(),
    role: text({ enum: EARLY_ROLES }),
    variant: text({ enum: EARLY_VARIANTS }),
    sessionId: text(),
    probePriceMinor: integer().notNull(),
    probeCurrency: text({ enum: EARLY_PRICE_CURRENCIES }).notNull(),
    probeAnswer: text({ enum: EARLY_PROBE_ANSWERS }),
    // null = "free only" (or step 2 not done yet; `steps_completed` tells them apart).
    fairPriceMinor: integer(),
    fairPriceCurrency: text({ enum: EARLY_PRICE_CURRENCIES }),
    features: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    refCode: text().notNull().unique("early_access_signups_ref_code_key"),
    referredById: uuid().references((): AnyPgColumn => earlyAccessSignups.id, {
      onDelete: "set null",
    }),
    // Captured silently from Cloudflare headers (D2).
    country: text(),
    region: text(),
    city: text(),
    timezone: text(),
    // City-level only: two decimals is about 1 km.
    latApprox: numeric({ precision: 5, scale: 2, mode: "number" }),
    lonApprox: numeric({ precision: 5, scale: 2, mode: "number" }),
    device: text({ enum: EARLY_DEVICES }),
    browser: text(),
    os: text(),
    lang: text(),
    referrerHost: text(),
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    campaignLinkId: uuid().references(() => campaignLinks.id, { onDelete: "set null" }),
    firstSeenAt: timestamp({ withTimezone: true }),
    timeToSubmitMs: integer(),
    stepsCompleted: smallint().notNull().default(1),
    status: text({ enum: EARLY_SIGNUP_STATUSES }).notNull().default("new"),
    adminNote: text(),
    // The moment of step 1: the page links to the privacy note next to the button.
    privacyAckAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (table) => [
    check(
      "early_access_signups_role_check",
      sql`${table.role} is null or ${inList(table.role, EARLY_ROLES)}`,
    ),
    check(
      "early_access_signups_variant_check",
      sql`${table.variant} is null or ${inList(table.variant, EARLY_VARIANTS)}`,
    ),
    check("early_access_signups_probe_currency_check", currencyIn(table.probeCurrency)),
    check(
      "early_access_signups_probe_answer_check",
      sql`${table.probeAnswer} is null or ${inList(table.probeAnswer, EARLY_PROBE_ANSWERS)}`,
    ),
    check(
      "early_access_signups_fair_currency_check",
      sql`${table.fairPriceCurrency} is null or ${currencyIn(table.fairPriceCurrency)}`,
    ),
    check(
      "early_access_signups_device_check",
      sql`${table.device} is null or ${inList(table.device, EARLY_DEVICES)}`,
    ),
    check("early_access_signups_status_check", inList(table.status, EARLY_SIGNUP_STATUSES)),
    check("early_access_signups_steps_check", sql`${table.stepsCompleted} in (1, 2)`),
    check("early_access_signups_probe_price_check", sql`${table.probePriceMinor} > 0`),
    check("early_access_signups_utm_check", sql`jsonb_typeof(${table.utm}) = 'object'`),
    index("early_access_signups_created_idx").on(table.createdAt),
    index("early_access_signups_country_city_idx").on(table.country, table.city),
    index("early_access_signups_role_idx").on(table.role),
    index("early_access_signups_campaign_idx").on(table.campaignLinkId),
    index("early_access_signups_referred_by_idx").on(table.referredById),
  ],
);

export type EarlyAccessEvent = typeof earlyAccessEvents.$inferSelect;
export type NewEarlyAccessEvent = typeof earlyAccessEvents.$inferInsert;
export type EarlyAccessSignup = typeof earlyAccessSignups.$inferSelect;
export type NewEarlyAccessSignup = typeof earlyAccessSignups.$inferInsert;
