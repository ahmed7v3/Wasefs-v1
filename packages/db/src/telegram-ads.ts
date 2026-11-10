import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";

import { mediaAssets, type MediaAssetRecord } from "./schema/media.js";
import {
  telegramAdCampaigns,
  telegramAdCreatives,
  telegramAdEvents,
  type NewTelegramAdCampaign,
  type NewTelegramAdCreative,
  type TelegramAdCampaignRow,
  type TelegramAdCreativeRow,
} from "./schema/telegram-ads.js";
import { telegramChats } from "./schema/telegram.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";
import type { TelegramAdEventKind } from "@wasfa/shared/telegram-ads";

type Handle = Database | Transaction;

/** Statistics days are Cairo days, like every other admin report. */
const STATS_TZ = "Africa/Cairo";

export type TelegramAdMedia = Pick<MediaAssetRecord, "status" | "width" | "height" | "variants">;

export interface TelegramAdCreativeWithMedia {
  creative: TelegramAdCreativeRow;
  media: TelegramAdMedia | null;
}

export interface TelegramAdCandidate extends TelegramAdCreativeWithMedia {
  campaign: TelegramAdCampaignRow;
}

// --- campaigns -------------------------------------------------------------------------------

export interface TelegramAdCampaignListRow {
  campaign: TelegramAdCampaignRow;
  creativeCount: number;
  impressions: number;
  clicks: number;
}

/** Every campaign with its creative, impression and click counts (aggregate subqueries). */
export async function listTelegramAdCampaigns(db: Handle): Promise<TelegramAdCampaignListRow[]> {
  const rows = await db
    .select({
      campaign: telegramAdCampaigns,
      creativeCount: sql<number>`(select count(*)::int from telegram_ad_creatives c where c.campaign_id = ${telegramAdCampaigns.id})`,
      impressions: sql<number>`(select count(*)::int from telegram_ad_events e where e.campaign_id = ${telegramAdCampaigns.id} and e.kind = 'impression')`,
      clicks: sql<number>`(select count(*)::int from telegram_ad_events e where e.campaign_id = ${telegramAdCampaigns.id} and e.kind = 'click')`,
    })
    .from(telegramAdCampaigns)
    .orderBy(desc(telegramAdCampaigns.createdAt));
  return rows;
}

export async function findTelegramAdCampaign(
  db: Handle,
  id: string,
): Promise<TelegramAdCampaignListRow | null> {
  const [row] = await db
    .select({
      campaign: telegramAdCampaigns,
      creativeCount: sql<number>`(select count(*)::int from telegram_ad_creatives c where c.campaign_id = ${telegramAdCampaigns.id})`,
      impressions: sql<number>`(select count(*)::int from telegram_ad_events e where e.campaign_id = ${telegramAdCampaigns.id} and e.kind = 'impression')`,
      clicks: sql<number>`(select count(*)::int from telegram_ad_events e where e.campaign_id = ${telegramAdCampaigns.id} and e.kind = 'click')`,
    })
    .from(telegramAdCampaigns)
    .where(eq(telegramAdCampaigns.id, id));
  return row ?? null;
}

export async function insertTelegramAdCampaign(
  db: Handle,
  values: NewTelegramAdCampaign,
): Promise<TelegramAdCampaignRow> {
  const [row] = await db.insert(telegramAdCampaigns).values(values).returning();
  if (!row) throw new Error("telegram ad campaign insert returned no row");
  return row;
}

export async function updateTelegramAdCampaign(
  db: Handle,
  id: string,
  patch: Partial<NewTelegramAdCampaign>,
): Promise<TelegramAdCampaignRow | null> {
  const [row] = await db
    .update(telegramAdCampaigns)
    .set(patch)
    .where(eq(telegramAdCampaigns.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTelegramAdCampaign(db: Handle, id: string): Promise<boolean> {
  const rows = await db
    .delete(telegramAdCampaigns)
    .where(eq(telegramAdCampaigns.id, id))
    .returning({ id: telegramAdCampaigns.id });
  return rows.length > 0;
}

/** The campaign ran out of budget: delivery marks it ended so it drops out of every list of live ones. */
export async function endTelegramAdCampaign(db: Handle, id: string): Promise<void> {
  await db
    .update(telegramAdCampaigns)
    .set({ status: "ended" })
    .where(and(eq(telegramAdCampaigns.id, id), eq(telegramAdCampaigns.status, "active")));
}

// --- creatives -------------------------------------------------------------------------------

export interface TelegramAdCreativeAdminRow extends TelegramAdCreativeWithMedia {
  impressions: number;
  clicks: number;
}

const creativeCounts = {
  impressions: sql<number>`(select count(*)::int from telegram_ad_events e where e.creative_id = ${telegramAdCreatives.id} and e.kind = 'impression')`,
  clicks: sql<number>`(select count(*)::int from telegram_ad_events e where e.creative_id = ${telegramAdCreatives.id} and e.kind = 'click')`,
};

const mediaColumns = {
  mediaId: mediaAssets.id,
  mediaStatus: mediaAssets.status,
  mediaWidth: mediaAssets.width,
  mediaHeight: mediaAssets.height,
  mediaVariants: mediaAssets.variants,
};

function mediaOf(row: {
  mediaId: string | null;
  mediaStatus: MediaAssetRecord["status"] | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaVariants: MediaAssetRecord["variants"] | null;
}): TelegramAdMedia | null {
  if (row.mediaId === null || row.mediaStatus === null || row.mediaVariants === null) return null;
  return {
    status: row.mediaStatus,
    width: row.mediaWidth,
    height: row.mediaHeight,
    variants: row.mediaVariants,
  };
}

export async function listTelegramAdCreatives(
  db: Handle,
  campaignId?: string,
): Promise<TelegramAdCreativeAdminRow[]> {
  const rows = await db
    .select({ creative: telegramAdCreatives, ...creativeCounts, ...mediaColumns })
    .from(telegramAdCreatives)
    .leftJoin(mediaAssets, eq(mediaAssets.id, telegramAdCreatives.imageMediaId))
    .where(campaignId === undefined ? undefined : eq(telegramAdCreatives.campaignId, campaignId))
    .orderBy(desc(telegramAdCreatives.createdAt));
  return rows.map((row) => ({
    creative: row.creative,
    media: mediaOf(row),
    impressions: row.impressions,
    clicks: row.clicks,
  }));
}

export async function findTelegramAdCreative(
  db: Handle,
  id: string,
): Promise<TelegramAdCreativeAdminRow | null> {
  const [row] = await db
    .select({ creative: telegramAdCreatives, ...creativeCounts, ...mediaColumns })
    .from(telegramAdCreatives)
    .leftJoin(mediaAssets, eq(mediaAssets.id, telegramAdCreatives.imageMediaId))
    .where(eq(telegramAdCreatives.id, id));
  return row
    ? { creative: row.creative, media: mediaOf(row), impressions: row.impressions, clicks: row.clicks }
    : null;
}

export async function insertTelegramAdCreative(
  db: Handle,
  values: NewTelegramAdCreative,
): Promise<TelegramAdCreativeRow> {
  const [row] = await db.insert(telegramAdCreatives).values(values).returning();
  if (!row) throw new Error("telegram ad creative insert returned no row");
  return row;
}

export async function updateTelegramAdCreative(
  db: Handle,
  id: string,
  patch: Partial<NewTelegramAdCreative>,
): Promise<TelegramAdCreativeRow | null> {
  const [row] = await db
    .update(telegramAdCreatives)
    .set(patch)
    .where(eq(telegramAdCreatives.id, id))
    .returning();
  return row ?? null;
}

export async function deleteTelegramAdCreative(db: Handle, id: string): Promise<boolean> {
  const rows = await db
    .delete(telegramAdCreatives)
    .where(eq(telegramAdCreatives.id, id))
    .returning({ id: telegramAdCreatives.id });
  return rows.length > 0;
}

/** The media asset's state, or null when it does not exist (ownership/type checks of the admin form). */
export async function findMediaForTelegramAd(
  db: Handle,
  id: string,
): Promise<Pick<MediaAssetRecord, "id" | "status" | "mime"> | null> {
  const [row] = await db
    .select({ id: mediaAssets.id, status: mediaAssets.status, mime: mediaAssets.mime })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  return row ?? null;
}

/** Approved creatives of campaigns that are active: the pool delivery draws from. */
export async function approvedTelegramAdCandidates(db: Handle): Promise<TelegramAdCandidate[]> {
  const rows = await db
    .select({ creative: telegramAdCreatives, campaign: telegramAdCampaigns, ...mediaColumns })
    .from(telegramAdCreatives)
    .innerJoin(telegramAdCampaigns, eq(telegramAdCampaigns.id, telegramAdCreatives.campaignId))
    .leftJoin(mediaAssets, eq(mediaAssets.id, telegramAdCreatives.imageMediaId))
    .where(
      and(eq(telegramAdCreatives.status, "approved"), eq(telegramAdCampaigns.status, "active")),
    )
    .orderBy(asc(telegramAdCreatives.createdAt));
  return rows.map((row) => ({
    creative: row.creative,
    campaign: row.campaign,
    media: mediaOf(row),
  }));
}

// --- events ----------------------------------------------------------------------------------

export interface TelegramAdEventInput {
  kind: TelegramAdEventKind;
  creativeId: string;
  campaignId: string;
  chatId: number;
  trigger: string;
}

export async function insertTelegramAdEvent(db: Handle, event: TelegramAdEventInput): Promise<void> {
  await db.insert(telegramAdEvents).values(event);
}

/** True when this chat already has an event of this kind for this creative since `since`. */
export async function telegramAdEventSince(
  db: Handle,
  input: { chatId: number; creativeId: string; kind: TelegramAdEventKind; since: Date },
): Promise<boolean> {
  const [row] = await db
    .select({ id: telegramAdEvents.id })
    .from(telegramAdEvents)
    .where(
      and(
        eq(telegramAdEvents.chatId, input.chatId),
        eq(telegramAdEvents.creativeId, input.creativeId),
        eq(telegramAdEvents.kind, input.kind),
        gte(telegramAdEvents.createdAt, input.since),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Impressions of each campaign since `since` (daily cap) and in total (budget), for the given ids. */
export async function telegramAdImpressionCounts(
  db: Handle,
  campaignIds: readonly string[],
  since: Date,
): Promise<Map<string, { today: number; total: number }>> {
  const result = new Map<string, { today: number; total: number }>();
  if (campaignIds.length === 0) return result;
  const rows = await db
    .select({
      campaignId: telegramAdEvents.campaignId,
      total: sql<number>`count(*)::int`,
      today: sql<number>`count(*) filter (where ${telegramAdEvents.createdAt} >= ${since})::int`,
    })
    .from(telegramAdEvents)
    .where(
      and(
        eq(telegramAdEvents.kind, "impression"),
        inArray(telegramAdEvents.campaignId, [...campaignIds]),
      ),
    )
    .groupBy(telegramAdEvents.campaignId);
  for (const row of rows) result.set(row.campaignId, { today: row.today, total: row.total });
  return result;
}

export async function setTelegramChatAdsHidden(
  db: Handle,
  chatId: number,
  hidden: boolean,
): Promise<void> {
  await db
    .update(telegramChats)
    .set({ adsHidden: hidden, updatedAt: new Date() })
    .where(eq(telegramChats.chatId, chatId));
}

/** The trigger of the chat's latest impression of this creative, or null (a test send has none). */
export async function telegramAdLastImpressionTrigger(
  db: Handle,
  chatId: number,
  creativeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ trigger: telegramAdEvents.trigger })
    .from(telegramAdEvents)
    .where(
      and(
        eq(telegramAdEvents.chatId, chatId),
        eq(telegramAdEvents.creativeId, creativeId),
        eq(telegramAdEvents.kind, "impression"),
      ),
    )
    .orderBy(desc(telegramAdEvents.createdAt))
    .limit(1);
  return row?.trigger ?? null;
}

/** What delivery needs to know about a chat (not the whole row). */
export async function findTelegramChatAdFacts(
  db: Handle,
  chatId: number,
): Promise<{ chatId: number; locale: "ar" | "en"; userId: string | null; adsHidden: boolean } | null> {
  const [row] = await db
    .select({
      chatId: telegramChats.chatId,
      locale: telegramChats.locale,
      userId: telegramChats.userId,
      adsHidden: telegramChats.adsHidden,
    })
    .from(telegramChats)
    .where(eq(telegramChats.chatId, chatId));
  return row ?? null;
}

/** The campaign and the live link target of one button, for the tracked redirect. */
export async function telegramAdButtonTarget(
  db: Handle,
  creativeId: string,
): Promise<{ campaignId: string; buttons: TelegramAdCreativeRow["buttons"] } | null> {
  const [row] = await db
    .select({ campaignId: telegramAdCreatives.campaignId, buttons: telegramAdCreatives.buttons })
    .from(telegramAdCreatives)
    .where(eq(telegramAdCreatives.id, creativeId));
  return row ?? null;
}

/** Ids of the creative's campaign, or null when the creative is gone (events need both). */
export async function telegramAdCreativeCampaign(
  db: Handle,
  creativeId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ campaignId: telegramAdCreatives.campaignId })
    .from(telegramAdCreatives)
    .where(eq(telegramAdCreatives.id, creativeId));
  return row?.campaignId ?? null;
}

// --- analytics -------------------------------------------------------------------------------

export interface TelegramAdCounts {
  impressions: number;
  clicks: number;
  reactions: number;
  hides: number;
  /** Distinct chats that saw an ad. */
  reach: number;
}

export interface TelegramAdStatsFilter {
  /** Cairo calendar days, inclusive. */
  from: string;
  to: string;
  campaignId?: string | undefined;
  creativeId?: string | undefined;
}

const counts = {
  impressions: sql<number>`(count(*) filter (where ${telegramAdEvents.kind} = 'impression'))::int`,
  clicks: sql<number>`(count(*) filter (where ${telegramAdEvents.kind} = 'click'))::int`,
  reactions: sql<number>`(count(*) filter (where ${telegramAdEvents.kind} = 'reaction'))::int`,
  hides: sql<number>`(count(*) filter (where ${telegramAdEvents.kind} = 'hide'))::int`,
  reach: sql<number>`(count(distinct ${telegramAdEvents.chatId}) filter (where ${telegramAdEvents.kind} = 'impression'))::int`,
};

function statsWhere(filter: TelegramAdStatsFilter): SQL {
  const start = sql`((${filter.from}::date)::timestamp at time zone ${STATS_TZ})`;
  const end = sql`(((${filter.to}::date) + 1)::timestamp at time zone ${STATS_TZ})`;
  const parts: SQL[] = [gte(telegramAdEvents.createdAt, start), lt(telegramAdEvents.createdAt, end)];
  if (filter.campaignId !== undefined) parts.push(eq(telegramAdEvents.campaignId, filter.campaignId));
  if (filter.creativeId !== undefined) parts.push(eq(telegramAdEvents.creativeId, filter.creativeId));
  return and(...parts) as SQL;
}

// Inlined, not bound: `cairoDay` is used in SELECT, GROUP BY and ORDER BY, and a bound value would
// emit a different placeholder for each use ($1, $6, $7), which Postgres rejects as a GROUP BY
// violation ("created_at must appear in the GROUP BY clause"). Keep in sync with STATS_TZ.
const cairoDay = sql<string>`to_char(${telegramAdEvents.createdAt} at time zone 'Africa/Cairo', 'YYYY-MM-DD')`;

export async function telegramAdTotals(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<TelegramAdCounts> {
  const [row] = await db.select(counts).from(telegramAdEvents).where(statsWhere(filter));
  return row ?? { impressions: 0, clicks: 0, reactions: 0, hides: 0, reach: 0 };
}

export async function telegramAdStatsByDay(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<(TelegramAdCounts & { day: string })[]> {
  return db
    .select({ day: cairoDay, ...counts })
    .from(telegramAdEvents)
    .where(statsWhere(filter))
    .groupBy(cairoDay)
    .orderBy(asc(cairoDay));
}

export async function telegramAdStatsByCampaign(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<(TelegramAdCounts & { campaignId: string; name: string })[]> {
  return db
    .select({ campaignId: telegramAdEvents.campaignId, name: telegramAdCampaigns.name, ...counts })
    .from(telegramAdEvents)
    .innerJoin(telegramAdCampaigns, eq(telegramAdCampaigns.id, telegramAdEvents.campaignId))
    .where(statsWhere(filter))
    .groupBy(telegramAdEvents.campaignId, telegramAdCampaigns.name)
    .orderBy(desc(counts.impressions));
}

export async function telegramAdStatsByCreative(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<(TelegramAdCounts & { creativeId: string; name: string; campaignId: string })[]> {
  return db
    .select({
      creativeId: telegramAdEvents.creativeId,
      name: telegramAdCreatives.name,
      campaignId: telegramAdEvents.campaignId,
      ...counts,
    })
    .from(telegramAdEvents)
    .innerJoin(telegramAdCreatives, eq(telegramAdCreatives.id, telegramAdEvents.creativeId))
    .where(statsWhere(filter))
    .groupBy(telegramAdEvents.creativeId, telegramAdCreatives.name, telegramAdEvents.campaignId)
    .orderBy(desc(counts.impressions));
}

export async function telegramAdStatsByTrigger(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<(TelegramAdCounts & { trigger: string })[]> {
  return db
    .select({ trigger: telegramAdEvents.trigger, ...counts })
    .from(telegramAdEvents)
    .where(statsWhere(filter))
    .groupBy(telegramAdEvents.trigger)
    .orderBy(desc(counts.impressions));
}

/** One row per Cairo day x creative: the CSV export. */
export async function telegramAdStatsByDayCreative(
  db: Handle,
  filter: TelegramAdStatsFilter,
): Promise<(TelegramAdCounts & { day: string; creativeId: string; name: string; campaign: string })[]> {
  return db
    .select({
      day: cairoDay,
      creativeId: telegramAdEvents.creativeId,
      name: telegramAdCreatives.name,
      campaign: telegramAdCampaigns.name,
      ...counts,
    })
    .from(telegramAdEvents)
    .innerJoin(telegramAdCreatives, eq(telegramAdCreatives.id, telegramAdEvents.creativeId))
    .innerJoin(telegramAdCampaigns, eq(telegramAdCampaigns.id, telegramAdEvents.campaignId))
    .where(statsWhere(filter))
    .groupBy(cairoDay, telegramAdEvents.creativeId, telegramAdCreatives.name, telegramAdCampaigns.name)
    .orderBy(asc(cairoDay), asc(telegramAdCreatives.name));
}
