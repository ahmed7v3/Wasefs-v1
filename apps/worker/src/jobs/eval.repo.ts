import {
  aiEvalItems,
  aiEvalResults,
  aiEvalRuns,
  aiEvalSets,
  aiUsage,
  files,
  type AiEvalItem,
  type AiEvalRun,
  type Database,
} from "@wasfa/db";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

/*
 * Queries of the accuracy-evaluation jobs. Platform data: no owner scope. Every write that moves a
 * run is conditioned on the status the job expects, so a retried or duplicate job cannot finish a
 * run twice or reopen a cancelled one.
 */

export async function findRun(db: Database, id: string): Promise<AiEvalRun | null> {
  const [row] = await db.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, id)).limit(1);
  return row ?? null;
}

/** `queued` (or a crashed run's `running`) to `running`. False when the run is already finished. */
export async function claimRun(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(aiEvalRuns)
    .set({ status: "running", startedAt: sql`coalesce(${aiEvalRuns.startedAt}, now())` })
    .where(and(eq(aiEvalRuns.id, id), inArray(aiEvalRuns.status, ["queued", "running"])))
    .returning({ id: aiEvalRuns.id });
  return rows.length > 0;
}

export async function isCancelled(db: Database, id: string): Promise<boolean> {
  const [row] = await db
    .select({ status: aiEvalRuns.status })
    .from(aiEvalRuns)
    .where(eq(aiEvalRuns.id, id));
  return row?.status === "cancelled";
}

export async function loadSetItems(db: Database, setId: string): Promise<AiEvalItem[]> {
  return db
    .select()
    .from(aiEvalItems)
    .where(eq(aiEvalItems.setId, setId))
    .orderBy(aiEvalItems.createdAt, aiEvalItems.id);
}

export interface PageFile {
  id: string;
  r2Key: string;
  status: string;
}

export async function loadFiles(db: Database, ids: readonly string[]): Promise<PageFile[]> {
  if (ids.length === 0) return [];
  return db
    .select({ id: files.id, r2Key: files.r2Key, status: files.status })
    .from(files)
    .where(inArray(files.id, [...ids]));
}

export async function doneItemIds(db: Database, runId: string): Promise<Set<string>> {
  const rows = await db
    .select({ itemId: aiEvalResults.itemId })
    .from(aiEvalResults)
    .where(eq(aiEvalResults.runId, runId));
  return new Set(rows.map((row) => row.itemId));
}

export interface NewResult {
  runId: string;
  itemId: string;
  output: unknown;
  scores: unknown;
  costUsdMicros: number;
  latencyMs: number | null;
  error: string | null;
}

/** A retried item keeps its first result. */
export async function insertResult(db: Database, result: NewResult): Promise<void> {
  await db.insert(aiEvalResults).values(result).onConflictDoNothing();
}

export interface ResultRow {
  itemId: string;
  kind: AiEvalItem["kind"];
  scores: unknown;
  costUsdMicros: number;
  latencyMs: number | null;
  error: string | null;
}

export async function loadResults(db: Database, runId: string): Promise<ResultRow[]> {
  return db
    .select({
      itemId: aiEvalResults.itemId,
      kind: aiEvalItems.kind,
      scores: aiEvalResults.scores,
      costUsdMicros: aiEvalResults.costUsdMicros,
      latencyMs: aiEvalResults.latencyMs,
      error: aiEvalResults.error,
    })
    .from(aiEvalResults)
    .innerJoin(aiEvalItems, eq(aiEvalItems.id, aiEvalResults.itemId))
    .where(eq(aiEvalResults.runId, runId));
}

/** Provider cost of every call the run made, failed attempts and repairs included. */
export async function runSpend(db: Database, runId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsage.costUsdMicros}), 0)` })
    .from(aiUsage)
    .where(eq(aiUsage.requestId, runId));
  return Number(row?.total ?? 0);
}

export interface RunEnd {
  status: "done" | "failed" | "cancelled";
  metrics: unknown;
  costUsdMicros: number;
}

/**
 * Ends a running run. A cancelled run (the admin already set the status) still receives the
 * numbers of the items that finished, but a cancelled run is never turned into done or failed.
 */
export async function endRun(db: Database, id: string, end: RunEnd): Promise<boolean> {
  const from =
    end.status === "cancelled"
      ? (["queued", "running", "cancelled"] as const)
      : (["queued", "running"] as const);
  const rows = await db
    .update(aiEvalRuns)
    .set({
      status: end.status,
      metrics: end.metrics,
      costUsdMicros: end.costUsdMicros,
      finishedAt: sql`coalesce(${aiEvalRuns.finishedAt}, now())`,
    })
    .where(and(eq(aiEvalRuns.id, id), inArray(aiEvalRuns.status, [...from])))
    .returning({ id: aiEvalRuns.id });
  return rows.length > 0;
}

/** The score of the latest finished run on the same set with the same primary model, before `runId`. */
export async function previousScore(
  db: Database,
  run: Pick<AiEvalRun, "id" | "setId">,
  primaryModelId: string,
): Promise<{ runId: string; score: number } | null> {
  const [row] = await db
    .select({
      id: aiEvalRuns.id,
      score: sql<string | null>`${aiEvalRuns.metrics} ->> 'score'`,
    })
    .from(aiEvalRuns)
    .where(
      and(
        eq(aiEvalRuns.setId, run.setId),
        eq(aiEvalRuns.status, "done"),
        ne(aiEvalRuns.id, run.id),
        isNotNull(sql`${aiEvalRuns.metrics} ->> 'score'`),
        sql`${aiEvalRuns.routeSnapshot} ->> 'primaryModelId' = ${primaryModelId}`,
      ),
    )
    .orderBy(desc(aiEvalRuns.finishedAt))
    .limit(1);
  return row?.score == null ? null : { runId: row.id, score: Number(row.score) };
}

// --- Import ---

export async function findOrCreateSet(
  db: Database,
  set: { key: string; name: string; description: string | null },
): Promise<string> {
  const [created] = await db
    .insert(aiEvalSets)
    .values(set)
    .onConflictDoNothing({ target: aiEvalSets.key })
    .returning({ id: aiEvalSets.id });
  if (created) return created.id;
  const [existing] = await db
    .select({ id: aiEvalSets.id })
    .from(aiEvalSets)
    .where(eq(aiEvalSets.key, set.key));
  if (!existing) throw new Error("Eval set vanished while importing");
  return existing.id;
}

/** True when the set already holds a prescription whose first page has this processed-image hash. */
export async function setHasImage(db: Database, setId: string, sha256: string): Promise<boolean> {
  const rows = await db
    .select({ id: aiEvalItems.id })
    .from(aiEvalItems)
    .innerJoin(files, sql`${files.id} = ${aiEvalItems.fileIds}[1]`)
    .where(and(eq(aiEvalItems.setId, setId), eq(files.sha256, sha256)))
    .limit(1);
  return rows.length > 0;
}

export interface NewEvalImage {
  id: string;
  ownerUserId: string;
  r2Key: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  dhash: string;
}

/** The processed image of an eval page as a `files` row: no expiry, so retention never deletes it. */
export async function insertEvalImage(db: Database, image: NewEvalImage): Promise<void> {
  await db.insert(files).values({
    id: image.id,
    ownerUserId: image.ownerUserId,
    createdBy: image.ownerUserId,
    purpose: "rx_page",
    r2Key: image.r2Key,
    mime: "image/jpeg",
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    sha256: image.sha256,
    dhash: image.dhash,
    status: "processed",
    expiresAt: null,
  });
}

export async function insertEvalItem(
  db: Database,
  item: { setId: string; fileIds: string[]; kind: AiEvalItem["kind"]; expected: unknown },
): Promise<string> {
  const [row] = await db.insert(aiEvalItems).values(item).returning({ id: aiEvalItems.id });
  if (!row) throw new Error("Eval item was not stored");
  return row.id;
}
