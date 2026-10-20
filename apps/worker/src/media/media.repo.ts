import { mediaAssets, type Database, type MediaAssetRecord } from "@wasfa/db";
import { and, eq } from "drizzle-orm";

import type { MediaVariant } from "@wasfa/shared/schemas/media";

/*
 * Queries of the media job. A job runs for the asset it was queued for; every write is conditioned
 * on `processing`, so a retry or a duplicate job cannot move an asset backwards.
 */

export async function findAsset(db: Database, id: string): Promise<MediaAssetRecord | null> {
  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  return row ?? null;
}

export interface ReadyFields {
  mime: NonNullable<MediaAssetRecord["mime"]>;
  width: number;
  height: number;
  bytes: number;
  blurDataUrl: string;
  variants: MediaVariant[];
}

/** `processing` to `ready`; the staging key is cleared (the object is deleted). False if the asset moved on. */
export async function markReady(db: Database, id: string, fields: ReadyFields): Promise<boolean> {
  const rows = await db
    .update(mediaAssets)
    .set({
      ...fields,
      status: "ready",
      originalKey: null,
      rejectReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "processing")))
    .returning({ id: mediaAssets.id });
  return rows.length > 0;
}

export async function markRejected(db: Database, id: string, reason: string): Promise<void> {
  await db
    .update(mediaAssets)
    .set({ status: "rejected", rejectReason: reason, originalKey: null, updatedAt: new Date() })
    .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "processing")));
}
