import { Inject, Injectable } from "@nestjs/common";
import {
  aiEvalItems,
  aiEvalResults,
  aiEvalRuns,
  aiEvalSets,
  aiModels,
  aiProviders,
  aiTaskRoutes,
  files,
  rxAnalyses,
  rxCorrections,
  rxPages,
  type AiEvalItem,
  type AiEvalRun,
  type AiEvalSet,
  type AiModel,
  type AiProvider,
  type AiTaskRoute,
  type FileRecord,
  type RxAnalysis,
  type RxCorrection,
} from "@wasfa/db";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { AiMode } from "@wasfa/shared/ai";

export interface SetRow {
  set: AiEvalSet;
  items: number;
  printed: number;
  handwritten: number;
  withoutImage: number;
}

export interface RunRow {
  run: AiEvalRun;
  setKey: string;
  setName: string;
  itemsTotal: number;
  itemsDone: number;
}

export interface ModelWithProvider {
  model: AiModel;
  provider: Pick<AiProvider, "id" | "key" | "kind" | "enabled" | "dataPolicy">;
}

export interface ItemResultRow {
  item: AiEvalItem;
  output: unknown;
  scores: unknown;
  costUsdMicros: number | null;
  latencyMs: number | null;
  error: string | null;
  done: boolean;
}

export interface SharedRow {
  analysis: RxAnalysis;
  /** Pages whose picture still exists. */
  pages: number;
}

export interface QueueRow {
  correction: RxCorrection;
  result: unknown;
  pages: number;
}

export interface CorrectionContext {
  correction: RxCorrection;
  result: unknown;
  /** The analysis's pages in order, with the file rows. */
  pages: FileRecord[];
  /** Every consented correction of the same analysis. */
  siblingIds: string[];
}

@Injectable()
export class AdminEvalsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  private get db() {
    return this.handle.db;
  }

  // --- Sets ---

  async listSets(): Promise<SetRow[]> {
    const rows = await this.db
      .select({
        set: aiEvalSets,
        items: sql<number>`count(${aiEvalItems.id})::int`,
        printed: sql<number>`count(${aiEvalItems.id}) filter (where ${aiEvalItems.kind} = 'printed')::int`,
        handwritten: sql<number>`count(${aiEvalItems.id}) filter (where ${aiEvalItems.kind} = 'handwritten')::int`,
        withoutImage: sql<number>`count(${aiEvalItems.id}) filter (where cardinality(${aiEvalItems.fileIds}) = 0)::int`,
      })
      .from(aiEvalSets)
      .leftJoin(aiEvalItems, eq(aiEvalItems.setId, aiEvalSets.id))
      .groupBy(aiEvalSets.id)
      .orderBy(desc(aiEvalSets.createdAt));
    return rows;
  }

  async findSet(id: string): Promise<AiEvalSet | undefined> {
    const [row] = await this.db.select().from(aiEvalSets).where(eq(aiEvalSets.id, id));
    return row;
  }

  /** Items of a set that a run can read (they have pages). */
  async runnableItems(setId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiEvalItems)
      .where(and(eq(aiEvalItems.setId, setId), sql`cardinality(${aiEvalItems.fileIds}) > 0`));
    return row?.count ?? 0;
  }

  // --- Routes and models for the snapshot ---

  async defaultRoute(task: "rx_extract", mode: AiMode): Promise<AiTaskRoute | undefined> {
    const [row] = await this.db
      .select()
      .from(aiTaskRoutes)
      .where(
        and(
          eq(aiTaskRoutes.task, task),
          eq(aiTaskRoutes.mode, mode),
          sql`${aiTaskRoutes.planId} is null`,
        ),
      );
    return row;
  }

  async modelsByIds(ids: readonly string[]): Promise<ModelWithProvider[]> {
    if (ids.length === 0) return [];
    return this.db
      .select({
        model: aiModels,
        provider: {
          id: aiProviders.id,
          key: aiProviders.key,
          kind: aiProviders.kind,
          enabled: aiProviders.enabled,
          dataPolicy: aiProviders.dataPolicy,
        },
      })
      .from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .where(inArray(aiModels.id, [...ids]));
  }

  // --- Runs ---

  private runSelect() {
    return this.db
      .select({
        run: aiEvalRuns,
        setKey: aiEvalSets.key,
        setName: aiEvalSets.name,
        itemsTotal: sql<number>`(select count(*)::int from ${aiEvalItems} where ${aiEvalItems.setId} = ${aiEvalRuns.setId})`,
        itemsDone: sql<number>`(select count(*)::int from ${aiEvalResults} where ${aiEvalResults.runId} = ${aiEvalRuns.id})`,
      })
      .from(aiEvalRuns)
      .innerJoin(aiEvalSets, eq(aiEvalSets.id, aiEvalRuns.setId));
  }

  async listRuns(options: { setId?: string | undefined; limit: number }): Promise<RunRow[]> {
    const query = this.runSelect();
    return options.setId === undefined
      ? await query.orderBy(desc(aiEvalRuns.createdAt)).limit(options.limit)
      : await query
          .where(eq(aiEvalRuns.setId, options.setId))
          .orderBy(desc(aiEvalRuns.createdAt))
          .limit(options.limit);
  }

  async findRun(id: string): Promise<RunRow | undefined> {
    const [row] = await this.runSelect().where(eq(aiEvalRuns.id, id));
    return row;
  }

  async createRuns(
    values: { setId: string; routeSnapshot: unknown; startedBy: string }[],
  ): Promise<string[]> {
    const rows = await this.db.insert(aiEvalRuns).values(values).returning({ id: aiEvalRuns.id });
    return rows.map((row) => row.id);
  }

  async failRuns(ids: readonly string[]): Promise<void> {
    await this.db
      .update(aiEvalRuns)
      .set({ status: "failed", finishedAt: new Date() })
      .where(and(inArray(aiEvalRuns.id, [...ids]), eq(aiEvalRuns.status, "queued")));
  }

  /** Sets `cancelled` on a run that has not finished; the worker stops at the next item. */
  async cancelRun(id: string): Promise<AiEvalRun | undefined> {
    const [row] = await this.db
      .update(aiEvalRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(aiEvalRuns.id, id), inArray(aiEvalRuns.status, ["queued", "running"])))
      .returning();
    return row;
  }

  /** Every item of the run's set with its result (if any), in set order. */
  async runItems(runId: string, setId: string): Promise<ItemResultRow[]> {
    const rows = await this.db
      .select({
        item: aiEvalItems,
        resultItem: aiEvalResults.itemId,
        output: aiEvalResults.output,
        scores: aiEvalResults.scores,
        costUsdMicros: aiEvalResults.costUsdMicros,
        latencyMs: aiEvalResults.latencyMs,
        error: aiEvalResults.error,
      })
      .from(aiEvalItems)
      .leftJoin(
        aiEvalResults,
        and(eq(aiEvalResults.itemId, aiEvalItems.id), eq(aiEvalResults.runId, runId)),
      )
      .where(eq(aiEvalItems.setId, setId))
      .orderBy(asc(aiEvalItems.createdAt), asc(aiEvalItems.id));
    return rows.map((row) => ({
      item: row.item,
      output: row.output,
      scores: row.scores,
      costUsdMicros: row.costUsdMicros,
      latencyMs: row.latencyMs,
      error: row.error,
      done: row.resultItem !== null,
    }));
  }

  async runItem(runId: string, itemId: string): Promise<ItemResultRow | undefined> {
    const run = await this.findRun(runId);
    if (run === undefined) return undefined;
    return (await this.runItems(runId, run.run.setId)).find((row) => row.item.id === itemId);
  }

  // --- Review queue ---

  /** Not yet in any eval item: `expected.origin.correctionIds` lists the corrections an item was made from. */
  private notYetAdded() {
    return sql`not exists (
      select 1 from ${aiEvalItems}
      where ${aiEvalItems.expected} -> 'origin' -> 'correctionIds' @> to_jsonb(${rxCorrections.id}::text)
    )`;
  }

  async reviewQueue(limit: number): Promise<QueueRow[]> {
    return this.db
      .select({
        correction: rxCorrections,
        result: rxAnalyses.result,
        pages: sql<number>`(
          select count(*)::int from ${rxPages}
          inner join ${files} on ${files.id} = ${rxPages.fileId}
          where ${rxPages.analysisId} = ${rxCorrections.analysisId} and ${files.status} = 'processed'
        )`,
      })
      .from(rxCorrections)
      .innerJoin(rxAnalyses, eq(rxAnalyses.id, rxCorrections.analysisId))
      .where(and(eq(rxCorrections.consentForEval, true), this.notYetAdded()))
      .orderBy(desc(rxCorrections.createdAt))
      .limit(limit);
  }

  /** Not yet in any eval item: `expected.origin.analysisId` names the analysis an item was made from. */
  private sharedNotYetAdded() {
    return sql`not exists (
      select 1 from ${aiEvalItems}
      where ${aiEvalItems.expected} -> 'origin' ->> 'analysisId' = ${rxAnalyses.id}::text
    )`;
  }

  /** Analyses a person rated and agreed to share, newest first, that no eval item was made from yet. */
  async sharedQueue(limit: number): Promise<SharedRow[]> {
    return this.db
      .select({
        analysis: rxAnalyses,
        pages: sql<number>`(
          select count(*)::int from ${rxPages}
          inner join ${files} on ${files.id} = ${rxPages.fileId}
          where ${rxPages.analysisId} = ${rxAnalyses.id} and ${files.status} = 'processed'
        )`,
      })
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.shareForReview, true), this.sharedNotYetAdded()))
      .orderBy(desc(rxAnalyses.ratedAt))
      .limit(limit);
  }

  /** One shared analysis with its page files (any status: the caller checks them). */
  async sharedContext(
    id: string,
  ): Promise<{ analysis: RxAnalysis; pages: FileRecord[] } | undefined> {
    const [analysis] = await this.db
      .select()
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.id, id), eq(rxAnalyses.shareForReview, true)));
    if (analysis === undefined) return undefined;
    const pages = await this.db
      .select({ file: files })
      .from(rxPages)
      .innerJoin(files, eq(files.id, rxPages.fileId))
      .where(eq(rxPages.analysisId, id))
      .orderBy(asc(rxPages.pageNo));
    return { analysis, pages: pages.map((page) => page.file) };
  }

  async sharedAlreadyAdded(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiEvalItems)
      .where(sql`${aiEvalItems.expected} -> 'origin' ->> 'analysisId' = ${id}`);
    return (row?.count ?? 0) > 0;
  }

  /** Takes the analysis out of the review list: the person's consent no longer reaches an admin. */
  async dismissShared(id: string): Promise<boolean> {
    const rows = await this.db
      .update(rxAnalyses)
      .set({ shareForReview: false })
      .where(and(eq(rxAnalyses.id, id), eq(rxAnalyses.shareForReview, true)))
      .returning({ id: rxAnalyses.id });
    return rows.length > 0;
  }

  async correctionContext(id: string): Promise<CorrectionContext | undefined> {
    const [row] = await this.db
      .select({ correction: rxCorrections, result: rxAnalyses.result })
      .from(rxCorrections)
      .innerJoin(rxAnalyses, eq(rxAnalyses.id, rxCorrections.analysisId))
      .where(and(eq(rxCorrections.id, id), eq(rxCorrections.consentForEval, true)));
    if (row === undefined) return undefined;
    const pages = await this.db
      .select({ file: files })
      .from(rxPages)
      .innerJoin(files, eq(files.id, rxPages.fileId))
      .where(eq(rxPages.analysisId, row.correction.analysisId))
      .orderBy(asc(rxPages.pageNo));
    const siblings = await this.db
      .select({ id: rxCorrections.id })
      .from(rxCorrections)
      .where(
        and(
          eq(rxCorrections.analysisId, row.correction.analysisId),
          eq(rxCorrections.consentForEval, true),
        ),
      );
    return {
      correction: row.correction,
      result: row.result,
      pages: pages.map((page) => page.file),
      siblingIds: siblings.map((sibling) => sibling.id),
    };
  }

  /** True when an item made from any of these corrections already exists. */
  async alreadyAdded(correctionIds: readonly string[]): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiEvalItems)
      .where(
        or(
          ...correctionIds.map(
            (id) =>
              sql`${aiEvalItems.expected} -> 'origin' -> 'correctionIds' @> to_jsonb(${id}::text)`,
          ),
        ),
      );
    return (row?.count ?? 0) > 0;
  }

  /** Withdraws the consent: the correction leaves the queue and is deleted with its analysis as usual. */
  async withdrawConsent(id: string): Promise<boolean> {
    const rows = await this.db
      .update(rxCorrections)
      .set({ consentForEval: false })
      .where(and(eq(rxCorrections.id, id), eq(rxCorrections.consentForEval, true)))
      .returning({ id: rxCorrections.id });
    return rows.length > 0;
  }

  async addItem(args: {
    setId: string;
    kind: AiEvalItem["kind"];
    expected: unknown;
    images: {
      id: string;
      ownerUserId: string;
      r2Key: string;
      bytes: number;
      width: number | null;
      height: number | null;
      sha256: string | null;
      dhash: string | null;
    }[];
  }): Promise<string> {
    return await this.db.transaction(async (tx) => {
      for (const image of args.images) {
        await tx.insert(files).values({
          ...image,
          createdBy: image.ownerUserId,
          purpose: "rx_page",
          mime: "image/jpeg",
          status: "processed",
          expiresAt: null,
        });
      }
      const [item] = await tx
        .insert(aiEvalItems)
        .values({
          setId: args.setId,
          fileIds: args.images.map((image) => image.id),
          kind: args.kind,
          expected: args.expected,
        })
        .returning({ id: aiEvalItems.id });
      if (!item) throw new Error("Eval item was not stored");
      return item.id;
    });
  }
}
