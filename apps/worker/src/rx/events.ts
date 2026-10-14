import {
  RX_EVENT_TTL_SECONDS,
  rxChannel,
  rxEventSchema,
  rxLastEventKey,
  rxSeqKey,
  type RxEvent,
} from "@wasfa/shared/schemas/rx";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

type Step = Extract<RxEvent, { type: "step" }>["step"];

export interface RxPublisher {
  step(step: Step): Promise<void>;
  done(status: "done" | "refunded"): Promise<void>;
  failed(errorRef: string): Promise<void>;
}

/**
 * Progress events of one analysis on `rx:<id>` (the API relays them as SSE). `seq` comes from a
 * Redis counter, so it keeps growing across job retries. The last event is also stored, so a client
 * that connects late starts from the current step. Progress is a courtesy: a Redis hiccup is logged
 * and never fails the analysis.
 */
export function createRxPublisher(redis: Redis, analysisId: string, logger: Logger): RxPublisher {
  async function publish(event: (seq: number) => RxEvent): Promise<void> {
    try {
      const seq = await redis.incr(rxSeqKey(analysisId));
      await redis.expire(rxSeqKey(analysisId), RX_EVENT_TTL_SECONDS);
      const payload = JSON.stringify(rxEventSchema.parse(event(seq)));
      await redis.set(rxLastEventKey(analysisId), payload, "EX", RX_EVENT_TTL_SECONDS);
      await redis.publish(rxChannel(analysisId), payload);
    } catch (error) {
      logger.warn(
        { analysisId, reason: error instanceof Error ? error.message : "unknown" },
        "rx event not published",
      );
    }
  }

  return {
    step: (step) => publish((seq) => ({ type: "step", step, seq })),
    done: (status) => publish((seq) => ({ type: "done", status, seq })),
    failed: (errorRef) => publish((seq) => ({ type: "failed", errorRef, seq })),
  };
}
