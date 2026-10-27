import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { newId } from "@wasfa/shared/ids";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../../common/redis.js";

import type { WaRenderDocumentPayload } from "@wasfa/shared/schemas/wa-document";

/** The api's only way to make a file for the WhatsApp agent: a `wa-agent.render-document` job on the `documents` queue. */
@Injectable()
export class WaDocumentQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue("documents", {
      connection: redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }

  async render(payload: WaRenderDocumentPayload): Promise<void> {
    await this.queue.add("wa-agent.render-document", payload, { jobId: `wa-doc-${newId()}` });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
