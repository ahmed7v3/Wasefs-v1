import { Inject, Injectable } from "@nestjs/common";
import {
  adCreatives,
  adPlacements,
  adStatsDaily,
  advertisers,
  mediaAssets,
  type AdCreativeRow,
  type AdPlacementRow,
  type AdvertiserRow,
  type MediaAssetRecord,
  type NewAdCreative,
  type NewAdvertiser,
} from "@wasfa/db";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { AdStatsRow } from "./ads-stats.js";
import type { AdChannel, AdStatus } from "@wasfa/shared/ads";

export interface CreativeAdminRow {
  creative: AdCreativeRow;
  advertiserName: string | null;
  media: Pick<MediaAssetRecord, "status" | "width" | "height" | "variants"> | null;
}

export type PlacementPatch = Partial<
  Pick<
    AdPlacementRow,
    | "enabled"
    | "pageClasses"
    | "devices"
    | "maxPerPage"
    | "sizeDesktop"
    | "sizeMobile"
    | "closable"
    | "dismissDays"
    | "allowPaid"
  >
>;

/**
 * The console reads and writes of the ad tables. Ads have no owner (no user data), so there is no
 * owner scope; the service decides what an admin may change. Statistics are read from the daily
 * rollup only.
 */
@Injectable()
export class AdminAdsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  // --- placements -------------------------------------------------------------------------

  placements(): Promise<AdPlacementRow[]> {
    return this.handle.db.select().from(adPlacements).orderBy(asc(adPlacements.sort));
  }

  async placement(key: string): Promise<AdPlacementRow | null> {
    const [row] = await this.handle.db
      .select()
      .from(adPlacements)
      .where(eq(adPlacements.key, key))
      .limit(1);
    return row ?? null;
  }

  async updatePlacement(key: string, patch: PlacementPatch): Promise<AdPlacementRow | null> {
    const [row] = await this.handle.db
      .update(adPlacements)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(adPlacements.key, key))
      .returning();
    return row ?? null;
  }

  // --- advertisers ------------------------------------------------------------------------

  advertisers(): Promise<{ advertiser: AdvertiserRow; creativeCount: number }[]> {
    return this.handle.db
      .select({
        advertiser: advertisers,
        creativeCount: sql<number>`count(${adCreatives.id})::int`,
      })
      .from(advertisers)
      .leftJoin(adCreatives, eq(adCreatives.advertiserId, advertisers.id))
      .groupBy(advertisers.id)
      .orderBy(asc(advertisers.name));
  }

  async advertiser(id: string): Promise<AdvertiserRow | null> {
    const [row] = await this.handle.db
      .select()
      .from(advertisers)
      .where(eq(advertisers.id, id))
      .limit(1);
    return row ?? null;
  }

  async createAdvertiser(values: NewAdvertiser): Promise<AdvertiserRow> {
    const [row] = await this.handle.db.insert(advertisers).values(values).returning();
    if (!row) throw new Error("advertiser insert returned no row");
    return row;
  }

  async updateAdvertiser(
    id: string,
    patch: Partial<Pick<AdvertiserRow, "name" | "category" | "contact" | "active">>,
  ): Promise<AdvertiserRow | null> {
    const [row] = await this.handle.db
      .update(advertisers)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(advertisers.id, id))
      .returning();
    return row ?? null;
  }

  async creativeCountOf(advertiserId: string): Promise<number> {
    const [row] = await this.handle.db
      .select({ count: sql<number>`count(*)::int` })
      .from(adCreatives)
      .where(eq(adCreatives.advertiserId, advertiserId));
    return row?.count ?? 0;
  }

  async deleteAdvertiser(id: string): Promise<void> {
    await this.handle.db.delete(advertisers).where(eq(advertisers.id, id));
  }

  // --- creatives --------------------------------------------------------------------------

  private selectCreatives() {
    return this.handle.db
      .select({
        creative: adCreatives,
        advertiserName: advertisers.name,
        mediaId: mediaAssets.id,
        mediaStatus: mediaAssets.status,
        mediaWidth: mediaAssets.width,
        mediaHeight: mediaAssets.height,
        mediaVariants: mediaAssets.variants,
      })
      .from(adCreatives)
      .leftJoin(advertisers, eq(advertisers.id, adCreatives.advertiserId))
      .leftJoin(mediaAssets, eq(mediaAssets.id, adCreatives.imageMediaId));
  }

  private toCreativeRow(row: {
    creative: AdCreativeRow;
    advertiserName: string | null;
    mediaId: string | null;
    mediaStatus: MediaAssetRecord["status"] | null;
    mediaWidth: number | null;
    mediaHeight: number | null;
    mediaVariants: MediaAssetRecord["variants"] | null;
  }): CreativeAdminRow {
    return {
      creative: row.creative,
      advertiserName: row.advertiserName,
      media:
        row.mediaId === null || row.mediaStatus === null || row.mediaVariants === null
          ? null
          : {
              status: row.mediaStatus,
              width: row.mediaWidth,
              height: row.mediaHeight,
              variants: row.mediaVariants,
            },
    };
  }

  async creatives(filter: {
    status?: AdStatus | undefined;
    channel?: AdChannel | undefined;
  }): Promise<CreativeAdminRow[]> {
    const conditions = [
      filter.status ? eq(adCreatives.status, filter.status) : undefined,
      filter.channel ? sql`${filter.channel} = any(${adCreatives.channels})` : undefined,
    ];
    const rows = await this.selectCreatives()
      .where(and(...conditions))
      .orderBy(desc(adCreatives.createdAt));
    return rows.map((row) => this.toCreativeRow(row));
  }

  async creative(id: string): Promise<CreativeAdminRow | null> {
    const [row] = await this.selectCreatives().where(eq(adCreatives.id, id)).limit(1);
    return row ? this.toCreativeRow(row) : null;
  }

  async createCreative(values: NewAdCreative): Promise<string> {
    const [row] = await this.handle.db
      .insert(adCreatives)
      .values(values)
      .returning({ id: adCreatives.id });
    if (!row) throw new Error("creative insert returned no row");
    return row.id;
  }

  async updateCreative(id: string, patch: Partial<NewAdCreative>): Promise<boolean> {
    const rows = await this.handle.db
      .update(adCreatives)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(adCreatives.id, id))
      .returning({ id: adCreatives.id });
    return rows.length > 0;
  }

  async deleteCreative(id: string): Promise<void> {
    await this.handle.db.delete(adCreatives).where(eq(adCreatives.id, id));
  }

  /** A `ready` library image can back a creative; anything else (processing, rejected, gone) cannot. */
  async mediaIsReady(id: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ status: mediaAssets.status })
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .limit(1);
    return row?.status === "ready";
  }

  // --- statistics -------------------------------------------------------------------------

  statsRows(range: { from: string; to: string; channel: AdChannel | null }): Promise<AdStatsRow[]> {
    return this.handle.db
      .select({
        creativeId: adStatsDaily.creativeId,
        title: adCreatives.title,
        placementKey: adStatsDaily.placementKey,
        day: adStatsDaily.day,
        channel: adStatsDaily.channel,
        impressions: adStatsDaily.impressions,
        clicks: adStatsDaily.clicks,
      })
      .from(adStatsDaily)
      .innerJoin(adCreatives, eq(adCreatives.id, adStatsDaily.creativeId))
      .where(
        and(
          gte(adStatsDaily.day, range.from),
          lte(adStatsDaily.day, range.to),
          range.channel ? eq(adStatsDaily.channel, range.channel) : undefined,
        ),
      );
  }
}
