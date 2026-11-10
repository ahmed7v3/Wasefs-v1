import {
  TELEGRAM_AD_EVENT_KINDS,
  TELEGRAM_AD_LAYOUTS,
  TELEGRAM_AD_STATUSES,
  TELEGRAM_CAMPAIGN_STATUSES,
  type TelegramAdButton,
  type TelegramAdTargeting,
} from "@wasfa/shared/telegram-ads";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { mediaAssets } from "./media.js";


/*
 * The Telegram ads (docs/TELEGRAM-BOT.md, "Ads"): their own campaigns, creatives and event log,
 * independent from the web/WhatsApp ads (`ads.ts`). Events are one row per impression, click,
 * reaction or hide; the analytics aggregate them. A chat id is stored only for frequency checks and
 * reach; no message text or profile ever lands here.
 */
export const telegramAdCampaigns = pgTable(
  "telegram_ad_campaigns",
  {
    id: idColumn(),
    name: text().notNull(),
    advertiser: text().notNull().default(""),
    status: text({ enum: TELEGRAM_CAMPAIGN_STATUSES }).notNull().default("draft"),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    dailyImpressionCap: integer(),
    totalImpressionCap: integer(),
    notes: text().notNull().default(""),
    ...timestamps(),
  },
  (table) => [
    check("telegram_ad_campaigns_status_check", inList(table.status, TELEGRAM_CAMPAIGN_STATUSES)),
    check(
      "telegram_ad_campaigns_schedule_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} < ${table.endsAt}`,
    ),
    check(
      "telegram_ad_campaigns_caps_check",
      sql`(${table.dailyImpressionCap} is null or ${table.dailyImpressionCap} >= 1) and (${table.totalImpressionCap} is null or ${table.totalImpressionCap} >= 1)`,
    ),
  ],
);

export const telegramAdCreatives = pgTable(
  "telegram_ad_creatives",
  {
    id: idColumn(),
    campaignId: uuid()
      .notNull()
      .references(() => telegramAdCampaigns.id, { onDelete: "cascade" }),
    name: text().notNull(),
    status: text({ enum: TELEGRAM_AD_STATUSES }).notNull().default("draft"),
    layout: text({ enum: TELEGRAM_AD_LAYOUTS }).notNull().default("hero"),
    headline: text().notNull(),
    body: text().notNull().default(""),
    imageMediaId: uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    buttons: jsonb()
      .$type<TelegramAdButton[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    buttonsPerRow: smallint().notNull().default(1),
    category: text().notNull().default("general"),
    weight: integer().notNull().default(100),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    targeting: jsonb()
      .$type<TelegramAdTargeting>()
      .notNull()
      .default(sql`'{"locales":[],"audience":"all","triggers":[]}'::jsonb`),
    ...timestamps(),
  },
  (table) => [
    check("telegram_ad_creatives_status_check", inList(table.status, TELEGRAM_AD_STATUSES)),
    check("telegram_ad_creatives_layout_check", inList(table.layout, TELEGRAM_AD_LAYOUTS)),
    check("telegram_ad_creatives_weight_check", sql`${table.weight} between 1 and 1000`),
    check("telegram_ad_creatives_per_row_check", sql`${table.buttonsPerRow} in (1, 2)`),
    check(
      "telegram_ad_creatives_schedule_check",
      sql`${table.startsAt} is null or ${table.endsAt} is null or ${table.startsAt} < ${table.endsAt}`,
    ),
    // The floor in the database too: an approved creative is never a medicine.
    check(
      "telegram_ad_creatives_no_medicine_check",
      sql`${table.status} <> 'approved' or ${table.category} <> 'medicine'`,
    ),
    index("telegram_ad_creatives_campaign_idx").on(table.campaignId),
    index("telegram_ad_creatives_status_idx").on(table.status),
  ],
);

export const telegramAdEvents = pgTable(
  "telegram_ad_events",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    kind: text({ enum: TELEGRAM_AD_EVENT_KINDS }).notNull(),
    creativeId: uuid()
      .notNull()
      .references(() => telegramAdCreatives.id, { onDelete: "cascade" }),
    campaignId: uuid().notNull(),
    chatId: bigint({ mode: "number" }).notNull(),
    trigger: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("telegram_ad_events_kind_check", inList(table.kind, TELEGRAM_AD_EVENT_KINDS)),
    index("telegram_ad_events_created_idx").on(table.createdAt),
    index("telegram_ad_events_creative_created_idx").on(table.creativeId, table.createdAt),
    index("telegram_ad_events_campaign_created_idx").on(table.campaignId, table.createdAt),
    index("telegram_ad_events_chat_created_kind_idx").on(
      table.chatId,
      table.createdAt,
      table.kind,
    ),
  ],
);

export type TelegramAdCampaignRow = typeof telegramAdCampaigns.$inferSelect;
export type NewTelegramAdCampaign = typeof telegramAdCampaigns.$inferInsert;
export type TelegramAdCreativeRow = typeof telegramAdCreatives.$inferSelect;
export type NewTelegramAdCreative = typeof telegramAdCreatives.$inferInsert;
export type TelegramAdEventRow = typeof telegramAdEvents.$inferSelect;
