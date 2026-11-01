import { AiProviderError } from "@wasfa/ai";
import { actionFor, classify } from "@wasfa/shared/wa-agent/failure";

import { signalOf } from "./failure-policy.js";

/** A model step that failed, as the round's step loop sees it. */
export interface StepFailure {
  error: unknown;
  /** Retries of this very step already made. */
  retriesUsed: number;
  /** A tool that changes something already ran in this turn. */
  effectsRan: boolean;
  /** Any tool ran (v1 stops retrying then, because the router is not allowed to fall back). */
  toolsRan: boolean;
  /** The turn's own budget and lock: aborted means there is no time left to retry. */
  turnSignal: AbortSignal;
}

/** Decides whether a failed step runs again; resolves after the pause when it does. */
export type StepRetry = (failure: StepFailure) => Promise<boolean>;

/** v1: one retry of a provider error that came before any tool ran (unchanged behaviour). */
export function singleRetry(sleep: (ms: number) => Promise<void>, delayMs: number): StepRetry {
  return async ({ error, retriesUsed, toolsRan }) => {
    if (retriesUsed > 0 || toolsRan || !(error instanceof AiProviderError)) return false;
    await sleep(delayMs);
    return true;
  };
}

/**
 * v2: a transient error before any effect repeats the same step after 1.5 s, then 4 s (the delays and the
 * decision are the shared failure policy's). Anything else is the caller's to classify.
 */
export function ladderRetry(sleep: (ms: number) => Promise<void>): StepRetry {
  return async ({ error, retriesUsed, effectsRan, turnSignal }) => {
    if (effectsRan || turnSignal.aborted) return false;
    const cls = classify(signalOf(error, { turnSignal }), { effectsRan: false });
    if (cls !== "transient") return false;
    const action = actionFor(cls, {
      attempt: 1,
      jobRetries: 0,
      stepRetriesUsed: retriesUsed,
      reasked: false,
      customerTextAllowed: true,
      customerTextInMs: 0,
      rateDeferred: false,
    });
    if (action.type !== "retry_step") return false;
    await sleep(action.delayMs);
    return true;
  };
}
