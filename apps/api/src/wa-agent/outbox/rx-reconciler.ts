import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { RxQueue } from "../../rx/rx-queue.js";

import { RxReconcilerRepo } from "./rx-reconciler.repo.js";

/** An analysis queued for longer than this has most likely lost its job (a crash between commit and enqueue). */
export const RX_RECONCILE_AFTER_MS = 120_000;
const SWEEP_LIMIT = 100;

/**
 * Adds the worker job of WhatsApp analyses whose enqueue after the start transaction never happened
 * (docs/WA-AGENT-RUNTIME.md section 17.3, step 6). The job id is the analysis id, so a job that exists
 * is not added twice. It touches no credits: the hold expires through the existing credit job.
 * The outbox sweep calls `sweep()` every 30 seconds.
 */
@Injectable()
export class RxReconciler {
  constructor(
    private readonly repo: RxReconcilerRepo,
    private readonly queue: RxQueue,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("RxReconciler");
  }

  /** Returns how many analyses it tried to enqueue. */
  async sweep(now: Date = new Date()): Promise<number> {
    const ids = await this.repo.stuckQueued(
      new Date(now.getTime() - RX_RECONCILE_AFTER_MS),
      SWEEP_LIMIT,
    );
    for (const id of ids) {
      try {
        await this.queue.analyze(id);
      } catch (error) {
        // The next sweep tries again.
        this.logger.error(
          { rxId: id, reason: error instanceof Error ? error.name : "unknown" },
          "rx job could not be re-queued",
        );
      }
    }
    return ids.length;
  }
}
