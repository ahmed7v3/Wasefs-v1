import { isAppError } from "@wasfa/shared/errors";
import {
  aggregateEvalRun,
  evalExpectedSchema,
  evalItemScoreSchema,
  isEvalRegression,
  scoreEvalItem,
  type EvalItemScore,
  type ScoredEvalItem,
} from "@wasfa/shared/evals";
import { evalRouteSnapshotSchema, type EvalRouteSnapshot } from "@wasfa/shared/schemas/admin-evals";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";

import {
  claimRun,
  doneItemIds,
  endRun,
  findRun,
  isCancelled,
  loadFiles,
  loadResults,
  loadSetItems,
  previousScore,
  insertResult,
  runSpend,
} from "../jobs/eval.repo.js";
import { analyzeImages } from "../rx/analyze.js";
import { RxStepError } from "../rx/model-call.js";
import { readSetting } from "../settings.js";

import type { AiRuntime } from "../ai/runtime.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { Database, AiEvalItem } from "@wasfa/db";
import type { Logger } from "pino";

/** Items of one run read at the same time (phase2.md Task 2.10: "sequential runs with a concurrency of 2"). */
export const EVAL_ITEM_CONCURRENCY = 2;
/** One prescription, pages to scored result. Longer than the 60 s a user waits: nobody is waiting. */
export const EVAL_ITEM_BUDGET_MS = 120_000;

export interface EvalRunDeps {
  db: Database;
  ai: AiRuntime;
  storage: ObjectStore;
  logger: Logger;
}

/** A code that is safe to store and log: never a message, which can quote the image text or a prompt. */
function errorCode(error: unknown): string {
  if (error instanceof RxStepError) return error.code;
  if (isAppError(error)) return error.code;
  return error instanceof Error ? error.name : "unknown";
}

/** The route lookup for `rx_extract` answers with the frozen model list; every other task is untouched. */
function frozenRoute(
  snapshot: EvalRouteSnapshot,
  runId: string,
  models: Awaited<ReturnType<AiRuntime["loadModels"]>>,
) {
  const byId = new Map(models.map((model) => [model.id, model]));
  const attempts = snapshot.models.flatMap((entry) => {
    const model = byId.get(entry.modelId);
    return model === undefined ? [] : [{ model, params: { ...entry.params } }];
  });
  return { routeId: snapshot.routeId ?? runId, version: snapshot.routeVersion, attempts };
}

/**
 * `evals.run`: reads every item of the run's set with the REAL prescription pipeline (read, match,
 * verify, finalize through the router and the drug database) and scores it against the label.
 * Nothing here touches credits, quotas or user rows; money goes through the router, so the spend
 * guard, the kill switch, the breaker and `ai_usage` all apply (usage rows carry the run id).
 *
 * Safe to run twice: items that already have a result are skipped, so a crashed run resumes where
 * it stopped. A refusal from the router (switched off, daily cap, no model) ends the run as
 * `failed` with the results so far. Logs carry ids, counts and codes, never prescription content.
 *
 * TODO(batch): providers with a Batch API run these at half price with results within 24 h. Not
 * built: it needs a per-provider submit/poll adapter, and the first sets are small enough to run
 * live. See evals/rx/README.md.
 */
export async function runEval(deps: EvalRunDeps, runId: string): Promise<void> {
  const { db, ai, storage, logger } = deps;
  const run = await findRun(db, runId);
  if (run === null) {
    logger.warn({ runId }, "eval run skipped: not found");
    return;
  }
  if (run.status !== "queued" && run.status !== "running") {
    logger.info({ runId, status: run.status }, "eval run skipped: already finished");
    return;
  }
  if (!(await claimRun(db, runId))) return;

  const snapshot = evalRouteSnapshotSchema.safeParse(run.routeSnapshot);
  if (!snapshot.success) {
    logger.error({ runId, code: "bad_snapshot" }, "eval run failed");
    await endRun(db, runId, { status: "failed", metrics: null, costUsdMicros: 0 });
    return;
  }
  const route = snapshot.data;

  const models = await ai.loadModels(route.models.map((entry) => entry.modelId));
  if (models.length === 0) {
    logger.error({ runId, code: "model_missing" }, "eval run failed");
    await endRun(db, runId, { status: "failed", metrics: null, costUsdMicros: 0 });
    return;
  }
  const frozen = frozenRoute(route, runId, models);
  const router = ai.routerWith(
    (inner) => (task, planId, mode) =>
      task === "rx_extract" ? Promise.resolve(frozen) : inner(task, planId, mode),
  );

  const rx = await readSetting(db, "rx");
  const items = await loadSetItems(db, run.setId);
  const finished = await doneItemIds(db, runId);
  const queue = items.filter((item) => !finished.has(item.id));

  // An object, not a `let`: the lanes below set it and the flow analysis would not see that.
  const state: { stop: "cancelled" | "refused" | null } = { stop: null };

  async function readItem(item: AiEvalItem): Promise<void> {
    const expected = evalExpectedSchema.safeParse(item.expected);
    const pages = await loadFiles(db, item.fileIds);
    const byId = new Map(pages.map((page) => [page.id, page]));
    const record = (fields: {
      output?: unknown;
      scores?: EvalItemScore | null;
      costUsdMicros?: number;
      latencyMs?: number | null;
      error?: string | null;
    }) =>
      insertResult(db, {
        runId,
        itemId: item.id,
        output: fields.output ?? null,
        scores: fields.scores ?? null,
        costUsdMicros: fields.costUsdMicros ?? 0,
        latencyMs: fields.latencyMs ?? null,
        error: fields.error ?? null,
      });

    if (!expected.success) return record({ error: "bad_label" });
    const images: Buffer[] = [];
    for (const fileId of item.fileIds) {
      const page = byId.get(fileId);
      const bytes =
        page?.status === "processed" ? await storage.get(page.r2Key, UPLOAD_MAX_BYTES) : null;
      if (bytes === null) return record({ error: "image_missing" });
      images.push(bytes);
    }
    if (images.length === 0) return record({ error: "image_missing" });

    const started = performance.now();
    try {
      const out = await analyzeImages({
        db,
        router,
        images,
        base: {
          mode: route.mode,
          planId: null,
          ownerUserId: null,
          ownerOrgId: null,
          userId: null,
          requestId: runId,
        },
        verifyMaxItems: rx.verifyMaxItems,
        drugMatching: rx.drugMatching,
        details: false,
        signal: AbortSignal.timeout(EVAL_ITEM_BUDGET_MS),
      });
      const latencyMs = Math.round(performance.now() - started);
      await record({
        output: out.result,
        scores: scoreEvalItem(expected.data, out.result.items),
        costUsdMicros: out.costUsdMicros,
        latencyMs,
      });
    } catch (error) {
      // A refusal ends the whole run: every other item would be refused the same way.
      if (isAppError(error)) {
        state.stop = "refused";
        logger.warn({ runId, code: errorCode(error) }, "eval run stopped: AI refused");
        return;
      }
      await record({
        error: errorCode(error),
        latencyMs: Math.round(performance.now() - started),
      });
    }
  }

  async function lane(): Promise<void> {
    for (;;) {
      if (state.stop !== null) return;
      if (await isCancelled(db, runId)) {
        state.stop = "cancelled";
        return;
      }
      const item = queue.shift();
      if (item === undefined) return;
      await readItem(item);
    }
  }
  await Promise.all(Array.from({ length: EVAL_ITEM_CONCURRENCY }, lane));

  const results = await loadResults(db, runId);
  const scored: ScoredEvalItem[] = results.map((result) => {
    const parsed = evalItemScoreSchema.safeParse(result.scores);
    return {
      kind: result.kind,
      score: parsed.success ? parsed.data : null,
      costUsdMicros: result.costUsdMicros,
      latencyMs: result.latencyMs,
    };
  });
  const metrics = aggregateEvalRun(scored);
  const costUsdMicros = await runSpend(db, runId);
  const status =
    state.stop === "cancelled"
      ? "cancelled"
      : state.stop === "refused" || (metrics.overall.items === 0 && scored.length > 0)
        ? "failed"
        : "done";
  const ended = await endRun(db, runId, { status, metrics, costUsdMicros });

  logger.info(
    {
      runId,
      status,
      items: scored.length,
      failed: metrics.overall.failed,
      score: metrics.score,
      costUsdMicros,
    },
    "eval run finished",
  );

  if (ended && status === "done") {
    const previous = await previousScore(db, run, route.primaryModelId);
    if (previous !== null && isEvalRegression(previous.score, metrics.score)) {
      logger.warn(
        {
          event: "eval.regression",
          runId,
          previousRunId: previous.runId,
          previousScore: previous.score,
          score: metrics.score,
        },
        "eval score dropped against the previous run of the same model",
      );
    }
  }
}
