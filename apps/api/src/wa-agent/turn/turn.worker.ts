import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { API_ENV } from "../../config/config.module.js";
import { SettingsService } from "../../settings/settings.service.js";

import { TurnRunner } from "./turn-runner.js";
import { TURN_QUEUE, turnJobSchema } from "./turn.queue.js";

import type { ApiEnv } from "../../config/env.js";

/**
 * Runs the `wa-agent-turns` jobs in the api process (the business services live here). Always started: an
 * idle worker costs one connection, and the `waAgent.runtime.v2` switch decides whether anything is
 * enqueued. Concurrency is read once, when the worker starts. Logs ids only.
 */
@Injectable()
export class TurnWorker implements OnModuleInit, OnApplicationShutdown {
  private worker: Worker | undefined;
  private connection: Redis | undefined;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly settings: SettingsService,
    private readonly runner: TurnRunner,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentTurnWorker");
  }

  async onModuleInit(): Promise<void> {
    const { runtime } = await this.settings.get("waAgent");
    // A worker blocks on its connection, so it gets its own without the shared command timeout.
    this.connection = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on("error", (error: Error) => {
      this.logger.error({ reason: error.message }, "Turn worker connection error");
    });
    this.worker = new Worker(TURN_QUEUE, (job) => this.process(job), {
      connection: this.connection,
      concurrency: runtime.concurrency,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.warn(
        { jobId: job?.id, attempt: job?.attemptsMade, reason: error.name },
        "Agent turn job failed",
      );
    });
    this.worker.on("error", (error) => {
      this.logger.error({ reason: error.name }, "Turn worker error");
    });
  }

  async process(job: Job): Promise<void> {
    const { conversationId } = turnJobSchema.parse(job.data);
    await this.runner.run(conversationId);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    this.connection?.disconnect();
  }
}
