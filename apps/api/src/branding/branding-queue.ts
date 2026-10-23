import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** The api's only way to start icon generation: a `branding.icons` job on the `images` queue (sharp lives in the worker). */
@Injectable()
export class BrandingQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue("images", { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }

  /**
   * One job per symbol digest (BullMQ ids may not contain ":"). A finished job with the same id is
   * kept for a while, so it is dropped first: uploading the same symbol again, or reverting to it,
   * must render the set again. A job still waiting or running is left alone: it is that work.
   */
  async icons(sha256: string): Promise<void> {
    const jobId = `branding-icons-${sha256}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "completed" || state === "failed") await existing.remove();
    }
    await this.queue.add("branding.icons", { sha256 }, { jobId });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
