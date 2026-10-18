import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { DEFAULT_JOB_OPTIONS } from "@wasfa/shared/queues";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

/** The api's only way to start a prescription analysis: an `rx.analyze` job on the `rx` queue. */
@Injectable()
export class RxQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: Redis) {
    this.queue = new Queue("rx", { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }

  /** One job per analysis: asking twice does not analyse twice. */
  async analyze(
    analysisId: string,
    options: { planOrgId?: string | undefined; routePlanId?: string | undefined } = {},
  ): Promise<void> {
    const payload = {
      analysisId,
      ...(options.planOrgId ? { planOrgId: options.planOrgId } : {}),
      ...(options.routePlanId ? { routePlanId: options.routePlanId } : {}),
    };
    await this.queue.add("rx.analyze", payload, { jobId: `rx-${analysisId}` });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
