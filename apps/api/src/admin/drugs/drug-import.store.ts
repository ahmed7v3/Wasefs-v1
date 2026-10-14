import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import {
  DRUG_IMPORT_BUSY_SECONDS,
  DRUG_IMPORT_TTL_SECONDS,
  drugImportKeys,
} from "@wasfa/shared/drugs";
import { drugImportPayloadSchema } from "@wasfa/shared/queues";
import {
  importProgressSchema,
  importReportSchema,
  type ImportProgress,
  type ImportReport,
} from "@wasfa/shared/schemas/admin-drugs";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { API_ENV } from "../../config/config.module.js";

import type { ApiEnv } from "../../config/env.js";

/** One try: a failed import is shown to the admin, who starts it again (a commit is safe to repeat). */
const IMPORT_JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} as const;

/**
 * Where an import lives while it runs: the uploaded file (up to 20 MB), the progress and the report,
 * all in Redis with a 24 h expiry, and the `drugs.import` queue. It has its own connection because
 * the shared one gives every command one second, which a 20 MB upload does not always get.
 */
@Injectable()
export class DrugImportStore implements OnApplicationShutdown {
  private readonly redis: Redis;
  private readonly queue: Queue;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
      commandTimeout: 30_000,
    });
    this.queue = new Queue("drugs", { connection: this.redis });
  }

  async putFile(batchId: string, bytes: Buffer): Promise<void> {
    await this.redis.set(drugImportKeys(batchId).file, bytes, "EX", DRUG_IMPORT_TTL_SECONDS);
  }

  async hasFile(batchId: string): Promise<boolean> {
    return (await this.redis.exists(drugImportKeys(batchId).file)) === 1;
  }

  /** Marks the batch as being worked on; `false` when another job for it is queued or running. */
  async tryLock(batchId: string): Promise<boolean> {
    const result = await this.redis.set(
      drugImportKeys(batchId).busy,
      "1",
      "EX",
      DRUG_IMPORT_BUSY_SECONDS,
      "NX",
    );
    return result === "OK";
  }

  async unlock(batchId: string): Promise<void> {
    await this.redis.del(drugImportKeys(batchId).busy);
  }

  async isBusy(batchId: string): Promise<boolean> {
    return (await this.redis.exists(drugImportKeys(batchId).busy)) === 1;
  }

  /** Queues a run. The caller holds the lock; it is released by the worker (or by the caller on error). */
  async start(
    batchId: string,
    mode: "dry_run" | "commit",
    actorId: string | undefined,
  ): Promise<void> {
    const keys = drugImportKeys(batchId);
    const queued: ImportProgress = { mode, phase: "queued", done: 0, total: 0, error: null };
    // A fresh run replaces the old report so the screen never shows a stale one.
    await this.redis.del(keys.report);
    await this.redis.set(keys.progress, JSON.stringify(queued), "EX", DRUG_IMPORT_TTL_SECONDS);
    const payload = drugImportPayloadSchema.parse({ batchId, mode, actorId });
    await this.queue.add("drugs.import", payload, IMPORT_JOB_OPTIONS);
  }

  async progress(batchId: string): Promise<ImportProgress | null> {
    return this.readJson(drugImportKeys(batchId).progress, importProgressSchema);
  }

  async report(batchId: string): Promise<ImportReport | null> {
    return this.readJson(drugImportKeys(batchId).report, importReportSchema);
  }

  private async readJson<T>(
    key: string,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  ): Promise<T | null> {
    const text = await this.redis.get(key);
    if (text === null) return null;
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.redis.quit().catch(() => {
      this.redis.disconnect();
    });
  }
}
