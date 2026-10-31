import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";

export const TURN_QUEUE = "wa-agent-turns";
const JITTER = 0.25;
const RETRY_BACKOFF_MS = 20_000;

export const turnJobSchema = z.object({ conversationId: z.uuid() });
export type TurnJob = z.infer<typeof turnJobSchema>;

/** BullMQ ids must not contain `:` (it is the key separator), hence the dash. */
export const turnDedupId = (conversationId: string) => `wa-turn-${conversationId}`;

/** The reply delay (`waAgent.replyDelaySeconds`) with the same plus or minus 25 % jitter the bridge uses. */
export function debounceDelayMs(replyDelaySeconds: number, random: number): number {
  return Math.round(replyDelaySeconds * 1_000 * (1 + (random * 2 - 1) * JITTER));
}

/** What the runner and the inbound consumer need from the queue (tests replace it). */
export interface TurnEnqueuer {
  /** Schedules a turn for the conversation; calls within the delay collapse into one job. */
  enqueue: (conversationId: string) => Promise<void>;
}

/**
 * The `wa-agent-turns` queue (docs/WA-AGENT-RUNTIME.md §4.3). One delayed job per conversation: BullMQ's
 * debounce deduplication (`ttl` + `extend` + `replace`, bullmq >= 5.x) swaps the waiting job for a fresh one
 * on every new message, so a burst of messages becomes a single turn that starts once the customer paused.
 */
@Injectable()
export class TurnQueue implements TurnEnqueuer, OnApplicationShutdown {
  private readonly queue: Queue<TurnJob>;
  /** Replaced by tests. */
  random: () => number = () => Math.random();

  constructor(
    @Inject(REDIS) redis: Redis,
    private readonly settings: SettingsService,
  ) {
    this.queue = new Queue<TurnJob>(TURN_QUEUE, { connection: redis });
  }

  async enqueue(conversationId: string): Promise<void> {
    const config = await this.settings.get("waAgent");
    await this.add(
      conversationId,
      debounceDelayMs(config.replyDelaySeconds, this.random()),
      config.runtime.jobAttempts,
    );
  }

  /** `delayMs` is both the wait and the debounce window. */
  async add(conversationId: string, delayMs: number, jobAttempts: number): Promise<void> {
    await this.queue.add(
      "turn",
      { conversationId },
      {
        delay: delayMs,
        deduplication: {
          id: turnDedupId(conversationId),
          ttl: delayMs,
          extend: true,
          replace: true,
        },
        // `jobAttempts` counts retries, BullMQ's `attempts` counts runs.
        attempts: jobAttempts + 1,
        backoff: { type: "exponential", delay: RETRY_BACKOFF_MS },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1_000 },
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
