import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { newId } from "@wasfa/shared/ids";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { TELEGRAM_RX_PDF_JOB, type TelegramRxPdfPayload } from "@wasfa/shared/schemas/telegram-pdf";
import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";

import type { ApiEnv } from "../config/env.js";

/**
 * The api's door to the worker's Typst renderer for the Telegram PDF: a `telegram.rx-pdf` job on the
 * `documents` queue, awaited through QueueEvents. Resolves with the storage key the worker returned.
 * The events connection is dedicated (a blocking read cannot share the api's command-timeout one)
 * and opened on first use, so an api that never sends a PDF holds no extra connection.
 */
@Injectable()
export class TelegramPdfQueue implements OnApplicationShutdown {
  private readonly queue: Queue;
  private events: QueueEvents | undefined;
  private eventsRedis: Redis | undefined;

  constructor(
    @Inject(REDIS) redis: Redis,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.queue = new Queue("documents", {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  async render(payload: TelegramRxPdfPayload, timeoutMs: number): Promise<string> {
    if (this.events === undefined) {
      this.eventsRedis = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
      this.events = new QueueEvents("documents", { connection: this.eventsRedis });
    }
    await this.events.waitUntilReady();
    // A fresh id per request: a retained failed job with a fixed id would swallow every retry.
    const job = await this.queue.add(TELEGRAM_RX_PDF_JOB, payload, {
      jobId: `tg-pdf-${newId()}`,
      attempts: 2,
    });
    const key: unknown = await job.waitUntilFinished(this.events, timeoutMs);
    if (typeof key !== "string") throw new Error("pdf_key_missing");
    return key;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.events?.close().catch(() => undefined);
    this.eventsRedis?.disconnect();
    await this.queue.close();
  }
}
