import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../common/redis.js";

type Listener = (message: string) => void;

/**
 * One Redis subscriber connection shared by every open `GET /rx/:id/events` stream of this api
 * instance (a connection in subscriber mode cannot run other commands, so it is never the shared
 * one). The worker publishes on `rx:<id>`; a channel is released when its last stream goes.
 */
@Injectable()
export class RxEventHub implements OnApplicationShutdown {
  private readonly subscriber: Redis;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    @Inject(REDIS) redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("RxEventHub");
    this.subscriber = redis.duplicate();
    this.subscriber.on("message", (channel: string, message: string) => {
      for (const listener of this.listeners.get(channel) ?? []) listener(message);
    });
    // A failed subscribe (Redis not up yet) is retried at every (re)connect.
    this.subscriber.on("ready", () => {
      for (const channel of this.listeners.keys()) void this.subscribe(channel);
    });
    this.subscriber.on("error", (error: Error) => {
      this.logger.warn({ reason: error.message }, "Rx subscriber error");
    });
  }

  /** Resolves once Redis confirms the subscription; returns the function that stops listening. */
  async listen(channel: string, listener: Listener): Promise<() => void> {
    let set = this.listeners.get(channel);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    if (isNew) await this.subscribe(channel);
    return () => {
      const current = this.listeners.get(channel);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(channel);
        void this.subscriber.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.subscriber.quit().catch(() => this.subscriber.disconnect());
  }

  private async subscribe(channel: string): Promise<void> {
    try {
      await this.subscriber.subscribe(channel);
    } catch (error) {
      this.logger.warn({ reason: (error as Error).message }, "Rx subscribe failed");
    }
  }
}
