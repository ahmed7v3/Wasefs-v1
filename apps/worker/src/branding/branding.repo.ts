import { createHash } from "node:crypto";

import { siteAssets, storeSiteAsset, type Database, type SiteAsset } from "@wasfa/db";
import { eq } from "drizzle-orm";

import type { RenderedIcon } from "./render-icons.js";
import type { BrandingAssetKey } from "@wasfa/shared/schemas/branding";

/*
 * Queries of the `branding.icons` job. Writes go through `storeSiteAsset`, the same archive-then-
 * upsert the api uses, so a regenerated icon keeps the previous one in `site_asset_history`.
 */

export async function findSymbol(db: Database): Promise<SiteAsset | null> {
  const [row] = await db.select().from(siteAssets).where(eq(siteAssets.key, "symbol")).limit(1);
  return row ?? null;
}

/** When the key was last written (null when absent), without its bytes. */
export async function lastWritten(db: Database, key: BrandingAssetKey): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: siteAssets.updatedAt })
    .from(siteAssets)
    .where(eq(siteAssets.key, key))
    .limit(1);
  return row?.updatedAt ?? null;
}

export function storeIcon(db: Database, icon: RenderedIcon): Promise<void> {
  return storeSiteAsset(db, {
    key: icon.key,
    contentType: icon.contentType,
    data: icon.data,
    sha256: createHash("sha256").update(icon.data).digest("hex"),
    width: icon.width,
    height: icon.height,
    updatedBy: null,
  });
}
