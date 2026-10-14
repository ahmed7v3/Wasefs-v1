import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { DEFAULT_JOB_OPTIONS, type JobInput } from "@wasfa/shared/queues";
import {
  EVAL_IMPORT_REPORT_TTL_SECONDS,
  evalImportReportKey,
  evalImportReportSchema,
  type EvalImportReport,
} from "@wasfa/shared/schemas/admin-evals";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";

/**
 * The api's way to the `evals` queue, and the import reports the worker leaves in Redis. A run is
 * tried once: it resumes by itself where it stopped when the admin starts it again, and retrying a
 * run that spends provider money behind the admin's back is not wanted.
 */
@Injectable()
export class EvalsQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    this.queue = new Queue("evals", {
      connection: redis,
      defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 1 },
    });
  }

  async startRun(runId: string): Promise<void> {
    await this.queue.add("evals.run", { runId }, { jobId: `eval-run-${runId}` });
  }

  async startImport(payload: JobInput<"evals", "evals.import">): Promise<void> {
    const queued: Omit<EvalImportReport, "id"> = {
      status: "queued",
      setId: null,
      created: 0,
      issues: [],
      errorCode: null,
    };
    await this.redis.set(
      evalImportReportKey(payload.batchId),
      JSON.stringify({ id: payload.batchId, ...queued }),
      "EX",
      EVAL_IMPORT_REPORT_TTL_SECONDS,
    );
    await this.queue.add("evals.import", payload, { jobId: `eval-import-${payload.batchId}` });
  }

  async report(batchId: string): Promise<EvalImportReport | null> {
    const raw = await this.redis.get(evalImportReportKey(batchId));
    if (raw === null) return null;
    const parsed = evalImportReportSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
