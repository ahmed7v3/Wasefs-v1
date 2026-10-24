import { BRANDING_HISTORY_KEEP, type BrandingAssetKey } from "@wasfa/shared/schemas/branding";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { siteAssetHistory, siteAssets, type SiteAsset } from "./schema/site-assets.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

/*
 * Writes to the brand images, shared by the api (admin uploads) and the worker (icons rendered from
 * the symbol) so both archive the same way: the row being replaced, reverted or deleted moves to
 * `site_asset_history` in the same transaction, and only the newest `BRANDING_HISTORY_KEEP` versions
 * of a key are kept. One advisory lock per key serialises writers of the same key.
 */

export interface SiteAssetWrite {
  key: BrandingAssetKey;
  contentType: SiteAsset["contentType"];
  data: Buffer;
  sha256: string;
  width: number | null;
  height: number | null;
  /** The admin; null when the worker wrote it. */
  updatedBy: string | null;
}

async function lock(tx: Transaction, key: BrandingAssetKey): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site_asset:${key}`}, 0))`);
}

async function current(tx: Transaction, key: BrandingAssetKey): Promise<SiteAsset | undefined> {
  const [row] = await tx.select().from(siteAssets).where(eq(siteAssets.key, key));
  return row;
}

async function archive(tx: Transaction, row: SiteAsset, replacedBy: string | null): Promise<void> {
  await tx.insert(siteAssetHistory).values({
    key: row.key,
    contentType: row.contentType,
    data: row.data,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    replacedBy,
  });
  const stale = await tx
    .select({ id: siteAssetHistory.id })
    .from(siteAssetHistory)
    .where(eq(siteAssetHistory.key, row.key))
    .orderBy(desc(siteAssetHistory.replacedAt), desc(siteAssetHistory.id))
    .offset(BRANDING_HISTORY_KEEP);
  if (stale.length > 0) {
    await tx.delete(siteAssetHistory).where(
      and(
        eq(siteAssetHistory.key, row.key),
        inArray(
          siteAssetHistory.id,
          stale.map((entry) => entry.id),
        ),
      ),
    );
  }
}

async function put(tx: Transaction, row: SiteAssetWrite): Promise<void> {
  const values = {
    contentType: row.contentType,
    data: row.data,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    updatedBy: row.updatedBy,
  };
  await tx
    .insert(siteAssets)
    .values({ key: row.key, ...values })
    .onConflictDoUpdate({ target: siteAssets.key, set: { ...values, updatedAt: new Date() } });
}

/** Stores `row`; the version it replaces is archived unless it is byte-identical. */
export async function storeSiteAsset(db: Database, row: SiteAssetWrite): Promise<void> {
  await db.transaction(async (tx) => {
    await lock(tx, row.key);
    const before = await current(tx, row.key);
    if (before && before.sha256 !== row.sha256) await archive(tx, before, row.updatedBy);
    await put(tx, row);
  });
}

/** Archives and deletes the live row. False when there was none. */
export async function removeSiteAsset(
  db: Database,
  key: BrandingAssetKey,
  actorId: string | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lock(tx, key);
    const before = await current(tx, key);
    if (!before) return false;
    await archive(tx, before, actorId);
    await tx.delete(siteAssets).where(eq(siteAssets.key, key));
    return true;
  });
}

/**
 * Puts the newest archived version back live; the version it replaces goes to the history. Returns
 * the restored row, or undefined when there is nothing to restore.
 */
export async function revertSiteAsset(
  db: Database,
  key: BrandingAssetKey,
  actorId: string | null,
): Promise<SiteAsset | undefined> {
  return db.transaction(async (tx) => {
    await lock(tx, key);
    const [latest] = await tx
      .select()
      .from(siteAssetHistory)
      .where(eq(siteAssetHistory.key, key))
      .orderBy(desc(siteAssetHistory.replacedAt), desc(siteAssetHistory.id))
      .limit(1);
    if (!latest) return undefined;

    const live = await current(tx, key);
    await tx.delete(siteAssetHistory).where(eq(siteAssetHistory.id, latest.id));
    if (live) await archive(tx, live, actorId);
    await put(tx, {
      key,
      contentType: latest.contentType,
      data: latest.data,
      sha256: latest.sha256,
      width: latest.width,
      height: latest.height,
      updatedBy: actorId,
    });
    return current(tx, key);
  });
}

/** Number of archived versions per key (how far `revert` can still walk back). */
export async function countSiteAssetHistory(db: Database): Promise<Map<BrandingAssetKey, number>> {
  const rows = await db
    .select({ key: siteAssetHistory.key, count: sql<number>`count(*)::int` })
    .from(siteAssetHistory)
    .groupBy(siteAssetHistory.key);
  return new Map(rows.map((row) => [row.key, row.count]));
}
