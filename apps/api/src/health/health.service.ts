import { Inject, Injectable } from "@nestjs/common";
import { WORKER_HEARTBEAT_KEY, workerStatus, type WorkerStatus } from "@wasfa/shared/queues";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { DB, type DbHandle } from "../common/database.js";
import { REDIS } from "../common/redis.js";

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface ReadinessResult {
  /** Database and Redis are reachable. A stale worker does not make the API unready. */
  ready: boolean;
  checks: Record<"database" | "redis", boolean>;
  worker: WorkerStatus;
}

@Injectable()
export class HealthService {
  private lastWorker: WorkerStatus | undefined;

  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("HealthService");
  }

  async readiness(): Promise<ReadinessResult> {
    const [database, redis, heartbeat] = await Promise.allSettled([
      withTimeout(this.handle.sql`select 1`.execute(), CHECK_TIMEOUT_MS),
      withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS),
      withTimeout(this.redis.get(WORKER_HEARTBEAT_KEY), CHECK_TIMEOUT_MS),
    ]);
    const checks = {
      database: database.status === "fulfilled",
      redis: redis.status === "fulfilled",
    };
    const ready = checks.database && checks.redis;
    if (!ready) {
      // Component detail goes to logs only; the public body stays minimal.
      this.logger.warn({ checks }, "Readiness check failed");
    }
    const worker = workerStatus(heartbeat.status === "fulfilled" ? heartbeat.value : null);
    this.logWorkerChange(worker);
    return { ready, checks, worker };
  }

  /** Probes hit this every few seconds, so only state changes are logged. */
  private logWorkerChange(worker: WorkerStatus): void {
    if (worker === this.lastWorker) return;
    this.lastWorker = worker;
    if (worker === "stale") {
      this.logger.warn({ worker }, "Worker heartbeat is stale or missing");
    } else {
      this.logger.info({ worker }, "Worker heartbeat is healthy");
    }
  }
}
