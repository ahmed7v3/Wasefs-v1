import { Inject, Injectable } from "@nestjs/common";
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
  ready: boolean;
  checks: Record<"database" | "redis", boolean>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly handle: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("HealthService");
  }

  async readiness(): Promise<ReadinessResult> {
    const [database, redis] = await Promise.allSettled([
      withTimeout(this.handle.sql`select 1`.execute(), CHECK_TIMEOUT_MS),
      withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS),
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
    return { ready, checks };
  }
}
