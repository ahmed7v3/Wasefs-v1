import { Inject, Injectable } from "@nestjs/common";
import {
  adCreatives,
  adPlacements,
  advertisers,
  mediaAssets,
  type AdCreativeRow,
  type AdPlacementRow,
  type MediaAssetRecord,
} from "@wasfa/db";
import { and, eq, inArray, ne } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

export interface CreativeCandidateRow {
  creative: AdCreativeRow;
  advertiserName: string | null;
  advertiserActive: boolean;
  media: Pick<MediaAssetRecord, "status" | "width" | "height" | "variants"> | null;
}

/**
 * Reads of the ad tables for delivery. They hold no user data (an ad has no owner), so there is no
 * owner scope here; only approved creatives of a non-medicine category ever leave this repository.
 * Statistics are written through Redis counters and the worker's rollup, never through here.
 */
@Injectable()
export class AdsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  placements(): Promise<AdPlacementRow[]> {
    return this.handle.db.select().from(adPlacements);
  }

  /** Approved creatives with their advertiser and image; schedule and targeting are judged by the caller. */
  async approvedCreatives(): Promise<CreativeCandidateRow[]> {
    const rows = await this.handle.db
      .select({
        creative: adCreatives,
        advertiserName: advertisers.name,
        advertiserActive: advertisers.active,
        mediaId: mediaAssets.id,
        mediaStatus: mediaAssets.status,
        mediaWidth: mediaAssets.width,
        mediaHeight: mediaAssets.height,
        mediaVariants: mediaAssets.variants,
      })
      .from(adCreatives)
      .leftJoin(advertisers, eq(advertisers.id, adCreatives.advertiserId))
      .leftJoin(mediaAssets, eq(mediaAssets.id, adCreatives.imageMediaId))
      .where(and(eq(adCreatives.status, "approved"), ne(adCreatives.category, "medicine")));
    return rows.map((row) => ({
      creative: row.creative,
      advertiserName: row.advertiserName,
      advertiserActive: row.advertiserActive ?? true,
      media:
        row.mediaId === null || row.mediaStatus === null || row.mediaVariants === null
          ? null
          : {
              status: row.mediaStatus,
              width: row.mediaWidth,
              height: row.mediaHeight,
              variants: row.mediaVariants,
            },
    }));
  }

  /** The advertiser of each creative id (for the one-advertiser-per-page rule). */
  async advertisersOfCreatives(
    ids: readonly string[],
  ): Promise<{ id: string; advertiserId: string | null }[]> {
    if (ids.length === 0) return [];
    return this.handle.db
      .select({ id: adCreatives.id, advertiserId: adCreatives.advertiserId })
      .from(adCreatives)
      .where(inArray(adCreatives.id, [...ids]));
  }

  /** The destination of a click: only from our own table, never from the token or the request. */
  async clickTarget(creativeId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ targetUrl: adCreatives.targetUrl })
      .from(adCreatives)
      .where(and(eq(adCreatives.id, creativeId), ne(adCreatives.category, "medicine")))
      .limit(1);
    return row?.targetUrl ?? null;
  }
}
