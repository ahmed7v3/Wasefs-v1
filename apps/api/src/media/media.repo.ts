import { Inject, Injectable } from "@nestjs/common";
import { mediaAssets, type MediaAssetRecord } from "@wasfa/db";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { ListMediaQuery, MediaStatus, PatchMediaInput } from "@wasfa/shared/schemas/media";

export interface StagedWrite {
  sha256: string;
  mime: MediaAssetRecord["mime"];
  bytes: number;
  originalKey: string;
  createdBy: string;
}

/** The media library is platform data (no owner); only admin routes reach this repository. */
@Injectable()
export class MediaRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async findById(id: string): Promise<MediaAssetRecord | undefined> {
    const [row] = await this.handle.db.select().from(mediaAssets).where(eq(mediaAssets.id, id));
    return row;
  }

  async findBySha(sha256: string): Promise<MediaAssetRecord | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.sha256, sha256));
    return row;
  }

  /**
   * Creates the `staged` row, or takes over one that never finished (`staged`, or `rejected` so the
   * same bytes may be retried). Atomic on the unique digest; returns `undefined` when the asset is
   * `processing` or `ready`: the caller then reuses it.
   */
  async upsertStaged(row: StagedWrite): Promise<MediaAssetRecord | undefined> {
    const [saved] = await this.handle.db
      .insert(mediaAssets)
      .values({ ...row, status: "staged" })
      .onConflictDoUpdate({
        target: mediaAssets.sha256,
        set: {
          status: "staged",
          mime: row.mime,
          bytes: row.bytes,
          originalKey: row.originalKey,
          rejectReason: null,
          updatedAt: new Date(),
        },
        setWhere: sql`${mediaAssets.status} in ('staged', 'rejected')`,
      })
      .returning();
    return saved;
  }

  /** `staged` to `processing`; false when the asset moved on (a second commit). */
  async markProcessing(id: string): Promise<boolean> {
    const rows = await this.handle.db
      .update(mediaAssets)
      .set({ status: "processing", updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.status, "staged")))
      .returning({ id: mediaAssets.id });
    return rows.length > 0;
  }

  async update(id: string, patch: PatchMediaInput): Promise<MediaAssetRecord | undefined> {
    const [row] = await this.handle.db
      .update(mediaAssets)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(mediaAssets.id, id))
      .returning();
    return row;
  }

  async list(query: ListMediaQuery): Promise<{ items: MediaAssetRecord[]; total: number }> {
    const where = query.status
      ? eq(mediaAssets.status, query.status satisfies MediaStatus)
      : undefined;
    const [items, [totals]] = await Promise.all([
      this.handle.db
        .select()
        .from(mediaAssets)
        .where(where)
        .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.handle.db.select({ total: count() }).from(mediaAssets).where(where),
    ]);
    return { items, total: totals?.total ?? 0 };
  }
}
