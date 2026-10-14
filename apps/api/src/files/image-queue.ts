import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** The api's only way to start image processing: an `image.process` job on the `images` queue. */
@Injectable()
export class ImageQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue("images", { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }

  /** One job per file: asking twice (a retried `complete`) does not process it twice. */
  async process(fileId: string): Promise<void> {
    await this.queue.add("image.process", { fileId }, { jobId: `image-process-${fileId}` });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
