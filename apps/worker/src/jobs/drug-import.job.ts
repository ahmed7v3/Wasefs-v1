import {
  DRUG_IMPORT_BATCH_SIZE,
  DRUG_IMPORT_TTL_SECONDS,
  drugImportKeys,
  presetMapping,
  type DrugImportMapping,
} from "@wasfa/shared/drugs";
import { importMappingSchema, type ImportProgress } from "@wasfa/shared/schemas/admin-drugs";

import { ImportFileError, readImportFile, type ParsedFile } from "./drug-import.file.js";
import {
  ReportCollector,
  fieldColumns,
  invalidResult,
  parseImportRow,
  planRow,
  rowKey,
  rowResult,
  type ImportRow,
  type RowPlan,
} from "./drug-import.plan.js";
import {
  findExisting,
  loadBatch,
  markCommitStarted,
  updateBatch,
  writeChunk,
} from "./drug-import.repo.js";

import type { JobContext } from "../queues.js";
import type { DrugSource } from "@wasfa/shared/ai";
import type { JobPayload } from "@wasfa/shared/queues";

type Payload = JobPayload<"drugs", "drugs.import">;

/*
 * `drugs.import` (Task 2.7). The api parked the uploaded file in Redis; this reads it, applies the
 * column mapping and either reports what a commit would do (`dry_run`) or does it (`commit`), in
 * chunks of 1,000 rows with progress. Both modes share `planRow`, so the preview matches the result.
 * The job runs once (no retries): a failure is shown to the admin, who starts it again - a commit
 * is safe to repeat because rows it already wrote are recognised by their batch tag.
 */

/** The mapping to use: the admin's (restricted to columns the file has), else the source's preset. */
function chooseMapping(saved: unknown, parsed: ParsedFile, source: DrugSource): DrugImportMapping {
  const known = importMappingSchema.safeParse(saved);
  const mapping: DrugImportMapping = {};
  if (known.success) {
    for (const [header, field] of Object.entries(known.data)) {
      if (parsed.headers.includes(header)) mapping[header] = field;
    }
  }
  return Object.keys(mapping).length > 0 ? mapping : presetMapping(source, parsed.headers);
}

export async function drugImportJob(payload: Payload, context: JobContext): Promise<void> {
  const { redis, db, logger } = context;
  const { batchId, mode } = payload;
  const keys = drugImportKeys(batchId);

  const progress = async (
    phase: ImportProgress["phase"],
    done: number,
    total: number,
    error: string | null = null,
  ): Promise<void> => {
    const value: ImportProgress = { mode, phase, done, total, error };
    await redis.set(keys.progress, JSON.stringify(value), "EX", DRUG_IMPORT_TTL_SECONDS);
  };

  try {
    const batch = await loadBatch(db, batchId);
    if (batch === undefined) {
      logger.warn({ batchId }, "Drug import batch is gone; nothing to do");
      return;
    }
    if (batch.status === "committed" || batch.status === "rolled_back") {
      await progress("failed", 0, 0, "already_finished");
      return;
    }
    await progress("running", 0, 0);

    const bytes = await redis.getBuffer(keys.file);
    if (bytes === null) {
      await progress("failed", 0, 0, "file_expired");
      return;
    }

    let parsed: ParsedFile;
    try {
      parsed = await readImportFile(bytes);
    } catch (error) {
      if (error instanceof ImportFileError) {
        if (mode === "dry_run") await updateBatch(db, batchId, { status: "failed" });
        await progress("failed", 0, 0, error.code);
        return;
      }
      throw error;
    }

    const mapping = chooseMapping(batch.mapping, parsed, batch.source);
    const columns = fieldColumns(mapping);
    if (columns.brandEn === undefined && columns.brandAr === undefined) {
      if (mode === "dry_run") {
        await updateBatch(db, batchId, { mapping, status: "failed" });
      }
      await progress("failed", 0, parsed.rows.length, "no_name_column");
      return;
    }

    const committedAt =
      mode === "commit" ? await markCommitStarted(db, batchId, payload.actorId) : batch.committedAt;
    const total = parsed.rows.length;
    const report = new ReportCollector();
    const seen = new Set<string>();
    let inserted = 0;
    let updated = 0;
    await progress("running", 0, total);

    for (let start = 0; start < total; start += DRUG_IMPORT_BATCH_SIZE) {
      const chunk = parsed.rows.slice(start, start + DRUG_IMPORT_BATCH_SIZE);
      const valid: ImportRow[] = [];
      for (const raw of chunk) {
        const row = parseImportRow(raw, columns, batch.source);
        if (row.ok) valid.push(row.value);
        else report.add(invalidResult(row));
      }
      const existing = await findExisting(
        db,
        batch.source,
        valid.filter((row) => row.sourceRef === null).map((row) => row.columns.normalizedEn),
        valid.flatMap((row) => (row.sourceRef === null ? [] : [row.sourceRef])),
      );
      const entries: { row: ImportRow; plan: RowPlan }[] = valid.map((row) => {
        const plan = planRow(row, existing.get(rowKey(row)), seen, { batchId, committedAt });
        report.add(rowResult(row, plan));
        return { row, plan };
      });
      if (mode === "commit") {
        const written = await writeChunk(db, batchId, batch.source, entries);
        inserted += written.inserted;
        updated += written.updated;
      }
      await progress("running", Math.min(start + chunk.length, total), total);
    }

    const finished = new Date();
    const result = report.build(mode, parsed.headers, mapping, finished);
    // Report first: once the status says "done" the admin screen reads it.
    await redis.set(keys.report, JSON.stringify(result), "EX", DRUG_IMPORT_TTL_SECONDS);

    // Rows a previous interrupted run already wrote are counted by the plan, not by this run.
    const counts = result.counts;
    if (mode === "dry_run") {
      await updateBatch(db, batchId, { mapping, rowsTotal: counts.total, status: "dry_run" });
    } else {
      await updateBatch(db, batchId, {
        mapping,
        rowsTotal: counts.total,
        rowsInserted: counts.new,
        rowsUpdated: counts.updated,
        rowsSkipped: counts.duplicate + counts.invalid,
        status: "committed",
      });
    }
    logger.info(
      { batchId, mode, ...counts, wroteInserted: inserted, wroteUpdated: updated },
      "Drug import finished",
    );
    await progress("done", total, total);
  } catch (error) {
    await progress("failed", 0, 0, "internal").catch(() => undefined);
    throw error;
  } finally {
    await redis.del(keys.busy);
  }
}
