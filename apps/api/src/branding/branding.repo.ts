import { Inject, Injectable } from "@nestjs/common";
import {
  countSiteAssetHistory,
  removeSiteAsset,
  revertSiteAsset,
  siteAssets,
  storeSiteAsset,
  type SiteAsset,
  type SiteAssetWrite,
} from "@wasfa/db";
import { eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { BrandingAssetKey } from "@wasfa/shared/schemas/branding";

export type AssetMeta = Pick<SiteAsset, "key" | "contentType" | "sha256" | "width" | "height"> & {
  size: number;
  updatedAt: Date;
};

export type AssetWrite = SiteAssetWrite & { updatedBy: string };

const META_COLUMNS = {
  key: siteAssets.key,
  contentType: siteAssets.contentType,
  sha256: siteAssets.sha256,
  width: siteAssets.width,
  height: siteAssets.height,
  size: sql<number>`octet_length(${siteAssets.data})`.mapWith(Number),
  updatedAt: siteAssets.updatedAt,
};

/**
 * Brand images: platform data, so no owner scope. Only admin routes write; `GET /assets/:key` reads.
 * Every write archives the version it replaces into `site_asset_history` (the last five per key are
 * kept) inside one transaction; the shared logic lives in `@wasfa/db` because the worker writes the
 * generated icons the same way.
 */
@Injectable()
export class BrandingRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The whole row, bytes included (the public route). */
  async find(key: BrandingAssetKey): Promise<SiteAsset | undefined> {
    const [row] = await this.handle.db.select().from(siteAssets).where(eq(siteAssets.key, key));
    return row;
  }

  /** What is stored, without pulling up to 512 KB of bytes (audit "before"). */
  async findMeta(key: BrandingAssetKey): Promise<AssetMeta | undefined> {
    const [row] = await this.handle.db
      .select(META_COLUMNS)
      .from(siteAssets)
      .where(eq(siteAssets.key, key));
    return row;
  }

  /** Every stored key, without bytes. */
  listMeta(): Promise<AssetMeta[]> {
    return this.handle.db.select(META_COLUMNS).from(siteAssets);
  }

  /** Archived versions per key. */
  historyCounts(): Promise<Map<BrandingAssetKey, number>> {
    return countSiteAssetHistory(this.handle.db);
  }

  /** Stores the row; the version it replaces is archived in the same transaction. */
  upsert(row: AssetWrite): Promise<void> {
    return storeSiteAsset(this.handle.db, row);
  }

  /** True when a row was removed (and archived, so it can be reverted). */
  remove(key: BrandingAssetKey, actorId: string): Promise<boolean> {
    return removeSiteAsset(this.handle.db, key, actorId);
  }

  /** The restored row, or undefined when the key has no archived version. */
  revert(key: BrandingAssetKey, actorId: string): Promise<SiteAsset | undefined> {
    return revertSiteAsset(this.handle.db, key, actorId);
  }
}
