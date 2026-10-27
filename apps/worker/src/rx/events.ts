import {
  RX_EVENT_TTL_SECONDS,
  rxChannel,
  rxEventSchema,
  rxLastEventKey,
  rxSeqKey,
  type RxEvent,
} from "@wasfa/shared/schemas/rx";
import { waAgentRxKey } from "@wasfa/shared/schemas/wa-agent";

import { pushWaAgentEvent } from "../notifications/wa-agent-events.js";

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

  /**
   * Tells the WhatsApp agent a reading it started has ended (`wa:agent:rx:<id>` exists only for
   * those). Nothing is sent for web analyses, and a failure here never touches the analysis.
   */
  async function followUp(type: "rx_done" | "rx_failed"): Promise<void> {
    try {
      if ((await redis.exists(waAgentRxKey(analysisId))) === 1) {
        await pushWaAgentEvent(redis, { type, rxId: analysisId });
      }
    } catch (error) {
      logger.warn(
        { analysisId, reason: error instanceof Error ? error.message : "unknown" },
        "WhatsApp agent rx event not queued",
      );
    }
  }

  return {
    step: (step) => publish((seq) => ({ type: "step", step, seq })),
    done: async (status) => {
      await publish((seq) => ({ type: "done", status, seq }));
      // A refunded analysis found nothing readable: the customer hears "could not read".
      await followUp(status === "done" ? "rx_done" : "rx_failed");
    },
    failed: async (errorRef) => {
      await publish((seq) => ({ type: "failed", errorRef, seq }));
      await followUp("rx_failed");
    },
  };
}
