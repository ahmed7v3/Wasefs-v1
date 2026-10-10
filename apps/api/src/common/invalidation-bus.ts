import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "./redis.js";

/**
 * Redis pub/sub between API instances, so a change made on one instance drops the in-process caches
 * of all the others at once (settings, flags). One dedicated subscriber connection serves every
 * channel: a connection in subscriber mode cannot run other commands, so it is never the shared one.
 * Publishing and subscribing are best effort: when Redis is down the 30 second cache TTL is the
 * fallback, and a request never fails because of it.
 */
@Injectable()
export class InvalidationBus implements OnApplicationShutdown {
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, (message: string) => void>();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("InvalidationBus");
    this.subscriber = redis.duplicate();
    this.subscriber.on("message", (channel: string, message: string) => {
      this.handlers.get(channel)?.(message);
    });
    // A failed first subscribe (Redis not up yet) is retried at every (re)connect.
    this.subscriber.on("ready", () => {
      for (const channel of this.handlers.keys()) void this.subscribe(channel);
    });
    this.subscriber.on("error", (error: Error) => {
      this.logger.warn({ reason: error.message }, "Invalidation subscriber error");
    });
  }

  /** One handler per channel. */
  on(channel: string, handler: (message: string) => void): void {
    this.handlers.set(channel, handler);
    void this.subscribe(channel);
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.redis.publish(channel, message);
    } catch (error) {
      this.logger.warn({ reason: (error as Error).message }, "Invalidation publish failed");
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  private async subscribe(channel: string): Promise<void> {
    try {
      await this.subscriber.subscribe(channel);
    } catch (error) {
      this.logger.warn(
        { reason: (error as Error).message, channel },
        "Invalidation subscribe failed",
      );
    }
  }
}

/** Global, so a service needing cross-instance invalidation just injects `InvalidationBus`. */
@Global()
@Module({ providers: [InvalidationBus], exports: [InvalidationBus] })
export class InvalidationModule {}
