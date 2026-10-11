import { Inject, Injectable } from "@nestjs/common";
import { siteAssets, type SiteAsset } from "@wasfa/db";
import { eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { BrandingAssetKey } from "@wasfa/shared/schemas/branding";

export type AssetMeta = Pick<SiteAsset, "contentType" | "sha256" | "width" | "height"> & {
  size: number;
};

export interface AssetWrite {
  key: BrandingAssetKey;
  contentType: SiteAsset["contentType"];
  data: Buffer;
  sha256: string;
  width: number | null;
  height: number | null;
  updatedBy: string;
}

/** Brand images: platform data, so no owner scope. Only admin routes write; `GET /assets/:key` reads. */
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
      .select({
        contentType: siteAssets.contentType,
        sha256: siteAssets.sha256,
        width: siteAssets.width,
        height: siteAssets.height,
        size: sql<number>`octet_length(${siteAssets.data})`.mapWith(Number),
      })
      .from(siteAssets)
      .where(eq(siteAssets.key, key));
    return row;
  }

  async upsert(row: AssetWrite): Promise<void> {
    const values = {
      contentType: row.contentType,
      data: row.data,
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      updatedBy: row.updatedBy,
    };
    await this.handle.db
      .insert(siteAssets)
      .values({ key: row.key, ...values })
      .onConflictDoUpdate({ target: siteAssets.key, set: { ...values, updatedAt: new Date() } });
  }

  /** True when a row was removed. */
  async remove(key: BrandingAssetKey): Promise<boolean> {
    const removed = await this.handle.db
      .delete(siteAssets)
      .where(eq(siteAssets.key, key))
      .returning({ key: siteAssets.key });
    return removed.length > 0;
  }
}
