import {
  AD_CATEGORIES,
  AD_CHANNELS,
  AD_DEVICES,
  AD_FORMATS,
  AD_STATUSES,
  PAGE_CLASSES,
  type AdTargeting,
} from "@wasfa/shared/ads";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { arrayWithin, idColumn, inList, timestamps } from "./columns.js";
import { mediaAssets } from "./media.js";

/*
 * First-party ads (docs/ADS.md, change home-ads-conversion D4). Placements are a code catalog seeded
 * by the migration (all disabled); the admin toggles and tunes them. Creatives belong to an
 * advertiser, or to nobody (`advertiser_id` null = a house creative). Statistics are aggregates per
 * creative, placement, day and channel: no cookie, no user id, no message text. The page-class
 * floor and the forbidden categories are code (`@wasfa/shared/ads`), not data.
 */
export const adPlacements = pgTable(
  "ad_placements",
  {
    key: text().primaryKey(),
    enabled: boolean().notNull().default(false),
    pageClasses: text({ enum: PAGE_CLASSES }).array().notNull(),
    devices: text({ enum: AD_DEVICES })
      .array()
      .notNull()
      .default(sql`'{mobile,tablet,desktop}'::text[]`),
    maxPerPage: integer().notNull().default(1),
    format: text({ enum: AD_FORMATS }).notNull(),
    sizeDesktop: text().notNull(),
    sizeMobile: text().notNull(),
    closable: boolean().notNull().default(false),
    dismissDays: integer().notNull().default(7),
    allowPaid: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("ad_placements_page_classes_check", arrayWithin(table.pageClasses, PAGE_CLASSES)),
    check("ad_placements_devices_check", arrayWithin(table.devices, AD_DEVICES)),
    check("ad_placements_format_check", inList(table.format, AD_FORMATS)),
    check("ad_placements_max_per_page_check", sql`${table.maxPerPage} between 0 and 10`),
    check("ad_placements_dismiss_days_check", sql`${table.dismissDays} between 1 and 365`),
  ],
);

export const advertisers = pgTable(
  "advertisers",
  {
    id: idColumn(),
    name: text().notNull(),
    category: text({ enum: AD_CATEGORIES }).notNull(),
    contact: text(),
    active: boolean().notNull().default(true),
    ...timestamps(),
  },
  (table) => [check("advertisers_category_check", inList(table.category, AD_CATEGORIES))],
);

export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: idColumn(),
    // Null = a house creative.
    advertiserId: uuid().references(() => advertisers.id, { onDelete: "restrict" }),
    title: text().notNull(),
    imageMediaId: uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    alt: text().notNull(),
    targetUrl: text().notNull(),
    category: text({ enum: AD_CATEGORIES }).notNull(),
    status: text({ enum: AD_STATUSES }).notNull().default("draft"),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    weight: integer().notNull().default(100),
    // {placements[], pageClasses[], devices[], locales[], countries[]}; an empty list = any.
    targeting: jsonb()
      .$type<AdTargeting>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Delivery channels; WhatsApp ads carry `wa_text` (the label is added by code).
    channels: text({ enum: AD_CHANNELS })
      .array()
      .notNull()
      .default(sql`'{web}'::text[]`),
    waText: text(),
    ...timestamps(),
  },
  (table) => [
    check("ad_creatives_status_check", inList(table.status, AD_STATUSES)),
    check("ad_creatives_category_check", inList(table.category, AD_CATEGORIES)),
    check("ad_creatives_channels_check", arrayWithin(table.channels, AD_CHANNELS)),
    check("ad_creatives_weight_check", sql`${table.weight} between 1 and 1000`),
    check(
      "ad_creatives_wa_text_check",
      sql`${table.waText} is null or char_length(${table.waText}) <= 700`,
    ),
    check(
      "ad_creatives_schedule_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} < ${table.endsAt}`,
    ),
    // The floor in the database too: an approved creative is never a medicine.
    check(
      "ad_creatives_no_medicine_check",
      sql`${table.status} <> 'approved' or ${table.category} <> 'medicine'`,
    ),
    index("ad_creatives_status_idx").on(table.status),
    index("ad_creatives_advertiser_idx").on(table.advertiserId),
  ],
);

export const adStatsDaily = pgTable(
  "ad_stats_daily",
  {
    creativeId: uuid()
      .notNull()
      .references(() => adCreatives.id, { onDelete: "cascade" }),
    placementKey: text()
      .notNull()
      .references(() => adPlacements.key, { onDelete: "cascade" }),
    day: date({ mode: "string" }).notNull(),
    channel: text({ enum: AD_CHANNELS }).notNull().default("web"),
    impressions: integer().notNull().default(0),
    clicks: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.creativeId, table.placementKey, table.day, table.channel],
      name: "ad_stats_daily_pkey",
    }),
    check("ad_stats_daily_channel_check", inList(table.channel, AD_CHANNELS)),
    check("ad_stats_daily_counts_check", sql`${table.impressions} >= 0 and ${table.clicks} >= 0`),
    index("ad_stats_daily_day_idx").on(table.day),
  ],
);

export type AdPlacementRow = typeof adPlacements.$inferSelect;
export type NewAdPlacement = typeof adPlacements.$inferInsert;
export type AdvertiserRow = typeof advertisers.$inferSelect;
export type NewAdvertiser = typeof advertisers.$inferInsert;
export type AdCreativeRow = typeof adCreatives.$inferSelect;
export type NewAdCreative = typeof adCreatives.$inferInsert;
export type AdStatsDailyRow = typeof adStatsDaily.$inferSelect;
