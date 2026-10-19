import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** The api's only way to start media processing: a `media.process` job on the `images` queue (sharp is CPU-heavy there too). */
@Injectable()
export class MediaQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue("images", { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }

  /** One job per asset: committing twice does not process it twice. */
  async process(assetId: string): Promise<void> {
    await this.queue.add("media.process", { assetId }, { jobId: `media-process-${assetId}` });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
