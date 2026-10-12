import { files, type Database, type FileRecord } from "@wasfa/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

/*
 * Queries of the image jobs. The worker has no per-user scope: a job runs for the file it was
 * queued for, and every write below is conditioned on the status the job expects, so a retry or a
 * duplicate job cannot move a file backwards.
 */

export async function findFile(db: Database, fileId: string): Promise<FileRecord | null> {
  const [row] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  return row ?? null;
}

export interface ProcessedFields {
  r2Key: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
}

/** `uploaded` to `processed`; the row now points at the processed JPEG. False if the file moved on. */
export async function markProcessed(
  db: Database,
  fileId: string,
  fields: ProcessedFields,
): Promise<boolean> {
  const rows = await db
    .update(files)
    .set({ ...fields, mime: "image/jpeg", status: "processed", updatedAt: new Date() })
    .where(and(eq(files.id, fileId), eq(files.status, "uploaded")))
    .returning({ id: files.id });
  return rows.length > 0;
}

export async function markRejected(db: Database, fileId: string, reason: string): Promise<void> {
  await db
    .update(files)
    .set({ status: "rejected", rejectReason: reason, updatedAt: new Date() })
    .where(and(eq(files.id, fileId), inArray(files.status, ["pending", "uploaded"])));
}

/** Files whose objects are past their retention date, oldest first. */
export async function findExpired(
  db: Database,
  now: Date,
  limit: number,
): Promise<Pick<FileRecord, "id" | "r2Key" | "status">[]> {
  return db
    .select({ id: files.id, r2Key: files.r2Key, status: files.status })
    .from(files)
    .where(and(sql`${files.status} <> 'deleted'`, lt(files.expiresAt, now)))
    .orderBy(files.expiresAt)
    .limit(limit);
}

/** Marks the file `deleted` (its object is gone). The row stays: the analysis says the image was deleted. */
export async function markDeleted(db: Database, fileId: string): Promise<void> {
  await db
    .update(files)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(files.id, fileId), sql`${files.status} <> 'deleted'`));
}
