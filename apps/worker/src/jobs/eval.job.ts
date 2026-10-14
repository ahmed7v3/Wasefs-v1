import {
  EVAL_IMPORT_REPORT_TTL_SECONDS,
  evalImportReportKey,
  type EvalImportReport,
} from "@wasfa/shared/schemas/admin-evals";

import { EvalImportError, importEvalSet } from "../eval/import.js";
import { runEval } from "../eval/run.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

/*
 * Accuracy evaluation jobs (queue `evals`, Task 2.10). The work lives in `../eval/`; this is the
 * place of the two jobs in the registry.
 */

/** `evals.run`: one run of an eval set against its frozen route. */
export async function evalRunJob(
  { runId }: JobPayload<"evals", "evals.run">,
  { db, logger, storage, ai }: Pick<JobContext, "db" | "logger" | "storage" | "ai">,
): Promise<void> {
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  if (ai === undefined) throw new Error("The AI runtime is not configured");
  await runEval({ db, ai, storage, logger }, runId);
}

/** `evals.import`: sheet and images from staging into the eval tables; the outcome waits in Redis for the admin page. */
export async function evalImportJob(
  payload: JobPayload<"evals", "evals.import">,
  { db, redis, logger, storage }: Pick<JobContext, "db" | "redis" | "logger" | "storage">,
): Promise<void> {
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  const key = evalImportReportKey(payload.batchId);
  const write = async (report: Omit<EvalImportReport, "id">): Promise<void> => {
    await redis.set(
      key,
      JSON.stringify({ id: payload.batchId, ...report }),
      "EX",
      EVAL_IMPORT_REPORT_TTL_SECONDS,
    );
  };
  const empty = { setId: null, created: 0, issues: [], errorCode: null };

  await write({ ...empty, status: "running" });
  try {
    const outcome = await importEvalSet({ db, storage }, payload);
    await write({ ...outcome, status: "done", errorCode: null });
    logger.info(
      { batchId: payload.batchId, created: outcome.created, issues: outcome.issues.length },
      "eval set imported",
    );
  } catch (error) {
    if (error instanceof EvalImportError) {
      // The sheet itself is unusable: retrying cannot help, the admin fixes it and uploads again.
      await write({ ...empty, status: "failed", errorCode: error.code });
      logger.warn({ batchId: payload.batchId, code: error.code }, "eval import refused");
      return;
    }
    await write({ ...empty, status: "failed", errorCode: "internal" });
    throw error;
  }
}
