import { Inject, Injectable } from "@nestjs/common";
import {
  activeIngredients,
  drugIngredients,
  drugs,
  files,
  recordAiUsage,
  rxAnalyses,
  rxCorrections,
  rxPages,
  type RuntimeUsageRow,
  type NewRxAnalysis,
  type RxAnalysis,
} from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { rxResultSchema, type RxResult } from "@wasfa/shared/schemas/rx";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { afterCursor, escapeLike, stamp, type Cursor } from "../admin/common/keyset.js";
import { DB, type DbHandle } from "../common/database.js";
import { scopedRepo, type ScopedRepo } from "../common/scoped-repo.js";

import type { AppliedCorrection, PickedDrug } from "./rx-correction.js";
import type { AiMode } from "@wasfa/shared/ai";
import type { RxField } from "@wasfa/shared/rx";

export const IN_FLIGHT = ["queued", "processing", "verifying"] as const;

export interface PageRow {
  pageNo: number;
  fileId: string;
  fileStatus: string;
}

export interface ListedAnalysis {
  id: string;
  status: RxAnalysis["status"];
  mode: AiMode;
  createdAt: Date;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
  creditsCharged: number;
  result: unknown;
  pageCount: number;
}

export interface CacheKey {
  inputSha256: string;
  skillVersion: string;
  routeVersion: number;
  mode: AiMode;
}

/** Every query of the prescription routes. Owner-scoped, except the global exact-match cache lookup. */
@Injectable()
export class RxRepo {
  private readonly ofUser: ScopedRepo<typeof rxAnalyses>;

  constructor(@Inject(DB) private readonly handle: DbHandle) {
    this.ofUser = scopedRepo(handle.db, {
      table: rxAnalyses,
      scope: rxAnalyses.ownerUserId,
      id: rxAnalyses.id,
    });
  }

  find(userId: string, id: string): Promise<RxAnalysis | null> {
    return this.ofUser.find(userId, id);
  }

  /** The user's own analysis, or `NOT_FOUND` (someone else's looks the same). */
  require(userId: string, id: string): Promise<RxAnalysis> {
    return this.ofUser.require(userId, id);
  }

  /** The pages of an analysis the caller already proved to own. */
  async pages(analysisId: string): Promise<PageRow[]> {
    return this.handle.db
      .select({ pageNo: rxPages.pageNo, fileId: rxPages.fileId, fileStatus: files.status })
      .from(rxPages)
      .innerJoin(files, eq(files.id, rxPages.fileId))
      .where(eq(rxPages.analysisId, analysisId))
      .orderBy(asc(rxPages.pageNo));
  }

  /** The analysis and its pages in one transaction: both exist or neither does. */
  async insert(values: NewRxAnalysis, fileIds: readonly string[]): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(rxAnalyses).values(values);
      await tx
        .insert(rxPages)
        .values(
          fileIds.map((fileId, index) => ({
            analysisId: values.id as string,
            pageNo: index + 1,
            fileId,
          })),
        );
    });
  }

  /**
   * The newest finished analysis of the very same pages, skill and route (Decision 7a). It looks
   * across owners on purpose: identical bytes give an identical answer. The owner's own analysis is
   * preferred (it can be free). Analyses a user has corrected are never reused: a human edit is not
   * the model's answer for the next person.
   */
  async findCached(userId: string, key: CacheKey): Promise<RxAnalysis | null> {
    const [row] = await this.handle.db
      .select()
      .from(rxAnalyses)
      .where(
        and(
          eq(rxAnalyses.inputSha256, key.inputSha256),
          eq(rxAnalyses.skillVersion, key.skillVersion),
          eq(rxAnalyses.routeVersion, key.routeVersion),
          eq(rxAnalyses.mode, key.mode),
          eq(rxAnalyses.status, "done"),
          isNotNull(rxAnalyses.result),
          notExists(
            this.handle.db
              .select({ one: sql`1` })
              .from(rxCorrections)
              .where(eq(rxCorrections.analysisId, rxAnalyses.id)),
          ),
        ),
      )
      .orderBy(
        sql`(${rxAnalyses.ownerUserId} = ${userId}) desc nulls last`,
        desc(rxAnalyses.finishedAt),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * A finished analysis of the SAME user since `since` with a page whose dHash is within
   * `maxDistance` bits of one of `dhashes` (Hamming distance of the 64-bit hashes). Never crosses
   * owners: a near match across users could show one patient another's prescription.
   */
  async findNearDuplicate(
    userId: string,
    dhashes: readonly string[],
    since: Date,
    maxDistance: number,
  ): Promise<{ id: string; createdAt: Date } | null> {
    if (dhashes.length === 0) return null;
    const near = or(
      ...dhashes.map(
        (hash) =>
          sql`bit_count((('x' || ${files.dhash})::bit(64)) # ((${`x${hash}`}::text)::bit(64))) <= ${maxDistance}`,
      ),
    );
    const [row] = await this.handle.db
      .select({ id: rxAnalyses.id, createdAt: rxAnalyses.createdAt })
      .from(rxAnalyses)
      .innerJoin(rxPages, eq(rxPages.analysisId, rxAnalyses.id))
      .innerJoin(files, eq(files.id, rxPages.fileId))
      .where(
        and(
          eq(rxAnalyses.ownerUserId, userId),
          eq(rxAnalyses.status, "done"),
          gt(rxAnalyses.createdAt, since),
          isNotNull(files.dhash),
          near,
        ),
      )
      .orderBy(desc(rxAnalyses.createdAt))
      .limit(1);
    return row ?? null;
  }

  /** Appends the usage row of a cache hit (cost 0, no provider). */
  recordUsage(row: RuntimeUsageRow): Promise<string> {
    return recordAiUsage(this.handle.db, row);
  }

  /** The job could not be queued: the analysis ends as failed, with a reference for support. */
  async markFailed(id: string, errorRef: string): Promise<void> {
    await this.handle.db
      .update(rxAnalyses)
      .set({ status: "failed", errorRef, finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(rxAnalyses.id, id), inArray(rxAnalyses.status, [...IN_FLIGHT])));
  }

  /** The user's history, newest first (keyset). `q` matches item names inside the results. */
  async list(
    userId: string,
    options: { cursor: Cursor | undefined; limit: number; q: string | undefined },
  ): Promise<ListedAnalysis[]> {
    const conditions: SQL[] = [eq(rxAnalyses.ownerUserId, userId)];
    if (options.cursor) {
      conditions.push(afterCursor(rxAnalyses.createdAt, rxAnalyses.id, options.cursor, "uuid"));
    }
    if (options.q !== undefined) {
      const pattern = `%${escapeLike(options.q)}%`;
      conditions.push(
        sql`exists (
          select 1 from jsonb_array_elements(coalesce(${rxAnalyses.result} -> 'items', '[]'::jsonb)) as it
          where it ->> 'name' ilike ${pattern} or it ->> 'rawText' ilike ${pattern}
        )`,
      );
    }
    const rows = await this.handle.db
      .select({
        id: rxAnalyses.id,
        status: rxAnalyses.status,
        mode: rxAnalyses.mode,
        createdAt: rxAnalyses.createdAt,
        cursorAt: stamp(rxAnalyses.createdAt),
        creditsCharged: rxAnalyses.creditsCharged,
        result: rxAnalyses.result,
        pageCount: sql<number>`(select count(*)::int from ${rxPages} where ${rxPages.analysisId} = ${rxAnalyses.id})`,
      })
      .from(rxAnalyses)
      .where(and(...conditions))
      .orderBy(desc(rxAnalyses.createdAt), desc(rxAnalyses.id))
      .limit(options.limit + 1);
    return rows;
  }

  /** Deletes the analysis (pages and corrections cascade). True when a row of this owner went. */
  remove(userId: string, id: string): Promise<boolean> {
    return this.ofUser.remove(userId, id);
  }

  /** A drug with its active ingredients (English names), for a picked correction. `null` when unknown. */
  async drugWithIngredients(drugId: string): Promise<PickedDrug | null> {
    const [drug] = await this.handle.db
      .select({ id: drugs.id, brandEn: drugs.brandEn })
      .from(drugs)
      .where(eq(drugs.id, drugId));
    if (!drug) return null;
    const rows = await this.handle.db
      .select({ name: activeIngredients.nameEn })
      .from(drugIngredients)
      .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
      .where(eq(drugIngredients.drugId, drugId))
      .orderBy(asc(activeIngredients.nameEn));
    return { id: drug.id, brandEn: drug.brandEn, ingredients: rows.map((row) => row.name) };
  }

  /**
   * Records one fix and stores the corrected result, atomically, under a row lock so two quick
   * fixes to the same analysis cannot overwrite each other. `NOT_FOUND` for a foreign analysis,
   * `CONFLICT` (`not_ready`) before it has a result, `VALIDATION_FAILED` for a line that does not exist.
   */
  async applyCorrection(
    userId: string,
    id: string,
    fix: {
      itemIndex: number;
      field: RxField;
      after: string;
      consentForEval: boolean;
    },
    apply: (result: RxResult) => AppliedCorrection | null,
  ): Promise<RxResult> {
    return this.handle.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(rxAnalyses)
        .where(and(eq(rxAnalyses.id, id), eq(rxAnalyses.ownerUserId, userId)))
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND);
      const parsed = row.status === "done" ? rxResultSchema.safeParse(row.result) : null;
      if (!parsed?.success) {
        throw new AppError(ErrorCode.CONFLICT, { details: { reason: "not_ready" } });
      }
      const applied = apply(parsed.data);
      if (applied === null) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["itemIndex"] } });
      }
      await tx
        .update(rxAnalyses)
        .set({ result: applied.result, updatedAt: new Date() })
        .where(eq(rxAnalyses.id, id));
      await tx.insert(rxCorrections).values({
        analysisId: id,
        itemIndex: fix.itemIndex,
        field: fix.field,
        before: applied.before,
        after: fix.after,
        userId,
        consentForEval: fix.consentForEval,
      });
      return applied.result;
    });
  }
}
