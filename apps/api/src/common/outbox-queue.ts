import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";

import { REDIS } from "./redis.js";

@Injectable()
export class OutboxQueue implements OnApplicationShutdown {
  private readonly queue: Queue;

  constructor(@Inject(REDIS) redis: import("ioredis").Redis) {
    this.queue = new Queue("payments", { connection: redis });
  }

  async kick(idempotencyKey: string): Promise<void> {
    const safeJobId = idempotencyKey.replaceAll(":", "-");
    await this.queue.add("outbox.drain", {}, { jobId: `outbox-drain-now-${safeJobId}` });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

@Global()
@Module({ providers: [OutboxQueue], exports: [OutboxQueue] })
export class OutboxQueueModule {}
