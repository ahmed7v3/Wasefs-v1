import {
  RX_EVENT_TTL_SECONDS,
  rxChannel,
  rxEventSchema,
  rxLastEventKey,
  rxSeqKey,
  type RxEvent,
  type RxResult,
} from "@wasfa/shared/schemas/rx";
import { waAgentRxKey, type WaRxFailureReason } from "@wasfa/shared/schemas/wa-agent";

import { pushWaAgentEvent } from "../notifications/wa-agent-events.js";

import type { Redis } from "ioredis";
import type { Logger } from "pino";

type Step = Extract<RxEvent, { type: "step" }>["step"];

/** Makes the PDF of a finished reading for the WhatsApp agent; `render` gives the stored key or null. */
export interface RxPdfPort {
  render(result: RxResult): Promise<string | null>;
  /** Removes a PDF that no event points to. */
  discard(key: string): Promise<void>;
}

/** Why a reading ended without a result, and whether the ledger really gave the credits back (observed, never assumed). */
export interface RxFailure {
  reason: WaRxFailureReason;
  creditsReturned: boolean;
}

export interface RxPublisher {
  step(step: Step): Promise<void>;
  done(status: "done" | "refunded", result?: RxResult, failure?: RxFailure): Promise<void>;
  failed(errorRef: string, failure?: RxFailure): Promise<void>;
}

/**
 * Progress events of one analysis on `rx:<id>` (the API relays them as SSE). `seq` comes from a
 * Redis counter, so it keeps growing across job retries. The last event is also stored, so a client
 * that connects late starts from the current step. Progress is a courtesy: a Redis hiccup is logged
 * and never fails the analysis.
 */
export function createRxPublisher(
  redis: Redis,
  analysisId: string,
  logger: Logger,
  pdf?: RxPdfPort,
  /** True when a `wa_outbox` route waits for this analysis (v2 starts write no Redis key). */
  routed?: () => Promise<boolean>,
): RxPublisher {
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
  async function followUp(
    type: "rx_done" | "rx_failed",
    result?: RxResult,
    failure?: RxFailure,
  ): Promise<void> {
    let pdfKey: string | null = null;
    try {
      if ((await redis.exists(waAgentRxKey(analysisId))) === 1 || ((await routed?.()) ?? false)) {
        // The PDF is a courtesy on top of the text result: any problem leaves it out and the text still goes.
        if (type === "rx_done" && result !== undefined && pdf !== undefined) {
          pdfKey = await pdf.render(result).catch(() => null);
        }
        await pushWaAgentEvent(
          redis,
          type === "rx_done"
            ? { type, rxId: analysisId, ...(pdfKey === null ? {} : { pdfKey }) }
            : { type, rxId: analysisId, ...(failure ?? {}) },
        );
      }
    } catch (error) {
      // Nothing points to the PDF any more.
      if (pdfKey !== null && pdf !== undefined) await pdf.discard(pdfKey);
      logger.warn(
        { analysisId, reason: error instanceof Error ? error.message : "unknown" },
        "WhatsApp agent rx event not queued",
      );
    }
  }

  return {
    step: (step) => publish((seq) => ({ type: "step", step, seq })),
    done: async (status, result, failure) => {
      await publish((seq) => ({ type: "done", status, seq }));
      // A refunded analysis found nothing readable: the customer hears "could not read".
      await followUp(status === "done" ? "rx_done" : "rx_failed", result, failure);
    },
    failed: async (errorRef, failure) => {
      await publish((seq) => ({ type: "failed", errorRef, seq }));
      await followUp("rx_failed", undefined, failure);
    },
  };
}
